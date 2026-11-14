import { randomUUID } from 'node:crypto';
import type { JobProcessor, ZeruxQueue, BullJobLike } from './index.js';

export type EmailDeliveryState =
  | 'pending'
  | 'claimed'
  | 'sending'
  | 'sent'
  | 'suppressed'
  | 'uncertain'
  | 'rejected';
export interface DurableEmailDeliveryRecord {
  /** Positive optimistic durable revision; increments only through exact CAS. */
  version: number;
  /** Opaque immutable durable message ID; never an authorization credential. */
  id: string;
  /** Saved marketing/transactional purpose, distinct from optional tracking consent. */
  purpose: 'marketing' | 'transactional';
  /** Private saved marketing consent/suppression lookup identity; never broker payload. */
  recipient?: string;
  /** Optional campaign reference; persisted in the durable mail record, never Redis. */
  campaignId?: string;
  /** Explicit pending/claimed/sending/sent/suppressed/uncertain/rejected state. */
  state: EmailDeliveryState;
  /** Trusted internal metadata. Never return this object in queue dashboard API. */
  lease: null | {
    /** Opaque trusted claimant identity, not a browser principal. */
    owner: string;
    /** Opaque current lease token fenced by exact version and expiry. */
    token: string;
    /** Lease expiry epoch milliseconds; sending expiry never authorizes automatic SMTP replay. */
    expiresAt: number;
  };
  /** Optional recorded send-boundary epoch milliseconds. */
  attemptedAt?: number;
  /** Optional terminal-state observation epoch milliseconds. */
  completedAt?: number;
  /** Most recent durable CAS epoch milliseconds. */
  updatedAt: number;
}
/** Must be implemented with shared, atomic conditional updates (affectedCount=1). */
export interface DurableEmailDeliveryStore {
  /** Read one private durable record; caller must independently authorize management access.
   * @param {string} id - Opaque message ID, not a recipient email.
   * @returns {Promise<DurableEmailDeliveryRecord | null>} Private stored facts or absence; no public dashboard projection.
   */
  load(id: string): Promise<DurableEmailDeliveryRecord | null>;
  /** Atomically compare one exact stored version before replacing the same immutable message identity.
   * @param {string} id - Existing opaque durable message ID.
   * @param {DurableEmailDeliveryRecord} next - Complete next record with exactly incremented version.
   * @param {number} expectedVersion - Exact expected previous version, not a local lock.
   * @returns {Promise<boolean>} True only for the winning compare-and-swap; false requires host contention handling.
   */
  save(
    id: string,
    next: DurableEmailDeliveryRecord,
    expectedVersion: number
  ): Promise<boolean>;
}
export interface DurableEmailDeliveryOptions {
  /** Borrowed host-owned linearizable durable store; never closed by callback factories. */
  store: DurableEmailDeliveryStore;
  /** Fresh preference check. Called before beginning delivery; sender must recheck at SMTP boundary. */
  isSubscribed: (email: string) => Promise<boolean>;
  /** Fresh hard-bounce/complaint/manual suppression check, separate from marketing opt-in. */
  isSuppressed?: (email: string) => Promise<boolean>;
  /** Optional live campaign gate: paused -> defer, cancelled -> suppress. */
  campaignGate?: (
    record: Readonly<DurableEmailDeliveryRecord>
  ) => Promise<'allow' | 'defer' | 'suppress'>;
  /** Send exactly one message ID; provider credentials and contents stay outside the queue. */
  send: (
    messageId: string,
    record: Readonly<DurableEmailDeliveryRecord>
  ) => Promise<unknown>;
  /** Optional isolated notification after uncertainty; observer failure must not trigger duplicate delivery. */
  onUncertain?: (messageId: string) => void | Promise<void>;
  /** Explicit lease duration, default 60000 ms and valid 3000 through 3600000. */
  leaseMs?: number;
  /** Optional trusted validated epoch clock; not a new scheduling timer. */
  now?: () => number;
}
/** Conservative opaque message-ID grammar; never an email or authorization check.
 * @param {unknown} id - Opaque candidate message identifier.
 * @returns {boolean} Whether bounded ID syntax matches, not permission.
 */
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id);
/** Create a cloned single-process reference store for tests/development only. It is not shared durable persistence or a production multi-worker CAS adapter.
 * @param {DurableEmailDeliveryRecord[]} initial - Explicit initial synthetic/development records; duplicate IDs reject.
 * @returns {DurableEmailDeliveryStore & {insert(record:DurableEmailDeliveryRecord):void}} Inert process-local reference store; no native connections or automatic worker.
 */
