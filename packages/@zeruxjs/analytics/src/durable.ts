import { createHash, randomUUID } from 'node:crypto';
import type {
  DatabaseFacade,
  TransactionDatabase,
  TransactionOptions,
} from '@zeruxjs/db';
import type { AnalyticsEventInput, AnalyticsRow } from './types.js';
import {
  isEventSchemaRegistry,
  type AnalyticsEventSchemaRegistry,
} from './schemas.js';
import { validateRegisteredEvent } from './validation.js';
import { numericFactId } from './reconciliation.js';

export type DurableAnalyticsStatus =
  | 'pending'
  | 'processing'
  | 'persisted'
  | 'dead'
  | 'purged';
export interface DurableAnalyticsReference {
  /** Explicit verified tenant/site boundary. */
  site: string;
  /** Opaque stable record reference, never recipient identity. */
  id: string;
}
export interface DurableAnalyticsFact {
  /** Opaque stable record reference, never recipient identity. */
  id: string;
  /** Source event reference. */
  event_id: string;
  /** Configured registered numeric property. */
  property_name: string;
  /** Validated finite numeric projection. */
  numeric_value: number;
  /** Validated source event label. */
  event_name: string;
  /** Collection channel. */
  source: string;
  /** Explicit verified tenant/site boundary. */
  site: string;
  /** Validated source pathname without query data. */
  pathname: string;
  /** Original UTC event timestamp. */
  occurred_at: number;
}
export interface DurableAnalyticsRecord extends DurableAnalyticsReference {
  /** Durable record format version, fixed at one. */
  version: 1;
  /** Registered event schema version pinned at acceptance. */
  schemaVersion: number;
  /** Exact CAS revision, incremented on each state transition. */
  revision: number;
  /** Durable workflow state, not an exactly-once delivery guarantee. */
  status: DurableAnalyticsStatus;
  /** Stable durable event identity. */
  eventId: string;
  /** Canonical integrity/dedup hash, not proof of authorship. */
  payloadHash: string;
  /** Private persisted event payload, removed in purge tombstones. */
  row: AnalyticsRow | null;
  /** Private numeric projections committed with the event through the journal. */
  facts: DurableAnalyticsFact[];
  /** Original explicit UTC event time. */
  occurredAt: number;
  /** Server acceptance time. */
  createdAt: number;
  /** Server-time dedup lifetime; expiry does not authorize key reuse silently. */
  dedupUntil: number;
  /** Bounded processing attempts. */
  attempts: number;
  /** Earliest explicit retry/dispatch time. */
  nextAt: number;
  /** Private processing token and expiry; never expose to clients. */
  lease: null | {
    /** Private random processing capability. */
    token: string; /** Server processing-lease expiry. */
    until: number;
  };
  /** Fixed failure classification without raw private causes. */
  code: null | 'TRANSIENT' | 'PERMANENT' | 'EXHAUSTED';
}
/** Host-owned shared durable primary. CAS includes site/id and exact revision, never cache get/set. */
export interface DurableAnalyticsStore {
  /** Required host store protocol identifier. */
  readonly contract: 'analytics-durable-v1';
  insert(record: DurableAnalyticsRecord): Promise<boolean>;
  get(
    reference: DurableAnalyticsReference
  ): Promise<DurableAnalyticsRecord | null>;
  cas(expectedRevision: number, next: DurableAnalyticsRecord): Promise<boolean>;
  page(
    site: string,
    query: {
      cursor?: string;
      limit: number; /** Explicit old event-time cutoff. */
      before?: number;
    }
  ): Promise<DurableAnalyticsRecord[]>;
}
export interface DurableAnalyticsAcknowledgement extends DurableAnalyticsReference {
  /** Explicit accepted/persisted/dead/purged/uncertain acknowledgement. */
  state: 'accepted' | 'persisted' | 'dead' | 'purged' | 'uncertain';
  /** Stable durable event identity. */
  eventId: string;
  /** Whether an existing acceptance was observed. */
  duplicate: boolean;
  /** Server-time dedup lifetime; expiry does not authorize key reuse silently. */
  dedupUntil: number;
}
export interface DurableAnalyticsPlan {
  /** Current exact revision/lease to fence on the pin. */
  record: DurableAnalyticsRecord;
  /** Next revision to publish only within the same transaction. */
  next: DurableAnalyticsRecord;
}
export interface DurableAnalyticsJournal {
  /** Insert only on this pin. Return true only for the unique durable insertion. */
  append(
    pin: TransactionDatabase,
    record: DurableAnalyticsRecord
  ): boolean | Promise<boolean>;
  /** Fence exact lease+revision, insert event/facts and CAS next state on this SAME pin. Throw on any failed result. */
  materialize(
    pin: TransactionDatabase,
    plan: DurableAnalyticsPlan
  ): boolean | Promise<boolean>;
  /** Fence each revision, delete facts before events, then keep payload-free dedup tombstones on this pin. */
  purge(
    pin: TransactionDatabase,
    plans: readonly DurableAnalyticsPlan[]
  ): boolean | Promise<boolean>;
}
export interface DurableAnalyticsPurgePreview {
  /** Explicit verified tenant/site boundary. */
  site: string;
  /** Explicit old event-time cutoff. */
  before: number;
  /** Bounded payload-free preview candidate metadata. */
  items: Array<{
    /** Opaque stable record reference, never recipient identity. */
    id: string;
    /** Exact CAS revision, incremented on each state transition. */
    revision: number;
    /** Durable workflow state, not an exactly-once delivery guarantee. */
    status: DurableAnalyticsStatus;
    /** Projected sidecar count for this candidate. */
    numericFacts: number;
    /** Whether the ledger still retains private row content. */
    hasPayload: boolean;
  }>;
  /** Pending/processing/dead candidates requiring an explicit conflict policy. */
  unprocessed: number;
  /** Persisted source candidates from the ledger projection. */
  eventCandidates: number;
  /** Projected sidecar candidates, not an independent database audit. */
  numericFactCandidates: number;
  /** Last returned ledger ID when continuation may exist. */
  nextCursor: string | null;
  /** Canonical preview integrity hash, not host authorization. */
  hash: string;
}
export interface DurableAnalyticsOptions {
  /** Host-owned shared durable primary with unique insert and exact CAS. */
  store: DurableAnalyticsStore;
  /** Validated package-instance registry. */
  schemaRegistry: AnalyticsEventSchemaRegistry;
  /** Explicit registered metrics, at most eight. */
  numericFields?: readonly string[];
  /** Required host action/reference/principal authorization callback. */
  authorize: (
    action: 'accept' | 'process' | 'dispatch' | 'inspect' | 'preview' | 'purge',
    reference: Readonly<DurableAnalyticsReference>,
    principal: unknown
  ) => boolean | Promise<boolean>;
  /** Attempt cap, default five and maximum 20. */
  maxAttempts?: number;
  /** Retry-age cap, default seven days and maximum 30 days. */
  maxAgeMs?: number;
  /** Dedup lifetime, default 30 days and maximum 90 days. */
  dedupMs?: number;
  /** Processing lease, default 60000ms and maximum 300000ms. */
  leaseMs?: number;
  /** Base retry delay, default 1000ms. */
  baseDelayMs?: number;
  /** Maximum retry delay, default 60000ms and maximum one day. */
  maxDelayMs?: number;
  /** Actual-settlement concurrency limit, default 16 and maximum 128. */
  maxPending?: number;
  /** Trusted injected clock or Date.now. */
  now?: () => number;
}
/** Fixed-code public failure; private causes are non-enumerable and never logged by default. */
export class DurableAnalyticsError extends Error {
  /** Create a fixed-code durable error with a private optional cause.
   * @param {string} code - Public diagnostic category.
   * @param {unknown} cause - Optional private cause, not enumerable telemetry.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Durable analytics failed (${code})`);
    this.name = 'DurableAnalyticsError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Create a redacted fixed-code durable-ingestion error.
 * @param {string} code - Public failure category.
 * @param {unknown} cause - Optional private non-enumerable cause.
 * @returns {DurableAnalyticsError} Failure without stored bodies or credentials in its message. */
const fail = (code: string, cause?: unknown) =>
  new DurableAnalyticsError(code, cause);
/** UTC day length used for maximum age, deduplication and purge cutoff policies. */
const DAY = 86400000;
/** Hash canonical identity/payload metadata without claiming authorship or permission.
 * @param {string} value - Validated serialized data.
 * @returns {string} SHA-256 hex identity. */
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
/** Serialize acyclic validated data with sorted object keys.
 * @param {unknown} value - Validated inert record/array/scalar.
 * @returns {string} Stable JSON spelling for integrity and preview hashes. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonical((value as Record<string, unknown>)[k])
        )
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
};
/** Deep-freeze detached prepared plans before handing them to host journals.
 * @param {T} value - Owned detached value.
 * @returns {T} Same immutable value; input must be acyclic validated data.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Validate an inclusive safe-integer resource budget.
 * @param {unknown} value - Candidate budget.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {number} Validated number; unsupported limits throw.
 */
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw fail('INVALID_LIMIT');
  }
  return value;
}
/** Validate explicit tenant and opaque durable record identity.
 * @param {DurableAnalyticsReference} value - Candidate tenant/reference tuple.
 * @returns {DurableAnalyticsReference} Detached reference, or a fixed invalid-reference failure.
 */
