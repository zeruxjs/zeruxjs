/** A durable, DB-backed queue publish-intent ledger.
 * Registration commits before Redis publish. This is recoverable at-least-once
 * queue publication, NOT a cross-database/Redis transaction or exactly-once SMTP. */
import { randomUUID } from 'node:crypto';
import type { DeliveryDatabase } from './reporting.js';
import type { ZeruxQueue, JobProcessor } from './index.js';
import type { DurableEmailDeliveryStore } from './delivery.js';

/** Conservative opaque message/cursor syntax, separate from host authorization. */
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Conservative fixed host-selected ledger table syntax. */
const tableName = /^[a-z][a-z0-9_]{0,62}$/;
/** Require safe supported epoch milliseconds for schedules and leases.
 * @param {unknown} n - Internal intent fact, lease or private native record.
 * @returns {n is number} Explicit validated disposition; failures do not prove a mutation was rolled back.
 */
const validTime = (n: unknown): n is number =>
  typeof n === 'number' &&
  Number.isSafeInteger(n) &&
  n >= 0 &&
  n <= 8_640_000_000_000_000;
export type DeliveryOutboxStatus =
  | 'pending'
  | 'leased'
  | 'published'
  | 'abandoned';
export interface DeliveryOutboxIntent {
  /** Opaque durable message reference; queue payloads contain only this value. */
  id: string;
  /** Positive optimistic durable revision; CAS rejects stale changes. */
  version: number;
  /** Reference publication state, distinct from SMTP delivery state. */
  status: DeliveryOutboxStatus;
  /** Immutable safe epoch milliseconds; not recomputed on replay. */
  scheduledAt: number;
  /** Immutable native job attempt budget, default3 and allowed1–20. */
  attempts: number;
  /** Active publication token/expiry only while status is leased; null otherwise. */
  lease: null | {
    /** Unpredictable per-claim lease token, not an authentication credential for HTTP. */
    token: string;
    /** Safe lease expiry epoch milliseconds; stale leases cannot settle. */
    expiresAt: number;
  };
  /** First durable registration epoch milliseconds. */
  createdAt: number;
  /** Latest intent revision epoch milliseconds. */
  updatedAt: number;
}
export interface DeliveryPublishOutbox {
  /** Persist an immutable publish intent before queue dispatch. Same identity/schedule/attempts returns the existing status; conflicting settings reject.
   * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
   * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
   * @param {number} options.scheduledAt - Immutable scheduled epoch milliseconds.
   * @param {number} [options.attempts] - Default 3, allowed 1–20.
   * @returns {Promise<{created:boolean;status:DeliveryOutboxStatus}>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  register(
    id: string,
    options: {
      /** Immutable safe epoch milliseconds; not recomputed on replay. */
      scheduledAt: number;
      /** Immutable native job attempt budget, default3 and allowed1–20. */
      attempts?: number;
    }
  ): Promise<{
    /** Whether this call created the immutable intent. */
    created: boolean;
    /** Reference publication state, distinct from SMTP delivery state. */
    status: DeliveryOutboxStatus;
  }>;
  /** Read a validated private intent by opaque reference; authorization and namespace separation remain host-owned.
   * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
   * @returns {Promise<DeliveryOutboxIntent|null>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  get(id: string): Promise<DeliveryOutboxIntent | null>;
  /** Read a finite ID-ordered validated page with one lookahead; default100, maximum250. This operation includes terminal records.
   * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
   * @param {string|null} [options.cursor] - Exclusive ID continuation.
   * @param {number} [options.limit] - Default 100, maximum 250.
   * @returns {Promise<object>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  page(options?: {
    /** Exclusive ordered opaque reference; null starts a bounded page. */
    cursor?: string | null;
    /** Default100; allowed1–250 with one lookahead row. */
    limit?: number;
  }): Promise<{
    /** Bounded validated intent page, not email content. */
    items: DeliveryOutboxIntent[];
    /** Exclusive continuation when another page is available; null when done. */
    nextCursor: string | null;
    /** True only when no lookahead row remains in this scan. */
    done: boolean;
  }>;
  /** Read pending or expired-leased records so terminal archives cannot starve dispatch. Future scheduledAt is passed to the native delayed queue, not polled with local timers.
   * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
   * @param {string|null} [options.cursor] - Exclusive ID continuation.
   * @param {number} [options.limit] - Default 100, maximum 250.
   * @returns {Promise<object>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  due(options?: {
    /** Exclusive ordered opaque reference; null starts a bounded page. */
    cursor?: string | null;
    /** Default100; allowed1–250 with one lookahead row. */
    limit?: number;
  }): Promise<{
    /** Bounded validated intent page, not email content. */
    items: DeliveryOutboxIntent[];
    /** Exclusive continuation when another page is available; null when done. */
    nextCursor: string | null;
    /** True only when no lookahead row remains in this scan. */
    done: boolean;
  }>;
  /** CAS-claim a pending/expired-leased intent with a new token; at most12 contention attempts. A lease alone does not prevent downstream duplicate publication.
   * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
   * @param {number} leaseMs - Exclusive publish lease duration, safe integer3000–3600000 milliseconds.
   * @returns {Promise<DeliveryOutboxIntent|null>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  claim(id: string, leaseMs: number): Promise<DeliveryOutboxIntent | null>;
  /** CAS-settle only the exact unexpired active lease, clearing its token; at most12 contention attempts. A false receipt does not prove queue publication failed.
   * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
   * @param {string} token - Exact active lease token from claim; cannot settle another or expired lease.
   * @param {'pending'|'published'|'abandoned'} status - Allowed terminal/deferred disposition for the current lease.
   * @returns {Promise<boolean>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  settle(
    id: string,
    token: string,
    status: 'pending' | 'published' | 'abandoned'
  ): Promise<boolean>;
  /** Reopen only a published intent through CAS, at most12 attempts. This low-level primitive has no authentication; expose it only through the authorized redriver.
   * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
   * @returns {Promise<boolean>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
   */
  reopen(id: string): Promise<boolean>;
}
/** Borrow a durable database for reference-only publish intents. Lazy schema/index setup and CAS do not make business-state/outbox/Redis writes one atomic transaction.
 * @param {DeliveryDatabase} db - Borrowed durable create/insert/select/update facade; host owns close and tenant scope.
 * @param {string} table - Validated host table name, default zerux_email_publish_outbox.
 * @param {() => number} now - Optional safe epoch-millisecond clock, default Date.now.
 * @returns {DeliveryPublishOutbox} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
 */
