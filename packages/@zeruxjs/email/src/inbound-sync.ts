/** Durable IMAP UID checkpoint coordinator. Only credentials stay with the receiver; no message data is stored here. */
import { createHash, randomUUID } from 'node:crypto';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
import type { IncomingPollCursor } from './inbound.js';

export interface MailboxSyncState {
  /** Explicit host job identity; not authentication or arbitrary import selection. */
  id: string;
  /** Exact configured private receiver account; host owns tenant authorization. */
  account: string;
  /** Optional explicit configured folder; each folder gets independent checkpoint identity. */
  mailbox?: string;
  /** Positive committed revision for native CAS. */
  version: number;
  /** Monotonic lease/reset generation fencing stale worker completions. */
  epoch: number;
  /** Generation/folder-bound native UID continuation; no message bodies or credentials stored. */
  cursor: IncomingPollCursor;
  /** Private active owner/token/expiry; public projection removes only the token. */
  lease: null | {
    /** Host worker label; not a user role or permission. */
    owner: string; /** Random private lease identity; never exposed by get/run/reset state projections. */
    token: string; /** Explicit epoch expiry; native poll work is not force-cancelled on lease loss. */
    expiresAt: number;
  };
  /** Idle/running/failed checkpoint state, not mail delivery evidence. */
  status: 'idle' | 'running' | 'failed';
  /** Committed receiver pages completed under the live lease. */
  pages: number;
  /** Sum of stored counts returned by committed receiver pages; not unique human reads. */
  received: number;
  /** Trusted epoch checkpoint timestamp. */
  updatedAt: number;
  /** Only fixed POLL_FAILED or null is persisted; raw causes remain private thrown errors. */
  lastError: 'POLL_FAILED' | null;
}
export interface MailboxSyncOptions {
  /** Borrowed structured database requiring real unique insertion and exact CAS counts. */
  db: CampaignDatabaseConnection;
  /** Explicit host job identity; not authentication or arbitrary import selection. */
  id: string;
  /** Exact configured private receiver account; host owns tenant authorization. */
  account: string;
  /** Optional IMAP folder; each folder has its own durable checkpoint and lease. */
  mailbox?: string;
  /** Borrowed configured IMAP poll service; host owns native lifecycle and authorization. */
  receiver: {
    poll: (
      account: string,
      options: {
        /** Generation/folder-bound native UID continuation; no message bodies or credentials stored. */
        cursor: IncomingPollCursor; /** Optional explicit configured folder; each folder gets independent checkpoint identity. */
        mailbox?: string;
      }
    ) => Promise<{
      /** Receiver-reported nonnegative count; not SMTP delivery evidence. */
      stored: number; /** Required successful receiver generation/folder-bound continuation. */
      nextCursor?: IncomingPollCursor;
    }>;
  };
  /** Integer 3000–3600000ms, default 60000; renewals remain cooperative database work. */
  leaseMs?: number;
  /** Validated private table name, default zerux_email_mailbox_sync. */
  table?: string;
  /** Optional trusted safe epoch clock, default Date.now. */
  now?: () => number;
}
/** Validate explicit bounded job/account/worker reference spelling without granting access.
 * @param {string} v - Candidate registered identity.
 * @returns {boolean} True only for the supported literal syntax. */
const validName = (v: string) =>
  typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(v);
/** Bind one IMAP checkpoint to explicit job/account/folder scope with real unique insert and revision-CAS requirements.
 * @param {MailboxSyncOptions} options - Explicit borrowed database/receiver, configured job/account/folder and finite lease policy.
 * @returns {object} Get/run/reset coordinator; database/receiver remain borrowed and each run owns its renewal timer.
 */