function ref(value: DurableAnalyticsReference) {
  if (
    !value ||
    typeof value.site !== 'string' ||
    !value.site ||
    value.site.length > 200 ||
    // eslint-disable-next-line no-control-regex -- Reject controls in a durable tenant reference.
    /[\x00-\x1f\x7f]/.test(value.site) ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.id)
  ) {
    throw fail('INVALID_REFERENCE');
  }
  return { site: value.site, id: value.id };
}
/** Compute payload identity independently of catalog-wide optional additions.
 * @param {AnalyticsRow} row - Validated event row.
 * @param {DurableAnalyticsFact[]} facts - Explicit numeric projections.
 * @returns {string} Canonical payload hash excluding only catalogId provenance. */
const payloadHash = (row: AnalyticsRow, facts: DurableAnalyticsFact[]) => {
  /** Detached parsed scalar/provenance data; no source or expressions are evaluated. */
  const props = JSON.parse(row.properties_json);
  if (props.zAnalyticsSchema) {
    delete props.zAnalyticsSchema.catalogId;
  }
  return hash(
    canonical({ row: { ...row, properties_json: canonical(props) }, facts })
  );
};
/** Expose payload-free acceptance state rather than the stored event body.
 * @param {DurableAnalyticsRecord} r - Validated durable record.
 * @param {boolean} duplicate - Whether an existing acceptance was observed, default false.
 * @param {DurableAnalyticsAcknowledgement['state']|undefined} state - Explicit uncertain override when commit outcome is ambiguous.
 * @returns {DurableAnalyticsAcknowledgement} Opaque reference and acknowledgement semantics. */
const ack = (
  r: DurableAnalyticsRecord,
  duplicate = false,
  state?: DurableAnalyticsAcknowledgement['state']
): DurableAnalyticsAcknowledgement => ({
  ...ref(r),
  state:
    state ??
    (r.status === 'pending' || r.status === 'processing'
      ? 'accepted'
      : r.status),
  eventId: r.eventId,
  duplicate,
  dedupUntil: r.dedupUntil,
});
type PinDatabase = Pick<
  DatabaseFacade,
  'transaction' | 'transactionCapabilities'
>;
/** Require negotiated real pinned transactions before atomic journal work.
 * @param {PinDatabase} db - Host database exposing a negotiated real pinned transaction.
 * @returns {PinDatabase['transaction']} Bound transaction callback owner; unsupported capabilities reject.
 */
function transaction(db: PinDatabase) {
  /** Negotiated transaction metadata; unsupported pins are rejected before mutation. */
  const caps = db?.transactionCapabilities?.();
  if (
    typeof db?.transaction !== 'function' ||
    !caps ||
    caps.savepoints !== false ||
    !Array.isArray(caps.isolationLevels) ||
    !caps.isolationLevels.length
  ) {
    throw fail('PINNED_TRANSACTION_REQUIRED');
  }
  return db.transaction.bind(db);
}
/** Validate supported cooperative transaction policy and combine cancellation.
 * @param {PinDatabase} db - Host database exposing a negotiated real pinned transaction.
 * @param {TransactionOptions} settings - Optional supported transaction policy; no nested emulated transaction.
 * @param {AbortSignal} signal - Owned operation cancellation signal.
 * @param {number} maxTimeout - Maximum allowed transaction timeout, default 60000ms.
 * @returns {TransactionOptions} Negotiated policy; unsupported isolation/deadline controls reject.
 */
