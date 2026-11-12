import { createHash } from 'node:crypto';
import type { AnalyticsConnection } from './types.js';
import { readEventSchemaCoverage } from './schemas.js';
import { validateTableName } from './validation.js';

/** UTC day length in milliseconds; cohort arithmetic never uses local time. */
const DAY = 86400000;
export type AnalyticsAnalysisKind =
  | 'sessions'
  | 'funnel'
  | 'cohort'
  | 'indexes';
export interface AnalyticsAnalysisOptions {
  /** Fixed, host-verified tenant/site; query objects cannot override it. */
  site: string;
  /** Required host authorization; literal true is required per invocation. */
  authorize: (
    context: Readonly<{
      site: string;
      kind: AnalyticsAnalysisKind;
      /** Optional caller cancellation signal; no forced JavaScript cancellation. */
      signal: AbortSignal;
    }>
  ) => boolean | Promise<boolean>;
  /** Maximum source events, default 5000 and maximum 10000. */
  maxEvents?: number;
  /** Keyset page size, default/max 200. */
  pageSize?: number;
  /** Scanned byte budget, default 8MiB and maximum 32MiB. */
  maxBytes?: number;
  /** Actual-settlement concurrency budget, default two and maximum 16. */
  maxConcurrent?: number;
  /** Cooperative duration limit; session queries use this field for their idle boundary. */
  timeoutMs?: number;
}
export interface AnalyticsAnalysisExecution {
  /** Optional caller cancellation signal; no forced JavaScript cancellation. */
  signal?: AbortSignal;
  /** Absolute UTC millisecond deadline. */
  deadline?: number;
}
export interface AnalyticsAnalysisWindow {
  /** Inclusive UTC event timestamp boundary. */
  since: number;
  /** Exclusive UTC event timestamp boundary. */
  until: number;
  /** Only the explicit bounded plan is supported. */
  plan?: 'bounded';
}
export interface AnalyticsSessionQuery extends AnalyticsAnalysisWindow {
  /** Cooperative duration limit; session queries use this field for their idle boundary. */
  timeoutMs?: number;
  /** Maximum observed session duration, default/max 24 hours. */
  maxDurationMs?: number;
}
export interface AnalyticsFunnelQuery extends AnalyticsAnalysisWindow {
  /** Two to ten ordered event labels. */
  steps: readonly string[];
  /** Maximum ordered conversion duration, capped at seven days. */
  conversionWindowMs?: number;
  /** Existing visitor or session identity; default visitor. */
  identity?: 'visitor' | 'session';
}
export interface AnalyticsCohortQuery extends AnalyticsAnalysisWindow {
  /** Event label establishing observed cohort membership. */
  entryEvent: string;
  /** Event label counted as a cohort return. */
  returnEvent: string;
  /** UTC return offsets from zero through 30. */
  retentionDays: number;
}
export interface AnalyticsAnalysisCoverage {
  /** Coverage schema version. */
  version: 1;
  /** Complete bounded source scan or truncated sampled page. */
  mode: 'bounded-persisted-window' | 'sampled-page';
  /** Native count at its read; separate from paged scan consistency. */
  persistedCount: number;
  /** Source rows inspected under scan budgets. */
  scanned: number;
  /** Validated consented rows with the selected identity. */
  identified: number;
  /** Consented rows lacking a supported opaque identity. */
  missingIdentity: number;
  /** Rows without granted consent excluded from identity analysis. */
  unconsented: number;
  /** Malformed stored rows excluded from analysis. */
  invalid: number;
  /** Rows with no versioned schema provenance. */
  legacyUnversioned: number;
  /** Rows carrying valid stored schema provenance. */
  versioned: number;
  /** Whether the event cap stopped the source scan. */
  truncated: boolean;
  /** Whether the keyset read observed the end of this window. */
  windowExhausted: boolean;
  /** Whether exhausted scan count matches the earlier native count. */
  countMatchesScan: boolean;
  /** Always false; independent reads are not a pinned snapshot. */
  snapshot: false;
  /** Underlying source ingestion remains best-effort. */
  ingestion: 'best-effort';
  /** Unknown historical identity coverage stays explicit. */
  historicalIdentity: 'unknown';
  /** Analysis order is occurred_at then deterministic ID. */
  ordering: 'occurred_at,id';
  /** Session/cohort interpretations are clipped to the observed window. */
  boundary: 'window-clipped';
}
/** Fixed-code error whose optional private cause stays outside enumerable diagnostics. */
export class AnalyticsAnalysisError extends Error {
  /** Create a fixed-code analysis error without exposing private causes by default.
   * @param {string} code - Public failure category.
   * @param {unknown} cause - Private optional cause retained non-enumerably.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Analytics analysis failed (${code})`);
    this.name = 'AnalyticsAnalysisError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Create a fixed-code analysis error with a private optional cause.
 * @param {string} code - Public diagnostic category.
 * @param {unknown} cause - Internal failure retained outside enumerable records.
 * @returns {AnalyticsAnalysisError} Redacted public error. */
const failure = (code: string, cause?: unknown) =>
  new AnalyticsAnalysisError(code, cause);
/** Require an allowlisted plain record with own data fields.
 * @param {unknown} value - Candidate options/query object.
 * @param {readonly string[]} allowed - Explicit supported field names.
 * @returns {void} Invalid options or accessors throw without executing source modules.
 */
function record(
  value: unknown,
  allowed: readonly string[]
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== 'string' ||
        !allowed.includes(k) ||
        !('value' in Object.getOwnPropertyDescriptor(value, k)!)
    )
  ) {
    throw failure('INVALID_OPTIONS');
  }
}
/** Validate a safe integer within an inclusive budget.
 * @param {unknown} value - Candidate numeric limit.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {number} Validated number or an explicit limit failure.
 */
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw failure('INVALID_LIMIT');
  }
  return value;
}
/** Validate one bounded event label.
 * @param {unknown} value - Untrusted event name.
 * @returns {string} Validated name; unsupported labels throw. */
