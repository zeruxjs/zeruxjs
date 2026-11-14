import { randomUUID } from 'node:crypto';
import type {
  NumericReconciliationQuery,
  NumericReconciliationResult,
} from './reconciliation.js';
import type { VersionedStore } from './documents.js';

/** A durable *scan checkpoint*, not a transactional completeness certificate. */
export interface NumericReconciliationJobDocument {
  /** CAS document revision. */
  version: number;
  /** Stable host-owned job identifier. */
  id: string;
  /** Immutable projection identity: table and sorted numeric fields, created with the job. */
  projectionKey: string;
  /** Explicit full-scan pass number. */
  pass: number;
  /** Immutable historical window and page configuration. */
  query: Readonly<
    Pick<NumericReconciliationQuery, 'since' | 'until' | 'site' | 'batchSize'>
  >;
  /** Persisted workflow state, separate from global historical completeness. */
  status: 'pending' | 'running' | 'failed' | 'completed';
  /** Last committed source ID, or null before scanning. */
  cursor: string | null;
  /** Cumulative scanned source rows for this pass. */
  scanned: number;
  /** Cumulative confirmed new facts. */
  created: number;
  /** Cumulative equivalent preexisting facts. */
  existing: number;
  /** Cumulative skipped invalid source rows. */
  invalidRows: number;
  /** Cumulative validated expected projections. */
  expectedFacts: number;
  /** Committed page count. */
  pages: number;
  /** Monotonic lease fencing generation. */
  epoch: number;
  /** Private owner/token/expiry capability; public state strips the token. */
  lease: null | {
    /** Validated trusted worker label. */
    owner: string; /** Private random lease token; never expose in public diagnostics. */
    token: string; /** Server-time lease expiry in UTC milliseconds. */
    expiresAt: number;
  };
  /** Server-time checkpoint update timestamp. */
  updatedAt: number;
  /** Bounded internal callback error message; host callbacks must redact private data. */
  lastError: string | null;
}
export type ReconciliationJobState = Omit<
  NumericReconciliationJobDocument,
  'lease'
> & {
  /** Private owner/token/expiry capability; public state strips the token. */
  lease: null | {
    /** Validated trusted worker label. */
    owner: string; /** Server-time lease expiry in UTC milliseconds. */
    expiresAt: number;
  };
};
export interface NumericReconciliationLease {
  /** Validated trusted worker label. */
  readonly owner: string;
  /** Private random lease token; never expose in public diagnostics. */
  readonly token: string;
  /** Monotonic lease fencing generation. */
  readonly epoch: number;
}
export interface NumericReconciliationJobOptions {
  /** Stable host-owned job identifier. */
  id: string;
  /** Immutable historical window and page configuration. */
  query: NumericReconciliationQuery;
  /** Borrowed durable CAS store; memory fixtures are not production durability. */
  store: VersionedStore<NumericReconciliationJobDocument>;
  /** Optional immutable table/field projection binding. */
  projectionKey?: string;
  /** An isolated caller must use a shared DB-backed CAS store in production. */
  reconcile: (
    query: NumericReconciliationQuery
  ) => Promise<NumericReconciliationResult>;
  /** Lease duration, default 60000ms; accepted range 3000–3600000ms. */
  leaseMs?: number;
  /** Test-only deterministic clock; production defaults to Date.now. */
  now?: () => number;
}

/** Validate immutable job identity and a closed historical scan window.
 * @param {string} id - Host-owned job ID.
 * @param {NumericReconciliationQuery} query - Page settings without a caller-managed cursor.
 * @returns {NumericReconciliationJobDocument['query']} Validated stable window; invalid settings reject.
 */