export function createDatabaseDeliveryOutbox(
  db: DeliveryDatabase,
  table = 'zerux_email_publish_outbox',
  now: () => number = Date.now
): DeliveryPublishOutbox {
  if (
    !db ||
    !['createTable', 'insert', 'select', 'update'].every(
      (name) => typeof (db as any)[name] === 'function'
    ) ||
    !tableName.test(table)
  ) {
    throw new TypeError('Invalid delivery outbox database');
  }
  /** Read and validate the injected clock before persisting temporal state.
   * @returns {number} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const clock = () => {
    /** Validated safe operation epoch milliseconds, not a synthetic historical time. */
    const t = now();
    if (!validTime(t)) {
      throw new Error('Invalid outbox clock');
    }
    return t;
  };
  let ready: Promise<void> | undefined;
  /** Share lazy table creation; a rejected initialization is cleared for explicit retry.
   * @returns {Promise<void>} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const ensure = () =>
    (ready ??= (async () => {
      /** Structured native receipt; failures never become successful empty state. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 128,
            primary: true,
            notNull: true,
          },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'status', type: 'varchar', length: 16, notNull: true },
          { name: 'lease_until', type: 'bigint' },
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Delivery outbox table unavailable');
      }
      if (db.createIndex) {
        try {
          await db.createIndex({
            table,
            name: `${table.slice(0, 42)}_status`,
            columns: ['status', 'id'],
            ifNotExists: true,
          });
        } catch {
          /* optimization only */
        }
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  /** Fixed private ledger projection including version and lease indexes. */
  const columns = ['id', 'version', 'status', 'lease_until', 'payload_json'];
  /** Check durable intent fields and consistency between leased state and token presence.
   * @param {DeliveryOutboxIntent} row - Internal intent fact, lease or private native record.
   * @returns {void} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const validate = (row: DeliveryOutboxIntent) => {
    if (
      !row ||
      !identifier.test(row.id) ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      !['pending', 'leased', 'published', 'abandoned'].includes(row.status) ||
      !validTime(row.scheduledAt) ||
      !Number.isSafeInteger(row.attempts) ||
      row.attempts < 1 ||
      row.attempts > 20 ||
      !validTime(row.createdAt) ||
      !validTime(row.updatedAt) ||
      (row.lease !== null &&
        (!row.lease ||
          !/^[-a-f0-9]{36}$/.test(row.lease.token) ||
          !validTime(row.lease.expiresAt))) ||
      (row.status === 'leased') !== (row.lease !== null)
    ) {
      throw new Error('Invalid durable outbox record');
    }
  };
  /** Parse private JSON and verify all denormalized identity/revision/status/lease columns.
   * @param {unknown} raw - Internal intent fact, lease or private native record.
   * @returns {DeliveryOutboxIntent} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const decode = (raw: unknown): DeliveryOutboxIntent => {
    /** Structured native receipt; failures never become successful empty state. */
    const r = raw as Record<string, unknown>;
    if (!r || typeof r.payload_json !== 'string') {
      throw new Error('Corrupt outbox payload');
    }
    /** Validated private intent decoded from its durable snapshot. */
    const entry = JSON.parse(r.payload_json) as DeliveryOutboxIntent;
    validate(entry);
    if (
      entry.id !== r.id ||
      entry.version !== Number(r.version) ||
      entry.status !== r.status ||
      (entry.lease?.expiresAt ?? null) !==
        (r.lease_until === null || r.lease_until === undefined
          ? null
          : Number(r.lease_until))
    ) {
      throw new Error('Outbox payload/index mismatch');
    }
    return entry;
  };
  /** Load exactly one validated intent by opaque identity.
   * @param {string} id - Internal intent fact, lease or private native record.
   * @returns {Promise<DeliveryOutboxIntent|null>} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const get = async (id: string) => {
    if (!identifier.test(id)) {
      throw new TypeError('Invalid outbox message ID');
    }
    await ensure();
    /** Structured native receipt; failures never become successful empty state. */
    const r = await db.select({
      table,
      columns,
      where: { field: 'id', operator: 'eq', value: id },
      limit: 1,
    });
    if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > 1) {
      throw new Error('Outbox read unavailable');
    }
    return r.rows.length ? decode(r.rows[0]) : null;
  };
  /** Perform a version-checked immutable-schedule CAS and require unambiguous affected-row counts.
   * @param {DeliveryOutboxIntent} old - Internal intent fact, lease or private native record.
   * @param {DeliveryOutboxIntent} next - Internal intent fact, lease or private native record.
   * @returns {Promise<boolean>} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const update = async (
    old: DeliveryOutboxIntent,
    next: DeliveryOutboxIntent
  ): Promise<boolean> => {
    if (
      next.id !== old.id ||
      next.version !== old.version + 1 ||
      next.scheduledAt !== old.scheduledAt ||
      next.attempts !== old.attempts
    ) {
      throw new Error('Invalid outbox transition');
    }
    validate(next);
    /** Structured native receipt; failures never become successful empty state. */
    const r = await db.update({
      table,
      values: {
        version: next.version,
        status: next.status,
        lease_until: next.lease?.expiresAt ?? null,
        payload_json: JSON.stringify(next),
      },
      where: {
        and: [
          { field: 'id', operator: 'eq', value: old.id },
          { field: 'version', operator: 'eq', value: old.version },
        ],
      },
    });
    if (!r?.ok) {
      throw new Error('Outbox CAS unavailable');
    }
    /** Validated affected-row count; only exactly one proves this CAS committed. */
    const affected = r.affectedCount ?? r.rowCount;
    if (
      typeof affected !== 'number' ||
      !Number.isSafeInteger(affected) ||
      affected < 0 ||
      affected > 1
    ) {
      throw new Error('Outbox requires atomic affectedCount');
    }
    return affected === 1;
  };
  return {
    get,
    /** Persist an immutable publish intent before queue dispatch. Same identity/schedule/attempts returns the existing status; conflicting settings reject.
     * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
     * @param {object} options - Immutable scheduled epoch milliseconds and optional attempts, default3.
     * @param {number} options.scheduledAt - Immutable scheduled epoch milliseconds.
     * @param {number} [options.attempts] - Default 3, allowed 1–20.
     * @returns {Promise<{created:boolean;status:DeliveryOutboxStatus}>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async register(id, { scheduledAt, attempts = 3 }) {
      if (
        !identifier.test(id) ||
        !validTime(scheduledAt) ||
        !Number.isSafeInteger(attempts) ||
        attempts < 1 ||
        attempts > 20
      ) {
        throw new TypeError('Invalid outbox intent');
      }
      /** Persisted immutable intent whose schedule/attempts must match a replay. */
      const existing = await get(id);
      // The schedule is immutable: callers must not silently reschedule a durable intent.
      if (existing) {
        if (
          existing.scheduledAt !== scheduledAt ||
          existing.attempts !== attempts
        ) {
          throw new Error('Conflicting delivery publish intent');
        }
        return { created: false, status: existing.status };
      }
      /** Validated safe operation epoch milliseconds, not a synthetic historical time. */
      const t = clock();
      /** Initial pending intent created before any queue publication. */
      const item: DeliveryOutboxIntent = {
        id,
        version: 1,
        status: 'pending',
        scheduledAt,
        attempts,
        lease: null,
        createdAt: t,
        updatedAt: t,
      };
      try {
        /** Structured native receipt; failures never become successful empty state. */
        const r = await db.insert({
          table,
          values: {
            id,
            version: 1,
            status: 'pending',
            lease_until: null,
            payload_json: JSON.stringify(item),
          },
        });
        if (r?.ok) {
          return { created: true, status: 'pending' };
        }
      } catch (error) {
        /** Current durable revision used for replay comparison or optimistic CAS. */
        const old = await get(id);
        if (!old) {
          throw error;
        }
        if (old.scheduledAt !== scheduledAt || old.attempts !== attempts) {
          throw new Error('Conflicting delivery publish intent');
        }
        return { created: false, status: old.status };
      }
      /** Current durable revision used for replay comparison or optimistic CAS. */
      const old = await get(id);
      if (old && old.scheduledAt === scheduledAt && old.attempts === attempts) {
        return { created: false, status: old.status };
      }
      throw new Error('Outbox registration failed');
    },
    /** Read a finite ID-ordered validated page with one lookahead; default100, maximum250. This operation includes terminal records.
     * @param {object} options - Optional exclusive cursor and bounded page size, default100 and maximum250.
     * @param {string|null} [options.cursor] - Exclusive ID continuation.
     * @param {number} [options.limit] - Default 100, maximum 250.
     * @returns {Promise<object>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async page({
      cursor = null,
      limit = 100,
    }: {
      /** Exclusive ordered opaque reference; null starts a bounded page. */
      cursor?: string | null;
      /** Default100; allowed1–250 with one lookahead row. */
      limit?: number;
    } = {}) {
      if (
        (cursor !== null && !identifier.test(cursor)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 250
      ) {
        throw new TypeError('Invalid outbox scan bounds');
      }
      await ensure();
      /** Structured native receipt; failures never become successful empty state. */
      const r = await db.select({
        table,
        columns,
        ...(cursor
          ? { where: { field: 'id', operator: 'gt', value: cursor } }
          : {}),
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit: limit + 1,
      });
      if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > limit + 1) {
        throw new Error('Outbox scan unavailable');
      }
      /** One lookahead row indicates another finite page. */
      const more = r.rows.length > limit;
      /** Requested validated page excluding lookahead, checked for strict ordering. */
      const items = r.rows.slice(0, limit).map(decode);
      // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
      for (let i = 0; i < items.length; i++) {
        if (
          (cursor && items[i]!.id <= cursor) ||
          (i > 0 && items[i]!.id <= items[i - 1]!.id)
        ) {
          throw new Error('Outbox scan unordered');
        }
      }
      return { items, nextCursor: more ? items.at(-1)!.id : null, done: !more };
    },
    /** Read pending or expired-leased records so terminal archives cannot starve dispatch. Future scheduledAt is passed to the native delayed queue, not polled with local timers.
     * @param {object} options - Optional exclusive cursor and bounded page size, default100 and maximum250.
     * @param {string|null} [options.cursor] - Exclusive ID continuation.
     * @param {number} [options.limit] - Default 100, maximum 250.
     * @returns {Promise<object>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async due({
      cursor = null,
      limit = 100,
    }: {
      /** Exclusive ordered opaque reference; null starts a bounded page. */
      cursor?: string | null;
      /** Default100; allowed1–250 with one lookahead row. */
      limit?: number;
    } = {}) {
      if (
        (cursor !== null && !identifier.test(cursor)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 250
      ) {
        throw new TypeError('Invalid due outbox scan bounds');
      }
      await ensure();
      /** Validated safe operation epoch milliseconds, not a synthetic historical time. */
      const t = clock();
      /** Structured pending/expired-lease selector; no raw SQL or payload expressions. */
      const conditions: any[] = [
        { field: 'status', operator: 'eq', value: 'pending' },
        {
          and: [
            { field: 'status', operator: 'eq', value: 'leased' },
            { field: 'lease_until', operator: 'lte', value: t },
          ],
        },
      ];
      /** Mandatory due-state filters plus optional exclusive ID continuation. */
      const where = {
        and: [
          { or: conditions },
          ...(cursor ? [{ field: 'id', operator: 'gt', value: cursor }] : []),
        ],
      };
      /** Structured native receipt; failures never become successful empty state. */
      const r = await db.select({
        table,
        columns,
        where,
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit: limit + 1,
      });
      if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > limit + 1) {
        throw new Error('Outbox due scan unavailable');
      }
      /** One lookahead row indicates another finite page. */
      const more = r.rows.length > limit;
      /** Requested validated page excluding lookahead, checked for strict ordering. */
      const items = r.rows.slice(0, limit).map(decode);
      // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
      for (let i = 0; i < items.length; i++) {
        if (
          (items[i]!.status !== 'pending' &&
            !(
              items[i]!.status === 'leased' && items[i]!.lease!.expiresAt <= t
            )) ||
          (cursor && items[i]!.id <= cursor) ||
          (i > 0 && items[i]!.id <= items[i - 1]!.id)
        ) {
          throw new Error('Outbox due scan returned invalid records');
        }
      }
      return { items, nextCursor: more ? items.at(-1)!.id : null, done: !more };
    },
    /** CAS-claim a pending/expired-leased intent with a new token; at most12 contention attempts. A lease alone does not prevent downstream duplicate publication.
     * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
     * @param {number} leaseMs - Exclusive publish lease duration, safe integer3000–3600000 milliseconds.
     * @returns {Promise<DeliveryOutboxIntent|null>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async claim(id, leaseMs) {
      if (
        !Number.isSafeInteger(leaseMs) ||
        leaseMs < 3000 ||
        leaseMs > 3_600_000
      ) {
        throw new RangeError('Invalid publish lease');
      }
      // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
      for (let i = 0; i < 12; i++) {
        /** Current durable revision used for replay comparison or optimistic CAS. */
        const old = await get(id);
        if (!old) {
          return null;
        }
        /** Validated safe operation epoch milliseconds, not a synthetic historical time. */
        const t = clock();
        if (
          old.status === 'published' ||
          old.status === 'abandoned' ||
          (old.status === 'leased' && old.lease!.expiresAt > t)
        ) {
          return null;
        }
        /** Next immutable-schedule revision to publish through CAS. */
        const next: DeliveryOutboxIntent = {
          ...old,
          version: old.version + 1,
          status: 'leased',
          updatedAt: t,
          lease: { token: randomUUID(), expiresAt: t + leaseMs },
        };
        if (!validTime(next.lease!.expiresAt)) {
          throw new RangeError('Invalid outbox lease expiration');
        }
        if (await update(old, next)) {
          return next;
        }
      }
      throw new Error('Outbox claim contention');
    },
    /** Reopen only a published intent through CAS, at most12 attempts. This low-level primitive has no authentication; expose it only through the authorized redriver.
     * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
     * @returns {Promise<boolean>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async reopen(id) {
      // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
      for (let i = 0; i < 12; i++) {
        /** Current durable revision used for replay comparison or optimistic CAS. */
        const old = await get(id);
        if (!old || old.status !== 'published') {
          return false;
        }
        /** Next immutable-schedule revision to publish through CAS. */
        const next: DeliveryOutboxIntent = {
          ...old,
          version: old.version + 1,
          status: 'pending',
          lease: null,
          updatedAt: clock(),
        };
        if (await update(old, next)) {
          return true;
        }
      }
      throw new Error('Outbox redrive contention');
    },
    /** CAS-settle only the exact unexpired active lease, clearing its token; at most12 contention attempts. A false receipt does not prove queue publication failed.
     * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
     * @param {string} token - Exact active lease token from claim; cannot settle another or expired lease.
     * @param {'pending'|'published'|'abandoned'} status - Allowed terminal/deferred disposition for the current lease.
     * @returns {Promise<boolean>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async settle(id, token, status) {
      if (
        !/^[-a-f0-9]{36}$/.test(token) ||
        !['pending', 'published', 'abandoned'].includes(status)
      ) {
        throw new TypeError('Invalid outbox settlement');
      }
      // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
      for (let i = 0; i < 12; i++) {
        /** Current durable revision used for replay comparison or optimistic CAS. */
        const old = await get(id);
        if (
          !old ||
          old.status !== 'leased' ||
          old.lease?.token !== token ||
          old.lease.expiresAt <= clock()
        ) {
          return false;
        }
        /** Next immutable-schedule revision to publish through CAS. */
        const next: DeliveryOutboxIntent = {
          ...old,
          version: old.version + 1,
          status,
          lease: null,
          updatedAt: clock(),
        };
        if (await update(old, next)) {
          return true;
        }
      }
      throw new Error('Outbox settlement contention');
    },
  };
}
/** Create explicit bounded reference dispatch using a durable lease, current delivery check and stable BullMQ job ID. SMTP replay protection remains the delivery CAS; this helper owns no timer/connection.
 * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
 * @param {DeliveryPublishOutbox} options.outbox - Borrowed durable intent ledger.
 * @param {object} options.queue - Borrowed native producer.
 * @param {object} options.delivery - Borrowed durable delivery reader.
 * @param {function} options.now - Optional clock.
 * @param {number} options.leaseMs - Default 60000ms.
 * @returns {object} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
 */
