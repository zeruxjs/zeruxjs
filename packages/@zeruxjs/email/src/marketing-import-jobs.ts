/** Durable, fenced, multi-worker audience import. Source cursors and durable checkpoints
 * contain only host-provided opaque metadata, not recipient rows. Hosts must keep identifiers/cursors free of PII.
 * The application supplies a repeatable, immutable source revision.
 * A lost lease can replay a page; appendRecipients MUST be idempotent. */
import { createHash, randomUUID } from 'node:crypto';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
import type { MarketingRecipient } from './marketing.js';

/** Bounded opaque job/worker reference syntax; not permission or module selection. */
const jobIdPattern = /^[A-Za-z0-9_.:-]{1,80}$/;
/** Bounded opaque campaign reference syntax; hosts must avoid embedding recipient data. */
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Bounded opaque immutable-source continuation syntax, not a URL or native query. */
const cursorPattern = /^[A-Za-z0-9_.-]{1,160}$/;
export interface MarketingImportPage {
  /** Private immutable-source records; never persisted into checkpoints or Redis job bodies. */
  recipients: readonly (string | MarketingRecipient)[];
  /** Exclusive opaque monotonic continuation; null exactly when page.done is true. */
  nextCursor: string | null;
  /** Explicit source completion; empty terminal pages are permitted. */
  done: boolean;
}
export interface MarketingImportSource {
  /** Read one stable immutable source-revision keyset page under explicit host scope.
 * @param {{
    cursor: string | null;
    limit: number;
  }} query - Explicit exclusive opaque cursor and finite page budget.
 * @returns {Promise<MarketingImportPage>} Private recipient records plus strict continuation/completion; source never enters queue data.
 */
  page(query: {
    /** Last committed exclusive source position; completed state can retain the preceding cursor. */
    cursor: string | null;
    /** Finite source page budget fixed by the persisted batchSize. */
    limit: number;
  }): Promise<MarketingImportPage>;
}
export interface MarketingImportJobState {
  /** Explicit opaque job identifier; host must avoid encoding personal data. */
  id: string;
  /** Explicit opaque host-scoped campaign identity. */
  campaignCode: string;
  /** Stable immutable snapshot fingerprint; changed input requires a new job identity/revision. */
  sourceRevision: string;
  /** Persisted page size 1–500, default 200; incompatible configuration rejects existing state. */
  batchSize: number;
  /** Positive committed native CAS revision. */
  version: number;
  /** Increasing lease/cancel generation fencing stale completions. */
  epoch: number;
  /** Pending/running/failed/completed/cancelled checkpoint state; not SMTP evidence. */
  status: 'pending' | 'running' | 'failed' | 'completed' | 'cancelled';
  /** Last committed exclusive source position; completed state can retain the preceding cursor. */
  cursor: string | null;
  /** Count of successfully committed source pages. */
  pages: number;
  /** Committed page record count equal to created plus existing. */
  processed: number;
  /** New recipient identities acknowledged by the append service. */
  created: number;
  /** Matching replay identities acknowledged by the append service. */
  existing: number;
  /** Private active worker/token/expiry; public state projection removes token. */
  lease: null | {
    /** Host worker label; never trusted as a role claim. */
    owner: string; /** Random private native lease claim, removed from state projections. */
    token: string; /** Explicit unexpired epoch required for every renewal/checkpoint. */
    expiresAt: number;
  };
  /** Trusted epoch metadata timestamp, not synthetic content time. */
  updatedAt: number;
  /** Fixed import failure class only; no raw upstream exception or recipient data. */
  lastError: string | null;
}
export interface MarketingImportJobOptions {
  /** Borrowed structured database with real unique insert and exact affected-count CAS. */
  db: CampaignDatabaseConnection;
  /** Explicit opaque job identifier; host must avoid encoding personal data. */
  id: string;
  /** Explicit opaque host-scoped campaign identity. */
  campaignCode: string;
  /** Stable fingerprint of an immutable source snapshot; must change when input changes. */
  sourceRevision: string;
  /** Host-owned immutable keyset source; never fetch arbitrary URLs from task data. */
  source: MarketingImportSource;
  /** Trusted idempotent authorized recipient persistence; its side effects can precede checkpoint commit. */
  append: (
    campaignCode: string,
    entries: readonly (string | MarketingRecipient)[]
  ) => Promise<{
    /** New identities committed by this append call. */
    added: number; /** Matching replay identities acknowledged by the append service. */
    existing: number; /** Current campaign count; not consent or delivery evidence. */
    recipientCount: number;
  }>;
  /** Persisted page size 1–500, default 200; incompatible configuration rejects existing state. */
  batchSize?: number;
  /** Integer 3000–3600000ms, default 60000; native work remains cooperatively bounded. */
  leaseMs?: number;
  /** Optional trusted safe epoch clock, default Date.now. */
  now?: () => number;
  /** Validated private checkpoint table, default zerux_marketing_import_jobs. */
  table?: string;
}
/** Validate only the explicit opaque continuation encoding.
 * @param {unknown} v - Candidate immutable-source cursor.
 * @returns {boolean} True for supported bounded literal syntax; host owns source meaning. */