function settingsFor(
  db: PinDatabase,
  settings: TransactionOptions,
  signal: AbortSignal,
  maxTimeout = 60000
): TransactionOptions {
  if (
    !settings ||
    typeof settings !== 'object' ||
    Object.keys(settings).some(
      (k) => !['isolation', 'signal', 'timeoutMs', 'deadline'].includes(k)
    )
  ) {
    throw fail('INVALID_TRANSACTION_OPTIONS');
  }
  /** Negotiated transaction metadata; unsupported pins are rejected before mutation. */
  const caps = db.transactionCapabilities?.();
  if (
    !caps ||
    caps.timeout !== 'cooperative' ||
    (settings.isolation !== undefined &&
      !caps.isolationLevels.includes(settings.isolation))
  ) {
    throw fail('UNSUPPORTED_TRANSACTION_POLICY');
  }
  if (
    settings.signal !== undefined &&
    !(settings.signal instanceof AbortSignal)
  ) {
    throw fail('INVALID_TRANSACTION_OPTIONS');
  }
  if (settings.deadline !== undefined) {
    integer(settings.deadline, 0, Date.now() + maxTimeout);
  }
  return {
    ...settings,
    timeoutMs: integer(
      settings.timeoutMs ?? Math.min(30000, maxTimeout),
      1,
      maxTimeout
    ),
    signal: settings.signal
      ? AbortSignal.any([signal, settings.signal])
      : signal,
  };
}
/** Validate bounded ledger pagination without user filter expressions.
 * @param {{ cursor?: string; limit?: number }} query - Optional opaque cursor and finite page limit.
 * @param {string|undefined} query.cursor - Exclusive opaque ledger continuation.
 * @param {number|undefined} query.limit - Page size, default 20 and maximum 50.
 * @returns {{cursor: string|undefined, limit: number}} Validated continuation with default 20 and maximum 50 records.
 */
function pageSettings(query: { cursor?: string; limit?: number }) {
  if (
    !query ||
    typeof query !== 'object' ||
    Object.keys(query).some((k) => !['cursor', 'limit'].includes(k)) ||
    (query.cursor !== undefined &&
      (typeof query.cursor !== 'string' ||
        !/^[a-f0-9]{32}$/.test(query.cursor)))
  ) {
    throw fail('INVALID_PAGE');
  }
  return { cursor: query.cursor, limit: integer(query.limit ?? 20, 1, 50) };
}
/** Create opt-in durable ingestion using host-owned CAS and pinned-journal contracts. Construction starts no queue, database, scheduler or retry loop.
 * @param {DurableAnalyticsOptions} options - Private host store/schema/authorization and bounded lifecycle policies.
 * @returns {DurableAnalytics} Disposable coordinator; accepted and persisted states have separate meanings.
 */
