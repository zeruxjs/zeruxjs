import { createHash } from 'node:crypto';
import {
  createAnalytics,
  createEventSchemaRegistry,
  type AnalyticsConnection,
  createDatabaseRequestIdStore,
} from '@zeruxjs/analytics';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import { createTagManager, validateContainer } from '@zeruxjs/tags';
import type { QueryOperation } from '@zeruxjs/db';

/** Fixed host scope. No event/property supplied by a browser can select a site or tenant. */
/** Create fixed-scope consent-aware local collection over a borrowed durable connector.
 * @param {SqliteConnector} database - Borrowed SQLite connector; this owner never disconnects it.
 * @param {string} tenant - Server-verified host tenant, not an event property.
 * @param {string} site - Server-verified host site, fixed before any collection.
 * @returns {Promise<object>} Explicit sample/tag/report callbacks and a collection close handle.
 */
export async function createWorkspaceAnalytics(
  database: SqliteConnector,
  tenant: string,
  site: string
) {
  /** Fixed host tenant/site namespace; hashing is not anonymization or permission. */
  const scope = createHash('sha256')
    .update(JSON.stringify([tenant, site]))
    .digest('hex');
  /** Execute one allowed analytics operation on the fixed configured local connection.
   * @param {QueryOperation} operation - Library-owned structured query, not raw browser SQL.
   * @returns {Promise<object>} Connector outcome; errors retain the package’s best-effort/reporting contract.
   */
  const execute = (operation: QueryOperation) =>
    database.execute(operation, {
      connection: {
        name: 'Workspace',
        slug: 'workspace',
        connector: '@zeruxjs/db-sqlite',
        options: {},
      },
    });
  /** Borrowed fixed SQLite facade; callers cannot select another named connection. */
  const connection: AnalyticsConnection = {
    insert: (operation) => execute({ ...operation, op: 'insert' }),
    select: (operation) => execute({ ...operation, op: 'select' }),
    createTable: (operation) => execute({ ...operation, op: 'createTable' }),
    createIndex: (operation) => execute({ ...operation, op: 'createIndex' }),
  };
  /** Explicit V1 sample schema bounds dimension values/cardinality and metric units/range. */
  const registry = createEventSchemaRegistry([
    {
      name: 'workspace.sample',
      version: 1,
      properties: {
        section: {
          kind: 'dimension',
          type: 'string',
          values: ['notebook', 'files', 'protocols'],
          maxCardinality: 3,
          required: true,
        },
        duration_ms: {
          kind: 'metric',
          unit: 'milliseconds',
          min: 0,
          max: 60_000,
          required: true,
        },
      },
    },
  ]);
  /** Consent-required owner; callers never select database/site via browser event properties. */
  const analytics = createAnalytics({
    analytics: 'workspace',
    database: {
      connectionSlugs: ['workspace'],
      /** Resolve only the configured analytics connection identity.
       * @param {string} name - Library-requested connection slug.
       * @returns {AnalyticsConnection} Borrowed local facade or an explicit scope-denied error.
       */
      getConnectionFacade(name) {
        if (name !== 'workspace') {
          throw new Error('ANALYTICS_SCOPE_DENIED');
        }
        return connection;
      },
    },
    schemaRegistry: registry,
    numericFields: ['duration_ms'],
    webConsent: 'required',
    onWarning: () => {
      /* Reports return explicit unavailable; never log event bodies. */
    },
  });
  if (!(await analytics.initialize())) {
    throw new Error('WORKSPACE_ANALYTICS_UNAVAILABLE');
  }
  /** Durable tag request-ID store shares the host connection; initialization failure is explicit. */
  const requestIds = createDatabaseRequestIdStore(
    connection,
    'workspace_tag_requests'
  );
  if (!(await requestIds.initialize())) {
    throw new Error('WORKSPACE_TAG_IDS_UNAVAILABLE');
  }
  /** Fixed validated local-only definition; no editable browser code or remote destinations are admitted. */
  const container = validateContainer({
    id: 'workspace',
    version: 1,
    name: 'Local sample collection',
    variables: [],
    triggers: [
      {
        id: 'sample',
        name: 'Explicit sample event',
        type: 'event',
        event: 'workspace.sample',
      },
    ],
    tags: [
      {
        id: 'local',
        name: 'Local SQLite analytics',
        type: 'analytics',
        triggerIds: ['sample'],
        eventName: 'workspace.sample',
      },
    ],
  });
  /** Explicit local collection owner with bounded concurrency and fresh per-dispatch consent. */
  const tags = createTagManager({
    analytics,
    requestIds,
    container,
    site: scope,
    defaultConsent: 'denied',
    requireBrowserConsent: true,
    maxConcurrentDispatches: 4,
    dispatchTimeoutMs: 3000,
    onWarning: () => {},
  });
  return {
    /** Dispatch one fixed local sample after explicitly applying this invocation’s consent.
     * @param {'granted' | 'denied'} consent - Fresh explicit collection choice for this sample only.
     * @returns {Promise<unknown>} Actual tag dispatch outcome; no external destination is contacted.
     */
    async tagSample(consent: 'granted' | 'denied') {
      /** Per-call collector with a fixed site; no mutable cross-request consent is shared. */
      const astag = tags.createAstag({ site: scope });
      await astag('consent', consent);
      return await astag('event', 'workspace.sample', {
        section: 'protocols',
        duration_ms: 0,
      });
    },
    tagDefinition: () => structuredClone(container),
    close: () => tags.close(),
    /** Validate bounded sample dimensions/units and preserve consent denial independently of storage availability.
     * @param {string} section - One of three authored dimension values.
     * @param {string} duration - Bounded integer millisecond text, at most 60000.
     * @param {string} consent - Explicit granted/denied choice, never inferred from login.
     * @returns {Promise<{ outcome: string }>} Honest consent-denied, persisted or unavailable outcome.
     */
    async record(section: string, duration: string, consent: string) {
      if (
        !['notebook', 'files', 'protocols'].includes(section) ||
        !/^\d{1,5}$/.test(duration) ||
        Number(duration) > 60_000 ||
        !['granted', 'denied'].includes(consent)
      ) {
        throw new Error('INVALID_ANALYTICS_SAMPLE');
      }
      /** Actual best-effort tracking result; absence is reported as unavailable rather than fabricated persistence. */
      const id = await analytics.track(
        registry.event('workspace.sample', {
          source: 'web',
          site: scope,
          consent: consent as 'granted' | 'denied',
          properties: {
            section: section as 'notebook' | 'files' | 'protocols',
            duration_ms: Number(duration),
          },
        })
      );
      let outcome;
      if (consent === 'denied') {
        outcome = 'consent-denied';
      } else if (id) {
        outcome = 'persisted';
      } else {
        outcome = 'unavailable';
      }
      return { outcome };
    },
    aggregate: () =>
      analytics.aggregate({ site: scope, groupBy: 'event', limit: 20 }),
  };
}