export function createMemoryEmailDeliveryStore(
  initial: DurableEmailDeliveryRecord[] = []
): DurableEmailDeliveryStore & {
  /** Insert one explicit unique cloned record into the process-local reference store.
   * @param {DurableEmailDeliveryRecord} record - Explicit reference record; this API is not production durable storage.
   * @returns {void} Rejects invalid/duplicate identifiers; no external resource acquired.
   */
  insert(record: DurableEmailDeliveryRecord): void;
} {
  /** Cloned process-local reference records, not durable/shared production persistence. */
  const records = new Map<string, DurableEmailDeliveryRecord>();
  /** Insert only a valid unique cloned reference record.
   * @param {DurableEmailDeliveryRecord} record - Explicit cloned reference record.
   * @returns {void} Inserts one reference record or rejects a duplicate.
   */
  const insert = (record: DurableEmailDeliveryRecord) => {
    if (!validId(record.id) || records.has(record.id)) {
      throw new TypeError('Invalid or duplicated email record');
    }
    records.set(record.id, structuredClone(record));
  };
  // Bound claim/transition contention and never reuse a stale version or lost lease.
  for (const record of initial) {
    insert(record);
  }
  return {
    insert,
    /** Read one private durable record; caller must independently authorize management access.
     * @param {string} id - Opaque message ID, not a recipient email.
     * @returns {Promise<DurableEmailDeliveryRecord | null>} Private stored facts or absence; no public dashboard projection.
     */
    async load(id) {
      /** Private current record/descriptor, never returned by queue dashboard APIs. */
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    /** Atomically compare one exact stored version before replacing the same immutable message identity.
     * @param {string} id - Existing opaque durable message ID.
     * @param {DurableEmailDeliveryRecord} next - Complete next record with exactly incremented version.
     * @param {number} expected - Exact expected previous version for the reference implementation.
     * @returns {Promise<boolean>} True only for the winning compare-and-swap; false requires host contention handling.
     */
    async save(id, next, expected) {
      /** Fresh durable revision reloaded before lease/version decisions. */
      const current = records.get(id);
      if (
        !current ||
        current.version !== expected ||
        next.version !== expected + 1 ||
        next.id !== id
      ) {
        return false;
      }
      records.set(id, structuredClone(next));
      return true;
    },
  };
}
/** Bind a conservative durable SMTP state machine over host-owned linearizable records. Never automatically resend after entering sending; expired sending claims and ambiguous submission require reconciliation.
 * @param {DurableEmailDeliveryOptions} options - Durable CAS, fresh consent/suppression/campaign gates and explicit trusted sender.
 * @returns {JobProcessor} Explicit worker callback; native queue owns worker lifetime and at-least-once execution.
 */
export function createDurableEmailDeliveryProcessor(
  options: DurableEmailDeliveryOptions
): JobProcessor {
  if (
    !options ||
    typeof options.store?.load !== 'function' ||
    typeof options.store?.save !== 'function' ||
    typeof options.isSubscribed !== 'function' ||
    typeof options.send !== 'function'
  ) {
    throw new TypeError(
      'Durable email delivery requires a store, consent check and sender'
    );
  }
  /** Validated native delivery lease length, default one minute. */
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 3000 || leaseMs > 3_600_000) {
    throw new RangeError('Invalid email delivery lease');
  }
  /** Borrowed trusted epoch clock; validate each use before persistence. */
  const clock = options.now ?? Date.now;
  /** Validated explicit epoch milliseconds or trusted current clock, scoped to this operation.
   * @returns {number} Validated current epoch milliseconds.
   */
  const now = () => {
    /** Observed trusted clock reading, checked before durable state changes.
     * @param {O} 0 - undefined
     * @returns {b} s
     */
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Invalid clock');
    }
    return value;
  };
  /** Load and validate current private state before a state-machine decision.
   * @param {string} id - Existing opaque durable reference.
   * @returns {Promise<DurableEmailDeliveryRecord>} Validated private current record.
   */
  const read = async (id: string) => {
    /** Private current record/descriptor, never returned by queue dashboard APIs. */
    const record = await options.store.load(id);
    if (
      !record ||
      record.id !== id ||
      !Number.isSafeInteger(record.version) ||
      record.version < 1 ||
      ![
        'pending',
        'claimed',
        'sending',
        'sent',
        'suppressed',
        'uncertain',
        'rejected',
      ].includes(record.state) ||
      !['transactional', 'marketing'].includes(record.purpose)
    ) {
      throw new Error('Email record missing or invalid');
    }
    return record;
  };
  /** Write one exact next durable version without changing its immutable ID.
   * @param {DurableEmailDeliveryRecord} old - Exact previous durable revision.
   * @param {Partial<DurableEmailDeliveryRecord>} changes - Explicit guarded state/lease patch.
   * @returns {Promise<boolean>} Winning durable CAS result.
   */
  const save = (
    old: DurableEmailDeliveryRecord,
    changes: Partial<DurableEmailDeliveryRecord>
  ) =>
    options.store.save(
      old.id,
      {
        ...old,
        ...changes,
        id: old.id,
        version: old.version + 1,
        updatedAt: now(),
      },
      old.version
    );
  /** Classify explicit terminal outcomes; uncertain is terminal to automatic sends.
   * @param {EmailDeliveryState} state - Explicit durable state.
   * @returns {boolean} Whether automatic SMTP must not run again.
   */
  const terminal = (state: EmailDeliveryState) =>
    state === 'sent' ||
    state === 'suppressed' ||
    state === 'uncertain' ||
    state === 'rejected';
  /** Boundedly CAS the current owned lease to a terminal/retry-safe state without overriding another claimant.
   * @param {string} id - Opaque durable message ID.
   * @param {string} token - Exact owned current lease token.
   * @param {EmailDeliveryState} state - Explicit desired delivery state.
   * @returns {Promise<void>} Winning transition or visible lease-loss/contention failure after at most 12 tries.
   */
  async function transition(
    id: string,
    token: string,
    state: EmailDeliveryState
  ) {
    // Bound claim/transition contention and never reuse a stale version or lost lease.
    for (let i = 0; i < 12; i++) {
      /** Fresh durable revision reloaded before lease/version decisions. */
      const current = await read(id);
      if (current.lease?.token !== token) {
        throw new Error('Email delivery lease lost');
      }
      if (
        await save(current, {
          state,
          lease: null,
          ...(terminal(state) ? { completedAt: now() } : {}),
        })
      ) {
        return;
      }
    }
    throw new Error('Email delivery state contention');
  }
  /** Claim only safe pending/expired pre-send work. Expired sending becomes uncertain because SMTP may already have accepted bytes.
   * @param {string} id - Opaque existing durable message ID.
   * @returns {Promise<object>} Owned claim token or terminal/busy state; never inferred permission to resend sending work.
   */
  async function acquire(id: string) {
    // Bound claim/transition contention and never reuse a stale version or lost lease.
    for (let i = 0; i < 12; i++) {
      /** Fresh durable revision reloaded before lease/version decisions. */
      const current = await read(id);
      /** Current validated epoch milliseconds for lease/terminal decisions. */
      const time = now();
      if (terminal(current.state)) {
        return { state: current.state } as const;
      }
      if (current.state === 'sending') {
        if (current.lease && current.lease.expiresAt > time) {
          return { state: 'busy' } as const;
        }
        // A crashed sender may have reached SMTP. Do NOT resend automatically.
        if (
          await save(current, {
            state: 'uncertain',
            lease: null,
            completedAt: time,
          })
        ) {
          return { state: 'uncertain', recovered: true } as const;
        }
        continue;
      }
      if (
        current.state === 'claimed' &&
        current.lease &&
        current.lease.expiresAt > time
      ) {
        return { state: 'busy' } as const;
      }
      /** Owned current lease token checked at every guarded transition. */
      const token = randomUUID();
      /** Fresh opaque worker claim owner, not an authenticated user identity. */
      const owner = randomUUID();
      if (
        await save(current, {
          state: 'claimed',
          lease: { owner, token, expiresAt: time + leaseMs },
        })
      ) {
        return { state: 'claimed', token } as const;
      }
    }
    throw new Error('Email delivery claim contention');
  }
  return async (job) => {
    if (job.name !== 'email.deliver' || !validId(job.data?.messageId)) {
      throw new TypeError('Invalid email delivery job');
    }
    /** Validated opaque reference from the fixed email.deliver envelope. */
    const id = job.data.messageId;
    /** Winning owned claim or terminal/busy outcome from durable CAS. */
    const claim = await acquire(id);
    if (claim.state === 'busy') {
      throw Object.assign(new Error('Email delivery claim busy; retry later'), {
        code: 'EMAIL_DELIVERY_BUSY',
      });
    }
    if (
      claim.state === 'uncertain' &&
      'recovered' in claim &&
      claim.recovered
    ) {
      try {
        await options.onUncertain?.(id);
      } catch {
        /* Cannot affect state */
      }
    }
    if (claim.state !== 'claimed') {
      return { status: claim.state };
    }
    /** Owned current lease token checked at every guarded transition. */
    const token = claim.token;
    let record = await read(id);
    try {
      if (record.purpose === 'marketing') {
        if (typeof record.recipient !== 'string' || !record.recipient.trim()) {
          throw new Error('Marketing recipient unavailable');
        }
        /** Fresh literal consent decision before SMTP; outage never implies consent. */
        const subscribed = await options.isSubscribed(record.recipient);
        if (subscribed !== true) {
          if (subscribed !== false) {
            throw new Error('Invalid marketing consent response');
          }
          await transition(id, token, 'suppressed');
          return { status: 'suppressed' };
        }
        if (options.isSuppressed) {
          /** Fresh hard-bounce/complaint/manual suppression, independent of tracking. */
          const suppressed = await options.isSuppressed(record.recipient);
          if (typeof suppressed !== 'boolean') {
            throw new Error('Invalid marketing suppression response');
          }
          if (suppressed) {
            await transition(id, token, 'suppressed');
            return { status: 'suppressed' };
          }
        }
        if (options.campaignGate) {
          /** Fresh campaign allow/defer/suppress gate, rechecked separately by the SMTP sender. */
          const policy = await options.campaignGate(record);
          if (policy === 'suppress') {
            await transition(id, token, 'suppressed');
            return { status: 'suppressed' };
          }
          if (policy === 'defer') {
            throw Object.assign(new Error('Campaign not accepting delivery'), {
              code: 'CAMPAIGN_DELIVERY_DEFERRED',
            });
          }
          if (policy !== 'allow') {
            throw new Error('Invalid campaign delivery policy');
          }
        }
      }
    } catch (error) {
      // Before SMTP begins, a failed consent read may be retried without duplicate delivery.
      /** Fresh durable revision reloaded before lease/version decisions. */
      const current = await read(id);
      if (current.state === 'claimed' && current.lease?.token === token) {
        await save(current, { state: 'pending', lease: null });
      }
      throw error;
    }
    record = await read(id);
    if (
      record.state !== 'claimed' ||
      record.lease?.token !== token ||
      record.lease.expiresAt <= now()
    ) {
      throw new Error('Email delivery lease expired');
    }
    if (!(await save(record, { state: 'sending', attemptedAt: now() }))) {
      throw new Error('Email delivery lease contested');
    }
    // The sender must check marketing consent again immediately before SMTP acceptance.
    // No heartbeat after 'sending': expiration is *uncertain*, never a replay trigger.
    try {
      /** Trusted sender result; explicit partial/unknown envelopes never become sent. */
      const provider = await options.send(id, record);
      // New email manager callers disclose explicit SMTP envelope uncertainty.
      // Legacy custom senders that return void remain responsible for their own verified result.
      if (
        provider &&
        typeof provider === 'object' &&
        'submissionStatus' in provider
      ) {
        /** Explicit SMTP submission classification; native failure detail stays private. */
        const reported = (
          provider as {
            /** Explicit trusted SMTP envelope classification; partial/unknown require review. */
            submissionStatus: unknown;
          }
        ).submissionStatus;
        if (
          !['accepted', 'partial', 'rejected', 'unknown'].includes(
            String(reported)
          )
        ) {
          throw new Error('Invalid SMTP submission classification');
        }
        if (reported === 'rejected') {
          await transition(id, token, 'rejected');
          return { status: 'rejected' };
        }
        if (reported !== 'accepted') {
          await transition(id, token, 'uncertain');
          try {
            await options.onUncertain?.(id);
          } catch {
            /* No duplicate send */
          }
          return { status: 'uncertain' };
        }
      }
      await transition(id, token, 'sent');
      return { status: 'sent' };
    } catch {
      // Even an ETIMEDOUT may have been accepted. Never auto retry an ambiguous outcome.
      let recorded = false;
      try {
        await transition(id, token, 'uncertain');
        recorded = true;
      } catch {
        /* Lease expiry/recovery will mark uncertain. */
      }
      if (recorded) {
        try {
          await options.onUncertain?.(id);
        } catch {
          /* notification cannot trigger duplicate delivery */
        }
      }
      return { status: 'uncertain' };
    }
  };
}
/** Validate the entire finite message-ID batch and native delivery schedule before enqueue; application persists and authorizes those IDs first.
 * @param {ZeruxQueue} queue - Borrowed native producer; its service owns lifecycle.
 * @param {readonly string[]} ids - One through 200 unique opaque existing durable message references.
 * @param {object} options - Explicit intended native schedule, attempts and optional trusted clock.
 * @param {number} options.sendAt - Intended execution epoch milliseconds.
 * @param {number} [options.attempts] - Native total attempts, default five.
 * @param {number} [options.now] - Trusted current epoch milliseconds.
 * @returns {Promise<BullJobLike[]>} Native bulk receipt, not recipient delivery or a cross-store transaction.
 */
