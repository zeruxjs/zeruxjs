import type {
  AnalyticsConfig,
  AnalyticsConnection,
  AnalyticsEventInput,
  AnalyticsRow,
  AnalyticsSummaryQuery,
  AnalyticsAggregateQuery,
  AnalyticsNumericAggregateQuery,
  DatabaseResultLike,
} from './types.js';
import {
  validateEvent,
  validateTableName,
  validateRegisteredEvent,
} from './validation.js';
import { isEventSchemaRegistry } from './schemas.js';
import {
  createAnalyticsAnalysis,
  type AnalyticsAnalysisOptions,
} from './analysis.js';
import { createDatabaseRequestIdStore } from './request-id.js';
import { createDatabaseDocumentStore } from './documents.js';
import { aggregateEventCounts } from './aggregation.js';
import { aggregateNumericFacts } from './numeric.js';
import { reconcileNumericFacts, numericFactId } from './reconciliation.js';
import type { NumericReconciliationQuery } from './reconciliation.js';
import { createNumericReconciliationJob } from './jobs.js';
import type {
  NumericReconciliationJobOptions,
  NumericReconciliationJobDocument,
} from './jobs.js';
import type { DocumentConnection, VersionedDocument } from './documents.js';
import { createHash } from 'node:crypto';
import { purgeAnalyticsEvents, validateRetentionQuery } from './retention.js';
import type { AnalyticsRetentionQuery } from './retention.js';

/** Create best-effort tracking and explicit reporting/admin operations over a named database.
 * Tracking and legacy reads absorb failures; native reports and administrative operations can reject.
 * The host owns connection shutdown, tenant authorization and trusted filter callbacks.
 * @param {AnalyticsConfig} config - Optional named database, consent, schema and numeric policies.
 * @returns {AnalyticsManager} Generation-scoped manager; construction starts no migration or background task.
 */