export function createDeliveryOutboxDispatcher(options: {
  /** Borrowed durable reference ledger; host owns storage and tenant boundaries. */
  outbox: DeliveryPublishOutbox;
  /** Borrowed native producer/inspection facade; host owns its shutdown. */
  queue: Pick<ZeruxQueue, 'add'>;
  /** Borrowed current durable delivery reader, authoritative for SMTP replay fences. */
  delivery: Pick<DurableEmailDeliveryStore, 'load'>;
  /** Optional host epoch-millisecond clock; native timers are not created. */
  now?: () => number;
  /** Default60000ms publication lease, bounded3000–3600000ms. */
  leaseMs?: number;
}) {
  if (
    !options?.outbox ||
    typeof options.outbox.claim !== 'function' ||
    typeof options.outbox.settle !== 'function' ||
    typeof options.outbox.due !== 'function' ||
    typeof options.queue?.add !== 'function' ||
    typeof options.delivery?.load !== 'function'
  ) {
    throw new TypeError('Outbox dispatcher requires durable intent and queue');
  }
  /** Borrowed host clock; this helper creates no timers. */
  const now = options.now ?? Date.now;
  /** Validated finite publication lease, default60000ms. */
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 3000 || leaseMs > 3_600_000) {
    throw new RangeError('Invalid dispatcher lease');
  }
  /** Claim, check current delivery, publish only a reference and settle durable state.
   * @param {string} id - Internal intent fact, lease or private native record.
   * @returns {Promise<'skipped'|'deferred'|'abandoned'|'published'>} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const dispatch = async (id: string) => {
    /** CAS-acquired publication lease; absence means no work is owned. */
    const claim = await options.outbox.claim(id, leaseMs);
    if (!claim) {
      return 'skipped' as const;
    }
    /** Exact current lease token required by settlement. */
    const token = claim.lease!.token;
    try {
      {
        /** Current durable SMTP state; claimed work defers and sending/terminal work never republishes. */
        const state = await options.delivery.load(id);
        if (!state || state.id !== id) {
          throw new Error('Outbox message has no matching durable delivery');
        }
        // An in-flight (even expired) pre-SMTP claim requires the separate
        // recovery scanner before republishing; never abandon it forever.
        if (state.state === 'claimed') {
          if (!(await options.outbox.settle(id, token, 'pending'))) {
            throw new Error(
              'Lost outbox lease while deferring claimed delivery'
            );
          }
          return 'deferred' as const;
        }
        // Sending might have reached SMTP; terminal deliveries must never replay.
        if (state.state !== 'pending') {
          if (!(await options.outbox.settle(id, token, 'abandoned'))) {
            throw new Error('Lost outbox lease after skip');
          }
          return 'abandoned' as const;
        }
      }
      /** Validated dispatch clock used to derive the remaining native delay. */
      const time = now();
      if (!validTime(time)) {
        throw new Error('Invalid dispatch clock');
      }
      // Both job name and payload are fixed. PII must never be included in Redis.
      await options.queue.add(
        'email.deliver',
        { messageId: id },
        {
          jobId: id,
          delay: Math.max(0, claim.scheduledAt - time),
          attempts: claim.attempts,
        }
      );
      if (!(await options.outbox.settle(id, token, 'published'))) {
        // Queue accepted the job, but the DB acknowledgement is unknown. Safe to
        // retry the same stable BullMQ job ID; durable delivery CAS gates SMTP.
        throw new Error('Outbox acknowledgement lost after queue publication');
      }
      return 'published' as const;
    } catch (error) {
      try {
        await options.outbox.settle(id, token, 'pending');
      } catch {
        /* expired claims can be reclaimed */
      }
      throw error;
    }
  };
  /** Sequentially dispatch one bounded due page and report redacted aggregate dispositions.
   * @param {object} [options] - Bounded page settings.
   * @param {string|null} [options.cursor] - Exclusive ID continuation.
   * @param {number} [options.limit] - Default 100, maximum 250.
   * @returns {Promise<{scanned:number;published:number;skipped:number;abandoned:number;deferred:number;failed:number;nextCursor:string|null;done:boolean}>} Explicit validated disposition; failures do not prove a mutation was rolled back.
   */
  const runPage = async ({
    cursor = null,
    limit = 100,
  }: {
    /** Exclusive ordered opaque reference; null starts a bounded page. */
    cursor?: string | null;
    /** Default100; allowed1–250 with one lookahead row. */
    limit?: number;
  } = {}) => {
    /** Borrowed bounded due-intent page with an explicit continuation. */
    const page = await options.outbox.due({ cursor, limit });
    let published = 0,
      skipped = 0,
      abandoned = 0,
      deferred = 0,
      failed = 0;
    // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
    for (const item of page.items) {
      if (item.status === 'published' || item.status === 'abandoned') {
        skipped++;
        continue;
      }
      if (item.status === 'leased' && item.lease!.expiresAt > now()) {
        skipped++;
        continue;
      }
      try {
        /** Explicit dispatch/page disposition; unknown failures are counted without exposing payloads. */
        const result = await dispatch(item.id);
        if (result === 'published') {
          published++;
        } else if (result === 'abandoned') {
          abandoned++;
        } else if (result === 'deferred') {
          deferred++;
        } else {
          skipped++;
        }
      } catch {
        failed++;
      }
    }
    return {
      scanned: page.items.length,
      published,
      skipped,
      abandoned,
      deferred,
      failed,
      nextCursor: page.nextCursor,
      done: page.done,
    };
  };
  return { dispatch, runPage };
}
/** Return after durable intent registration, not Redis acceptance. Preserve immutable scheduledAt on replay and require an explicit scheduler to drain intents; optional immediate dispatch failures do not undo persistence.
 * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
 * @param {DeliveryPublishOutbox} options.outbox - Borrowed durable intent ledger.
 * @param {function} options.now - Optional clock.
 * @param {object} options.dispatch - Optional immediate dispatcher.
 * @param {function} options.dispatch.dispatch - Dispatch a registered reference.
 * @param {function} options.onDispatchFailure - Optional private-cause callback; host must redact.
 * @returns {object} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
 */