function validateJob(
  id: string,
  query: NumericReconciliationQuery
): NumericReconciliationJobDocument['query'] {
  if (!/^[A-Za-z0-9_.:-]{1,90}$/.test(id)) {
    throw new TypeError('Invalid reconciliation job ID');
  }
  if (
    !query ||
    !Number.isSafeInteger(query.since) ||
    query.since < 0 ||
    !Number.isSafeInteger(query.until) ||
    query.until < query.since
  ) {
    throw new RangeError(
      'Reconciliation job requires an explicit closed time window'
    );
  }
  if (query.cursor !== undefined) {
    throw new TypeError('Job cursor is managed by the durable checkpoint');
  }
  if (
    query.site !== undefined &&
    (typeof query.site !== 'string' ||
      query.site.length > 200 ||
      // eslint-disable-next-line no-control-regex -- Reject controls in administrative scope values.
      /[\x00-\x1f]/.test(query.site))
  ) {
    throw new TypeError('Invalid reconciliation job site');
  }
  /** Immutable bounded source-page size for the durable job window. */
  const batchSize = query.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new RangeError('Invalid reconciliation job batch size');
  }
  return {
    since: query.since,
    until: query.until,
    ...(query.site === undefined ? {} : { site: query.site }),
    batchSize,
  };
}
/** Clone checkpoint metadata while removing the private lease token.
 * @param {NumericReconciliationJobDocument} document - Internal durable state.
 * @returns {ReconciliationJobState} Detached administrative state; callback error messages still require host sanitization.
 */
function publicState(
  document: NumericReconciliationJobDocument
): ReconciliationJobState {
  /** Public checkpoint fields with the private fencing token removed. */
  const { lease, ...remaining } = document;
  return structuredClone({
    ...remaining,
    lease: lease ? { owner: lease.owner, expiresAt: lease.expiresAt } : null,
  });
}

/** Create a fenced scan coordinator using a host-owned durable CAS store. Construction starts no heartbeat; runOnce owns its active timer.
 * @param {NumericReconciliationJobOptions} options - Immutable window, projection, lease policy and bounded page callback.
 * @returns {ReturnType<typeof createNumericReconciliationJob>} Coordinator facade; source-scan completion is not transactional historical completeness.
 */