const event = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(value)
  ) {
    throw failure('INVALID_EVENT');
  }
  return value;
};
/** Recognize supported consented opaque identities without creating new tracking IDs.
 * @param {unknown} value - Stored visitor/session identifier.
 * @returns {boolean} Whether the identifier has the supported bounded shape. */
const opaque = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
/** Bounded persisted source-ID grammar used for keyset integrity checks. */
const idPattern = /^[A-Za-z0-9_-]{1,36}$/;
/** Only shared window/plan keys accepted before kind-specific query fields. */
const windowKeys = ['since', 'until', 'plan'];
/** Validate the explicit bounded half-open event-time query window.
 * @param {AnalyticsAnalysisWindow} query - Window plus kind-specific options.
 * @param {readonly string[]} extra - Additional allowlisted query keys.
 * @returns {{since: number, until: number}} UTC millisecond range; unsupported plans and windows over 31 days reject.
 */
function window(query: AnalyticsAnalysisWindow, extra: readonly string[] = []) {
  record(query, [...windowKeys, ...extra]);
  if (query.plan !== undefined && query.plan !== 'bounded') {
    throw failure('UNSUPPORTED_PLAN');
  }
  integer(query.since, 0, 253402300799999);
  integer(query.until, 0, Date.now());
  if (query.until <= query.since || query.until - query.since > 31 * DAY) {
    throw failure('INVALID_WINDOW');
  }
  return { since: query.since, until: query.until };
}
interface Observed {
  /** Validated persisted event ID. */
  id: string;
  /** Validated event label. */
  name: string;
  /** Validated event-time timestamp. */
  at: number;
  /** Existing visitor or session identity; default visitor. */
  identity: string;
}
interface Scope {
  /** Optional caller cancellation signal; no forced JavaScript cancellation. */
  signal: AbortSignal;
  /** Absolute UTC millisecond deadline. */
  deadline: number;
  /** Throw at cooperative boundaries after deadline/cancellation. */
  check: () => void;
}
/** Create a tenant-bound cooperative read owner over a borrowed connection. Authorization precedes count/scan; close aborts and drains actual work.
 * @param {AnalyticsAnalysisOptions & {
    connection: () => AnalyticsConnection | undefined;
    table?: string;
  }} options - Fixed verified site, host authorization, connection and finite read budgets.
 * @returns {AnalyticsAnalysis} Disposable headless session/funnel/cohort facade; construction starts no background work.
 */