export async function enqueueEmailCampaignBatch(
  queue: ZeruxQueue,
  ids: readonly string[],
  options: {
    /** Explicit intended native execution time; at most 365 days ahead with bounded past tolerance. */
    sendAt: number;
    /** Native queue attempts, default five and valid 1 through 20. */
    attempts?: number;
    /** Optional trusted validated epoch clock; not a new scheduling timer. */
    now?: number;
  }
): Promise<BullJobLike[]> {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 200 ||
    ids.some((id) => !validId(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new TypeError(
      'Campaign batch must contain 1..200 distinct durable message IDs'
    );
  }
  /** Validated explicit epoch milliseconds or trusted current clock, scoped to this operation. */
  const now = options.now ?? Date.now();
  if (
    !Number.isSafeInteger(options.sendAt) ||
    !Number.isSafeInteger(now) ||
    options.sendAt < now - 30_000 ||
    options.sendAt > now + 365 * 86_400_000
  ) {
    throw new RangeError('Invalid campaign delivery time');
  }
  /** Validated native batch attempts, default five. */
  const attempts = options.attempts ?? 5;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new RangeError('Invalid campaign attempts');
  }
  /** Native persisted nonnegative delay; no per-process delivery timer. */
  const delay = Math.max(0, options.sendAt - now);
  return queue.addBulk(
    ids.map((messageId) => ({
      name: 'email.deliver',
      data: { messageId },
      options: {
        jobId: `email-${messageId}`,
        delay,
        attempts,
        backoff: { type: 'exponential', delay: 5000 } as const,
      },
    }))
  );
}