export function createAnalytics(config: AnalyticsConfig = {}) {
  config = config ?? {};
  /** Fixed warning categories already emitted by this manager; private causes and event values are excluded. */
  const warnings = new Set<string>();
  /** Emit each fixed warning category once without letting a warning hook break telemetry.
   * @param {string} code - Package-authored diagnostic category, never raw private input.
   * @returns {void} Records the category even when the host warning callback throws. */
  const warn = (code: string) => {
    if (warnings.has(code)) {
      return;
    }
    warnings.add(code);
    try {
      (config.onWarning ?? ((message: string) => console.warn(message)))(
        `[analytics] ${code}`
      );
    } catch {
      /* warning hooks are also best-effort */
    }
  };
  let table = 'analytics_events';
  let invalidTable = false;
  try {
    table = validateTableName(config.table ?? table);
  } catch {
    invalidTable = true;
    warn('invalid table configuration; analytics disabled');
  }
  let configurationValid = !invalidTable;
  let enabled = config.enabled !== false && configurationValid;
  let schemas: AnalyticsConfig['eventSchemas'];
  try {
    if (config.eventSchemas !== undefined) {
      if (
        !config.eventSchemas ||
        typeof config.eventSchemas !== 'object' ||
        Array.isArray(config.eventSchemas) ||
        Object.keys(config.eventSchemas).length > 100
      ) {
        throw new TypeError();
      }
      // Validate each legacy allowlist before enabling collection.
      for (const [name, schema] of Object.entries(config.eventSchemas)) {
        if (
          !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(name) ||
          !schema ||
          typeof schema !== 'object' ||
          !schema.properties ||
          Object.keys(schema.properties).length > 40
        ) {
          throw new TypeError();
        }
        // Legacy fields accept only the declared inert scalar kinds.
        for (const [key, type] of Object.entries(schema.properties)) {
          if (
            !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(key) ||
            !['string', 'number', 'boolean', 'null'].includes(type)
          ) {
            throw new TypeError();
          }
        }
      }
      schemas = config.eventSchemas;
    }
  } catch {
    warn('invalid event schemas; collection disabled');
    configurationValid = false;
    enabled = false;
  }
  /** Validated package-instance registry, kept separate from the legacy schema allowlist. */
  const registry = isEventSchemaRegistry(config.schemaRegistry)
    ? config.schemaRegistry
    : undefined;
  if (config.schemaRegistry !== undefined && !registry) {
    warn('invalid schema registry; collection disabled');
    configurationValid = false;
    enabled = false;
  }
  if (registry && schemas) {
    warn('conflicting event schema configuration; collection disabled');
    configurationValid = false;
    enabled = false;
  }
  /** Validate an event row without filtering, reserving correlation or writing storage.
   * @param {AnalyticsEventInput} input - Untrusted event fields after host boundary checks.
   * @returns {AnalyticsRow} Validated row with optional registered provenance; invalid data throws.
   */
  function validateInput(input: AnalyticsEventInput) {
    return validateRegisteredEvent(input, registry);
  }
  /** Explicit policy fencing legacy deletion when a durable ledger owns retention. */
  const durableRetention = config.durableRetention === true;
  if (
    config.durableRetention !== undefined &&
    typeof config.durableRetention !== 'boolean'
  ) {
    warn('invalid durable retention policy; collection disabled');
    configurationValid = false;
    enabled = false;
  }
  if (
    config.webConsent !== undefined &&
    !['required', 'optional'].includes(config.webConsent)
  ) {
    warn('invalid web consent configuration; collection disabled');
    configurationValid = false;
    enabled = false;
  }
  // Numeric materialization is explicit. Never silently opt in every property.
  let numericFields: string[] = [];
  try {
    if (config.numericFields !== undefined) {
      if (
        !Array.isArray(config.numericFields) ||
        config.numericFields.length > 8 ||
        new Set(config.numericFields).size !== config.numericFields.length ||
        config.numericFields.some(
          (field) =>
            typeof field !== 'string' ||
            !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(field) ||
            ['constructor', 'prototype', '__proto__'].includes(field)
        )
      ) {
        throw new Error();
      }
      numericFields = [...config.numericFields];
    }
  } catch {
    warn(
      'invalid numericFields configuration; numeric materialization disabled'
    );
  }
  /** Stable sidecar name derived only from the validated event table identifier. */
  const numericTable = `${table.slice(0, 55)}_numeric`;
  let numericReady = false;
  let numericIndexed = 0;
  let numericDropped = 0;
  let numericUniqueIndexReady = false;
  /** Explicit named connection; no fallback to an unrelated application database. */
  const databaseName = config.analytics;
  /** Resolve the borrowed configured connection only while collection is valid and enabled.
   * @returns {AnalyticsConnection|undefined} Existing host facade, or undefined with a fixed warning on failure. */
  const locate = (): AnalyticsConnection | undefined => {
    if (!enabled) {
      return undefined;
    }
    try {
      if (
        !databaseName ||
        !config.database?.connectionSlugs?.includes(databaseName)
      ) {
        warn('configured database connector unavailable; event skipped');
        return undefined;
      }
      return config.database.getConnectionFacade(databaseName);
    } catch {
      warn('configured database connector unavailable; event skipped');
      return undefined;
    }
  };
  /** Require explicit database success instead of truthy transport presence.
   * @param {DatabaseResultLike|undefined} response - Settled connector result.
   * @returns {boolean} Whether the connector explicitly reported ok=true.
   */
  function succeeded(response: DatabaseResultLike | undefined): boolean {
    return response?.ok === true;
  }
  let initializing: Promise<boolean> | undefined;
  let initialized = false;
  let indexesReady = false;
  let recorded = 0;
  let dropped = 0;
  /** Generation-scoped facade over borrowed database services; it has no close handle. */
  const manager = {
    /** Explicit connection label; credentials remain inside the host database manager. */
    databaseConnection: databaseName,
    /** Create an explicitly authorized bounded analysis scope on this named connection.
     * @param {AnalyticsAnalysisOptions} options - Host principal/site binding and query lifecycle policy.
     * @returns {ReturnType<AnalyticsManager['createAnalysis']>} Analysis facade; its separate lifecycle remains caller-owned.
     */
    createAnalysis(options: AnalyticsAnalysisOptions) {
      return createAnalyticsAnalysis({ ...options, connection: locate, table });
    },
    /** Validate before collector correlation reservation without invoking filters or writes.
     * @param {AnalyticsEventInput} input - Candidate event fields.
     * @returns {void} Invalid rows throw; no persisted event is created.
     */
    validateInput(input: AnalyticsEventInput) {
      validateInput(input);
    },
    /** Describe registered schemas when explicitly configured.
     * @returns {ReturnType<AnalyticsManager['schemaCatalog']>} Immutable catalog description, or undefined for legacy collection.
     */
    schemaCatalog() {
      return registry?.describe();
    },
    /** Create an atomic UTC-day reservation adapter borrowing the named connection.
     * @returns {ReturnType<AnalyticsManager['createRequestIdStore']>} Store facade, or undefined when storage is unavailable.
     */
    createRequestIdStore() {
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      return connection ? createDatabaseRequestIdStore(connection) : undefined;
    },
    /** Create a versioned document adapter only when the borrowed connector supports updates.
     * @param {string} table - Explicit validated document table handled by the document adapter.
     * @param {string} id - Document identity within that table.
     * @param {T} initial - Initial versioned document, not an authorization grant.
     * @returns {ReturnType<AnalyticsManager['createDocumentStore']>} Borrowed CAS document store, or undefined without an update-capable connection.
     */
    createDocumentStore<T extends VersionedDocument>(
      table: string,
      id: string,
      initial: T
    ) {
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      return connection?.update
        ? createDatabaseDocumentStore(
            connection as DocumentConnection,
            table,
            id,
            initial
          )
        : undefined;
    },
    /** Read the effective switch, including fail-closed configuration validation.
     * @returns {boolean} Whether collection is currently enabled.
     */
    get enabled() {
      return enabled;
    },
    /** Check explicit numeric configuration without implying materialization completeness.
     * @param {string} field - Property name to inspect.
     * @returns {boolean} Whether the field was configured, independent of readiness or historical coverage.
     */
    supportsNumericField(field: string) {
      return numericFields.includes(field);
    },
    /** Toggle collection without bypassing invalid configuration.
     * @param {boolean} value - Only literal true enables a valid manager.
     * @returns {void} Updates the switch; no connection is started or closed.
     */
    setEnabled(value: boolean) {
      enabled = value === true && configurationValid;
    },
    /** Read fixed counters and configuration readiness; connection lookup may emit a warning.
     * @returns {ReturnType<AnalyticsManager['status']>} Snapshot of manager-local diagnostics, not a durable completeness receipt.
     */
    status() {
      return {
        schemaCoverageVersion: 1 as const,
        schemaCatalogId: registry?.describe().catalogId,
        enabled,
        configured: !!databaseName,
        connected: !!locate(),
        initialized,
        indexesReady,
        numericReady,
        numericIndexed,
        numericDropped,
        numericUniqueIndexReady,
        recorded,
        dropped,
        warnings: [...warnings],
      };
    },
    /** Explicitly create schemas and supported indexes with coalesced in-flight initialization.
     * @returns {Promise<boolean>} True for available core schema; optional sidecar/index failures have separate status. False on storage failure; later calls may retry.
     */
    async initialize(): Promise<boolean> {
      if (initializing) {
        return initializing;
      }
      if (initialized && (!numericFields.length || numericReady)) {
        return true;
      }
      if (!locate()) {
        return false;
      }
      if (!initializing) {
        initializing = (async () => {
          /** Borrowed named connection resolved for this operation; the host owns shutdown. */
          const connection = locate();
          if (!connection) {
            return false;
          }
          try {
            /** Settled database/report result checked before exposing successful persistence or counts. */
            const result = await connection.createTable({
              table,
              ifNotExists: true,
              columns: [
                { name: 'id', type: 'varchar', length: 36, primary: true },
                {
                  name: 'event_name',
                  type: 'varchar',
                  length: 96,
                  notNull: true,
                },
                { name: 'source', type: 'varchar', length: 16, notNull: true },
                { name: 'site', type: 'varchar', length: 200, notNull: true },
                { name: 'pathname', type: 'text', notNull: true },
                {
                  name: 'session_id',
                  type: 'varchar',
                  length: 128,
                  notNull: true,
                },
                { name: 'occurred_at', type: 'bigint', notNull: true },
                { name: 'properties_json', type: 'text', notNull: true },
              ],
            });
            if (!succeeded(result)) {
              warn('database schema initialization unavailable');
              return false;
            }
            initialized = true;
            if (numericFields.length) {
              try {
                /** Configured rule or schema operation result; it does not establish caller authorization. */
                const schema = await connection.createTable({
                  table: numericTable,
                  ifNotExists: true,
                  columns: [
                    { name: 'id', type: 'varchar', length: 140, primary: true },
                    {
                      name: 'event_id',
                      type: 'varchar',
                      length: 36,
                      notNull: true,
                    },
                    {
                      name: 'property_name',
                      type: 'varchar',
                      length: 96,
                      notNull: true,
                    },
                    { name: 'numeric_value', type: 'float', notNull: true },
                    {
                      name: 'event_name',
                      type: 'varchar',
                      length: 96,
                      notNull: true,
                    },
                    {
                      name: 'source',
                      type: 'varchar',
                      length: 16,
                      notNull: true,
                    },
                    {
                      name: 'site',
                      type: 'varchar',
                      length: 200,
                      notNull: true,
                    },
                    { name: 'pathname', type: 'text', notNull: true },
                    { name: 'occurred_at', type: 'bigint', notNull: true },
                  ],
                });
                numericReady = schema?.ok === true;
                if (
                  numericReady &&
                  config.indexes !== false &&
                  connection.createIndex
                ) {
                  // Required for cross-process reconciliation and legacy field-order changes.
                  try {
                    /** Database outcome for the event/property uniqueness constraint required by reconciliation. */
                    const uniq = await connection.createIndex({
                      table: numericTable,
                      name: `${numericTable.slice(0, 43)}_event_field_uq`,
                      columns: ['event_id', 'property_name'],
                      unique: true,
                      ifNotExists: true,
                    });
                    numericUniqueIndexReady = uniq?.ok === true;
                    if (!numericUniqueIndexReady) {
                      warn(
                        'numeric event/property uniqueness index unavailable; backfill disabled'
                      );
                    }
                  } catch {
                    numericUniqueIndexReady = false;
                    warn(
                      'numeric event/property uniqueness index unavailable; backfill disabled'
                    );
                  }
                  try {
                    /** Optional numeric read-index outcome; index failure does not disable core collection. */
                    const idx = await connection.createIndex({
                      table: numericTable,
                      name: `${numericTable.slice(0, 45)}_field_at`,
                      columns: ['property_name', 'occurred_at'],
                      ifNotExists: true,
                    });
                    if (
                      !idx?.ok &&
                      !['1061', 'ER_DUP_KEYNAME'].includes(
                        String(idx?.error?.code ?? '')
                      )
                    ) {
                      warn('numeric read index unavailable');
                    }
                  } catch {
                    warn('numeric read index unavailable');
                  }
                }
                if (
                  numericReady &&
                  config.indexes === false &&
                  config.numericUniqueIndexManagedExternally === true
                ) {
                  // Operator assertion: the external migration owns uniqueness enforcement.
                  numericUniqueIndexReady = true;
                }
                if (!numericReady) {
                  warn(
                    'numeric fact schema unavailable; core event tracking remains enabled'
                  );
                }
              } catch {
                numericReady = false;
                warn(
                  'numeric fact schema unavailable; core event tracking remains enabled'
                );
              }
            }
            if (config.indexes !== false && connection.createIndex) {
              /** Deterministic table hash suffix keeping truncated index names distinct. */
              const suffix = createHash('sha256')
                .update(table)
                .digest('hex')
                .slice(0, 8);
              /** Bounded stable prefix for the event read indexes. */
              const base = `${table.slice(0, 43)}_${suffix}`;
              indexesReady = true;
              // Index outcomes remain separate from core table/ingestion readiness.
              for (const [kind, columns] of [
                ['id', ['id']],
                ['at', ['occurred_at']],
                ['event', ['event_name', 'occurred_at']],
                ['site', ['site', 'occurred_at']],
              ] as const) {
                try {
                  /** Settled database response; a failed read/index operation is never treated as successful persistence. */
                  const response = await connection.createIndex({
                    table,
                    name: `${base}_${kind}`,
                    columns: [...columns],
                    unique: kind === 'id',
                    ifNotExists: true,
                  });
                  if (
                    !response?.ok &&
                    !['1061', 'ER_DUP_KEYNAME'].includes(
                      String(response?.error?.code ?? '')
                    )
                  ) {
                    indexesReady = false;
                  }
                } catch {
                  indexesReady = false;
                }
              }
              if (!indexesReady) {
                warn(
                  'some analytics read indexes could not be created; collection remains enabled'
                );
              }
            }
            return true;
          } catch {
            warn('database schema initialization unavailable');
            return false;
          }
        })().finally(() => {
          initializing = undefined;
        });
      }
      return initializing;
    },
    /** Persist a best-effort event after fresh filter/consent and schema checks.
     * @param {AnalyticsEventInput} input - Event fields; trusted host authorization is separate.
     * @returns {Promise<string|undefined>} Core persisted event ID, or undefined for disabled, invalid, denied or unavailable collection. Numeric writes remain separate.
     */
    async track(input: AnalyticsEventInput): Promise<string | undefined> {
      if (!enabled) {
        return undefined;
      }
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection) {
        dropped++;
        return undefined;
      }
      try {
        if (input?.consent === 'denied') {
          return undefined;
        }
        /** Trusted host filter result; consent is checked again before validating or writing it. */
        const filtered = config.filter ? await config.filter(input) : input;
        if (filtered === null || filtered.consent === 'denied') {
          return undefined;
        }
        if (
          (filtered.source ?? 'server') === 'web' &&
          config.webConsent === 'required' &&
          filtered.consent !== 'granted'
        ) {
          return undefined;
        }
        if (schemas) {
          /** Configured rule or schema operation result; it does not establish caller authorization. */
          const schema = Object.hasOwn(schemas, filtered.name)
            ? schemas[filtered.name]
            : undefined;
          if (!schema) {
            throw new TypeError('Unregistered event name');
          }
          // Reject unknown/mismatched fields before constructing a persisted row.
          for (const [key, value] of Object.entries(
            filtered.properties ?? {}
          )) {
            /** Legacy allowlisted scalar type for this own property, when configured. */
            const expected = Object.hasOwn(schema.properties, key)
              ? schema.properties[key]
              : undefined;
            if (!expected) {
              if (!schema.allowAdditionalProperties) {
                throw new TypeError('Unregistered event property');
              }
            } else if ((value === null ? 'null' : typeof value) !== expected) {
              throw new TypeError('Event property type mismatch');
            }
          }
        }
        /** Validated detached event row; its ID is returned only after the core insert succeeds. */
        const row = validateInput(filtered);
        /** Settled database/report result checked before exposing successful persistence or counts. */
        const result = await connection.insert({
          table,
          values: row as unknown as Record<string, string | number>,
        });
        if (!succeeded(result)) {
          warn('event storage unavailable; event skipped');
          dropped++;
          return undefined;
        }
        recorded++;
        if (numericFields.length) {
          /** Persisted scalar properties parsed for explicitly configured numeric projections only. */
          const props = JSON.parse(row.properties_json) as Record<
            string,
            unknown
          >;
          /** Finite configured numeric sidecars; their optional insert is separate from the committed event. */
          const facts = numericFields.flatMap((field) =>
            typeof props[field] === 'number' && Number.isFinite(props[field])
              ? [
                  {
                    id: numericFactId(row.id, field),
                    event_id: row.id,
                    property_name: field,
                    numeric_value: props[field] as number,
                    event_name: row.event_name,
                    source: row.source,
                    site: row.site,
                    pathname: row.pathname,
                    occurred_at: row.occurred_at,
                  },
                ]
              : []
          );
          if (facts.length) {
            if (!numericReady) {
              numericDropped += facts.length;
              warn('numeric facts not initialized; numeric value skipped');
            } else {
              try {
                /** Numeric sidecar insert result; failures update coverage counters without undoing the event. */
                const saved = await connection.insert({
                  table: numericTable,
                  values: facts,
                });
                if (saved?.ok) {
                  numericIndexed += facts.length;
                } else {
                  numericDropped += facts.length;
                  warn(
                    'numeric fact storage unavailable; numeric value skipped'
                  );
                }
              } catch {
                numericDropped += facts.length;
                warn('numeric fact storage unavailable; numeric value skipped');
              }
            }
          }
        }
        return row.id;
      } catch {
        warn('event storage unavailable or invalid event; event skipped');
        dropped++;
        return undefined;
      }
    },
    /** Count persisted events natively; reporting failures reject instead of fabricating zero.
     * @param {AnalyticsAggregateQuery} query - Validated grouping/filters with host-authorized site binding.
     * @returns {ReturnType<AnalyticsManager['aggregate']>} Persisted totals and bounded groups from separate database reads.
     */
    async aggregate(query: AnalyticsAggregateQuery) {
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection) {
        throw new Error('Analytics aggregate connector unavailable');
      }
      return aggregateEventCounts(connection, table, query);
    },
    /** Repair one explicit historical page only after numeric readiness and uniqueness checks.
     * @param {NumericReconciliationQuery} query - Host-authorized site/window and bounded continuation.
     * @returns {ReturnType<AnalyticsManager['reconcileNumeric']>} Page receipt; conflicts/storage failures reject and earlier fact writes may remain committed.
     */
    async reconcileNumeric(query: NumericReconciliationQuery) {
      if (!numericFields.length) {
        throw new Error('Numeric materialization is not configured');
      }
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection || !numericReady) {
        throw new Error('Numeric reconciliation connector unavailable');
      }
      if (!numericUniqueIndexReady) {
        throw new Error(
          'Numeric reconciliation requires a verified unique event/property index'
        );
      }
      return reconcileNumericFacts(
        connection,
        table,
        numericTable,
        numericFields,
        query
      );
    },
    /** Create a fenced durable coordinator for one immutable projection/window.
     * @param {string} id - Stable host-owned job identifier.
     * @param {NumericReconciliationQuery} query - Explicit authorized historical window.
     * @param {Pick<NumericReconciliationJobOptions, 'leaseMs'|'now'>|undefined} options - Optional lease duration and trusted clock.
     * @returns {ReturnType<AnalyticsManager['createReconciliationJob']>} Job facade using the borrowed CAS connection; unsupported readiness/capabilities reject.
     */
    createReconciliationJob(
      id: string,
      query: NumericReconciliationQuery,
      options?: Pick<NumericReconciliationJobOptions, 'leaseMs' | 'now'>
    ) {
      if (!numericFields.length || !numericReady || !numericUniqueIndexReady) {
        throw new Error(
          'Reconciliation job requires initialized numeric storage with a verified unique index'
        );
      }
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection?.update) {
        throw new Error(
          'Reconciliation job requires an atomic compare-and-swap database connector'
        );
      }
      /** Stable private document table for explicitly requested reconciliation jobs. */
      const jobTable = `${table.slice(0, 46)}_reconcile_jobs`;
      /** Hash binding a job to this event table, sidecar table and sorted configured fields. */
      const projectionKey = createHash('sha256')
        .update(
          JSON.stringify({
            table,
            numericTable,
            numericFields: [...numericFields].sort(),
          })
        )
        .digest('hex');
      /** CAS document adapter borrowing the same host connection; persistence lifecycle remains external. */
      const store =
        createDatabaseDocumentStore<NumericReconciliationJobDocument>(
          connection as DocumentConnection,
          jobTable,
          id,
          {
            version: 1,
            id,
            projectionKey,
            pass: 1,
            query: {
              since: query.since,
              until: query.until,
              ...(query.site !== undefined ? { site: query.site } : {}),
              batchSize: query.batchSize ?? 100,
            },
            status: 'pending',
            cursor: null,
            scanned: 0,
            created: 0,
            existing: 0,
            invalidRows: 0,
            expectedFacts: 0,
            pages: 0,
            epoch: 0,
            lease: null,
            updatedAt: Date.now(),
            lastError: null,
          }
        );
      return createNumericReconciliationJob({
        id,
        query,
        store,
        projectionKey,
        reconcile: (page) => manager.reconcileNumeric(page),
        ...options,
      });
    },
    /** Aggregate committed sidecars without claiming complete historical coverage.
     * @param {AnalyticsNumericAggregateQuery} query - Configured numeric field, metric and authorized filters.
     * @returns {ReturnType<AnalyticsManager['aggregateNumeric']>} Indexed-only result with optional declared unit provenance; unsupported fields/storage reject.
     */
    async aggregateNumeric(query: AnalyticsNumericAggregateQuery) {
      if (!numericFields.includes(query.valueField)) {
        throw new Error('Numeric property not configured for indexing');
      }
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection || !numericReady) {
        throw new Error('Numeric analytics connector unavailable');
      }
      /** Configured rule or schema operation result; it does not establish caller authorization. */
      const schema = registry?.metric(query.valueField, query.name);
      /** Settled database/report result checked before exposing successful persistence or counts. */
      const result = await aggregateNumericFacts(
        connection,
        numericTable,
        query
      );
      return { ...result, ...(schema ? { schema } : {}) };
    },
    /** Read one bounded recent-event page using explicit structured filters.
     * @param {AnalyticsSummaryQuery} query - Optional page/filter settings; default limit 100, maximum 500.
     * @returns {Promise<AnalyticsRow[]>} Returned rows, or an empty list on invalid query/storage failure; no exact-count guarantee.
     */
    async events(query: AnalyticsSummaryQuery = {}): Promise<AnalyticsRow[]> {
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection) {
        return [];
      }
      try {
        /** Bounded recent-event page size; compatibility counts never imply a complete historical scan. */
        const limit = query.limit ?? 100;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          throw new RangeError('Invalid limit');
        }
        /** Structured validated filters; tenant/site authorization must be supplied by the host. */
        const conditions: Array<{
          field: string;
          operator: 'eq' | 'gte' | 'lte';
          value: string | number;
        }> = [];
        if (query.name) {
          conditions.push({
            field: 'event_name',
            operator: 'eq',
            value: validateEvent({ name: query.name }).event_name,
          });
        }
        if (query.source) {
          if (!['web', 'email', 'server', 'system'].includes(query.source)) {
            throw new TypeError('Invalid source');
          }
          conditions.push({
            field: 'source',
            operator: 'eq',
            value: query.source,
          });
        }
        if (query.site !== undefined) {
          if (
            typeof query.site !== 'string' ||
            query.site.length > 200 ||
            // eslint-disable-next-line no-control-regex -- Reject controls in a site filter.
            /[\x00-\x1f]/.test(query.site)
          ) {
            throw new TypeError('Invalid site');
          }
          conditions.push({ field: 'site', operator: 'eq', value: query.site });
        }
        // Validate each optional inclusive timestamp filter independently.
        for (const [key, op] of [
          ['since', 'gte'],
          ['until', 'lte'],
        ] as const) {
          /** Optional timestamp bound validated before it becomes a database predicate. */
          const value = query[key];
          if (value !== undefined) {
            if (!Number.isSafeInteger(value) || value < 0) {
              throw new RangeError('Invalid timestamp');
            }
            conditions.push({ field: 'occurred_at', operator: op, value });
          }
        }
        /** Settled database response; a failed read/index operation is never treated as successful persistence. */
        const response = await connection.select({
          table,
          columns: [
            'id',
            'event_name',
            'source',
            'site',
            'pathname',
            'session_id',
            'occurred_at',
            'properties_json',
          ],
          ...(conditions.length
            ? {
                where:
                  conditions.length === 1 ? conditions[0] : { and: conditions },
              }
            : {}),
          orderBy: [{ by: 'occurred_at', direction: 'desc' }],
          limit,
        });
        if (!succeeded(response)) {
          warn('analytics query unavailable');
          return [];
        }
        return Array.isArray(response.rows)
          ? (response.rows as AnalyticsRow[])
          : [];
      } catch {
        warn('analytics query unavailable or invalid');
        return [];
      }
    },
    /** Count a bounded recent page while preserving legacy coverage labels.
     * @param {AnalyticsSummaryQuery} query - Optional filters and page limit, capped at 500.
     * @returns {ReturnType<AnalyticsManager['countsWithCoverage']>} Sampled-page or unavailable metadata; connection availability alone does not prove a successful read.
     */
    async countsWithCoverage(query: AnalyticsSummaryQuery = {}) {
      /** Bounded recent-event page size; compatibility counts never imply a complete historical scan. */
      const limit = Math.min(query.limit ?? 500, 500);
      /** Connection lookup availability only; it is not proof that the following read succeeds. */
      const available = !!locate();
      /** Bounded recent-event page used for compatibility results, not a full persisted total. */
      const rows = await manager.events({ ...query, limit });
      /** Null-prototype per-event counters limited to the returned recent page. */
      const counts: Record<string, number> = Object.create(null) as Record<
        string,
        number
      >;
      // Count only recognized event labels in the bounded returned page.
      for (const row of rows) {
        if (
          typeof row.event_name === 'string' &&
          /^[a-zA-Z][a-zA-Z0-9_.:-]{0,95}$/.test(row.event_name)
        ) {
          counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
        }
      }
      return {
        counts,
        scanned: rows.length,
        limit,
        coverage: available
          ? ('sampled-page' as const)
          : ('unavailable' as const),
        possiblyTruncated: !available || rows.length === limit,
      };
    },
    /** Preview or execute one retention page under explicit host approval.
     * @param {AnalyticsRetentionQuery} query - Required site/cutoff/page policy; destructive writes require approval.
     * @returns {ReturnType<AnalyticsManager['purgePage']>} Bounded retention receipt; durable-ledger conflicts, denied approval or unsupported storage reject.
     */
    async purgePage(query: AnalyticsRetentionQuery) {
      validateRetentionQuery(query);
      if (durableRetention) {
        throw new Error(
          'Durable retention requires its ledger preview and coordinated purge'
        );
      }
      /** Borrowed named connection resolved for this operation; the host owns shutdown. */
      const connection = locate();
      if (!connection?.delete || !initialized) {
        throw new Error(
          'Retention requires an initialized database with delete support'
        );
      }
      if (query.dryRun === false) {
        if (
          !config.approveRetention ||
          !(await config.approveRetention({
            site: query.site,
            before: query.before,
          }))
        ) {
          throw new Error('Retention approval denied');
        }
        if (numericFields.length && !numericReady) {
          throw new Error(
            'Numeric facts unavailable; refusing unsafe partial retention'
          );
        }
      }
      return purgeAnalyticsEvents(connection, table, numericTable, query, {
        numericTableReady: numericReady && numericFields.length > 0,
      });
    },
    /** Preserve legacy nonthrowing counts over at most 500 recent events.
     * @param {AnalyticsSummaryQuery} query - Optional recent-page filters; never a global historical count.
     * @returns {Promise<Record<string, number>>} Page counts, or an empty object on failure.
     */
    async counts(
      query: AnalyticsSummaryQuery = {}
    ): Promise<Record<string, number>> {
      try {
        /** Bounded recent-event page used for compatibility results, not a full persisted total. */
        const rows = await manager.events({
          ...query,
          limit: Math.min(query.limit ?? 500, 500),
        });
        /** Null-prototype per-event counters limited to the returned recent page. */
        const counts: Record<string, number> = Object.create(null) as Record<
          string,
          number
        >;
        // Count only the bounded page; this preserves legacy sampled semantics.
        for (const row of rows) {
          if (
            typeof row.event_name === 'string' &&
            /^[a-zA-Z][a-zA-Z0-9_.:-]{0,95}$/.test(row.event_name)
          ) {
            counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
          }
        }
        return counts;
      } catch {
        warn('analytics aggregation unavailable');
        return {};
      }
    },
  };
  return manager;
}
/** Public manager facade inferred from its standalone factory. */
export type AnalyticsManager = ReturnType<typeof createAnalytics>;