export function createDurableAnalytics(options: DurableAnalyticsOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    Object.keys(options).some(
      (k) =>
        ![
          'store',
          'schemaRegistry',
          'numericFields',
          'authorize',
          'maxAttempts',
          'maxAgeMs',
          'dedupMs',
          'leaseMs',
          'baseDelayMs',
          'maxDelayMs',
          'maxPending',
          'now',
        ].includes(k)
    ) ||
    (options.now !== undefined && typeof options.now !== 'function') ||
    (options.numericFields !== undefined &&
      !Array.isArray(options.numericFields))
  ) {
    throw fail('INVALID_CONFIGURATION');
  }
  /** Borrowed host-owned durable CAS primary; queue/cache storage is not substituted. */
  const store = options?.store;
  if (
    store?.contract !== 'analytics-durable-v1' ||
    ['insert', 'get', 'cas', 'page'].some(
      (k) => typeof (store as any)[k] !== 'function'
    ) ||
    !isEventSchemaRegistry(options.schemaRegistry) ||
    typeof options.authorize !== 'function'
  ) {
    throw fail('INVALID_CONFIGURATION');
  }
  /** Validated generation-scoped schema registry; no browser-supplied registry code. */
  const registry = options.schemaRegistry;
  /** Borrowed host authorization callback rechecked for each privileged operation. */
  const authorize = options.authorize;
  /** Explicit bounded metric selection validated against registry units. */
  const numericFields = [...(options.numericFields ?? [])];
  if (
    numericFields.length > 8 ||
    new Set(numericFields).size !== numericFields.length
  ) {
    throw fail('INVALID_CONFIGURATION');
  }
  numericFields.forEach((field) => registry.metric(field));
  /** Finite materialization-attempt cap, default five and maximum 20. */
  const maxAttempts = integer(options.maxAttempts ?? 5, 1, 20);
  /** Maximum retry age, default seven days and maximum 30 days. */
  const maxAge = integer(options.maxAgeMs ?? 7 * DAY, 1000, 30 * DAY);
  /** Dedup tombstone lifetime, at least max age and at most 90 days. */
  const dedupMs = integer(options.dedupMs ?? 30 * DAY, maxAge, 90 * DAY);
  /** Finite processing lease, default 60000ms and maximum 300000ms. */
  const leaseMs = integer(options.leaseMs ?? 60000, 1000, 300000);
  /** Base bounded retry delay, default 1000ms. */
  const base = integer(options.baseDelayMs ?? 1000, 1, DAY);
  /** Maximum retry delay, default 60000ms and maximum one day. */
  const delayMax = integer(options.maxDelayMs ?? 60000, base, DAY);
  /** Actual-settlement admission cap, default 16 and maximum 128. */
  const maxPending = integer(options.maxPending ?? 16, 1, 128);
  /** Trusted injected clock, or server Date.now. */
  const now = options.now ?? Date.now;
  let closed = false;
  /** Actual native/host work retained until settlement; close waits for it. */
  const pending = new Set<Promise<unknown>>();
  /** Owned operation signals; cancellation never forcibly stops host callbacks. */
  const controllers = new Set<AbortController>();
  /** Read a safe server clock for durable state transitions.
   * @returns {number} Validated UTC milliseconds. */
  const clock = () => integer(now(), 0, 253402300799999);
  /** Compute bounded exponential delay without executing retries automatically.
   * @param {number} attempt - Validated positive attempt number.
   * @returns {number} Delay capped by configured maximum. */
  const delay = (attempt: number) =>
    Math.min(delayMax, base * 2 ** Math.min(attempt - 1, 20));
  /** Reauthorize an operation using a detached tenant reference.
   * @param {Parameters<typeof authorize>[0]} action - Named privileged operation.
   * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
   * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
   * @returns {Promise<void>} Literal true is required; denial rejects.
   */
  async function allowed(
    action: Parameters<typeof authorize>[0],
    reference: DurableAnalyticsReference,
    principal: unknown
  ) {
    if (
      (await authorize(action, Object.freeze(ref(reference)), principal)) !==
      true
    ) {
      throw fail('DENIED');
    }
  }
  /** Admit bounded work and retain ownership until actual host settlement.
   * @param {(signal: AbortSignal) => Promise<T>} work - Host work receiving the owned cooperative cancellation signal.
   * @returns {Promise<T>} Result or redacted failure; no automatic replay of side effects.
   */
  function run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(fail('CLOSED'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(fail('OVERLOAD'));
    }
    /** Owned cooperative signal for this admitted operation. */
    const controller = new AbortController();
    controllers.add(controller);
    /** Actual work settlement, including host storage/callbacks; owns the pending slot. */
    const promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      })
      .catch((cause) => {
        throw cause instanceof DurableAnalyticsError
          ? cause
          : fail('STORE_UNAVAILABLE', cause);
      })
      .finally(() => {
        pending.delete(promise);
        controllers.delete(controller);
      });
    pending.add(promise);
    return promise;
  }
  /** Clone and verify durable records before relying on tenant, status or payload.
   * @param {DurableAnalyticsRecord | null} raw - Untrusted persisted record.
   * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
   * @returns {DurableAnalyticsRecord|null} Verified detached record or absence; corruption rejects.
   */
  function checked(
    raw: DurableAnalyticsRecord | null,
    reference: DurableAnalyticsReference
  ): DurableAnalyticsRecord | null {
    if (!raw) {
      return null;
    }
    /** Detached durable record checked against the fixed tenant/reference and integrity metadata. */
    const r = structuredClone(raw);
    ref(r);
    if (
      r.site !== reference.site ||
      r.id !== reference.id ||
      r.version !== 1 ||
      !['pending', 'processing', 'persisted', 'dead', 'purged'].includes(
        r.status
      ) ||
      r.eventId !== r.id ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !Number.isSafeInteger(r.attempts) ||
      r.attempts < 0 ||
      r.attempts > 20 ||
      !/^[a-f0-9]{64}$/.test(r.payloadHash) ||
      !Array.isArray(r.facts) ||
      r.facts.length > 8
    ) {
      throw fail('CORRUPT_RECORD');
    }
    // Validate every persisted transition timestamp before relying on the record.
    for (const value of [r.occurredAt, r.createdAt, r.dedupUntil, r.nextAt]) {
      integer(value, 0, 253402300799999);
    }
    if (r.status === 'purged') {
      if (r.row !== null || r.facts.length) {
        throw fail('CORRUPT_RECORD');
      }
    } else if (
      !r.row ||
      r.row.id !== r.eventId ||
      r.row.site !== r.site ||
      r.row.occurred_at !== r.occurredAt ||
      typeof r.row.properties_json !== 'string' ||
      Buffer.byteLength(r.row.properties_json) > 8192 ||
      payloadHash(r.row, r.facts) !== r.payloadHash
    ) {
      throw fail('CORRUPT_RECORD');
    }
    integer(r.schemaVersion, 1, 10000);
    if (
      r.lease &&
      (!/^[A-Za-z0-9-]{36}$/.test(r.lease.token) ||
        !Number.isSafeInteger(r.lease.until))
    ) {
      throw fail('CORRUPT_RECORD');
    }
    if ((r.status === 'processing') !== !!r.lease) {
      throw fail('CORRUPT_RECORD');
    }
    return r;
  }
  /** Read one explicit tenant/reference record through the durable primary.
   * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
   * @returns {Promise<DurableAnalyticsRecord|null>} Verified record or absence.
   */
  async function get(reference: DurableAnalyticsReference) {
    return checked(await store.get(ref(reference)), reference);
  }
  /** Validate consent/schema, reauthorize acceptance and prepare stable deduplicated identity.
   * @param {AnalyticsEventInput & { occurredAt: number }} input - Explicit consented event with stable occurrence timestamp.
   * @param {string} key - Opaque bounded idempotency key scoped to the site.
   * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
   * @returns {ReturnType<DurableAnalytics['prepare']>} Prepared immutable record; preparation alone is not durable acceptance.
   */
  async function prepare(
    input: AnalyticsEventInput & {
      /** Original explicit UTC event time. */
      occurredAt: number;
    },
    key: string,
    principal: unknown
  ) {
    if (
      typeof key !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(key) ||
      !input ||
      !Number.isSafeInteger(input.occurredAt) ||
      input.consent !== 'granted' ||
      !input.site
    ) {
      throw fail('INVALID_OR_UNCONSENTED_EVENT');
    }
    registry.prepare(input);
    input = structuredClone(input);
    /** Stable tenant/key-derived opaque event reference. */
    const id = hash(JSON.stringify([input.site, key])).slice(0, 32);
    /** Validated tenant-bound reference; never inferred from email or browser roles. */
    const reference = ref({ site: input.site!, id });
    await allowed('accept', reference, principal);
    /** Existing durable acceptance used for deduplication and historical schema pinning. */
    const old = await get(reference);
    if (old && clock() >= old.dedupUntil) {
      throw fail('DEDUPE_KEY_EXPIRED');
    }
    /** Detached event pinned to an existing schema version when replaying the same key. */
    const selected = {
      ...input,
      ...(old && input.schemaVersion === undefined
        ? { schemaVersion: old.schemaVersion }
        : {}),
    };
    /** Validated event row with stable durable identity and original explicit occurredAt. */
    const row = validateRegisteredEvent(
      old ? { ...selected, occurredAt: Date.now() } : selected,
      registry
    );
    row.occurred_at = input.occurredAt;
    row.id = id;
    /** Detached parsed scalar/provenance data; no source or expressions are evaluated. */
    const props = JSON.parse(row.properties_json);
    /** Configured numeric projections sharing the durable event identity. */
    const facts = numericFields.flatMap((field) =>
      typeof props[field] === 'number'
        ? [
            {
              id: numericFactId(id, field),
              event_id: id,
              property_name: field,
              numeric_value: props[field],
              event_name: row.event_name,
              source: row.source,
              site: row.site,
              pathname: row.pathname,
              occurred_at: row.occurred_at,
            },
          ]
        : []
    );
    /** Validated server transition time, independent of client occurrence time. */
    const at = clock();
    /** Prepared immutable record/claim/page receipt; persistence occurs only in explicit store/journal calls. */
    const result: DurableAnalyticsRecord = {
      ...reference,
      version: 1,
      schemaVersion: JSON.parse(row.properties_json).zAnalyticsSchema
        .schemaVersion,
      revision: 1,
      status: 'pending',
      eventId: id,
      payloadHash: payloadHash(row, facts),
      row,
      facts,
      occurredAt: row.occurred_at,
      createdAt: at,
      dedupUntil: at + dedupMs,
      attempts: 0,
      nextAt: at,
      lease: null,
      code: null,
    };
    return freeze(result);
  }
  /** Confirm an existing unexpired identical acceptance after insert conflict.
   * @param {DurableAnalyticsRecord} record - Expected immutable prepared acceptance.
   * @returns {Promise<DurableAnalyticsAcknowledgement>} Duplicate receipt; unknown, expired or conflicting payloads reject.
   */
  async function existing(record: DurableAnalyticsRecord) {
    /** Existing durable acceptance used for deduplication and historical schema pinning. */
    const old = await get(record);
    if (!old) {
      throw fail('ACCEPTANCE_UNCERTAIN');
    }
    if (clock() >= old.dedupUntil) {
      throw fail('DEDUPE_KEY_EXPIRED');
    }
    if (old.payloadHash !== record.payloadHash) {
      throw fail('DEDUPE_CONFLICT');
    }
    return ack(old, true);
  }
  /** Acquire a bounded processing lease through exact-revision CAS.
   * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
   * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
   * @returns {ReturnType<DurableAnalytics['prepareMaterialization']>} Existing receipt or immutable leased materialization plan.
   */
  async function claim(
    reference: DurableAnalyticsReference,
    principal: unknown
  ) {
    reference = ref(reference);
    await allowed('process', reference, principal);
    /** Current durable CAS state re-read before lease/retry/inspection decisions. */
    const current = await get(reference);
    if (!current) {
      throw fail('NOT_FOUND');
    }
    if (
      current.status === 'persisted' ||
      current.status === 'purged' ||
      current.status === 'dead'
    ) {
      return { acknowledgement: ack(current, true) };
    }
    /** Validated server transition time, independent of client occurrence time. */
    const at = clock();
    if (
      (current.status === 'processing' &&
        at < current.lease!.until + delay(current.attempts)) ||
      (current.status === 'pending' && at < current.nextAt)
    ) {
      return { acknowledgement: ack(current, true) };
    }
    if (at - current.createdAt >= maxAge || current.attempts >= maxAttempts) {
      /** Candidate next revision; only the store/journal fence may commit it. */
      const next = {
        ...current,
        revision: current.revision + 1,
        status: 'dead' as const,
        lease: null,
        code: 'EXHAUSTED' as const,
      };
      if (!(await store.cas(current.revision, next))) {
        throw fail('CONFLICT');
      }
      return { acknowledgement: ack(next) };
    }
    /** Processing record with new revision, attempt count and private random lease token. */
    const leased: DurableAnalyticsRecord = {
      ...current,
      revision: current.revision + 1,
      status: 'processing',
      attempts: current.attempts + 1,
      lease: { token: randomUUID(), until: at + leaseMs },
    };
    if (!(await store.cas(current.revision, leased))) {
      throw fail('CONFLICT');
    }
    /** Candidate next revision; only the store/journal fence may commit it. */
    const next: DurableAnalyticsRecord = {
      ...leased,
      revision: leased.revision + 1,
      status: 'persisted',
      lease: null,
      code: null,
    };
    return { plan: freeze({ record: leased, next }) };
  }
  /** Hash preview metadata without turning it into authorization.
   * @param {Omit<DurableAnalyticsPurgePreview, 'hash'>} value - Bounded payload-free preview body.
   * @returns {string} Canonical integrity hash; fresh approval is still required.
   */
  function previewHash(value: Omit<DurableAnalyticsPurgePreview, 'hash'>) {
    return hash(canonical(value));
  }
  /** Reauthorize purge and re-read every preview revision before preparing tombstones.
   * @param {DurableAnalyticsPurgePreview} preview - Bounded metadata preview whose revisions and scope are rechecked.
   * @param {'reject-unprocessed' | 'cancel-unprocessed'} conflicts - Explicit reject-unprocessed or cancel-unprocessed retention policy.
   * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
   * @returns {Promise<readonly DurableAnalyticsPlan[]>} Immutable plans; stale/changed/unprocessed conflicts reject before journal deletion.
   */
  async function purgePlans(
    preview: DurableAnalyticsPurgePreview,
    conflicts: 'reject-unprocessed' | 'cancel-unprocessed',
    principal: unknown
  ) {
    /** Detached preview body and its integrity hash; approval remains a separate fresh host decision. */
    const { hash: digest, ...body } = structuredClone(preview);
    if (
      previewHash(body) !== digest ||
      !Array.isArray(body.items) ||
      body.items.length > 50 ||
      !['reject-unprocessed', 'cancel-unprocessed'].includes(conflicts)
    ) {
      throw fail('INVALID_PREVIEW');
    }
    integer(body.before, 0, clock() - DAY);
    await allowed('purge', { site: body.site, id: '0'.repeat(32) }, principal);
    /** Bounded revision-fenced purge candidates; no deletion happens while preparing them. */
    const plans: DurableAnalyticsPlan[] = [];
    // Re-read and fence each preview candidate before constructing its tombstone.
    for (const item of body.items) {
      /** Detached durable record checked against the fixed tenant/reference and integrity metadata. */
      const r = await get({ site: body.site, id: item.id });
      if (
        !r ||
        r.revision !== item.revision ||
        r.status !== item.status ||
        r.occurredAt >= body.before
      ) {
        throw fail('STALE_PREVIEW');
      }
      if (
        !['persisted', 'purged'].includes(r.status) &&
        conflicts === 'reject-unprocessed'
      ) {
        throw fail('UNPROCESSED_CONFLICT');
      }
      plans.push({
        record: r,
        next: {
          ...r,
          revision: r.revision + 1,
          status: 'purged',
          row: null,
          facts: [],
          lease: null,
        },
      });
    }
    return freeze(plans);
  }
  return Object.freeze({
    /** Validate consent/schema, reauthorize acceptance and prepare stable deduplicated identity.
     * @param {AnalyticsEventInput & { occurredAt: number }} input - Explicit consented event with stable occurrence timestamp.
     * @param {string} key - Opaque bounded idempotency key scoped to the site.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {ReturnType<DurableAnalytics['prepare']>} Prepared immutable record; preparation alone is not durable acceptance.
     */
    prepare(
      input: AnalyticsEventInput & {
        /** Original explicit UTC event time. */
        occurredAt: number;
      },
      key: string,
      principal: unknown
    ) {
      return run(() => prepare(input, key, principal));
    },
    /** Persist acceptance in the durable primary without claiming event materialization.
     * @param {AnalyticsEventInput & { occurredAt: number }} input - Explicit consented event with stable occurrence timestamp.
     * @param {string} key - Opaque bounded idempotency key scoped to the site.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {ReturnType<DurableAnalytics['accept']>} Accepted/duplicate acknowledgement; lost insertion result is explicitly uncertain.
     */
    accept(
      input: AnalyticsEventInput & {
        /** Original explicit UTC event time. */
        occurredAt: number;
      },
      key: string,
      principal: unknown
    ) {
      return run(async () => {
        /** Prepared immutable acceptance or leased record, not an already committed business mutation. */
        const record = await prepare(input, key, principal);
        try {
          if (await store.insert(record)) {
            return ack(record);
          }
        } catch (cause) {
          throw fail('ACCEPTANCE_UNCERTAIN', cause);
        }
        return existing(record);
      });
    },
    /** Commit business mutation and ledger append only on the same real pin. The business callback is never automatically replayed.
     * @param {PinDatabase} db - Host database exposing a negotiated real pinned transaction.
     * @param {Pick<DurableAnalyticsJournal, 'append'>} journal - Host pin-consuming journal; every result must be fenced on the same transaction.
     * @param {AnalyticsEventInput & { occurredAt: number }} input - Explicit consented event with stable occurrence timestamp.
     * @param {string} key - Opaque bounded idempotency key scoped to the site.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @param {(pin: TransactionDatabase) => T | Promise<T>} business - Host business mutation consuming the same pin as journal.append.
     * @param {TransactionOptions} settings - Optional supported transaction policy; no nested emulated transaction.
     * @returns {Promise<DurableAnalyticsAcknowledgement>} Posttransaction acceptance receipt; failed/ambiguous commit reports uncertainty.
     */
    commit<T>(
      db: PinDatabase,
      journal: Pick<DurableAnalyticsJournal, 'append'>,
      input: AnalyticsEventInput & {
        /** Original explicit UTC event time. */
        occurredAt: number;
      },
      key: string,
      principal: unknown,
      business: (pin: TransactionDatabase) => T | Promise<T>,
      settings: TransactionOptions = {}
    ) {
      return run(async (signal) => {
        /** Negotiated real pinned transaction function; no query-only transaction emulation. */
        const tx = transaction(db);
        /** Validated cooperative transaction controls combined with the owned operation signal. */
        const policy = settingsFor(db, settings, signal);
        if (
          typeof journal?.append !== 'function' ||
          typeof business !== 'function'
        ) {
          throw fail('INVALID_CONFIGURATION');
        }
        /** Prepared immutable acceptance or leased record, not an already committed business mutation. */
        const record = await prepare(input, key, principal);
        /** Existing durable acceptance used for deduplication and historical schema pinning. */
        const old = await get(record);
        if (old) {
          return existing(record);
        }
        try {
          await tx(async (pin) => {
            if ((await journal.append(pin, record)) !== true) {
              throw fail('CONFLICT');
            }
            await business(pin);
          }, policy);
          return ack(record);
        } catch (cause) {
          throw fail('COMMIT_UNCERTAIN', cause);
        }
      });
    },
    /** Prepare an authorized lease outside native SQLite synchronous transaction intervals.
     * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {ReturnType<DurableAnalytics['prepareMaterialization']>} Existing receipt or leased immutable plan; host journal must enforce its fence.
     */
    prepareMaterialization(
      reference: DurableAnalyticsReference,
      principal: unknown
    ) {
      return run(() => claim(reference, principal));
    },
    /** Materialize event/facts and next ledger revision on a real negotiated pin.
     * @param {PinDatabase} db - Host database exposing a negotiated real pinned transaction.
     * @param {Pick<DurableAnalyticsJournal, 'materialize'>} journal - Host pin-consuming journal; every result must be fenced on the same transaction.
     * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @param {TransactionOptions} settings - Optional supported transaction policy; no nested emulated transaction.
     * @returns {Promise<DurableAnalyticsAcknowledgement>} Persisted receipt or explicit uncertain acknowledgement after an ambiguous transaction.
     */
    persist(
      db: PinDatabase,
      journal: Pick<DurableAnalyticsJournal, 'materialize'>,
      reference: DurableAnalyticsReference,
      principal: unknown,
      settings: TransactionOptions = {}
    ) {
      return run(async (signal) => {
        /** Negotiated real pinned transaction function; no query-only transaction emulation. */
        const tx = transaction(db);
        /** Validated cooperative transaction controls combined with the owned operation signal. */
        const policy = settingsFor(db, settings, signal, leaseMs - 1);
        if (typeof journal?.materialize !== 'function') {
          throw fail('INVALID_CONFIGURATION');
        }
        /** Prepared immutable record/claim/page receipt; persistence occurs only in explicit store/journal calls. */
        const result = await claim(reference, principal);
        if (!result.plan) {
          return result.acknowledgement!;
        }
        try {
          await tx(async (pin) => {
            if ((await journal.materialize(pin, result.plan!)) !== true) {
              throw fail('FENCE_LOST');
            }
          }, policy);
          return ack(result.plan.next);
        } catch {
          return ack(result.plan.record, false, 'uncertain');
        }
      });
    },
    /** Return authorized payload-free administrative status.
     * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {ReturnType<DurableAnalytics['inspect']>} Opaque reference, counters and state; no bodies or lease token.
     */
    inspect(reference: DurableAnalyticsReference, principal: unknown) {
      return run(async () => {
        await allowed('inspect', reference, principal);
        /** Detached durable record checked against the fixed tenant/reference and integrity metadata. */
        const r = await get(reference);
        if (!r) {
          throw fail('NOT_FOUND');
        }
        return {
          ...ack(r, true),
          attempts: r.attempts,
          status: r.status,
          code: r.code,
          createdAt: r.createdAt,
          nextAt: r.nextAt,
          leaseUntil: r.lease?.until ?? null,
        };
      });
    },
    /** Recheck acceptance after an uncertain result without replaying mutations.
     * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {Promise<DurableAnalyticsAcknowledgement>} Current receipt; a processing lease remains uncertain.
     */
    confirm(reference: DurableAnalyticsReference, principal: unknown) {
      return run(async () => {
        await allowed('inspect', reference, principal);
        /** Current durable CAS state re-read before lease/retry/inspection decisions. */
        const current = await get(reference);
        if (!current) {
          throw fail('NOT_FOUND');
        }
        return ack(
          current,
          true,
          current.status === 'processing' ? 'uncertain' : undefined
        );
      });
    },
    /** Record an explicit transient/permanent failure only under the live lease token.
     * @param {DurableAnalyticsReference} reference - Tenant-bound opaque durable reference.
     * @param {string} token - Private current processing lease token.
     * @param {'transient' | 'permanent'} classification - Declared transient/permanent failure; unknown outcomes must not be classified as safe retries.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {Promise<DurableAnalyticsAcknowledgement>} Pending retry or terminal receipt; lost fences/conflicts reject.
     */
    settleFailure(
      reference: DurableAnalyticsReference,
      token: string,
      classification: 'transient' | 'permanent',
      principal: unknown
    ) {
      return run(async () => {
        await allowed('process', reference, principal);
        if (!['transient', 'permanent'].includes(classification)) {
          throw fail('INVALID_FAILURE');
        }
        /** Current durable CAS state re-read before lease/retry/inspection decisions. */
        const current = await get(reference);
        if (
          !current ||
          current.status !== 'processing' ||
          current.lease?.token !== token ||
          clock() >= current.lease.until
        ) {
          throw fail('FENCE_LOST');
        }
        /** Explicit terminal decision from classification, attempt cap or total age. */
        const dead =
          classification === 'permanent' ||
          current.attempts >= maxAttempts ||
          clock() - current.createdAt >= maxAge;
        // Preserve the distinction between a declared permanent failure and exhausted transient retries.
        let failureCode: DurableAnalyticsRecord['code'] = 'TRANSIENT';
        if (classification === 'permanent') {
          failureCode = 'PERMANENT';
        } else if (dead) {
          failureCode = 'EXHAUSTED';
        }
        /** Candidate next revision; only the store/journal fence may commit it. */
        const next: DurableAnalyticsRecord = {
          ...current,
          revision: current.revision + 1,
          status: dead ? 'dead' : 'pending',
          lease: null,
          code: failureCode,
          nextAt: clock() + delay(current.attempts),
        };
        if (!(await store.cas(current.revision, next))) {
          throw fail('CONFLICT');
        }
        return ack(next);
      });
    },
    /** Publish only opaque references through an acknowledged nondestructive backend.
 * @param {string} site - Host-verified site.
 * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
 * @param {{
        acknowledgement: true;
        destructiveRead: false;
        publish(reference: DurableAnalyticsReference): Promise<unknown>;
      }} publisher - Explicit acknowledged publisher; destructive-read backends reject.
 * @param {(reference: DurableAnalyticsReference) => Promise<unknown>} publisher.publish - Borrowed acknowledged opaque-reference publisher.
 * @param {false} publisher.destructiveRead - Must reject destructive-read delivery.
 * @param {true} publisher.acknowledgement - Explicit acknowledgement capability required.
 * @param {{ cursor?: string; limit?: number }} query - Optional bounded ledger cursor/page settings.
 * @param {string|undefined} query.cursor - Exclusive opaque ledger continuation.
 * @param {number|undefined} query.limit - Page size, default 20 and maximum 50.
 * @returns {ReturnType<DurableAnalytics['dispatch']>} Bounded published count/continuation; no stored body is sent as a queue job.
 */
    dispatch(
      site: string,
      principal: unknown,
      publisher: {
        acknowledgement: true;
        destructiveRead: false;
        publish(reference: DurableAnalyticsReference): Promise<unknown>;
      },
      query: { cursor?: string; limit?: number } = {}
    ) {
      return run(async (signal) => {
        if (
          publisher?.acknowledgement !== true ||
          publisher.destructiveRead !== false ||
          typeof publisher.publish !== 'function'
        ) {
          throw fail('ACKNOWLEDGED_PUBLISHER_REQUIRED');
        }
        /** Validated bounded ledger continuation; no unbounded scan fallback. */
        const { limit, cursor } = pageSettings(query);
        await allowed('dispatch', { site, id: '0'.repeat(32) }, principal);
        /** Bounded tenant ledger page returned by the host durable store. */
        const rows = await store.page(site, { cursor, limit });
        if (!Array.isArray(rows) || rows.length > limit) {
          throw fail('INVALID_PAGE');
        }
        let previous = cursor;
        let published = 0;
        // Scope/order checks and fresh process authorization precede each reference publish.
        for (const raw of rows) {
          signal.throwIfAborted();
          /** Detached durable record checked against the fixed tenant/reference and integrity metadata. */
          const r = checked(raw, { site, id: raw.id })!;
          if (previous && r.id <= previous) {
            throw fail('INVALID_PAGE');
          }
          previous = r.id;
          if (
            (r.status === 'pending' && r.nextAt <= clock()) ||
            (r.status === 'processing' &&
              r.lease!.until + delay(r.attempts) <= clock())
          ) {
            await allowed('process', r, principal);
            await publisher.publish(ref(r));
            published++;
          }
        }
        return {
          published,
          nextCursor: rows.length === limit ? (previous ?? null) : null,
          coverage: 'bounded-ledger-page' as const,
        };
      });
    },
    /** Read a metadata-only old ledger page without deleting or cancelling work.
     * @param {string} site - Host-verified site.
     * @param {number} before - Cutoff at least one server day old.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @param {{ cursor?: string; limit?: number }} query - Optional bounded ledger cursor/page settings.
     * @param {string|undefined} query.cursor - Exclusive opaque ledger continuation.
     * @param {number|undefined} query.limit - Page size, default 20 and maximum 50.
     * @returns {Promise<DurableAnalyticsPurgePreview>} Integrity-hashed bounded preview; not signed approval or a pinned snapshot.
     */
    previewPurge(
      site: string,
      before: number,
      principal: unknown,
      query: { cursor?: string; limit?: number } = {}
    ) {
      return run(async () => {
        ref({ site, id: '0'.repeat(32) });
        integer(before, 0, clock() - DAY);
        await allowed('preview', { site, id: '0'.repeat(32) }, principal);
        /** Validated bounded ledger continuation; no unbounded scan fallback. */
        const { limit, cursor } = pageSettings(query);
        /** Bounded tenant ledger page returned by the host durable store. */
        const rows = await store.page(site, { before, cursor, limit });
        if (!Array.isArray(rows) || rows.length > limit) {
          throw fail('INVALID_PAGE');
        }
        let previous = cursor;
        /** Metadata-only preview entries without stored bodies or tokens. */
        const items = rows.map((raw) => {
          /** Detached durable record checked against the fixed tenant/reference and integrity metadata. */
          const r = checked(raw, { site, id: raw.id })!;
          if (r.occurredAt >= before || (previous && r.id <= previous)) {
            throw fail('INVALID_PAGE');
          }
          previous = r.id;
          return {
            id: r.id,
            revision: r.revision,
            status: r.status,
            numericFacts: r.facts.length,
            hasPayload: r.row !== null,
          };
        });
        /** Prepared immutable record/claim/page receipt; persistence occurs only in explicit store/journal calls. */
        const result = {
          site,
          before,
          items,
          unprocessed: items.filter(
            (r) => !['persisted', 'purged'].includes(r.status)
          ).length,
          eventCandidates: items.filter((r) => r.status === 'persisted').length,
          numericFactCandidates: items
            .filter((r) => r.status === 'persisted')
            .reduce((n, r) => n + r.numericFacts, 0),
          nextCursor: rows.length === limit ? (previous ?? null) : null,
        };
        return { ...result, hash: previewHash(result) };
      });
    },
    /** Prepare authorized revision-fenced tombstones without executing deletion.
     * @param {DurableAnalyticsPurgePreview} preview - Bounded metadata preview whose revisions and scope are rechecked.
     * @param {'reject-unprocessed' | 'cancel-unprocessed'} conflicts - Explicit reject-unprocessed or cancel-unprocessed retention policy.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @returns {Promise<readonly DurableAnalyticsPlan[]>} Immutable plans for a host-qualified synchronous/native journal.
     */
    preparePurge(
      preview: DurableAnalyticsPurgePreview,
      conflicts: 'reject-unprocessed' | 'cancel-unprocessed',
      principal: unknown
    ) {
      return run(() => purgePlans(preview, conflicts, principal));
    },
    /** Delete facts/events and retain dedup tombstones only through one pinned approved journal.
     * @param {PinDatabase} db - Host database exposing a negotiated real pinned transaction.
     * @param {Pick<DurableAnalyticsJournal, 'purge'>} journal - Host pin-consuming journal; every result must be fenced on the same transaction.
     * @param {DurableAnalyticsPurgePreview} preview - Bounded metadata preview whose revisions and scope are rechecked.
     * @param {'reject-unprocessed' | 'cancel-unprocessed'} conflicts - Explicit reject-unprocessed or cancel-unprocessed retention policy.
     * @param {unknown} principal - Host-verified initiating principal; authorization is rechecked.
     * @param {TransactionOptions} settings - Optional supported transaction policy; no nested emulated transaction.
     * @returns {ReturnType<DurableAnalytics['purge']>} Bounded committed-page receipt; never a global erasure certificate.
     */
    purge(
      db: PinDatabase,
      journal: Pick<DurableAnalyticsJournal, 'purge'>,
      preview: DurableAnalyticsPurgePreview,
      conflicts: 'reject-unprocessed' | 'cancel-unprocessed',
      principal: unknown,
      settings: TransactionOptions = {}
    ) {
      return run(async (signal) => {
        /** Negotiated real pinned transaction function; no query-only transaction emulation. */
        const tx = transaction(db);
        /** Validated cooperative transaction controls combined with the owned operation signal. */
        const policy = settingsFor(db, settings, signal);
        if (typeof journal?.purge !== 'function') {
          throw fail('INVALID_CONFIGURATION');
        }
        /** Bounded revision-fenced purge candidates; no deletion happens while preparing them. */
        const plans = await purgePlans(preview, conflicts, principal);
        await tx(async (pin) => {
          if ((await journal.purge(pin, freeze(plans))) !== true) {
            throw fail('FENCE_LOST');
          }
        }, policy);
        return {
          deleted: plans.length,
          coverage: 'approved-ledger-page' as const,
        };
      });
    },
    /** Read fixed lifecycle counters without tenant labels or stored payloads.
     * @returns {{closed: boolean, pending: number}} Admission state and actual pending work.
     */
    diagnostics() {
      return { closed, pending: pending.size };
    },
    /** Stop new work, signal active scopes and drain actual host settlement.
     * @returns {Promise<void>} Settles without closing borrowed stores/databases; noncooperative callbacks may delay it.
     */
    async close() {
      closed = true;
      // Signal cooperative owners before waiting for their actual settlement.
      for (const c of controllers) {
        c.abort();
      }
      await Promise.allSettled([...pending]);
    },
  });
}
export type DurableAnalytics = ReturnType<typeof createDurableAnalytics>;
