import { createHash } from 'node:crypto';
import { isReportId } from './model.js';

export type ReportUnit =
  | 'count'
  | 'seconds'
  | 'milliseconds'
  | 'bytes'
  | 'ratio'
  | `currency:${string}`;
export interface SourceField {
  /** Validated unique source field or registration name; not an authorization claim. */
  name: string;
  /** Dimension versus metric; determines allowed scalar representation/units. */
  kind: 'dimension' | 'metric';
  /** String dimension or precision-preserving decimal-string metric; no automatic Number coercion. */
  type: 'string' | 'decimal';
  /** Required metric unit (including explicit currency), absent for dimensions. */
  unit?: ReportUnit;
}
export interface ReportSourceSchema {
  /** Fixed V1 source schema/result format; incompatible versions reject. */
  version: 1;
  /** Trusted finite schema of at most100 unique fields, snapshotted before queries. */
  fields: readonly SourceField[];
}
/** Supplied only by verified server identity/session middleware, never request JSON. */
export interface ReportSourceScope {
  /** Verified application tenant from host authentication, never query JSON. */
  tenant: string;
  /** Verified fixed site bound to this source/credential grant. */
  site: string;
  /** Verified initiating principal, separate from tenant and provider account. */
  principal: string;
  /** Host-verified exact credential/grant partition; tenant equality alone is insufficient. */
  credentialPartition: string;
}
export interface ReportSourceQuery {
  /** Exactly one explicitly registered source name per query. */
  source: string;
  /** Must equal the registered V1 schema; no implicit migration. */
  schemaVersion: 1;
  /** Up to9 unique selected registered dimensions. */
  dimensions: string[];
  /** One to10 unique selected registered metrics. */
  metrics: string[];
  /** Inclusive canonical UTC first query day. */
  from: string;
  /** Inclusive canonical UTC final day within the source capability limit. */
  to: string;
  /** Positive finite requested row limit, no higher than adapter capability. */
  limit: number;
}
export interface ReportSourceResult {
  /** Fixed V1 source schema/result format; incompatible versions reject. */
  version: 1;
  /** Exactly one explicitly registered source name per query. */
  source: string;
  /** Must equal the registered V1 schema; no implicit migration. */
  schemaVersion: 1;
  /** Normalized inclusive query window, not a transaction snapshot. */
  window: {
    /** Inclusive canonical UTC first query day. */
    from: string;
    /** Inclusive canonical UTC final day within the source capability limit. */
    to: string;
    /** True: both declared UTC day endpoints are included. */
    inclusive: true;
  };
  /** Exact selected schema/units in query order; extra provider fields never leak. */
  columns: SourceField[];
  /** Bounded string cells aligned to columns; metrics retain decimal precision. */
  rows: string[][];
  /** Validated explicit result IANA zone; no automatic cross-zone aggregation. */
  timeZone: string;
  /** Explicit provider/internal provenance, hidden rows, sampling and restrictions. */
  coverage: {
    /** Dimension versus metric; determines allowed scalar representation/units. */
    kind: 'provider-reported' | 'internal';
    /** Whether matching groups extend beyond returned rows; never quietly drop groups. */
    truncated: boolean;
    /** Safe matching group count or null when unknown, not event population size. */
    totalRows: number | null;
    /** Unknown or provider-reported; unknown is not proof of unsampled data. */
    sampling: 'unknown' | 'reported';
    /** Whether provider reports threshold/restriction/warning presence; private warning text is excluded. */
    restricted: boolean;
  };
  /** Always private-no-store; this registry has no implicit result cache. */
  cachePrivacy: 'private-no-store';
  /** SHA-256 schema/query/verified identity cache partition; not authorization or anonymization. */
  cacheIdentity: string;
}
export interface ReportSourceAdapter {
  /** Explicit trusted V1 catalog; no remote introspection or executable discovery. */
  schema: ReportSourceSchema;
  /** Declared read-only finite row/day capabilities; registry enforces ceilings. */
  capabilities: {
    /** Must be literal true; this contract never exposes provider mutations. */
    readOnly: true;
    /** Declared finite row ceiling, registry accepts1–10000. */
    maxRows: number;
    /** Declared inclusive UTC-day ceiling, registry accepts1–366. */
    maxDays: number;
  };
  /** Return only source-owned columns, rows, zone and coverage under the explicit verified context. Adapter code enforces underlying tenant predicates; the registry adds the private identity envelope.
   * @param {ReportSourceQuery} query - Explicit bounded schema-versioned table query; source-specific tenant predicates remain adapter-owned.
   * @param {object} context - Trusted verified identity and cancellation.
   * @param {Readonly<ReportSourceScope>} context.scope - Verified tenant/site/principal/grant partition.
   * @param {AbortSignal} context.signal - Cooperative caller cancellation.
   * @returns {Promise<object>} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
   */
  query(
    query: ReportSourceQuery,
    context: {
      /** Readonly host-verified identity passed only after fresh authorization. */
      scope: Readonly<ReportSourceScope>;
      /** Cooperative cancellation signal; cannot force-cancel arbitrary trusted code. */
      signal: AbortSignal;
    }
  ): Promise<
    Omit<
      ReportSourceResult,
      | 'version'
      | 'source'
      | 'schemaVersion'
      | 'cachePrivacy'
      | 'cacheIdentity'
      | 'window'
    >
  >;
  /** Release the adapter-owned work/resources after the registry drains queries; borrowed credentials remain host-owned.
   * @returns {void|Promise<void>} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
   */
  dispose?(): void | Promise<void>;
}
/** Fixed public source categories; native causes remain private and non-enumerable. */
export class ReportSourceError extends Error {
  /** Create a fixed public source error; private causes remain outside enumerable response records.
 * @param {| 'INVALID_QUERY'
      | 'DENIED'
      | 'UNAVAILABLE'
      | 'QUOTA'
      | 'CANCELLED'
      | 'OVERLOAD'
      | 'CLOSED'
      | 'INVALID_RESULT'} code - Fixed public failure category, never a provider body or credential.
 * @param {unknown} cause - Optional private non-enumerable native cause; host logs must redact it.
 */
  constructor(
    readonly code:
      | 'INVALID_QUERY'
      | 'DENIED'
      | 'UNAVAILABLE'
      | 'QUOTA'
      | 'CANCELLED'
      | 'OVERLOAD'
      | 'CLOSED'
      | 'INVALID_RESULT',
    cause?: unknown
  ) {
    super(`Report source ${code.toLowerCase()}`);
    this.name = 'ReportSourceError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Reject with one fixed public category rather than copying private values into a message.
 * @param {ReportSourceError['code']} code - Fixed public failure category, never a provider body or credential.
 * @returns {never} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
 */
function fail(code: ReportSourceError['code']): never {
  throw new ReportSourceError(code);
}
/** Snapshot the four required host-verified identity fields. Shape checks do not authenticate identities or authorize credential reuse.
 * @param {ReportSourceScope} value - Host-verified tenant/site/principal/credential partition, not browser role claims.
 * @returns {ReportSourceScope} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
 */
export function sourceScope(value: ReportSourceScope): ReportSourceScope {
  if (
    !value ||
    Object.keys(value).some(
      (k) => !['tenant', 'site', 'principal', 'credentialPartition'].includes(k)
    ) ||
    !['tenant', 'site', 'principal', 'credentialPartition'].every(
      (k) =>
        typeof value[k as keyof ReportSourceScope] === 'string' &&
        value[k as keyof ReportSourceScope].length > 0 &&
        value[k as keyof ReportSourceScope].length <= 200 &&
        // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
        !/[\x00-\x1f\x7f]/.test(value[k as keyof ReportSourceScope])
    )
  ) {
    fail('DENIED');
  }
  return Object.freeze({
    tenant: value.tenant,
    site: value.site,
    principal: value.principal,
    credentialPartition: value.credentialPartition,
  });
}
/** Snapshot a finite trusted registered V1 dimension/metric catalog and reject duplicate names or incompatible units. No source modules execute for discovery.
 * @param {ReportSourceSchema} input - Explicit query/schema input validated before provider work.
 * @returns {ReportSourceSchema} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
 */
export function sourceSchema(input: ReportSourceSchema): ReportSourceSchema {
  if (
    input?.version !== 1 ||
    !Array.isArray(input.fields) ||
    !input.fields.length ||
    input.fields.length > 100
  ) {
    fail('INVALID_QUERY');
  }
  /** Validated frozen finite trusted field catalog; no source query is executed. */
  const fields = input.fields.map((f) => {
    if (
      !f ||
      Object.keys(f).some(
        (k) => !['name', 'kind', 'type', 'unit'].includes(k)
      ) ||
      !isReportId(f.name) ||
      !['dimension', 'metric'].includes(f.kind) ||
      f.type !== (f.kind === 'dimension' ? 'string' : 'decimal') ||
      (f.kind === 'dimension' && f.unit !== undefined) ||
      (f.kind === 'metric' &&
        (!f.unit ||
          !/^(count|seconds|milliseconds|bytes|ratio|currency:[A-Z]{3})$/.test(
            f.unit
          )))
    ) {
      fail('INVALID_QUERY');
    }
    return Object.freeze({
      name: f.name,
      kind: f.kind,
      type: f.type,
      ...(f.unit ? { unit: f.unit } : {}),
    });
  });
  if (new Set(fields.map((f) => f.name)).size !== fields.length) {
    fail('INVALID_QUERY');
  }
  return Object.freeze({ version: 1, fields: Object.freeze(fields) });
}
/** Validate finite selected fields, row budget and real inclusive UTC calendar window against this source schema. Return a fresh plan; no provider call or authorization occurs here.
 * @param {ReportSourceQuery} input - Explicit query/schema input validated before provider work.
 * @param {ReportSourceSchema} schema - Trusted registered V1 field schema, not discovered executable modules.
 * @param {number} maxRows - Declared positive adapter row ceiling, registry maximum10000.
 * @param {number} maxDays - Declared inclusive UTC-day ceiling, registry maximum366.
 * @returns {ReportSourceQuery} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
 */
export function validateSourceQuery(
  input: ReportSourceQuery,
  schema: ReportSourceSchema,
  maxRows: number,
  maxDays: number
): ReportSourceQuery {
  if (
    !input ||
    Object.keys(input).some(
      (k) =>
        ![
          'source',
          'schemaVersion',
          'dimensions',
          'metrics',
          'from',
          'to',
          'limit',
        ].includes(k)
    ) ||
    !isReportId(input.source) ||
    input.schemaVersion !== schema.version ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > maxRows
  ) {
    fail('INVALID_QUERY');
  }
  // Iterate only finite selected cells/owners or the bounded reader; keep native settlement ownership explicit.
  for (const [names, kind, max] of [
    [input.dimensions, 'dimension', 9],
    [input.metrics, 'metric', 10],
  ] as const) {
    if (
      !Array.isArray(names) ||
      names.length > max ||
      (kind === 'metric' && !names.length) ||
      new Set(names).size !== names.length ||
      names.some(
        (n) => !schema.fields.some((f) => f.name === n && f.kind === kind)
      )
    ) {
      fail('INVALID_QUERY');
    }
  }
  /** Validate real canonical UTC calendar labels before bounded-window arithmetic.
   * @param {string} s - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {number} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const day = (s: string) => {
    if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s)) {
      return NaN;
    }
    /** Parsed calendar epoch or validated count, never a synthetic build timestamp. */
    const n = Date.parse(s + 'T00:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s
      ? n
      : NaN;
  };
  /** Validated inclusive UTC start epoch. */
  const a = day(input.from);
  /** Validated inclusive UTC final epoch. */
  const b = day(input.to);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    b < a ||
    b - a >= maxDays * 86400000
  ) {
    fail('INVALID_QUERY');
  }
  return {
    ...input,
    dimensions: [...input.dimensions],
    metrics: [...input.metrics],
  };
}
/** Own explicit adapter registrations and bounded unsettled queries. Reauthorize every query, never share result caches implicitly, and drain actual work before disposing accepted adapters.
 * @param {object} options - Required explicit host authorization or registry/scope resolver with finite limits.
 * @param {function} options.authorize - Required fresh host decision per identity/source.
 * @param {number} [options.maxConcurrent] - Default 4, maximum 64 actual unsettled jobs.
 * @param {number} [options.timeoutMs] - Default 10000, maximum 60000ms observation.
 * @param {number} [options.maxBytes] - Default 1 MiB, maximum 4 MiB normalized output.
 * @returns {object} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
 */
export function createReportSourceRegistry(options: {
  /** Required fresh literal-true host authorization per identity/source before adapter work. */
  authorize: (
    scope: Readonly<ReportSourceScope>,
    source: string
  ) => boolean | Promise<boolean>;
  /** Default4, allowed1–64 actual unsettled queries including timed-out native work. */
  maxConcurrent?: number;
  /** Default10000, allowed1–60000 observation deadline; actual native ownership remains until settlement. */
  timeoutMs?: number;
  /** Default1 MiB, allowed256–4 MiB normalized serialized output. */
  maxBytes?: number;
}) {
  if (typeof options?.authorize !== 'function') {
    fail('INVALID_QUERY');
  }
  /** Validated actual-unsettled query ceiling, default4. */
  const max = options.maxConcurrent ?? 4;
  /** Validated observation deadline, default10000ms. */
  const timeout = options.timeoutMs ?? 10000;
  /** Validated normalized output ceiling, default1 MiB. */
  const bytes = options.maxBytes ?? 1024 * 1024;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 64 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 60000 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 256 ||
    bytes > 4 * 1024 * 1024
  ) {
    fail('INVALID_QUERY');
  }
  /** Explicit finite registered schemas/adapter facades; no package discovery. */
  const sources = new Map<
    string,
    {
      /** Trusted explicitly registered adapter; not a dynamically imported package. */
      adapter: ReportSourceAdapter;
      /** Explicit trusted V1 catalog; no remote introspection or executable discovery. */
      schema: ReportSourceSchema;
    }
  >();
  /** Actual unsettled authorization/adapter promises retaining slots after caller deadlines. */
  const jobs = new Set<Promise<unknown>>();
  /** Owned per-query cooperative cancellation signals, retained through native settlement. */
  const controllers = new Set<AbortController>();
  /** Original accepted adapter identities, disposed once after actual registry drain. */
  const owners = new Set<ReportSourceAdapter>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Resolve only an existing registered source and validate its finite plan; unknown names fail closed without package discovery.
   * @param {ReportSourceQuery} query - Explicit bounded schema-versioned table query; source-specific tenant predicates remain adapter-owned.
   * @returns {object} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
   */
  function lookup(query: ReportSourceQuery) {
    /** Trusted explicitly registered source/schema selected by the validated plan. */
    const entry = sources.get(query?.source);
    if (!entry) {
      fail('DENIED');
    }
    return {
      entry,
      query: validateSourceQuery(
        query,
        entry.schema,
        entry.adapter.capabilities.maxRows,
        entry.adapter.capabilities.maxDays
      ),
    };
  }
  return {
    /** Accept one explicit trusted adapter/schema with finite capabilities. Close later disposes each accepted original adapter identity once, even under multiple source names.
     * @param {string} name - Unique validated source name, at most32 registrations; not permission to query it.
     * @param {ReportSourceAdapter} adapter - Trusted explicit adapter. Accepted registration owns its eventual disposal; invalid registration leaves cleanup with the caller.
     * @returns {void} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
     */
    register(name: string, adapter: ReportSourceAdapter) {
      if (closed) {
        fail('CLOSED');
      }
      if (
        !isReportId(name) ||
        sources.has(name) ||
        sources.size >= 32 ||
        typeof adapter?.query !== 'function' ||
        adapter.capabilities?.readOnly !== true ||
        !Number.isSafeInteger(adapter.capabilities.maxRows) ||
        adapter.capabilities.maxRows < 1 ||
        adapter.capabilities.maxRows > 10000 ||
        !Number.isSafeInteger(adapter.capabilities.maxDays) ||
        adapter.capabilities.maxDays < 1 ||
        adapter.capabilities.maxDays > 366
      ) {
        fail('INVALID_QUERY');
      }
      sources.set(name, {
        adapter: {
          schema: adapter.schema,
          capabilities: { ...adapter.capabilities },
          query: adapter.query.bind(adapter),
          dispose: adapter.dispose?.bind(adapter),
        },
        schema: sourceSchema(adapter.schema),
      });
      owners.add(adapter);
    },
    /** Validate one to12 independent source/schema plans without execution or permission grants. No fields, time zones or scores are automatically joined.
     * @param {readonly ReportSourceQuery[]} queries - One to12 independent typed panels; no cross-source joins or execution.
     * @returns {ReportSourceQuery[]} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
     */
    validatePlan(queries: readonly ReportSourceQuery[]) {
      if (!Array.isArray(queries) || !queries.length || queries.length > 12) {
        fail('INVALID_QUERY');
      }
      return queries.map((q) => lookup(q).query);
    },
    /** Execute only the explicitly registered source under fresh host identity/authorization. Bound returned fields/cells/bytes and retain actual native work after timeout; registry normalization never invents coverage.
     * @param {ReportSourceQuery} input - Explicit query/schema input validated before provider work.
     * @param {ReportSourceScope} identity - Verified host identity including credential partition, never extracted from a report definition.
     * @param {AbortSignal} signal - Optional cooperative caller cancellation; native work retains its slot until actual settlement.
     * @returns {Promise<ReportSourceResult>} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
     */
    async query(
      input: ReportSourceQuery,
      identity: ReportSourceScope,
      signal?: AbortSignal
    ): Promise<ReportSourceResult> {
      if (closed) {
        fail('CLOSED');
      }
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        fail('INVALID_QUERY');
      }
      if (jobs.size >= max) {
        fail('OVERLOAD');
      }
      /** Frozen verified host identity; shape validation does not authenticate it. */
      const scope = sourceScope(identity);
      /** Matched registered source and copied bounded plan before provider execution. */
      const { entry, query } = lookup(input);
      /** Owned per-query signal; abort cannot force-cancel native JavaScript. */
      const controller = new AbortController();
      controllers.add(controller);
      /** Scoped cancellation/body-reader cleanup callback, removed after its wait scope.
       * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
       */
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop = () => {};
      /** Observed cancellation race, separate from actual native settlement. */
      const cancelled = new Promise<never>((_, reject) => {
        stop = () => reject(new ReportSourceError('CANCELLED'));
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) {
          stop();
        }
        timer = setTimeout(abort, timeout);
      });
      /** Actual authorization/provider/normalization promise; keep capacity until it settles. */
      const native = Promise.resolve()
        .then(async () => {
          if (controller.signal.aborted) {
            fail('CANCELLED');
          }
          if ((await options.authorize(scope, query.source)) !== true) {
            fail('DENIED');
          }
          if (controller.signal.aborted) {
            fail('CANCELLED');
          }
          /** Private adapter result checked and projected; extra blobs/diagnostics never escape. */
          const raw = await entry.adapter.query(query, {
            scope,
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            fail('CANCELLED');
          }
          /** Exactly the selected trusted fields/units in declared query order. */
          const columns = [...query.dimensions, ...query.metrics].map(
            (n) => entry.schema.fields.find((f) => f.name === n)!
          );
          if (
            !raw ||
            !Array.isArray(raw.columns) ||
            raw.columns.length !== columns.length ||
            raw.columns.some(
              (f, i) =>
                !f ||
                f.name !== columns[i]!.name ||
                f.kind !== columns[i]!.kind ||
                f.type !== columns[i]!.type ||
                f.unit !== columns[i]!.unit
            ) ||
            !Array.isArray(raw.rows) ||
            raw.rows.length > query.limit ||
            raw.rows.some(
              (r) =>
                !Array.isArray(r) ||
                r.length !== columns.length ||
                r.some(
                  (v, i) =>
                    typeof v !== 'string' ||
                    Buffer.byteLength(v) > 4096 ||
                    (columns[i]!.type === 'decimal' &&
                      !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v))
                )
            ) ||
            !raw.coverage ||
            !['provider-reported', 'internal'].includes(raw.coverage.kind) ||
            typeof raw.coverage.truncated !== 'boolean' ||
            typeof raw.timeZone !== 'string' ||
            !raw.timeZone ||
            raw.timeZone.length > 100 ||
            typeof raw.coverage.restricted !== 'boolean' ||
            !['unknown', 'reported'].includes(raw.coverage.sampling) ||
            (raw.coverage.totalRows !== null &&
              (!Number.isSafeInteger(raw.coverage.totalRows) ||
                raw.coverage.totalRows < raw.rows.length))
          ) {
            fail('INVALID_RESULT');
          }
          let cellBytes = 0;
          // Iterate only finite selected cells/owners or the bounded reader; keep native settlement ownership explicit.
          for (const row of raw.rows) {
            // Iterate only finite selected cells/owners or the bounded reader; keep native settlement ownership explicit.
            for (const cell of row) {
              cellBytes += Buffer.byteLength(cell);
              if (cellBytes > bytes) {
                fail('INVALID_RESULT');
              }
            }
          }
          if (
            raw.coverage.totalRows !== null &&
            raw.coverage.totalRows > raw.rows.length &&
            !raw.coverage.truncated
          ) {
            fail('INVALID_RESULT');
          }
          try {
            new Intl.DateTimeFormat('en', { timeZone: raw.timeZone });
          } catch {
            fail('INVALID_RESULT');
          }
          // No provider blobs, credentials or arbitrary extra adapter fields escape normalization.
          /** Normalized private result with explicit coverage and verified cache partition. */
          const result: ReportSourceResult = {
            version: 1,
            source: query.source,
            schemaVersion: 1,
            window: { from: query.from, to: query.to, inclusive: true },
            columns: structuredClone(columns),
            rows: raw.rows.map((r) => [...r]),
            timeZone: raw.timeZone,
            coverage: {
              kind: raw.coverage.kind,
              truncated: raw.coverage.truncated,
              totalRows: raw.coverage.totalRows,
              sampling: raw.coverage.sampling,
              restricted: raw.coverage.restricted,
            },
            cachePrivacy: 'private-no-store',
            cacheIdentity: createHash('sha256')
              .update(JSON.stringify([scope, entry.schema, query]))
              .digest('hex'),
          };
          if (Buffer.byteLength(JSON.stringify(result)) > bytes) {
            fail('INVALID_RESULT');
          }
          return result;
        })
        .catch((error) => {
          if (error instanceof ReportSourceError) {
            throw error;
          }
          throw new ReportSourceError(
            controller.signal.aborted ? 'CANCELLED' : 'UNAVAILABLE',
            error
          );
        })
        .finally(() => {
          jobs.delete(native);
          controllers.delete(controller);
        });
      jobs.add(native);
      try {
        return await Promise.race([native, cancelled]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', stop);
      }
    },
    /** Return fixed counters for current ownership without tenant IDs, query contents or credentials.
     * @returns {object} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
     */
    status() {
      return { closed, pending: jobs.size, sources: sources.size };
    },
    /** Idempotently stop admission, abort queries, await actual native settlement and dispose every accepted adapter once. Uncooperative callbacks may delay close; disposal failure remains explicit.
     * @returns {Promise<void>} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      // Iterate only finite selected cells/owners or the bounded reader; keep native settlement ownership explicit.
      for (const c of controllers) {
        c.abort();
      }
      return (closing = (async () => {
        await Promise.allSettled([...jobs]);
        /** All adapter disposal outcomes; one failure cannot prevent other owners being disposed. */
        const results = await Promise.allSettled(
          [...owners].map((a) => Promise.resolve().then(() => a.dispose?.()))
        );
        sources.clear();
        owners.clear();
        if (results.some((r) => r.status === 'rejected')) {
          fail('UNAVAILABLE');
        }
      })());
    },
  };
}
export type ReportSourceRegistry = ReturnType<
  typeof createReportSourceRegistry