export function createNumericReconciliationJob(
  options: NumericReconciliationJobOptions
) {
  /** Explicit host-owned job identity, durable CAS adapter and bounded page callback. */
  const { id, store, reconcile } = options;
  /** Immutable projection binding; an empty default does not invent an external identity. */
  const projectionKey = options.projectionKey ?? '';
  /** Validated immutable scan window stored with this job ID. */
  const query = validateJob(id, options.query);
  /** Finite lease duration, default 60000ms and restricted to 3000–3600000ms. */
  const leaseMs = options.leaseMs ?? 60_000;
  if (
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 3_000 ||
    leaseMs > 3_600_000
  ) {
    throw new RangeError('Invalid reconciliation lease duration');
  }
  /** Trusted injected clock or server Date.now; not caller event time. */
  const clock = options.now ?? Date.now;
  /** Read a validated server clock used for lease fencing.
   * @returns {number} Safe nonnegative UTC milliseconds, or an explicit clock failure. */
  const time = () => {
    /** Clock sample checked before lease arithmetic. */
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Invalid reconciliation clock');
    }
    return value;
  };
  /** Initial immutable window/projection with a fresh scan checkpoint. */
  const initial: NumericReconciliationJobDocument = {
    version: 1,
    id,
    projectionKey,
    pass: 1,
    query,
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
    updatedAt: time(),
    lastError: null,
  };
  // The persisted row owns its identity. An existing ID with different bounds or
  // batch size must never quietly adopt a new job's settings.
  /** Load and verify durable identity/configuration before transitions.
   * @returns {Promise<NumericReconciliationJobDocument>} Current checkpoint, or an explicit conflict/storage error.
   */
  async function read() {
    /** Durable checkpoint loaded before every ownership-sensitive transition. */
    const document = await store.load();
    if (
      document.id !== id ||
      document.projectionKey !== projectionKey ||
      JSON.stringify(document.query) !== JSON.stringify(query) ||
      !Number.isSafeInteger(document.version) ||
      document.version < 1 ||
      !Number.isSafeInteger(document.epoch) ||
      document.epoch < 0 ||
      !Number.isSafeInteger(document.pass) ||
      document.pass < 1 ||
      !['pending', 'running', 'failed', 'completed'].includes(
        document.status
      ) ||
      (document.cursor !== null &&
        (typeof document.cursor !== 'string' || document.cursor.length > 36)) ||
      ![
        document.scanned,
        document.created,
        document.existing,
        document.invalidRows,
        document.expectedFacts,
        document.pages,
      ].every((v) => Number.isSafeInteger(v) && v >= 0)
    ) {
      throw new Error('Reconciliation job identity or configuration conflict');
    }
    return document;
  }
  /** Publish one checkpoint only if its previous revision still matches.
   * @param {NumericReconciliationJobDocument} previous - Current revision read from storage.
   * @param {NumericReconciliationJobDocument} next - Candidate next state before incrementing revision.
   * @returns {Promise<boolean>} Whether the atomic version update won.
   */
  async function cas(
    previous: NumericReconciliationJobDocument,
    next: NumericReconciliationJobDocument
  ) {
    return store.save(
      { ...next, version: previous.version + 1 },
      previous.version
    );
  }
  /** Verify current live lease ownership and fencing epoch.
   * @param {NumericReconciliationJobDocument} doc - Current persisted checkpoint.
   * @param {NumericReconciliationLease} lease - Private caller lease token.
   * @param {number} now - Validated server time.
   * @returns {boolean} Whether this worker still owns the unexpired running lease. */
  const belongs = (
    doc: NumericReconciliationJobDocument,
    lease: NumericReconciliationLease,
    now: number
  ) =>
    doc.status === 'running' &&
    doc.lease?.owner === lease.owner &&
    doc.lease.token === lease.token &&
    doc.epoch === lease.epoch &&
    doc.lease.expiresAt > now;
  /** Copy a private fencing capability from the newly persisted lease.
   * @param {NumericReconciliationJobDocument} doc - Successfully claimed checkpoint.
   * @returns {NumericReconciliationLease} Owner/token/epoch required for subsequent writes. */
  const tokenFor = (
    doc: NumericReconciliationJobDocument
  ): NumericReconciliationLease => ({
    owner: doc.lease!.owner,
    token: doc.lease!.token,
    epoch: doc.epoch,
  });
  /** Validate a bounded worker label before creating a lease.
   * @param {string} owner - Trusted worker instance label.
   * @returns {void} Invalid labels throw. */
  const validOwner = (owner: string) => {
    if (typeof owner !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(owner)) {
      throw new TypeError('Invalid reconciliation worker ID');
    }
  };
  /** Claim an unleased unfinished job with a finite contention budget.
   * @param {string} owner - Validated trusted worker label.
   * @returns {Promise<NumericReconciliationLease|null>} Private lease capability, or null for busy/completed work; contention exhaustion rejects.
   */
  async function acquire(
    owner: string
  ): Promise<NumericReconciliationLease | null> {
    validOwner(owner);
    // Bound CAS contention rather than spinning indefinitely across replicas.
    for (let attempt = 0; attempt < 12; attempt++) {
      /** Current durable checkpoint; every transition compares its stored version. */
      const current = await read();
      /** Validated server time for this individual transition. */
      const now = time();
      if (
        current.status === 'completed' ||
        (current.lease && current.lease.expiresAt > now)
      ) {
        return null;
      }
      /** Candidate checkpoint; only successful CAS publishes it. */
      const next: NumericReconciliationJobDocument = {
        ...current,
        status: 'running',
        epoch: current.epoch + 1,
        lease: { owner, token: randomUUID(), expiresAt: now + leaseMs },
        updatedAt: now,
        lastError: null,
      };
      if (await cas(current, next)) {
        return tokenFor(next);
      }
    }
    throw new Error('Reconciliation lease contention exceeded retry budget');
  }
  /** Extend only the currently owned unexpired lease.
   * @param {NumericReconciliationLease} lease - Private owner/token/epoch capability.
   * @returns {Promise<void>} Settles after successful renewal; lost ownership/contention rejects.
   */
  async function renew(lease: NumericReconciliationLease): Promise<void> {
    // Bound CAS contention rather than spinning indefinitely across replicas.
    for (let attempt = 0; attempt < 12; attempt++) {
      /** Current durable checkpoint; every transition compares its stored version. */
      const current = await read();
      /** Validated server time for this individual transition. */
      const now = time();
      if (!belongs(current, lease, now)) {
        throw new Error('Reconciliation lease lost');
      }
      if (
        await cas(current, {
          ...current,
          lease: { ...current.lease!, expiresAt: now + leaseMs },
          updatedAt: now,
        })
      ) {
        return;
      }
    }
    throw new Error(
      'Reconciliation heartbeat contention exceeded retry budget'
    );
  }
  /** Commit validated page counters/cursor only under the current lease and revision.
   * @param {NumericReconciliationLease} lease - Private current lease capability.
   * @param {NumericReconciliationResult} page - Actual completed bounded page receipt.
   * @returns {Promise<ReconciliationJobState>} Public committed state; stale/invalid/precision-losing checkpoints reject.
   */
  async function checkpoint(
    lease: NumericReconciliationLease,
    page: NumericReconciliationResult
  ): Promise<ReconciliationJobState> {
    /** Current durable checkpoint; every transition compares its stored version. */
    const current = await read();
    /** Validated server time for this individual transition. */
    const now = time();
    if (!belongs(current, lease, now)) {
      throw new Error('Reconciliation lease lost');
    }
    // Validate every page counter before advancing the durable cursor.
    for (const key of [
      'scanned',
      'expectedFacts',
      'created',
      'existing',
      'invalidRows',
    ] as const) {
      if (!Number.isSafeInteger(page[key]) || page[key] < 0) {
        throw new Error('Invalid reconciliation page metrics');
      }
    }
    if (
      page.created + page.existing !== page.expectedFacts ||
      page.hasMore === page.windowExhausted ||
      (page.hasMore &&
        (!page.nextCursor ||
          typeof page.nextCursor !== 'string' ||
          page.nextCursor.length > 36 ||
          // eslint-disable-next-line no-control-regex -- Reject controls in administrative scope values.
          /[\x00-\x20\x7f]/.test(page.nextCursor) ||
          (current.cursor !== null && page.nextCursor <= current.cursor))) ||
      (!page.hasMore && page.nextCursor !== null) ||
      (page.scanned < 1 && page.hasMore)
    ) {
      throw new Error('Invalid reconciliation checkpoint result');
    }
    /** Candidate checkpoint; only successful CAS publishes it. */
    const next: NumericReconciliationJobDocument = {
      ...current,
      status: page.hasMore ? 'pending' : 'completed',
      cursor: page.hasMore ? page.nextCursor : current.cursor,
      scanned: current.scanned + page.scanned,
      created: current.created + page.created,
      existing: current.existing + page.existing,
      invalidRows: current.invalidRows + page.invalidRows,
      expectedFacts: current.expectedFacts + page.expectedFacts,
      pages: current.pages + 1,
      lease: null,
      lastError: null,
      updatedAt: now,
    };
    // Never persist a precision-losing checkpoint. Large scans must be partitioned into smaller jobs.
    if (
      ![
        next.scanned,
        next.created,
        next.existing,
        next.invalidRows,
        next.expectedFacts,
        next.pages,
      ].every(Number.isSafeInteger)
    ) {
      throw new Error('Reconciliation checkpoint exceeds safe integer range');
    }
    // Fencing: renewal/takeover moves the document version. A losing CAS cannot commit.
    if (!(await cas(current, next))) {
      throw new Error(
        'Reconciliation checkpoint version changed; replay after lease expiry'
      );
    }
    return publicState({ ...next, version: current.version + 1 });
  }
  /** Record a bounded internal failure only while the caller owns the lease.
   * @param {NumericReconciliationLease} lease - Private current capability.
   * @param {unknown} error - Host-sanitized callback failure; its message can be persisted internally.
   * @returns {Promise<boolean>} False if lease ownership was lost; contention/storage errors reject.
   */
  async function fail(
    lease: NumericReconciliationLease,
    error: unknown
  ): Promise<boolean> {
    /** Bounded failure message persisted by this internal administrative job; callers must sanitize callback errors. */
    const message = error instanceof Error ? error.message : String(error);
    // Bound CAS contention rather than spinning indefinitely across replicas.
    for (let attempt = 0; attempt < 12; attempt++) {
      /** Current durable checkpoint; every transition compares its stored version. */
      const current = await read();
      /** Validated server time for this individual transition. */
      const now = time();
      if (!belongs(current, lease, now)) {
        return false;
      }
      if (
        await cas(current, {
          ...current,
          status: 'failed',
          lease: null,
          updatedAt: now,
          lastError: message.slice(0, 400),
        })
      ) {
        return true;
      }
    }
    throw new Error(
      'Reconciliation failure checkpoint contention exceeded retry budget'
    );
  }
  /** Begin a fresh full scan pass without taking over an active lease.
   * @returns {Promise<ReconciliationJobState>} Committed new-pass state; active lease/contention rejects.
   */
  async function restart(): Promise<ReconciliationJobState> {
    // Bound CAS contention rather than spinning indefinitely across replicas.
    for (let attempt = 0; attempt < 12; attempt++) {
      /** Current durable checkpoint; every transition compares its stored version. */
      const current = await read();
      /** Validated server time for this individual transition. */
      const now = time();
      if (current.lease && current.lease.expiresAt > now) {
        throw new Error('Reconciliation job is leased by another worker');
      }
      /** Candidate checkpoint; only successful CAS publishes it. */
      const next: NumericReconciliationJobDocument = {
        ...initial,
        version: current.version + 1,
        pass: current.pass + 1,
        epoch: current.epoch + 1,
        updatedAt: now,
      };
      if (await store.save(next, current.version)) {
        return publicState(next);
      }
    }
    throw new Error('Reconciliation restart contention exceeded retry budget');
  }
  /** Acquire, execute and checkpoint one page with an owned heartbeat timer.
   * @param {string} owner - Trusted worker instance label.
   * @returns {Promise<{busy: boolean, state: ReconciliationJobState}>} Busy state or committed receipt; failure retains the old cursor and clears heartbeat resources.
   */
  async function runOnce(
    owner: string
  ): Promise<{ busy: boolean; state: ReconciliationJobState }> {
    /** Private acquired lease; unavailable/completed work is reported as busy. */
    const lease = await acquire(owner);
    if (!lease) {
      return { busy: true, state: publicState(await read()) };
    }
    // Renew during long-running pages. Timer only exists for this actively awaited job.
    let active = true,
      lost: unknown;
    let heartbeat = Promise.resolve();
    /** Owned heartbeat timer limited to this awaited run; cleared on every completion path. */
    const timer = setInterval(
      () => {
        if (!active || lost) {
          return;
        }
        heartbeat = heartbeat
          .then(() => renew(lease))
          .catch((error) => {
            lost = error;
          });
      },
      Math.max(1000, Math.floor(leaseMs / 3))
    );
    timer.unref?.();
    try {
      /** Checkpoint read after lease acquisition; its cursor is authoritative. */
      const state = await read();
      /** Actual bounded reconciliation result, checkpointed only while lease ownership remains valid. */
      const page = await reconcile({
        ...query,
        ...(state.cursor ? { cursor: state.cursor } : {}),
      });
      active = false;
      clearInterval(timer);
      await heartbeat;
      if (lost) {
        throw lost;
      }
      return { busy: false, state: await checkpoint(lease, page) };
    } catch (error) {
      active = false;
      clearInterval(timer);
      await heartbeat;
      // Failed pages do not advance the durable cursor; a replacement worker
      // may replay them after failure or expiry.
      try {
        await fail(lease, error);
      } catch {
        /* keep the original failure */
      }
      throw error;
    } finally {
      active = false;
      clearInterval(timer);
    }
  }
  return {
    get: async () => publicState(await read()),
    acquire,
    renew,
    checkpoint,
    fail,
    runOnce,
    restart,
  };
}