/** Resolve only an authorized uncertain record after independent provider reconciliation. Never requeue/send; durable evidence/audit policy remains host-owned.
 * @param {DurableEmailDeliveryStore} store - Borrowed linearizable durable delivery store.
 * @param {string} id - Opaque existing uncertain message reference.
 * @param {'sent' | 'suppressed' | 'rejected'} decision - Explicit provider-verified sent/suppressed/rejected classification.
 * @param {object} options - Verified host context, required fresh approval and optional best-effort redacted audit.
 * @param {unknown} options.context - Verified privileged operator identity/context.
 * @param {function} options.authorize - Fresh exact record/decision approval.
 * @param {function} [options.onAudit] - Best-effort redacted committed-resolution observer.
 * @returns {Promise<boolean>} Winning manual CAS resolution; denied/non-uncertain/contended work rejects.
 */
export async function resolveUncertainEmailDelivery(
  store: DurableEmailDeliveryStore,
  id: string,
  decision: 'sent' | 'suppressed' | 'rejected',
  options: {
    /** Host-verified privileged operator context; never unverified role strings. */
    context: unknown;
    /** Required fresh host decision for exact record/decision; literal true only. */
    authorize: (
      context: unknown,
      id: string,
      decision: string
    ) => Promise<boolean> | boolean;
    /** Optional best-effort committed-resolution facts; no recipients or bodies. */
    onAudit?: (entry: {
      /** Opaque immutable durable message ID; never an authorization credential. */
      id: string;
      /** Fixed provider-verified terminal classification. */
      decision: string;
      /** UTC audit timestamp only. */
      at: string;
    }) => Promise<void> | void;
  }
): Promise<boolean> {
  if (
    !validId(id) ||
    !['sent', 'suppressed', 'rejected'].includes(decision) ||
    typeof options?.authorize !== 'function'
  ) {
    throw new TypeError('Invalid delivery resolution');
  }
  if ((await options.authorize(options.context, id, decision)) !== true) {
    throw new Error('Delivery resolution forbidden');
  }
  // Bound claim/transition contention and never reuse a stale version or lost lease.
  for (let i = 0; i < 12; i++) {
    /** Private current record/descriptor, never returned by queue dashboard APIs. */
    const record = await store.load(id);
    if (!record || record.id !== id) {
      throw new Error('Unknown email delivery record');
    }
    if (record.state !== 'uncertain') {
      throw new Error('Only uncertain delivery may be manually resolved');
    }
    /** Actual manual-resolution epoch timestamp recorded after fresh authorization. */
    const timestamp = Date.now();
    if (
      await store.save(
        id,
        {
          ...record,
          version: record.version + 1,
          state: decision,
          lease: null,
          completedAt: timestamp,
          updatedAt: timestamp,
        },
        record.version
      )
    ) {
      try {
        await options.onAudit?.({
          id,
          decision,
          at: new Date(timestamp).toISOString(),
        });
      } catch {
        /* No replay after committed transition */
      }
      return true;
    }
  }
  throw new Error('Delivery resolution contention');
}