export function createDatabaseMailboxSync(options: MailboxSyncOptions) {
  /** Explicit host-scoped borrowed dependencies and checkpoint identity; no endpoint/package discovery. */
  const { db, id, account, receiver, mailbox } = options;
  /** Validated private checkpoint table, default zerux_email_mailbox_sync. */
  const table = options.table ?? 'zerux_email_mailbox_sync';
  /** Finite lease/renewal policy; native polling still needs its own resource bounds. */
  const leaseMs = options.leaseMs ?? 60000;
  /** Trusted epoch clock, default Date.now. */
  const clock = options.now ?? Date.now;
  if (
    !db ||
    !validName(id) ||
    !validName(account) ||
    !receiver ||
    typeof receiver.poll !== 'function' ||
    (mailbox !== undefined &&
      (typeof mailbox !== 'string' ||
        !mailbox ||
        mailbox.length > 255 ||
        /[\r\n\0]/.test(mailbox))) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(table) ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 3000 ||
    leaseMs > 3600000
  ) {
    throw new TypeError('Invalid mailbox sync options');
  }
  // Preserve historical checkpoint keys for unscoped workers; new folders are isolated.
  /** Stable checkpoint key preserving legacy unscoped identities while isolating explicit folders. */
  const key =
    'ims_' +
    createHash('sha256')
      .update(
        JSON.stringify(
          mailbox === undefined ? [id, account] : [id, account, mailbox]
        )
      )
      .digest('hex');
  /** Require one safe nonnegative trusted epoch for lease/checkpoint decisions.

 * @returns {number} Validated current epoch milliseconds. */
  const timestamp = () => {
    /** One trusted clock read; unsafe values reject before writes. */
    const v = clock();
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new Error('Invalid mailbox sync clock');
    }
    return v;
  };
  /** Private empty generation-zero checkpoint bound to explicit account/folder scope. */
  const initial: MailboxSyncState = {
    id,
    account,
    ...(mailbox ? { mailbox } : {}),
    version: 1,
    epoch: 0,
    cursor: { afterUid: 0, ...(mailbox ? { mailbox } : {}) },
    lease: null,
    status: 'idle',
    pages: 0,
    received: 0,
    updatedAt: timestamp(),
    lastError: null,
  };
  let ready: Promise<void> | undefined;
  /** Coalesce lazy schema initialization and release failed initialization for later attempts.

 * @returns {Promise<void>} Borrowed database schema accepted; no connection is acquired. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Private native schema/read/write result checked before interpreting counts or rows. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 68,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Mailbox sync table unavailable');
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  /** Read one private checkpoint and verify its configured scope, revision, cursor and counter shape.
   * @returns {Promise<MailboxSyncState | null>} Validated private state including lease token, or null; not a public response.
   */
  async function lookup(): Promise<MailboxSyncState | null> {
    /** Private native schema/read/write result checked before interpreting counts or rows. */
    const r = await db.select({
      table,
      columns: ['id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: key },
      limit: 1,
    });
    if (!r?.ok || !Array.isArray(r.rows)) {
      throw new Error('Mailbox sync read failed');
    }
    /** One private persisted checkpoint row. */
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    /** Current committed private state used for exact revision/lease/epoch checks. */
    const s = JSON.parse(String(row.payload_json)) as MailboxSyncState;
    if (
      s.id !== id ||
      s.account !== account ||
      (mailbox !== undefined && s.mailbox !== mailbox) ||
      (s.mailbox !== undefined && s.cursor?.mailbox !== s.mailbox) ||
      !Number.isSafeInteger(s.version) ||
      s.version !== Number(row.version) ||
      s.version < 1 ||
      !Number.isSafeInteger(s.epoch) ||
      s.epoch < 0 ||
      !Number.isSafeInteger(s.cursor?.afterUid) ||
      s.cursor.afterUid < 0 ||
      (s.cursor.uidValidity !== undefined &&
        !/^\d+$/.test(s.cursor.uidValidity)) ||
      !Number.isSafeInteger(s.pages) ||
      s.pages < 0 ||
      !Number.isSafeInteger(s.received) ||
      s.received < 0 ||
      !['idle', 'running', 'failed'].includes(s.status)
    ) {
      throw new Error('Corrupt mailbox sync checkpoint');
    }
    return s;
  }
  /** Initialize schema/checkpoint once or observe the concurrently committed existing identity.
   * @returns {Promise<MailboxSyncState>} Current private committed state; no native ownership transfer.
   */
  async function read() {
    await ensure();
    /** Current private checkpoint observed while renewing a live lease. */
    const state = await lookup();
    if (state) {
      return state;
    }
    try {
      /** Private native schema/read/write result checked before interpreting counts or rows. */
      const r = await db.insert({
        table,
        values: { id: key, version: 1, payload_json: JSON.stringify(initial) },
      });
      if (r?.ok) {
        return structuredClone(initial);
      }
    } catch (error) {
      /** Existing committed identity observed after losing create-only initialization. */
      const concurrent = await lookup();
      if (concurrent) {
        return concurrent;
      }
      throw error;
    }
    /** Existing committed identity observed after losing create-only initialization. */
    const concurrent = await lookup();
    if (concurrent) {
      return concurrent;
    }
    throw new Error('Mailbox sync initialization failed');
  }
  /** Increment one exact committed revision and require an actual zero/one native affected count.
   * @param {MailboxSyncState} s - Current private committed checkpoint, including lease metadata.
   * @param {Omit<MailboxSyncState, 'version'>} patch - Complete next-state fields; this helper owns the version increment.
   * @returns {Promise<boolean>} True only for one committed update; stale revision returns false.
   */
  async function cas(
    s: MailboxSyncState,
    patch: Omit<MailboxSyncState, 'version'>
  ) {
    /** Complete candidate next checkpoint with caller/owned revision generation updates. */
    const next = { ...patch, version: s.version + 1 };
    /** Private native schema/read/write result checked before interpreting counts or rows. */
    const r = await db.update({
      table,
      values: { version: next.version, payload_json: JSON.stringify(next) },
      where: {
        and: [
          { field: 'id', operator: 'eq', value: key },
          { field: 'version', operator: 'eq', value: s.version },
        ],
      },
    });
    if (!r?.ok) {
      throw new Error('Mailbox sync write failed');
    }
    /** Exact native zero/one CAS count; unknown/multiple rows reject. */
    const count = r.affectedCount ?? r.rowCount;
    if (!Number.isSafeInteger(count) || (count !== 0 && count !== 1)) {
      throw new Error('Mailbox sync requires atomic affectedCount');
    }
    return count === 1;
  }
  /** Remove the private lease token while retaining explicit checkpoint/worker/expiry metadata.
   * @param {MailboxSyncState} s - Private committed checkpoint.
   * @returns {Omit<MailboxSyncState, "lease"> & {lease: {owner: string, expiresAt: number} | null}} Host-private token-free projection; not an automatically authorized HTTP response. */
  const publicState = (s: MailboxSyncState) => ({
    ...s,
    lease: s.lease
      ? { owner: s.lease.owner, expiresAt: s.lease.expiresAt }
      : null,
  });
  /** Claim a random token and increasing epoch only when no unexpired lease is present.
   * @param {string} owner - Validated host worker label; random lease token/epoch provide separate ownership fencing.
   * @returns {Promise<{owner: string, token: string, epoch: number} | null>} Private lease or busy null; finite contention rejects.
   */
  async function acquire(owner: string) {
    if (!validName(owner)) {
      throw new TypeError('Invalid sync worker');
    }
    // Reload exact committed state on contention; never overwrite a live or newer lease.
    for (let i = 0; i < 20; i++) {
      /** Current committed private state used for exact revision/lease/epoch checks. */
      const s = await read();
      /** Validated epoch captured for this lease/checkpoint transition. */
      const t = timestamp();
      if (s.lease && s.lease.expiresAt > t) {
        return null;
      }
      /** New generation that fences all stale runs and resets. */
      const epoch = s.epoch + 1;
      /** Private active ownership token/epoch; never a client role capability. */
      const lease = { owner, token: randomUUID(), expiresAt: t + leaseMs };
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
    throw new Error('Mailbox sync lease contention');
  }
  /** Require running status, matching epoch/owner/token and an unexpired lease before commit.
   * @param {MailboxSyncState} s - Current private committed state.
   * @param {{owner: string, token: string, epoch: number}} l - Private run ownership claim.
   * @param {string} l.owner - Host worker identity bound to this private run.
   * @param {string} l.token - Private random lease claim, never public response data.
   * @param {number} l.epoch - Exact lease/reset generation.
   * @returns {boolean} Whether this run still owns the current committed lease. */
  const owns = (
    s: MailboxSyncState,
    l: {
      /** Host worker label; not a user role or permission. */
      owner: string; /** Random private lease identity; never exposed by get/run/reset state projections. */
      token: string; /** Monotonic lease/reset generation fencing stale worker completions. */
      epoch: number;
    }
  ) =>
    s.status === 'running' &&
    s.epoch === l.epoch &&
    s.lease?.owner === l.owner &&
    s.lease.token === l.token &&
    s.lease.expiresAt > timestamp();
  /** Own a renewal timer/chain while one borrowed receiver poll runs, then fence scope/epoch/token before checkpoint commit.
   * @param {string} owner - Validated host worker label; random lease token/epoch provide separate ownership fencing.
   * @returns {Promise<object>} Token-free state with busy flag; lost ownership discards completion and never overwrites a newer cursor.
   */
  async function runOnce(owner: string) {
    /** Private active ownership token/epoch; never a client role capability. */
    const lease = await acquire(owner);
    if (!lease) {
      return { busy: true, state: publicState(await read()) };
    }
    let active = true,
      lost: unknown,
      heartbeat = Promise.resolve();
    /** Per-run renewal interval removed on every terminal path; outstanding renewal promises are awaited. */
    const timer = setInterval(
      () => {
        if (!active || lost) {
          return;
        }
        heartbeat = heartbeat
          .then(async () => {
            // Renew only the same live token/epoch through bounded revision-CAS attempts.
            for (let i = 0; i < 12; i++) {
              /** Current private checkpoint observed while renewing a live lease. */
              const state = await read();
              if (!owns(state, lease)) {
                throw new Error('Mailbox sync lease lost');
              }
              if (
                await cas(state, {
                  ...state,
                  lease: { ...state.lease!, expiresAt: timestamp() + leaseMs },
                  updatedAt: timestamp(),
                })
              ) {
                return;
              }
            }
            throw new Error('Mailbox sync renewal contention');
          })
          .catch((error) => {
            lost = error;
          });
      },
      Math.max(1000, Math.floor(leaseMs / 3))
    );
    timer.unref?.();
    try {
      /** Current committed private state used for exact revision/lease/epoch checks. */
      const s = await read();
      if (!owns(s, lease)) {
        throw new Error('Mailbox sync lease lost');
      }
      /** Borrowed receiver result independently checked before advancing the durable cursor. */
      const result = await receiver.poll(account, {
        cursor: { ...s.cursor },
        ...(mailbox ? { mailbox } : {}),
      });
      active = false;
      clearInterval(timer);
      await heartbeat;
      if (lost) {
        throw lost;
      }
      if (
        !result?.nextCursor ||
        (mailbox !== undefined && result.nextCursor.mailbox !== mailbox) ||
        (s.mailbox !== undefined && result.nextCursor.mailbox !== s.mailbox) ||
        !Number.isSafeInteger(result.nextCursor.afterUid) ||
        result.nextCursor.afterUid < s.cursor.afterUid ||
        !/^\d+$/.test(result.nextCursor.uidValidity ?? '') ||
        !Number.isSafeInteger(result.stored) ||
        result.stored < 0
      ) {
        throw new Error('Invalid receiver cursor or result');
      }
      /** Fresh committed checkpoint reread after poll/renewal settlement. */
      const latest = await read();
      if (!owns(latest, lease)) {
        throw new Error('Mailbox sync lease lost');
      }
      /** Validated epoch captured for this lease/checkpoint transition. */
      const t = timestamp();
      /** Complete candidate next checkpoint with caller/owned revision generation updates. */
      const next = {
        ...latest,
        ...(result.nextCursor.mailbox
          ? { mailbox: result.nextCursor.mailbox }
          : {}),
        status: 'idle' as const,
        lease: null,
        cursor: result.nextCursor,
        pages: latest.pages + 1,
        received: latest.received + result.stored,
        updatedAt: t,
        lastError: null,
      };
      if (!(await cas(latest, next))) {
        throw new Error('Mailbox sync checkpoint lost');
      }
      return {
        busy: false,
        state: publicState({ ...next, version: latest.version + 1 }),
      };
    } catch (error) {
      active = false;
      clearInterval(timer);
      await heartbeat;
      // Mark failure only while this run still owns the lease; stale owners leave newer state intact.
      for (let i = 0; i < 8; i++) {
        /** Current checkpoint inspected for an owned failure transition; stale owners cannot clear newer leases. */
        const current = await read();
        if (!owns(current, lease)) {
          break;
        }
        if (
          await cas(current, {
            ...current,
            lease: null,
            status: 'failed',
            lastError: 'POLL_FAILED',
            updatedAt: timestamp(),
          })
        ) {
          break;
        }
      }
      throw error;
    } finally {
      active = false;
      clearInterval(timer);
    }
  }
  /** Reset only after trusted operator investigation and external authorization, refusing a live worker lease.
   * @returns {Promise<object>} Token-free reset state with increased epoch; never an automatic UIDVALIDITY repair.
   */
  async function resetCursor() {
    // Administrative resets also use finite CAS attempts and refuse live native work ownership.
    for (let i = 0; i < 15; i++) {
      /** Current committed private state used for exact revision/lease/epoch checks. */
      const s = await read();
      /** Validated epoch captured for this lease/checkpoint transition. */
      const t = timestamp();
      if (s.lease && s.lease.expiresAt > t) {
        throw new Error('Mailbox sync worker active');
      }
      /** Complete candidate next checkpoint with caller/owned revision generation updates. */
      const next = {
        ...s,
        mailbox,
        epoch: s.epoch + 1,
        cursor: { afterUid: 0, ...(mailbox ? { mailbox } : {}) },
        lease: null,
        status: 'idle' as const,
        updatedAt: t,
        lastError: null,
      };
      if (await cas(s, next)) {
        return publicState({ ...next, version: s.version + 1 });
      }
    }
    throw new Error('Mailbox sync reset contention');
  }
  return { get: async () => publicState(await read()), runOnce, resetCursor };
}

/** Resolve only an explicit registered id/account reference; queue data cannot carry credentials or message content.
 * @param {(
    id: string,
    account: string
  ) =>
    | ReturnType<typeof createDatabaseMailboxSync>
    | Promise<ReturnType<typeof createDatabaseMailboxSync>>} resolve - Trusted explicit application registry lookup; never arbitrary package/module discovery.
 * @returns {(job: {data?: unknown}, workerId: string) => Promise<object>} Borrowed coordinator invocation; resolver must enforce host tenant/worker authorization.
 */
export function createIncomingSyncProcessor(
  resolve: (
    id: string,
    account: string
  ) =>
    | ReturnType<typeof createDatabaseMailboxSync>
    | Promise<ReturnType<typeof createDatabaseMailboxSync>>
) {
  if (typeof resolve !== 'function') {
    throw new TypeError('Mailbox sync resolver required');
  }
  return async (
    job: {
      /** Opaque job id/account reference only; arbitrary fields, bodies and secrets reject. */
      data?: unknown;
    },
    workerId: string
  ) => {
    if (
      !job?.data ||
      typeof job.data !== 'object' ||
      Array.isArray(job.data) ||
      Object.keys(job.data).length !== 2 ||
      !validName((job.data as any).id) ||
      !validName((job.data as any).account) ||
      !validName(workerId)
    ) {
      throw new TypeError('Mailbox sync task accepts only id and account');
    }
    /** Exact registered opaque queue reference; no credentials or content are forwarded. */
    const { id, account } = job.data as {
      /** Explicit host job identity; not authentication or arbitrary import selection. */
      id: string; /** Exact configured private receiver account; host owns tenant authorization. */
      account: string;
    };
    /** Explicit trusted registry result; only its declared runOnce is invoked. */
    const handler = await resolve(id, account);
    if (!handler || typeof handler.runOnce !== 'function') {
      throw new Error('Registered mailbox sync job missing');
    }
    return handler.runOnce(workerId);
  };
}