>;
/** Build a read-only POST JSON handler over a borrowed registry and required authenticated scope resolver. Bound body reads and return private/no-store fixed errors; outer host admission/session deadlines remain required.
 * @param {object} options - Required explicit host authorization or registry/scope resolver with finite limits.
 * @param {ReportSourceRegistry} options.registry - Borrowed explicit source owner.
 * @param {function} options.resolveScope - Required authenticated session-to-scope resolver.
 * @returns {function} Explicit normalized result/control receipt or fixed failure; no automatic fallback to an unauthorized source.
 */
export function createReportSourceHandler(options: {
  /** Borrowed explicit source registry; handler creation does not own its close. */
  registry: ReportSourceRegistry;
  /** Required authenticated host callback; report JSON/headers do not supply trusted identity. */
  resolveScope: (
    request: Request
  ) => ReportSourceScope | Promise<ReportSourceScope>;
}) {
  if (!options?.registry || typeof options.resolveScope !== 'function') {
    fail('INVALID_QUERY');
  }
  return async (request: Request) => {
    /** Fixed private/no-store and representation headers, not provider-controlled metadata. */
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      vary: 'Cookie, Authorization',
      'x-content-type-options': 'nosniff',
    };
    /** Fixed-code JSON response helper; never echo raw exceptions or token bodies.
     * @param {unknown} body - Explicit value for this documented owner/projection; host authorization remains separate.
     * @param {number} status - Explicit value for this documented owner/projection; host authorization remains separate.
     * @returns {Response} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
     */
    const response = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers });
    if (request.method !== 'POST') {
      return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    try {
      /** Frozen verified host identity; shape validation does not authenticate it. */
      const scope = sourceScope(await options.resolveScope(request));
      if (
        request.headers.get('content-type')?.split(';')[0]?.trim() !==
        'application/json'
      ) {
        return response({ error: 'INVALID_QUERY' }, 415);
      }
      if (!request.body) {
        fail('INVALID_QUERY');
      }
      /** Owned bounded request body reader cancelled/released on every exit. */
      const reader = request.body.getReader();
      let body = '',
        size = 0;
      /** Strict streaming UTF-8 decoder; corrupt input does not execute code. */
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let expired = false;
      /** Scoped cancellation/body-reader cleanup callback, removed after its wait scope.
       * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
       */
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      /** Owned finite body-read timer cleared on normal/cancel/error exits. */
      const timer = setTimeout(() => {
        expired = true;
        abort();
      }, 10000);
      request.signal.addEventListener('abort', abort, { once: true });
      try {
        // Iterate only finite selected cells/owners or the bounded reader; keep native settlement ownership explicit.
        while (true) {
          if (request.signal.aborted || expired) {
            fail('CANCELLED');
          }
          /** One bounded request-body chunk or terminal receipt. */
          const { done, value } = await reader.read();
          if (request.signal.aborted || expired) {
            fail('CANCELLED');
          }
          if (done) {
            break;
          }
          size += value.byteLength;
          if (size > 16384) {
            fail('INVALID_QUERY');
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      let query: ReportSourceQuery;
      try {
        query = JSON.parse(body);
      } catch {
        fail('INVALID_QUERY');
      }
      return response(
        await options.registry.query(query, scope, request.signal),
        200
      );
    } catch (error) {
      /** Fixed public response category; unknown exceptions fail as denied identity. */
      const code = error instanceof ReportSourceError ? error.code : 'DENIED';
      return response(
        { error: code },
        (() => {
          switch (code) {
            case 'DENIED':
              return 403;
            case 'INVALID_QUERY':
              return 422;
            case 'CANCELLED':
              return 408;
            case 'QUOTA':
            case 'OVERLOAD':
              return 429;
            default:
              return 503;
          }
        })()
      );
    }
  };
}