export function createOutboxBackedEmailQueue(options: {
  /** Borrowed durable reference ledger; host owns storage and tenant boundaries. */
  outbox: DeliveryPublishOutbox;
  /** Optional host epoch-millisecond clock; native timers are not created. */
  now?: () => number;
  /** Optional borrowed immediate dispatcher; failure does not erase durable acceptance. */
  dispatch?: {
    /** Attempt publication of an already registered opaque message reference; no caller-supplied destination/content is executed.
     * @param {string} id - Opaque durable message reference; not a recipient address or permission grant.
     * @returns {Promise<unknown>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    dispatch(id: string): Promise<unknown>;
  };
  /** Optional internal diagnostic callback; may receive private transport causes and must redact before logging. */
  onDispatchFailure?: (error: unknown) => void | Promise<void>;
}) {
  if (!options?.outbox || typeof options.outbox.register !== 'function') {
    throw new TypeError('Durable outbox required');
  }
  /** Borrowed host clock; this helper creates no timers. */
  const now = options.now ?? Date.now;
  return {
    /** Register one validated reference-only durable email intent and optionally attempt immediate dispatch. Success means persisted intent, not delivery or queue confirmation.
     * @param {string} name - Only the fixed email.deliver job name is accepted.
     * @param {{ messageId: string }} data - Reference-only payload containing the durable message ID; no private email content.
     * @param {string} data.messageId - Opaque private durable reference.
     * @param {{ jobId: string; delay: number; attempts: number }} settings - Matching stable job ID, finite relative delay and attempts1–20.
     * @param {string} settings.jobId - Matching stable message ID.
     * @param {number} settings.delay - Initial nonnegative delay milliseconds.
     * @param {number} settings.attempts - Immutable attempt budget, 1–20.
     * @returns {Promise<{id:string;persisted:boolean}>} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
     */
    async add(
      name: string,
      data: {
        /** Opaque durable reference; no recipients or SMTP credentials. */
        messageId: string;
      },
      settings: {
        /** Must equal the opaque durable message ID for native deduplication. */
        jobId: string;
        /** Safe nonnegative relative delay used only on initial intent registration. */
        delay: number;
        /** Immutable native job attempt budget, default3 and allowed1–20. */
        attempts: number;
      }
    ) {
      if (
        name !== 'email.deliver' ||
        !identifier.test(data?.messageId) ||
        settings?.jobId !== data.messageId ||
        !Number.isSafeInteger(settings.delay) ||
        settings.delay < 0 ||
        !Number.isSafeInteger(settings.attempts) ||
        settings.attempts < 1 ||
        settings.attempts > 20
      ) {
        throw new TypeError('Invalid durable email queue intent');
      }
      /** Persisted immutable intent whose schedule/attempts must match a replay. */
      const existing = await options.outbox.get(data.messageId);
      if (!existing) {
        /** Validated safe operation epoch milliseconds, not a synthetic historical time. */
        const t = now();
        if (!validTime(t) || !validTime(t + settings.delay)) {
          throw new Error('Invalid queued schedule');
        }
        await options.outbox.register(data.messageId, {
          scheduledAt: t + settings.delay,
          attempts: settings.attempts,
        });
      } else if (existing.attempts !== settings.attempts) {
        throw new Error('Conflicting delivery retry configuration');
      }
      if (options.dispatch) {
        try {
          await options.dispatch.dispatch(data.messageId);
        } catch (error) {
          try {
            await options.onDispatchFailure?.(error);
          } catch {
            /* no throwing after durable intent */
          }
        }
      }
      return { id: data.messageId, persisted: true };
    },
  };
}

/** Create an explicit host-authorized repair for a missing native queue job. Recheck published intent and pending delivery, then CAS-reopen; native inspection is not a distributed lock.
 * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
 * @param {DeliveryPublishOutbox} options.outbox - Borrowed durable intent ledger.
 * @param {object} options.delivery - Borrowed current-state reader.
 * @param {object} options.queue - Borrowed native job inspection.
 * @param {function} options.authorize - Required fresh host authorization.
 * @returns {function} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
 */
export function createDeliveryOutboxRedriver(options: {
  /** Borrowed durable reference ledger; host owns storage and tenant boundaries. */
  outbox: DeliveryPublishOutbox;
  /** Borrowed current durable delivery reader, authoritative for SMTP replay fences. */
  delivery: Pick<DurableEmailDeliveryStore, 'load'>;
  /** Borrowed native producer/inspection facade; host owns its shutdown. */
  queue: Pick<ZeruxQueue, 'getJob'>;
  /** Required fresh host permission check for each redrive; syntax is not authorization. */
  authorize: (id: string) => Promise<boolean> | boolean;
}) {
  if (
    !options?.outbox ||
    typeof options.outbox.reopen !== 'function' ||
    typeof options.delivery?.load !== 'function' ||
    typeof options.queue?.getJob !== 'function' ||
    typeof options.authorize !== 'function'
  ) {
    throw new TypeError(
      'Authenticated redrive requires outbox, delivery and queue'
    );
  }
  return async function redrive(id: string) {
    if (!identifier.test(id)) {
      throw new TypeError('Invalid outbox message identity');
    }
    if ((await options.authorize(id)) !== true) {
      throw new Error('Outbox redrive not authorized');
    }
    /** Private published intent checked again before authorized repair. */
    const row = await options.outbox.get(id);
    if (!row || row.status !== 'published') {
      return { reopened: false, reason: 'not-published' as const };
    }
    /** Current private delivery state; only pending state may be reopened. */
    const delivery = await options.delivery.load(id);
    if (!delivery || delivery.id !== id || delivery.state !== 'pending') {
      return { reopened: false, reason: 'not-pending' as const };
    }
    /** Native queue presence observation; not a lock or proof of delivery. */
    const job = await options.queue.getJob(id);
    if (job) {
      return { reopened: false, reason: 'queue-job-present' as const };
    }
    return {
      reopened: await options.outbox.reopen(id),
      reason: 'queue-job-missing' as const,
    };
  };
}

/** Create an opt-in processor for an empty email.outbox.poll payload. Scan bounded sequential pages and reject nonadvancing cursors; no recurring schedule is registered automatically.
 * @param {ReturnType<typeof createDeliveryOutboxDispatcher>} dispatcher - Borrowed explicit dispatcher; factory does not schedule or own its lifetime.
 * @param {object} options - Explicit borrowed dependencies or bounded page/poll settings; operation-specific fields below.
 * @param {number} options.pageSize - Default 100, maximum 250.
 * @param {number} options.maxPages - Default 10, maximum 100.
 * @returns {JobProcessor} Explicit persisted/queue disposition or failure; no exactly-once delivery guarantee.
 */
export function createDeliveryOutboxJobProcessor(
  dispatcher: ReturnType<typeof createDeliveryOutboxDispatcher>,
  options: {
    /** Default100, allowed1–250 intents per explicit poll page. */
    pageSize?: number;
    /** Default10, allowed1–100 sequential pages per poll invocation. */
    maxPages?: number;
  } = {}
): JobProcessor {
  if (!dispatcher || typeof dispatcher.runPage !== 'function') {
    throw new TypeError('Outbox dispatcher required');
  }
  /** Validated finite per-page bound, default100 and maximum250. */
  const pageSize = options.pageSize ?? 100;
  /** Validated sequential page ceiling, default10 and maximum100. */
  const maxPages = options.maxPages ?? 10;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 250 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  ) {
    throw new RangeError('Invalid outbox job scan limits');
  }
  return async (job) => {
    if (
      job.name !== 'email.outbox.poll' ||
      !job.data ||
      Object.keys(job.data).length !== 0
    ) {
      throw new TypeError('Outbox poll accepts no job payload');
    }
    let cursor: string | null = null,
      pages = 0,
      scanned = 0,
      published = 0,
      skipped = 0,
      abandoned = 0,
      deferred = 0,
      failed = 0,
      done = false;
    // Bound work by the validated page/attempt ceiling; CAS or continuation still decides progress.
    while (pages < maxPages) {
      /** Explicit dispatch/page disposition; unknown failures are counted without exposing payloads. */
      const result = await dispatcher.runPage({ cursor, limit: pageSize });
      pages++;
      scanned += result.scanned;
      published += result.published;
      skipped += result.skipped;
      abandoned += result.abandoned;
      deferred += result.deferred;
      failed += result.failed;
      if (result.done) {
        done = true;
        break;
      }
      if (!result.nextCursor || result.nextCursor === cursor) {
        throw new Error('Outbox scan cursor did not advance');
      }
      cursor = result.nextCursor;
    }
    return {
      pages,
      scanned,
      published,
      skipped,
      abandoned,
      deferred,
      failed,
      done,
      nextCursor: done ? null : cursor,
    };
  };
}