export function createAnalyticsAnalysis(
  options: AnalyticsAnalysisOptions & {
    connection: () => AnalyticsConnection | undefined;
    table?: string;
  }
) {
  record(options, [
    'site',
    'authorize',
    'connection',
    'table',
    'maxEvents',
    'pageSize',
    'maxBytes',
    'maxConcurrent',
    'timeoutMs',
  ]);
  if (
    typeof options.site !== 'string' ||
    !options.site.length ||
    options.site.length > 200 ||
    // eslint-disable-next-line no-control-regex -- Reject controls in the fixed tenant site.
    /[\x00-\x1f\x7f]/.test(options.site) ||
    typeof options.authorize !== 'function' ||
    typeof options.connection !== 'function'
  ) {
    throw failure('INVALID_OPTIONS');
  }
  /** Fixed host-verified site; query inputs cannot override the tenant filter. */
  const site = options.site;
  /** Borrowed host authorization callback rechecked for each admitted analysis. */
  const authorize = options.authorize;
  /** Borrowed named connector resolver; this scope never closes the host database. */
  const connection = options.connection;
  /** Validated analytics source table. */
  const table = validateTableName(options.table ?? 'analytics_events');
  /** Maximum scanned source events, default 5000 and bounded to 1–10000. */
  const maxEvents = integer(options.maxEvents ?? 5000, 1, 10000);
  /** Keyset source page size, default/max 200. */
  const pageSize = integer(options.pageSize ?? 200, 1, 200);
  /** Accumulated scanned property-byte budget, default 8MiB and maximum 32MiB. */
  const maxBytes = integer(
    options.maxBytes ?? 8 * 1024 * 1024,
    1024,
    32 * 1024 * 1024
  );
  /** Actual-settlement concurrency slots, default two and maximum 16. */
  const maxConcurrent = integer(options.maxConcurrent ?? 2, 1, 16);
  /** Cooperative query wait deadline, default 10000ms and maximum 60000ms. */
  const timeoutMs = integer(options.timeoutMs ?? 10000, 1, 60000);
  /** Native work retained until settlement even when a waiting caller times out. */
  const pending = new Set<Promise<unknown>>();
  /** Owned cancellation controllers for active authorization/query work. */
  const controllers = new Set<AbortController>();
  let closed = false;
  /** Admit one authorized analysis while retaining its slot until native settlement.
   * @param {AnalyticsAnalysisKind} kind - Named analysis capability being requested.
   * @param {AnalyticsAnalysisExecution} execution - Optional caller signal/deadline.
   * @param {(db: AnalyticsConnection, scope: Scope) => Promise<T>} fn - Bounded callback receiving the borrowed database and owned read scope.
   * @returns {Promise<T>} Result or redacted failure; timeout does not prove native cancellation.
   */
  async function run<T>(
    kind: AnalyticsAnalysisKind,
    execution: AnalyticsAnalysisExecution,
    fn: (db: AnalyticsConnection, scope: Scope) => Promise<T>
  ): Promise<T> {
    record(execution, ['signal', 'deadline']);
    if (
      execution.signal !== undefined &&
      !(execution.signal instanceof AbortSignal)
    ) {
      throw failure('INVALID_OPTIONS');
    }
    /** Optional caller deadline, separately bounded from this scope timeout. */
    const requestedDeadline =
      execution.deadline === undefined
        ? Infinity
        : integer(execution.deadline, 0, Date.now() + 60000);
    if (closed) {
      throw failure('CLOSED');
    }
    if (pending.size >= maxConcurrent) {
      throw failure('OVERLOAD');
    }
    /** Owned per-call cancellation source; cannot forcibly stop arbitrary JavaScript. */
    const controller = new AbortController();
    /** Earlier of scope timeout and caller deadline. */
    const deadline = Math.min(Date.now() + timeoutMs, requestedDeadline);
    let timedOut = false;
    /** Propagate caller cancellation into the owned operation signal.
     * @returns {void} Aborts cooperative work only. */
    const abort = () => controller.abort();
    /** Fence work at await/read/loop boundaries.
     * @returns {void} Throws a fixed cancellation/deadline error when the scope is no longer usable. */
    const check = () => {
      if (controller.signal.aborted || Date.now() >= deadline) {
        throw failure(
          timedOut || Date.now() >= deadline ? 'DEADLINE' : 'CANCELLED'
        );
      }
    };
    execution.signal?.addEventListener('abort', abort, { once: true });
    if (execution.signal?.aborted) {
      abort();
    }
    controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined,
      stop = () => {};
    /** Caller-visible cancellation/deadline wait, separate from actual native settlement. */
    const stopped = new Promise<never>((_, reject) => {
      stop = () => reject(failure(timedOut ? 'DEADLINE' : 'CANCELLED'));
      controller.signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.max(1, deadline - Date.now())
      );
      if (controller.signal.aborted) {
        stop();
      }
    });
    /** Actual authorization and database work; owns its pending slot until settlement. */
    const work = Promise.resolve().then(async () => {
      check();
      if (
        (await authorize(
          Object.freeze({ site, kind, signal: controller.signal })
        )) !== true
      ) {
        throw failure('DENIED');
      }
      check();
      /** Borrowed available connection resolved only after host authorization. */
      const db = connection();
      if (!db) {
        throw failure('UNAVAILABLE');
      }
      return fn(db, { signal: controller.signal, deadline, check });
    });
    pending.add(work);
    void work
      .finally(() => {
        pending.delete(work);
        controllers.delete(controller);
      })
      .catch(() => {});
    try {
      return await Promise.race([work, stopped]);
    } catch (cause) {
      throw cause instanceof AnalyticsAnalysisError
        ? cause
        : failure('UNAVAILABLE', cause);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      execution.signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', stop);
    }
  }
  /** Count and page a fixed tenant/time window before ranking or grouping identities.
   * @param {AnalyticsConnection} db - Borrowed connector supporting native COUNT and structured predicates.
   * @param {Scope} scope - Owned cooperative execution checks.
   * @param {{ since: number; until: number }} range - Half-open UTC event-time bounds.
   * @param {number} range.since - Inclusive UTC millisecond boundary.
   * @param {number} range.until - Exclusive UTC millisecond boundary.
   * @param {'visitor' | 'session'} identity - Previously consented visitor/session mode.
   * @returns {Promise<{events: Observed[], coverage: AnalyticsAnalysisCoverage}>} Bounded validated events sorted by event time then ID, with honest scan coverage.
   */
  async function scan(
    db: AnalyticsConnection,
    scope: Scope,
    range: {
      /** Inclusive UTC event timestamp boundary. */
      since: number; /** Exclusive UTC event timestamp boundary. */
      until: number;
    },
    identity: 'visitor' | 'session'
  ) {
    /** Fixed site filter and half-open event-time window applied in every native read. */
    const clauses = [
      { field: 'site', operator: 'eq' as const, value: site },
      { field: 'occurred_at', operator: 'gte' as const, value: range.since },
      { field: 'occurred_at', operator: 'lt' as const, value: range.until },
    ];
    /** Read one bounded structured query with cooperative signal/deadline checks.
     * @param {Parameters<AnalyticsConnection['select']>[0]} operation - Native structured count or keyset page.
     * @returns {Promise<Record<string, unknown>[]>} Rows, or a fixed failed-plan diagnostic. */
    const select = async (
      operation: Parameters<AnalyticsConnection['select']>[0]
    ) => {
      scope.check();
      /** Actual settled connector/index result; no unbounded fallback is attempted. */
      const result = await db.select(operation, {
        signal: scope.signal,
        deadline: scope.deadline,
      });
      scope.check();
      if (!result?.ok || !Array.isArray(result.rows)) {
        throw failure('UNSUPPORTED_OR_FAILED_PLAN');
      }
      return result.rows as Record<string, unknown>[];
    };
    // COUNT/filter are executed by the connector. No raw SQL or unbounded select fallback.
    /** Native count for the fixed site and half-open window. */
    const totals = await select({
      table,
      columns: [
        {
          expr: {
            kind: 'function',
            name: 'COUNT',
            args: [{ kind: 'column', name: 'id' }],
          },
          as: 'analysis_count',
        },
      ],
      where: { and: clauses },
    });
    /** Native count scalar, optionally represented as decimal digits. */
    const raw = totals[0]?.analysis_count;
    /** Safe persisted count validated before it enters coverage metadata. */
    const count =
      typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (
      totals.length !== 1 ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw failure('INVALID_RESULT');
    }
    /** Explicit observed scan/identity/provenance coverage, never a pinned snapshot guarantee. */
    const coverage: AnalyticsAnalysisCoverage = {
      version: 1,
      mode: 'bounded-persisted-window',
      persistedCount: count,
      scanned: 0,
      identified: 0,
      missingIdentity: 0,
      unconsented: 0,
      invalid: 0,
      legacyUnversioned: 0,
      versioned: 0,
      truncated: false,
      windowExhausted: false,
      countMatchesScan: false,
      snapshot: false,
      ingestion: 'best-effort',
      historicalIdentity: 'unknown',
      ordering: 'occurred_at,id',
      boundary: 'window-clipped',
    };
    /** Only validated consented identified events retained for bounded in-memory analysis. */
    const events: Observed[] = [];
    let cursor: string | undefined,
      bytes = 0;
    // Fetch only bounded pages and retain one lookahead row for truncation detection.
    while (true) {
      /** Remaining admitted events plus one lookahead row. */
      const limit = Math.min(pageSize, maxEvents - coverage.scanned) + 1;
      /** Bounded keyset page; site and ascending ID are checked after storage returns it. */
      const rows = await select({
        table,
        columns: [
          'id',
          'event_name',
          'site',
          'session_id',
          'occurred_at',
          'properties_json',
        ],
        where: {
          and: [
            ...clauses,
            ...(cursor
              ? [{ field: 'id', operator: 'gt' as const, value: cursor }]
              : []),
          ],
        },
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit,
      });
      if (rows.length > limit) {
        throw failure('INVALID_RESULT');
      }
      /** Number of page rows to process without consuming the lookahead. */
      const take = Math.min(rows.length, limit - 1);
      // Scope/order/consent checks precede retaining any event for identity analysis.
      for (const row of rows.slice(0, take)) {
        scope.check();
        if (
          typeof row.id !== 'string' ||
          !idPattern.test(row.id) ||
          (cursor !== undefined && row.id <= cursor) ||
          row.site !== site
        ) {
          throw failure('SCOPE_OR_ORDER_VIOLATION');
        }
        cursor = row.id;
        coverage.scanned++;
        if (typeof row.properties_json !== 'string') {
          coverage.invalid++;
          continue;
        }
        if (Buffer.byteLength(row.properties_json) > 8192) {
          throw failure('BYTE_LIMIT');
        }
        bytes += Buffer.byteLength(row.properties_json) + 256;
        if (bytes > maxBytes) {
          throw failure('BYTE_LIMIT');
        }
        /** Stored event timestamp normalized from bounded decimal digits only. */
        const occurredAt =
          typeof row.occurred_at === 'string' &&
          /^\d{1,15}$/.test(row.occurred_at)
            ? Number(row.occurred_at)
            : row.occurred_at;
        if (
          typeof row.event_name !== 'string' ||
          !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(row.event_name) ||
          typeof occurredAt !== 'number' ||
          !Number.isSafeInteger(occurredAt) ||
          occurredAt < range.since ||
          occurredAt >= range.until
        ) {
          coverage.invalid++;
          continue;
        }
        let props: Record<string, unknown>;
        try {
          props = JSON.parse(row.properties_json);
          if (!props || typeof props !== 'object' || Array.isArray(props)) {
            throw 0;
          }
          /** Stored schema provenance, not proof of complete historical fields. */
          const schema = readEventSchemaCoverage({
            properties_json: row.properties_json,
          });
          if (schema.coverage === 'versioned') {
            coverage.versioned++;
          } else {
            coverage.legacyUnversioned++;
          }
        } catch {
          coverage.invalid++;
          continue;
        }
        if (props.zConsent !== 'granted') {
          coverage.unconsented++;
          continue;
        }
        /** Existing consented identifier selected by query mode; no fingerprinting or synthesis. */
        const who = identity === 'visitor' ? props.zVisitorId : row.session_id;
        if (!opaque(who)) {
          coverage.missingIdentity++;
          continue;
        }
        coverage.identified++;
        events.push({
          id: row.id,
          name: row.event_name,
          at: occurredAt,
          identity: who,
        });
      }
      if (rows.length < limit) {
        coverage.windowExhausted = true;
        break;
      }
      if (coverage.scanned === maxEvents) {
        coverage.truncated = true;
        coverage.mode = 'sampled-page';
        break;
      }
    }
    coverage.countMatchesScan =
      coverage.windowExhausted && coverage.scanned === coverage.persistedCount;
    events.sort((a, b) => {
      if (a.at !== b.at) {
        return a.at - b.at;
      }
      if (a.id < b.id) {
        return -1;
      }
      if (a.id > b.id) {
        return 1;
      }
      return 0;
    });
    scope.check();
    return { events, coverage };
  }
  /** Decide whether observed conversion counts have complete identity/scan coverage.
   * @param {AnalyticsAnalysisCoverage} coverage - Actual bounded scan metadata.
   * @returns {boolean} Whether unknown identity, invalid rows and truncation are absent. */
  const known = (coverage: AnalyticsAnalysisCoverage) =>
    !coverage.truncated &&
    coverage.countMatchesScan &&
    !coverage.missingIdentity &&
    !coverage.unconsented &&
    !coverage.invalid;
  return Object.freeze({
    /** Explicitly provision supported analysis index shapes after authorization.
     * @param {AnalyticsAnalysisExecution} execution - Optional cooperative cancellation/deadline.
     * @returns {ReturnType<AnalyticsAnalysis['initializeIndexes']>} Two declared indexes or an unsupported/storage failure; no hidden migration on import.
     */
    initializeIndexes(execution: AnalyticsAnalysisExecution = {}) {
      return run('indexes', execution, async (db, scope) => {
        if (!db.createIndex) {
          throw failure('UNSUPPORTED_INDEX_PLAN');
        }
        /** Stable bounded table suffix for explicit analysis indexes. */
        const hash = createHash('sha256')
          .update(table)
          .digest('hex')
          .slice(0, 8);
        // Provision only declared index shapes; unsupported native plans reject.
        for (const [suffix, columns] of [
          ['site_id', ['site', 'id']],
          ['site_at_id', ['site', 'occurred_at', 'id']],
        ] as const) {
          scope.check();
          /** Actual settled connector/index result; no unbounded fallback is attempted. */
          const result = await db.createIndex(
            {
              table,
              name: `${table.slice(0, 39)}_${hash}_${suffix}`,
              columns: [...columns],
              ifNotExists: true,
            },
            { signal: scope.signal, deadline: scope.deadline }
          );
          scope.check();
          if (
            !result?.ok &&
            !['1061', 'ER_DUP_KEYNAME'].includes(
              String(result?.error?.code ?? '')
            )
          ) {
            throw failure('UNSUPPORTED_INDEX_PLAN');
          }
        }
        return { indexes: 2 };
      });
    },
    /** Group observed session identities using idle and maximum-duration boundaries.
     * @param {AnalyticsSessionQuery} query - Bounded window plus explicit/default timeout limits.
     * @param {AnalyticsAnalysisExecution} execution - Optional cooperative execution controls.
     * @returns {ReturnType<AnalyticsAnalysis['sessions']>} Window-clipped observed sessions with coverage, not a reconstructed global session history.
     */
    sessions(
      query: AnalyticsSessionQuery,
      execution: AnalyticsAnalysisExecution = {}
    ) {
      /** Validated half-open event-time range, at most 31 days. */
      const range = window(query, ['timeoutMs', 'maxDurationMs']);
      /** Session idle boundary, default 30 minutes and bounded to 1 minute–24 hours. */
      const idle = integer(
        query.timeoutMs ?? 30 * 60000,
        60000,
        24 * 60 * 60000
      );
      /** Maximum observed session duration, no longer than 24 hours. */
      const duration = integer(
        query.maxDurationMs ?? 24 * 60 * 60000,
        idle,
        24 * 60 * 60000
      );
      return run('sessions', execution, async (db, scope) => {
        /** Bounded consented events plus explicit scan/identity coverage. */
        const { events, coverage } = await scan(db, scope, range, 'session');
        /** Per-identity state bounded by the admitted event count, scoped to this query. */
        const states = new Map<
          string,
          { first: number; last: number; count: number }
        >();
        let sessions = 0,
          totalDurationMs = 0;
        // Consume only admitted events for this fixed tenant/window.
        for (const item of events) {
          scope.check();
          /** Last observed session state for this consented identity. */
          const previous = states.get(item.identity);
          if (
            !previous ||
            item.at - previous.last >= idle ||
            item.at - previous.first >= duration
          ) {
            sessions++;
            states.set(item.identity, {
              first: item.at,
              last: item.at,
              count: 1,
            });
          } else {
            totalDurationMs += item.at - previous.last;
            previous.last = item.at;
            previous.count++;
          }
        }
        return {
          sessions,
          events: events.length,
          totalDurationMs,
          timeoutMs: idle,
          maxDurationMs: duration,
          semantics: 'observed-window-sessions' as const,
          coverage,
        };
      });
    },
    /** Evaluate strict increasing-time steps once per consented identity/window.
     * @param {AnalyticsFunnelQuery} query - Bounded window, validated steps and conversion horizon.
     * @param {AnalyticsAnalysisExecution} execution - Optional cooperative execution controls.
     * @returns {ReturnType<AnalyticsAnalysis['funnel']>} Observed counts and nullable conversions when evidence coverage is incomplete.
     */
    funnel(
      query: AnalyticsFunnelQuery,
      execution: AnalyticsAnalysisExecution = {}
    ) {
      /** Validated half-open event-time range, at most 31 days. */
      const range = window(query, ['steps', 'conversionWindowMs', 'identity']);
      if (
        !Array.isArray(query.steps) ||
        query.steps.length < 2 ||
        query.steps.length > 10
      ) {
        throw failure('INVALID_STEPS');
      }
      /** Validated two-to-ten ordered funnel labels. */
      const steps = Array.from(query.steps, event);
      /** Finite strict-order conversion window, default at most one day and maximum seven days. */
      const conversionWindowMs = integer(
        query.conversionWindowMs ?? Math.min(DAY, range.until - range.since),
        1,
        Math.min(7 * DAY, range.until - range.since)
      );
      /** Explicit visitor/session identity mode; identity collection remains consented. */
      const identity = query.identity ?? 'visitor';
      if (!['visitor', 'session'].includes(identity)) {
        throw failure('INVALID_IDENTITY');
      }
      return run('funnel', execution, async (db, scope) => {
        /** Bounded consented events plus explicit scan/identity coverage. */
        const { events, coverage } = await scan(db, scope, range, identity);
        /** Per-identity state bounded by the admitted event count, scoped to this query. */
        const states = new Map<
          string,
          { stage: number; start: number; last: number; max: number }
        >();
        // Consume only admitted events for this fixed tenant/window.
        for (const item of events) {
          scope.check();
          let state = states.get(item.identity);
          if (!state) {
            state = { stage: 0, start: 0, last: 0, max: 0 };
            states.set(item.identity, state);
          }
          if (state.max === steps.length) {
            continue;
          }
          if (state.stage && item.at - state.start > conversionWindowMs) {
            state.stage = 0;
          }
          if (
            item.name === steps[state.stage] &&
            (!state.stage || item.at > state.last)
          ) {
            if (!state.stage) {
              state.start = item.at;
            }
            state.stage++;
            state.last = item.at;
            state.max = Math.max(state.max, state.stage);
          }
        }
        /** Observed once-per-identity stage counts for each ordered step. */
        const reached = steps.map((name, index) => ({
          name,
          principals: [...states.values()].filter((s) => s.max > index).length,
        }));
        /** Observed identities reaching the first step. */
        const entered = reached[0]!.principals;
        /** Observed completed identities; incomplete coverage exposes a separate nullable exact result. */
        const converted = reached.at(-1)!.principals;
        return {
          steps: reached,
          entered,
          converted: known(coverage) ? converted : null,
          observedConverted: converted,
          conversionRate:
            known(coverage) && entered ? converted / entered : null,
          deduplication: 'once-per-identity-window' as const,
          conversionWindowMs,
          coverage,
        };
      });
    },
    /** Evaluate UTC first-observed entry and bounded return-day retention.
     * @param {AnalyticsCohortQuery} query - Whole-UTC-day entry window and at most 30 return days.
     * @param {AnalyticsAnalysisExecution} execution - Optional cooperative execution controls.
     * @returns {ReturnType<AnalyticsAnalysis['cohort']>} Observed membership/retention with immature or unknown rates left null.
     */
    cohort(
      query: AnalyticsCohortQuery,
      execution: AnalyticsAnalysisExecution = {}
    ) {
      /** Validated half-open event-time range, at most 31 days. */
      const range = window(query, [
        'entryEvent',
        'returnEvent',
        'retentionDays',
      ]);
      if (range.since % DAY || range.until % DAY) {
        throw failure('UTC_DAY_REQUIRED');
      }
      /** Validated cohort entry label. */
      const entryEvent = event(query.entryEvent);
      /** Validated cohort return label. */
      const returnEvent = event(query.returnEvent);
      /** Explicit UTC retention offsets, bounded to 0–30. */
      const retentionDays = integer(query.retentionDays, 0, 30);
      /** Last observed UTC millisecond, clipped to now and the requested retention horizon. */
      const observedUntil = Math.min(
        Date.now(),
        range.until + retentionDays * DAY
      );
      return run('cohort', execution, async (db, scope) => {
        /** Bounded consented events plus explicit scan/identity coverage. */
        const { events, coverage } = await scan(
          db,
          scope,
          { since: range.since, until: observedUntil },
          'visitor'
        );
        /** First observed entry per consented visitor within the entry window. */
        const members = new Map<
          string,
          { day: number; /** Validated event-time timestamp. */ at: number }
        >();
        // Consume only admitted events for this fixed tenant/window.
        for (const item of events) {
          if (
            item.name === entryEvent &&
            item.at < range.until &&
            !members.has(item.identity)
          ) {
            members.set(item.identity, {
              day: Math.floor(item.at / DAY) * DAY,
              at: item.at,
            });
          }
        }
        /** UTC cohort-day buckets of deduplicated observed return identities. */
        const retained = new Map<number, Set<string>[]>();
        // Allocate only validated UTC entry-day buckets, each with a bounded retention horizon.
        for (let day = range.since; day < range.until; day += DAY) {
          retained.set(
            day,
            Array.from({ length: retentionDays + 1 }, () => new Set<string>())
          );
        }
        // Consume only admitted events for this fixed tenant/window.
        for (const item of events) {
          scope.check();
          /** Observed cohort entry for this visitor, if one exists. */
          const joined = members.get(item.identity);
          if (
            joined === undefined ||
            item.name !== returnEvent ||
            item.at < joined.at
          ) {
            continue;
          }
          /** UTC day offset relative to the first observed cohort entry. */
          const offset = Math.floor(item.at / DAY) - joined.day / DAY;
          if (offset >= 0 && offset <= retentionDays) {
            retained.get(joined.day)![offset]!.add(item.identity);
          }
        }
        /** Bounded UTC membership/retention records with explicit maturity and coverage. */
        const cohorts = [...retained].map(([day, buckets]) => {
          /** Observed entry identities for this UTC day. */
          const size = [...members.values()].filter(
            (member) => member.day === day
          ).length;
          return {
            day: new Date(day).toISOString().slice(0, 10),
            principals: size,
            retention: buckets.map((set, offset) => {
              /** Whether the entire UTC retention bucket has elapsed within the observed horizon. */
              const mature = day + (offset + 1) * DAY <= observedUntil;
              return {
                day: offset,
                observed: mature ? set.size : null,
                rate:
                  mature && known(coverage) && size ? set.size / size : null,
                complete: mature,
              };
            }),
          };
        });
        return {
          cohorts,
          membership: 'first-entry-observed-in-window' as const,
          observedUntil,
          coverage,
        };
      });
    },
    /** Read bounded lifecycle counters without identity or route labels.
     * @returns {{closed: boolean, pending: number}} Closed state and actual pending-work count.
     */
    diagnostics() {
      return { closed, pending: pending.size };
    },
    /** Stop admission, signal active work and await actual settlement without closing the borrowed database.
     * @returns {Promise<void>} Settles after native operations/host callbacks settle; noncooperative work can delay close.
     */
    async close() {
      closed = true;
      // Signal all owned scopes before waiting for actual work settlement.
      for (const controller of controllers) {
        controller.abort();
      }
      await Promise.allSettled([...pending]);
    },
  });
}
export type AnalyticsAnalysis = ReturnType<typeof createAnalyticsAnalysis>;