const safeCursor = (v: unknown): v is string =>
  typeof v === 'string' && cursorPattern.test(v);
/** Clone checkpoint metadata while removing the private active lease token.
 * @param {MarketingImportJobState} s - Private committed checkpoint.
 * @returns {Omit<MarketingImportJobState, "lease"> & {lease: {owner: string, expiresAt: number} | null}} Token-free private state; identifiers/cursors still require host privacy/authorization policy. */
const sanitized = (s: MarketingImportJobState) => {
  /** Separate the secret lease claim from explicitly retained private checkpoint metadata. */
  const { lease, ...other } = s;
  return structuredClone({
    ...other,
    lease: lease ? { owner: lease.owner, expiresAt: lease.expiresAt } : null,
  });
};
/** Bind one immutable source revision and finite page size to durable host CAS checkpoints and lease epochs.
 * @param {MarketingImportJobOptions} options - Explicit borrowed database/source/append policy and fixed job/revision identity.
 * @returns {object} Private get/acquire/renew/commit/run/cancel controller; host owns authorization, idempotent append and borrowed resources.
 */
export function createMarketingImportJob(options: MarketingImportJobOptions) {
  /** Explicit host-scoped borrowed dependencies; no source/client/module discovery. */
  const { db, id, campaignCode, source, append } = options;
  /** Host-asserted immutable snapshot fingerprint compared exactly; this helper does not rescan/recompute source content. */
  const sourceRevision = options.sourceRevision;
  /** Validated private checkpoint table, default zerux_marketing_import_jobs. */
  const table = options.table ?? 'zerux_marketing_import_jobs';
  /** Persisted finite page size, default two hundred and maximum five hundred. */
  const batchSize = options.batchSize ?? 200;
  /** Finite lease lifetime, default one minute; native/source calls require independent host deadlines. */
  const leaseMs = options.leaseMs ?? 60_000;
  if (
    !db ||
    !['createTable', 'insert', 'select', 'update'].every(
      (k) => typeof (db as any)[k] === 'function'
    ) ||
    !jobIdPattern.test(id) ||
    !campaignPattern.test(campaignCode) ||
    typeof sourceRevision !== 'string' ||
    !/^[A-Za-z0-9_.:-]{8,160}$/.test(sourceRevision) ||
    !source ||
    typeof source.page !== 'function' ||
    typeof append !== 'function' ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500 ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 3000 ||
    leaseMs > 3600000 ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(table)
  ) {
    throw new TypeError('Invalid durable marketing import configuration');
  }
  /** Explicit trusted epoch clock, default Date.now. */
  const clock = options.now ?? Date.now;
  /** Require a safe nonnegative trusted epoch before ownership/checkpoint decisions.

 * @returns {number} Validated epoch milliseconds. */
  const now = () => {
    /** One trusted epoch captured for this exact ownership/state transition. */
    const t = clock();
    if (!Number.isSafeInteger(t) || t < 0) {
      throw new Error('Invalid import clock');
    }
    return t;
  };
  /** Stable campaign/job identity preserving the stored revision contract; source changes must use a new job/revision. */
  const key =
    'mi_' +
    createHash('sha256')
      .update(campaignCode + '\0' + id)
      .digest('hex');
  /** Aggregate-only empty checkpoint with no recipient rows or source credentials. */
  const initial: MarketingImportJobState = {
    id,
    campaignCode,
    sourceRevision,
    batchSize,
    version: 1,
    epoch: 0,
    status: 'pending',
    cursor: null,
    pages: 0,
    processed: 0,
    created: 0,
    existing: 0,
    lease: null,
    updatedAt: now(),
    lastError: null,
  };
  let ready: Promise<void> | undefined;
  /** Coalesce lazy checkpoint schema creation and release failed initialization for later attempts.

 * @returns {Promise<void>} Borrowed schema operation settled; no connection ownership transfer. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Private native schema/read/write outcome checked before trusting rows/counts. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 67,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Import checkpoint table unavailable');
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  /** Verify persisted identity/revision/source/page/counter/lease shape before resuming work.

 * @returns {Promise<MarketingImportJobState | null>} Private committed checkpoint or null; incompatible source revision rejects. */
  const lookup = async (): Promise<MarketingImportJobState | null> => {
    /** Private native schema/read/write outcome checked before trusting rows/counts. */
    const r = await db.select({
      table,
      columns: ['id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: key },
      limit: 1,
    });
    if (!r?.ok || !Array.isArray(r.rows)) {
      throw new Error('Import checkpoint unavailable');
    }
    if (!r.rows.length) {
      return null;
    }
    /** One private native checkpoint row; raw payload is never returned as an HTTP diagnostic. */
    const row = r.rows[0] as Record<string, unknown>;
    if (typeof row.payload_json !== 'string') {
      throw new Error('Invalid checkpoint JSON');
    }
    /** Parsed private checkpoint validated against this fixed job/source contract. */
    const state = JSON.parse(row.payload_json) as MarketingImportJobState;
    if (
      state.id !== id ||
      state.campaignCode !== campaignCode ||
      state.sourceRevision !== sourceRevision ||
      state.batchSize !== batchSize ||
      !Number.isSafeInteger(state.version) ||
      state.version !== Number(row.version) ||
      state.version < 1 ||
      !Number.isSafeInteger(state.epoch) ||
      state.epoch < 0 ||
      !['pending', 'running', 'failed', 'completed', 'cancelled'].includes(
        state.status
      ) ||
      (state.cursor !== null && !safeCursor(state.cursor)) ||
      ![state.pages, state.processed, state.created, state.existing].every(
        (x) => Number.isSafeInteger(x) && x >= 0
      ) ||
      state.created + state.existing !== state.processed ||
      (state.lease !== null &&
        (!state.lease ||
          typeof state.lease.owner !== 'string' ||
          typeof state.lease.token !== 'string' ||
          !Number.isSafeInteger(state.lease.expiresAt)))
    ) {
      throw new Error('Import checkpoint identity or version conflict');
    }
    return state;
  };
  /** Initialize one create-only checkpoint or observe the concurrently committed existing identity.

 * @returns {Promise<MarketingImportJobState>} Current private state; no process-local lock is substituted for native uniqueness. */
  const read = async () => {
    await ensure();
    /** Existing committed checkpoint, never a new empty replacement on failure. */
    const existing = await lookup();
    if (existing) {
      return existing;
    }
    try {
      /** Private native schema/read/write outcome checked before trusting rows/counts. */
      const r = await db.insert({
        table,
        values: { id: key, version: 1, payload_json: JSON.stringify(initial) },
      });
      if (r?.ok) {
        return structuredClone(initial);
      }
    } catch (error) {
      /** Exact committed identity observed after a create-only initialization race. */
      const concurrent = await lookup();
      if (concurrent) {
        return concurrent;
      }
      throw error;
    }
    /** Exact committed identity observed after a create-only initialization race. */
    const concurrent = await lookup();
    if (concurrent) {
      return concurrent;
    }
    throw new Error('Import checkpoint initialization failed');
  };
  /** Write one complete next checkpoint only against the exact native prior revision.
   * @param {MarketingImportJobState} current - Current private committed state.
   * @param {Omit<MarketingImportJobState, "version">} update - Complete next fields; helper owns version increment.
   * @returns {Promise<boolean>} True for exactly one native update; zero conflict returns false. */
  const cas = async (
    current: MarketingImportJobState,
    update: Omit<MarketingImportJobState, 'version'>
  ) => {
    /** Complete candidate next checkpoint; no recipient data is copied into it. */
    const next = { ...update, version: current.version + 1 };
    /** Private native schema/read/write outcome checked before trusting rows/counts. */
    const r = await db.update({
      table,
      values: { version: next.version, payload_json: JSON.stringify(next) },
      where: {
        and: [
          { field: 'id', operator: 'eq', value: key },
          { field: 'version', operator: 'eq', value: current.version },
        ],
      },
    });
    if (!r?.ok) {
      throw new Error('Import checkpoint write failed');
    }
    /** Native safe zero/one update count; missing or multiple rows reject. */
    const affected = r.affectedCount ?? r.rowCount;
    if (
      typeof affected !== 'number' ||
      !Number.isSafeInteger(affected) ||
      affected < 0 ||
      affected > 1
    ) {
      throw new Error('Import requires connector atomic affectedCount');
    }
    return affected === 1;
  };
  type Lease = {
    /** Host worker label; never trusted as a role claim. */
    owner: string; /** Random private native lease claim, removed from state projections. */
    token: string; /** Increasing lease/cancel generation fencing stale completions. */
    epoch: number;
  };
  /** Fence every mutable operation by running state, epoch, owner, token and unexpired time.
   * @param {MarketingImportJobState} s - Current private checkpoint.
   * @param {Lease} l - Private run ownership claim.
   * @param {number} t - Validated current epoch.
   * @returns {boolean} Whether this exact run still owns the committed lease. */
  const belongs = (s: MarketingImportJobState, l: Lease, t: number) =>
    s.status === 'running' &&
    s.epoch === l.epoch &&
    s.lease?.owner === l.owner &&
    s.lease.token === l.token &&
    s.lease.expiresAt > t;
  /** Claim a random token and increasing epoch only for nonterminal state without an unexpired lease.
   * @param {string} owner - Host-verified worker identity; spelling alone is not authorization.
   * @returns {Promise<Lease | null>} Private lease, or null for live ownership/completed/cancelled state; do not serialize tokens to a UI.
   */
  async function acquire(owner: string): Promise<Lease | null> {
    if (!jobIdPattern.test(owner)) {
      throw new TypeError('Invalid import worker');
    }
    // Claim only against the latest committed state; live/terminal ownership is never overwritten.
    for (let i = 0; i < 20; i++) {
      /** Latest committed private state reloaded before every ownership transition. */
      const s = await read();
      /** One trusted epoch captured for this exact ownership/state transition. */
      const t = now();
      if (
        s.status === 'completed' ||
        s.status === 'cancelled' ||
        (s.lease && s.lease.expiresAt > t)
      ) {
        return null;
      }
      /** Private active owner/token/epoch; never a public role capability. */
      const lease = { owner, token: randomUUID(), expiresAt: t + leaseMs };
      /** Increasing run/cancel generation fencing stale completions. */
      const epoch = s.epoch + 1;
      if (
        await cas(s, {
          ...s,
          epoch,
          status: 'running',
          lease,
          updatedAt: t,
          lastError: null,
        })
      ) {
        return { owner, token: lease.token, epoch };
      }
    }
    throw new Error('Import lease acquisition contention');
  }
  /** Renew only the same unexpired running owner/token/epoch through finite native CAS attempts.
   * @param {Lease} lease - Private exact owner/token/epoch claim; never a browser capability.
   * @returns {Promise<void>} Renewal committed; stale/cancelled ownership rejects without extending a newer lease.
   */
  async function renew(lease: Lease) {
    // Reload and CAS within a finite budget; stale ownership cannot mutate a newer generation.
    for (let i = 0; i < 15; i++) {
      /** Latest committed private state reloaded before every ownership transition. */
      const s = await read();
      /** One trusted epoch captured for this exact ownership/state transition. */
      const t = now();
      if (!belongs(s, lease, t)) {
        throw new Error('Import lease lost');
      }
      if (
        await cas(s, {
          ...s,
          lease: { ...s.lease!, expiresAt: t + leaseMs },
          updatedAt: t,
        })
      ) {
        return;
      }
    }
    throw new Error('Import lease renewal contention');
  }
  /** Fence exact live ownership and validate page/count/progress consistency before saving aggregate-only checkpoint metadata.
   * @param {Lease} lease - Private exact owner/token/epoch claim; never a browser capability.
   * @param {MarketingImportPage} page - Bounded private source page from the immutable revision.
   * @param {{ added: number; existing: number; recipientCount: number }} counts - Acknowledged append counts for this exact page, excluding any uncommitted attempt.
   * @param {number} counts.added - New recipient identities committed for this exact page.
   * @param {number} counts.existing - Exact matching replay identities for this page.
   * @param {number} counts.recipientCount - Current service campaign count, not delivery evidence.
   * @returns {Promise<object>} Token-free committed state; an earlier append is not rolled back if this checkpoint fails.
   */
  async function commit(
    lease: Lease,
    page: MarketingImportPage,
    counts: {
      /** New identities committed by this append call. */
      added: number; /** Matching replay identities acknowledged by the append service. */
      existing: number; /** Current campaign count; not consent or delivery evidence. */
      recipientCount: number;
    }
  ) {
    /** Latest committed private state reloaded before every ownership transition. */
    const s = await read();
    /** One trusted epoch captured for this exact ownership/state transition. */
    const t = now();
    if (!belongs(s, lease, t)) {
      throw new Error('Import lease lost');
    }
    if (
      !Number.isSafeInteger(counts.added) ||
      counts.added < 0 ||
      !Number.isSafeInteger(counts.existing) ||
      counts.existing < 0 ||
      counts.added + counts.existing !== page.recipients.length ||
      page.done !== (page.nextCursor === null) ||
      (!page.done &&
        (!safeCursor(page.nextCursor) ||
          (s.cursor !== null && page.nextCursor <= s.cursor) ||
          page.recipients.length === 0))
    ) {
      throw new Error('Invalid import batch checkpoint');
    }
    /** Complete candidate next checkpoint; no recipient data is copied into it. */
    const next = {
      ...s,
      status: page.done ? ('completed' as const) : ('pending' as const),
      lease: null,
      cursor: page.done ? s.cursor : page.nextCursor,
      pages: s.pages + 1,
      processed: s.processed + page.recipients.length,
      created: s.created + counts.added,
      existing: s.existing + counts.existing,
      updatedAt: t,
    };
    if (
      ![next.pages, next.processed, next.created, next.existing].every(
        Number.isSafeInteger
      )
    ) {
      throw new Error('Import counters exceeded safe integer limit');
    }
    if (!(await cas(s, next))) {
      throw new Error('Import checkpoint lost to another worker');
    }
    return sanitized({ ...next, version: s.version + 1 });
  }
  /** Persist only a fixed failure class while this run still owns the live lease.
   * @param {Lease} lease - Private exact owner/token/epoch claim; never a browser capability.
   * @param {unknown} error - Private native/source/parser cause; only its fixed type class is persisted.
   * @returns {Promise<boolean>} True for an owned failure checkpoint, false for lost ownership; raw cause remains private.
   */
  async function fail(lease: Lease, error: unknown) {
    // Reload and CAS within a finite budget; stale ownership cannot mutate a newer generation.
    for (let i = 0; i < 15; i++) {
      /** Latest committed private state reloaded before every ownership transition. */
      const s = await read();
      /** One trusted epoch captured for this exact ownership/state transition. */
      const t = now();
      if (!belongs(s, lease, t)) {
        return false;
      }
      // Exceptions from parsers/DB callbacks may contain email addresses or JSON.
      // Persist a non-PII classification instead of untrusted exception messages.
      /** Fixed TypeError/RangeError/other classification; raw exception messages and recipient data are never persisted. */
      const lastError = (() => {
        if (error instanceof TypeError) {
          return 'IMPORT_INVALID_INPUT';
        }
        if (error instanceof RangeError) {
          return 'IMPORT_BOUNDS';
        }
        return 'IMPORT_PAGE_FAILED';
      })();
      if (
        await cas(s, {
          ...s,
          status: 'failed',
          lease: null,
          lastError,
          updatedAt: t,
        })
      ) {
        return true;
      }
    }
    throw new Error('Import failure checkpoint contention');
  }
  /** Own renewal while reading one immutable page and idempotently appending recipients, then commit only under the live lease.
   * @param {string} owner - Host-verified worker identity; spelling alone is not authorization.
   * @returns {Promise<object>} Token-free state; busy also represents terminal no-acquisition, not only another active worker.
   */
  async function runOnce(owner: string) {
    /** Private active owner/token/epoch; never a public role capability. */
    const lease = await acquire(owner);
    if (!lease) {
      return { busy: true, state: sanitized(await read()) };
    }
    let active = true,
      lost: unknown;
    let heartbeat = Promise.resolve();
    /** Per-run renewal interval; removed on every terminal path and its serial native renewal chain is awaited. */
    const timer = setInterval(
      () => {
        if (!active || lost) {
          return;
        }
        heartbeat = heartbeat
          .then(() => renew(lease))
          .catch((e) => {
            lost = e;
          });
      },
      Math.max(1000, Math.floor(leaseMs / 3))
    );
    timer.unref?.();
    try {
      /** Latest committed private state reloaded before every ownership transition. */
      const s = await read();
      /** Bounded immutable-source recipient page kept only in the trusted worker memory. */
      const page = await source.page({ cursor: s.cursor, limit: batchSize });
      if (
        !page ||
        !Array.isArray(page.recipients) ||
        page.recipients.length > batchSize ||
        (!page.recipients.length && !page.done) ||
        typeof page.done !== 'boolean' ||
        (page.nextCursor !== null && !safeCursor(page.nextCursor))
      ) {
        throw new Error('Invalid import source page');
      }
      if (
        page.done !== (page.nextCursor === null) ||
        (!page.done &&
          (!safeCursor(page.nextCursor) ||
            (s.cursor !== null && page.nextCursor <= s.cursor)))
      ) {
        throw new Error('Invalid import source cursor');
      }
      // A cancellation or lease takeover during source paging must not start a new append.
      /** Fresh committed ownership check after source paging, before starting another append. */
      const current = await read();
      if (!belongs(current, lease, now())) {
        throw new Error('Import lease lost before append');
      }
      /** Acknowledged idempotent append counts; an append can commit before checkpoint failure. */
      const counts = page.recipients.length
        ? await append(campaignCode, page.recipients)
        : { added: 0, existing: 0, recipientCount: 0 };
      active = false;
      clearInterval(timer);
      await heartbeat;
      if (lost) {
        throw lost;
      }
      return { busy: false, state: await commit(lease, page, counts) };
    } catch (error) {
      active = false;
      clearInterval(timer);
      await heartbeat;
      try {
        await fail(lease, error);
      } catch {
        /* original failure retained */
      }
      throw error;
    } finally {
      active = false;
      clearInterval(timer);
    }
  }
  /** Fence future commits by increasing epoch and clearing the lease; already started native append cannot be recalled.
   * @returns {Promise<object>} Token-free cancelled or already terminal state; no recipient or remote-data deletion.
   */
  async function cancel() {
    // Reload and CAS within a finite budget; stale ownership cannot mutate a newer generation.
    for (let i = 0; i < 15; i++) {
      /** Latest committed private state reloaded before every ownership transition. */
      const s = await read();
      /** One trusted epoch captured for this exact ownership/state transition. */
      const t = now();
      if (s.status === 'completed' || s.status === 'cancelled') {
        return sanitized(s);
      }
      if (
        await cas(s, {
          ...s,
          status: 'cancelled',
          lease: null,
          epoch: s.epoch + 1,
          updatedAt: t,
        })
      ) {
        return sanitized({
          ...s,
          status: 'cancelled',
          lease: null,
          epoch: s.epoch + 1,
          updatedAt: t,
          version: s.version + 1,
        });
      }
    }
    throw new Error('Import cancellation contention');
  }
  /** Changed input requires a new immutable source revision and new job ID; existing checkpoints never silently rebind. */
  return {
    /** Read token-free private checkpoint metadata; host must authorize management access.
     * @returns {Promise<object>} Aggregate checkpoint metadata without recipient rows or lease token.
     */
    get: async () => sanitized(await read()),
    acquire,
    renew,
    commit,
    runOnce,
    cancel,
  };
}

/** Resolve only registered opaque job/campaign references through trusted host code.
 * @param {(
    id: string,
    campaignCode: string
  ) =>
    | ReturnType<typeof createMarketingImportJob>
    | Promise<ReturnType<typeof createMarketingImportJob>>} resolve - Explicit trusted job/campaign registry; it must enforce initiating tenant/worker permissions.
 * @returns {(job: {data?: unknown, id?: string}, workerId: string) => Promise<object>} Explicit worker handler; no module/endpoint/shell selection or recipient payload from job data.
 */
export function createMarketingImportProcessor(
  resolve: (
    id: string,
    campaignCode: string
  ) =>
    | ReturnType<typeof createMarketingImportJob>
    | Promise<ReturnType<typeof createMarketingImportJob>>
) {
  if (typeof resolve !== 'function') {
    throw new TypeError('Import job resolver required');
  }
  return async function process(
    job: {
      /** Opaque-only job envelope; no recipient/source credentials permitted. */
      data?: unknown; /** Explicit opaque job identifier; host must avoid encoding personal data. */
      id?: string;
    },
    workerId: string
  ) {
    if (
      !job ||
      !job.data ||
      typeof job.data !== 'object' ||
      Array.isArray(job.data) ||
      !jobIdPattern.test((job.data as any).id) ||
      !campaignPattern.test((job.data as any).campaignCode) ||
      !jobIdPattern.test(workerId) ||
      Object.keys(job.data).some((k) => !['id', 'campaignCode'].includes(k))
    ) {
      throw new TypeError(
        'Import queue message must contain only safe job identifiers'
      );
    }
    /** Exact opaque job reference, never source records or credentials. */
    const { id, campaignCode } = job.data as {
      /** Explicit opaque job identifier; host must avoid encoding personal data. */
      id: string;
      /** Explicit opaque host-scoped campaign identity. */
      campaignCode: string;
    };
    /** Explicit trusted resolver result; only its declared runOnce is invoked. */
    const task = await resolve(id, campaignCode);
    if (!task || typeof task.runOnce !== 'function') {
      throw new Error('Registered import job unavailable');
    }
    return task.runOnce(workerId);
  };
}
/** Publish only job/campaign references using the explicit BullMQ-style retry contract.
 * @param {{
    add(
      name: string,
      data: { id: string; campaignCode: string },
      options: {
        jobId: string;
        attempts: number;
        backoff: { type: 'exponential'; delay: number };
      }
    ): Promise<unknown>;
  }} queue - Borrowed acknowledged BullMQ-style add port; no automatic backend capability emulation.
 * @param {(name: string, data: {id: string, campaignCode: string}, options: {jobId: string, attempts: number, backoff: {type: "exponential", delay: number}}) => Promise<unknown>} queue.add - Explicit borrowed native BullMQ-style enqueue callback.
 * @param {string} id - Validated opaque job reference; not arbitrary executable module selection.
 * @param {string} campaignCode - Validated opaque campaign reference in the host-authorized namespace.
 * @returns {Promise<unknown>} Native queue acceptance, not completed import or SMTP delivery; append must remain idempotent.
 */
export async function enqueueMarketingImportJob(
  queue: {
    /** Enqueue one explicit named task under the borrowed queue contract.
 * @param {string} name - Fixed explicit task name selected by this adapter.
 * @param {{ id: string; campaignCode: string }} data - Opaque job/campaign IDs only, never source rows or credentials.
 * @param {{
        jobId: string;
        attempts: number;
        backoff: { type: 'exponential'; delay: number };
      }} options - Explicit borrowed database/source/append policy and fixed job/revision identity.
 * @returns {Promise<unknown>} Native acceptance; retries require idempotent host checkpoint/append ownership.
 */
    add(
      name: string,
      data: {
        /** Explicit opaque job identifier; host must avoid encoding personal data. */
        id: string; /** Explicit opaque host-scoped campaign identity. */
        campaignCode: string;
      },
      options: {
        /** Deterministic native task reference; not exactly-once execution. */
        jobId: string;
        /** Fixed five native attempts for the idempotent import workflow. */
        attempts: number;
        /** Explicit native exponential retry policy; not process-timer scheduling. */
        backoff: {
          /** Fixed exponential native backoff discriminator. */
          type: 'exponential'; /** Fixed initial native retry backoff of five thousand milliseconds. */
          delay: number;
        };
      }
    ): Promise<unknown>;
  },
  id: string,
  campaignCode: string
) {
  if (
    !jobIdPattern.test(id) ||
    !campaignPattern.test(campaignCode) ||
    typeof queue?.add !== 'function'
  ) {
    throw new TypeError('Invalid marketing import enqueue');
  }
  /** Deterministic native task reference; does not prove exactly-once processing. */
  const jobId =
    'marketing-import-' +
    createHash('sha256')
      .update(campaignCode + '\0' + id)
      .digest('hex')
      .slice(0, 48);
  return queue.add(
    'marketing.import',
    { id, campaignCode },
    { jobId, attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
  );
}
