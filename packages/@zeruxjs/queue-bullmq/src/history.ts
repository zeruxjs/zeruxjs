/** Durable append-only journal of observed email state transitions.
 * The journal does not imply atomicity with the materialized delivery document. */
import { createHash } from 'node:crypto';
import type { DeliveryDatabase, CampaignDeliverySource } from './reporting.js';
import type {
  DurableEmailDeliveryRecord,
  DurableEmailDeliveryStore,
  EmailDeliveryState,
} from './delivery.js';

/** Conservative fixed host table-name grammar. */
const tablePattern = /^[a-z][a-z0-9_]{0,62}$/;
/** Conservative campaign syntax; tenant permission checks remain host-owned. */
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Opaque durable delivery and source-continuation syntax. */
const messagePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Finite observed state vocabulary; not every state must exist in history. */
export const deliveryHistoryStates = [
  'pending',
  'claimed',
  'sending',
  'sent',
  'suppressed',
  'uncertain',
  'rejected',
] as const;
export interface EmailDeliveryTransition {
  /** Opaque private message reference; not recipient identity. */
  messageId: string;
  /** Host-authorized campaign scope; syntax alone grants no access. */
  campaignId: string;
  /** Positive immutable materialized delivery revision observed at transition time. */
  version: number;
  /** Previous known state or null for an initial insertion. */
  from: EmailDeliveryState | null;
  /** Observed next state in the fixed durable vocabulary. */
  to: EmailDeliveryState;
  /** Validated transition epoch milliseconds from persisted state/host clock. */
  occurredAt: number;
}
export interface EmailDeliveryHistoryEntry extends EmailDeliveryTransition {
  /** SHA-256 message/version identity; not proof of authorship or authorization. */
  id: string;
}
/** Validate safe supported epoch milliseconds before date arithmetic.
 * @param {unknown} n - Internal private journal fact or trusted UTC input.
 * @returns {n is number} Validated comparison/lookup result; malformed or unavailable state rejects.
 */
const validDate = (n: unknown): n is number =>
  typeof n === 'number' &&
  Number.isSafeInteger(n) &&
  n >= 0 &&
  n < 8_640_000_000_000_000;
/** Reject malformed identity, revision, state or timestamp before durable journal insertion.
 * @param {EmailDeliveryTransition} e - Validated immutable transition facts; not a recipient or message body.
 * @returns {void} Explicit durable result or failure; private payloads are not returned in aggregate projections.
 */
function validate(e: EmailDeliveryTransition) {
  if (
    !e ||
    !messagePattern.test(e.messageId) ||
    !campaignPattern.test(e.campaignId) ||
    !Number.isSafeInteger(e.version) ||
    e.version < 1 ||
    (e.from !== null && !deliveryHistoryStates.includes(e.from)) ||
    !deliveryHistoryStates.includes(e.to) ||
    !validDate(e.occurredAt)
  ) {
    throw new TypeError('Invalid delivery transition');
  }
}
/** Derive deterministic message/version identity without including message content.
 * @param {EmailDeliveryTransition} e - Internal private journal fact or trusted UTC input.
 * @returns {string} Validated comparison/lookup result; malformed or unavailable state rejects.
 */
const eventKey = (e: EmailDeliveryTransition) =>
  createHash('sha256')
    .update(e.messageId + '\0' + e.version)
    .digest('hex');
/** Create lazy append-only observed transition storage on a borrowed database. Index creation is optional; journal/state atomicity is not implied.
 * @param {DeliveryDatabase} db - Borrowed durable create/insert/select facade; host owns authorization and close.
 * @param {string} table - Host-selected conservative table name; defaults to zerux_email_delivery_history.
 * @returns {object} Explicit durable result or failure; private payloads are not returned in aggregate projections.
 */
export function createDatabaseEmailDeliveryHistory(
  db: DeliveryDatabase,
  table = 'zerux_email_delivery_history'
) {
  if (
    !db ||
    !['createTable', 'insert', 'select'].every(
      (k) => typeof (db as any)[k] === 'function'
    ) ||
    !tablePattern.test(table)
  ) {
    throw new TypeError('Invalid history database');
  }
  let ready: Promise<void> | undefined;
  /** Share lazy schema initialization; clear rejected initialization for a later explicit retry.
   * @returns {Promise<void>} Validated comparison/lookup result; malformed or unavailable state rejects.
   */
  const ensure = () =>
    (ready ??= (async () => {
      /** Structured native result; failed reads/inserts never become empty successful data. */
      const r = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 64,
            primary: true,
            notNull: true,
          },
          { name: 'campaign_id', type: 'varchar', length: 96, notNull: true },
          { name: 'message_id', type: 'varchar', length: 128, notNull: true },
          { name: 'version', type: 'bigint', notNull: true },
          { name: 'from_state', type: 'varchar', length: 32 },
          { name: 'to_state', type: 'varchar', length: 32, notNull: true },
          { name: 'occurred_at', type: 'bigint', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('Delivery history table unavailable');
      }
      if (db.createIndex) {
        // Iterate only fixed indexes, bounded pages, known groups or the validated UTC window.
        for (const [name, columns] of [
          ['campaign_day_idx', ['campaign_id', 'occurred_at']],
          ['message_version_idx', ['campaign_id', 'message_id', 'version']],
        ] as const) {
          try {
            await db.createIndex({
              table,
              name: `${table.slice(0, 37)}_${name}`,
              columns: [...columns],
              ifNotExists: true,
            });
          } catch {
            /* Optional index. */
          }
        }
      }
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  /** Fixed private journal projection; no arbitrary caller column names. */
  const columns = [
    'id',
    'campaign_id',
    'message_id',
    'version',
    'from_state',
    'to_state',
    'occurred_at',
  ];
  /** Decode and validate identity/state/time columns and expected transition hash.
   * @param {unknown} raw - Internal private journal fact or trusted UTC input.
   * @returns {EmailDeliveryHistoryEntry} Validated comparison/lookup result; malformed or unavailable state rejects.
   */
  const decode = (raw: unknown): EmailDeliveryHistoryEntry => {
    /** Private durable record or grouped row; never include it in public aggregate logs. */
    const row = raw as Record<string, unknown>;
    /** Validated immutable transition facts decoded from durable columns. */
    const entry: EmailDeliveryHistoryEntry = {
      id: String(row.id),
      campaignId: String(row.campaign_id),
      messageId: String(row.message_id),
      version: Number(row.version),
      from:
        row.from_state === null || row.from_state === undefined
          ? null
          : (row.from_state as EmailDeliveryState),
      to: row.to_state as EmailDeliveryState,
      occurredAt: Number(row.occurred_at),
    };
    validate(entry);
    if (entry.id !== eventKey(entry)) {
      throw new Error('Invalid delivery history hash');
    }
    return entry;
  };
  /** Compare all immutable transition facts before treating a duplicate key as replay.
   * @param {EmailDeliveryHistoryEntry} a - Internal private journal fact or trusted UTC input.
   * @param {EmailDeliveryHistoryEntry} b - Internal private journal fact or trusted UTC input.
   * @returns {boolean} Validated comparison/lookup result; malformed or unavailable state rejects.
   */
  const equal = (a: EmailDeliveryHistoryEntry, b: EmailDeliveryHistoryEntry) =>
    a.messageId === b.messageId &&
    a.campaignId === b.campaignId &&
    a.version === b.version &&
    a.from === b.from &&
    a.to === b.to &&
    a.occurredAt === b.occurredAt;
  /** Insert one immutable message/version transition, resolving identical replay by durable lookup and rejecting conflicting facts. Unknown insertion failure is not silently accepted.
   * @param {EmailDeliveryTransition} event - Observed immutable state transition, not an inferred event.
   * @returns {Promise<boolean>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
   */
  async function record(event: EmailDeliveryTransition): Promise<boolean> {
    validate(event);
    await ensure();
    /** Deterministic immutable message/version identity. */
    const id = eventKey(event);
    /** Private transition snapshot plus deterministic identity for replay comparison. */
    const candidate = { ...event, id };
    /** Reload the precise durable identity after an insertion conflict/failure.
     * @returns {Promise<EmailDeliveryHistoryEntry|null>} Validated comparison/lookup result; malformed or unavailable state rejects.
     */
    const lookup = async () => {
      /** Structured native result; failed reads/inserts never become empty successful data. */
      const r = await db.select({
        table,
        columns,
        where: { field: 'id', operator: 'eq', value: id },
        limit: 1,
      });
      if (!r?.ok || !Array.isArray(r.rows)) {
        throw new Error('Delivery history lookup failed');
      }
      return r.rows.length ? decode(r.rows[0]) : null;
    };
    try {
      /** Structured native result; failed reads/inserts never become empty successful data. */
      const r = await db.insert({
        table,
        values: {
          id,
          campaign_id: event.campaignId,
          message_id: event.messageId,
          version: event.version,
          from_state: event.from,
          to_state: event.to,
          occurred_at: event.occurredAt,
        },
      });
      if (r?.ok) {
        return true;
      }
    } catch (error) {
      /** Current persisted transition/delivery record used to verify replay or optimistic revision. */
      const old = await lookup();
      if (!old) {
        throw error;
      }
      if (!equal(old, candidate)) {
        throw new Error('Conflicting delivery transition replay');
      }
      return false;
    }
    /** Current persisted transition/delivery record used to verify replay or optimistic revision. */
    const old = await lookup();
    if (old) {
      if (!equal(old, candidate)) {
        throw new Error('Conflicting delivery transition replay');
      }
      return false;
    }
    throw new Error('Delivery history insert unavailable');
  }
  /** Read the latest known campaign/message transition with explicit scope verification; absence does not prove no transition occurred.
   * @param {string} campaignId - Host-authorized opaque campaign scope.
   * @param {string} messageId - Opaque private durable delivery reference.
   * @returns {Promise<EmailDeliveryHistoryEntry|null>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
   */
  async function latest(
    campaignId: string,
    messageId: string
  ): Promise<EmailDeliveryHistoryEntry | null> {
    if (!campaignPattern.test(campaignId) || !messagePattern.test(messageId)) {
      throw new TypeError('Invalid delivery history identity');
    }
    await ensure();
    /** Structured native result; failed reads/inserts never become empty successful data. */
    const r = await db.select({
      table,
      columns,
      where: {
        and: [
          { field: 'campaign_id', operator: 'eq', value: campaignId },
          { field: 'message_id', operator: 'eq', value: messageId },
        ],
      },
      orderBy: [{ by: 'version', direction: 'desc' }],
      limit: 1,
    });
    if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > 1) {
      throw new Error('Delivery history latest lookup unavailable');
    }
    /** Private durable record or grouped row; never include it in public aggregate logs. */
    const row = r.rows.length ? decode(r.rows[0]) : null;
    if (row && (row.messageId !== messageId || row.campaignId !== campaignId)) {
      throw new Error('Out-of-scope history lookup');
    }
    return row;
  }
  /** Read a bounded hash-ordered private transition page with one lookahead row; host authorizes access before calling.
   * @param {string} campaignId - Host-authorized opaque campaign scope.
   * @param {object} [options] - Optional bounded page settings.
   * @param {string|null} [options.cursor] - Exclusive hash continuation.
   * @param {number} [options.limit] - Default 100, maximum 500.
   * @returns {Promise<object>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
   */
  async function page(
    campaignId: string,
    {
      cursor = null,
      limit = 100,
    }: {
      /** Exclusive stable hash/message continuation appropriate to the operation. */
      cursor?: string | null;
      /** Bounded page limit; invalid/unbounded requests reject. */
      limit?: number;
    } = {}
  ) {
    if (
      !campaignPattern.test(campaignId) ||
      (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      throw new TypeError('Invalid delivery history scan');
    }
    await ensure();
    /** Structured mandatory campaign filter plus optional exclusive continuation. */
    const clauses: any[] = [
      { field: 'campaign_id', operator: 'eq', value: campaignId },
    ];
    if (cursor) {
      clauses.push({ field: 'id', operator: 'gt', value: cursor });
    }
    /** Structured native result; failed reads/inserts never become empty successful data. */
    const r = await db.select({
      table,
      columns,
      where: { and: clauses },
      orderBy: [{ by: 'id', direction: 'asc' }],
      limit: limit + 1,
    });
    if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > limit + 1) {
      throw new Error('Delivery history scan unavailable');
    }
    /** One lookahead row determines whether another bounded page is available. */
    const hasMore = r.rows.length > limit;
    /** Validated requested transition slice; lookahead is excluded. */
    const items = r.rows.slice(0, limit).map(decode);
    if (
      items.some(
        (v) =>
          v.campaignId !== campaignId || (cursor !== null && v.id <= cursor)
      )
    ) {
      throw new Error('Out of scope history row');
    }
    return {
      events: items,
      nextCursor: hasMore ? items.at(-1)!.id : null,
      done: !hasMore,
    };
  }
  /** Compare bounded current states against latest recorded state. Matching states do not prove every intermediate transition/version was journaled; concurrent processes do not provide a snapshot.
   * @param {string} campaignId - Host-authorized opaque campaign scope.
   * @param {CampaignDeliverySource} source - Borrowed ordered campaign delivery pager; not a transaction snapshot.
   * @param {object} options - Bounded optional exclusive cursor and page limit, default100 and maximum200.
   * @param {string|null} [options.cursor] - Exclusive delivery reference.
   * @param {number} [options.limit] - Default 100, maximum 200.
   * @returns {Promise<object>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
   */
  async function auditCurrent(
    campaignId: string,
    source: CampaignDeliverySource,
    options: {
      /** Exclusive stable hash/message continuation appropriate to the operation. */
      cursor?: string | null;
      /** Bounded page limit; invalid/unbounded requests reject. */
      limit?: number;
    } = {}
  ) {
    /** Validated exclusive ordered continuation, default null. */
    const cursor = options.cursor ?? null;
    /** Validated requested bounded audit count, default100. */
    const limit = options.limit ?? 100;
    if (
      !campaignPattern.test(campaignId) ||
      (cursor !== null && !messagePattern.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !source ||
      typeof source.pageCampaign !== 'function'
    ) {
      throw new TypeError('Invalid delivery history audit');
    }
    await ensure();
    /** Bounded current delivery page with one lookahead row. */
    const rows = await source.pageCampaign(campaignId, cursor, limit + 1);
    if (!Array.isArray(rows) || rows.length > limit + 1) {
      throw new Error('Invalid durable delivery audit page');
    }
    let covered = 0,
      missing = 0,
      stale = 0;
    /** Requested finite current-state slice, excluding lookahead. */
    const selected = rows.slice(0, limit);
    let previous = cursor;
    // Iterate only fixed indexes, bounded pages, known groups or the validated UTC window.
    for (const row of selected) {
      if (
        !row ||
        !messagePattern.test(row.id) ||
        row.campaignId !== campaignId ||
        (previous !== null && row.id <= previous) ||
        !deliveryHistoryStates.includes(row.state)
      ) {
        throw new Error('Out of scope or unordered delivery audit row');
      }
      previous = row.id;
      /** Latest journal lookup for this campaign/message; failure is distinct from absence. */
      const result = await db.select({
        table,
        columns,
        where: {
          and: [
            { field: 'campaign_id', operator: 'eq', value: campaignId },
            { field: 'message_id', operator: 'eq', value: row.id },
          ],
        },
        orderBy: [{ by: 'version', direction: 'desc' }],
        limit: 1,
      });
      if (
        !result?.ok ||
        !Array.isArray(result.rows) ||
        result.rows.length > 1
      ) {
        throw new Error('History audit lookup unavailable');
      }
      if (!result.rows.length) {
        missing++;
        continue;
      }
      /** Latest validated observed transition; only known state coverage is asserted. */
      const last = decode(result.rows[0]);
      if (last.messageId !== row.id || last.campaignId !== campaignId) {
        throw new Error('Out of scope history audit row');
      }
      // Metadata-only version increments do not create history transitions.
      // Matching states indicate latest-state coverage, not full version coverage.
      if (last.to === row.state) {
        covered++;
      } else {
        stale++;
      }
    }
    /** One lookahead row determines whether another bounded page is available. */
    const hasMore = rows.length > limit;
    return {
      campaignId,
      checked: selected.length,
      covered,
      missing,
      stale,
      complete: !hasMore,
      nextCursor: hasMore ? selected.at(-1)!.id : null,
      coverage: 'latest-observed-state-only' as const,
      snapshotConsistent: false as const,
    };
  }
  /** Query native per-state counts over at most92 inclusive UTC days. Only recorded transitions count; separate queries are not one pinned snapshot.
   * @param {string} campaignId - Host-authorized opaque campaign scope.
   * @param {string} from - Inclusive canonical UTC first day.
   * @param {string} to - Inclusive canonical UTC final day; maximum92 days inclusive.
   * @returns {Promise<object>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
   */
  async function trends(campaignId: string, from: string, to: string) {
    if (
      !campaignPattern.test(campaignId) ||
      !/\d{4}-\d{2}-\d{2}/.test(from) ||
      !/\d{4}-\d{2}-\d{2}/.test(to)
    ) {
      throw new TypeError('Invalid history trend range');
    }
    /** Require real canonical UTC calendar dates before bounded day iteration.
     * @param {string} s - Internal private journal fact or trusted UTC input.
     * @returns {number} Validated comparison/lookup result; malformed or unavailable state rejects.
     */
    const parse = (s: string) => {
      /** Validated canonical UTC epoch timestamp. */
      const t = Date.parse(s + 'T00:00:00.000Z');
      if (!validDate(t) || new Date(t).toISOString().slice(0, 10) !== s) {
        throw new TypeError('Invalid UTC day');
      }
      return t;
    };
    /** Inclusive UTC day start for bounded native trend queries. */
    const start = parse(from);
    /** Inclusive final UTC day start; limit includes both endpoints. */
    const end = parse(to);
    if (end < start || (end - start) / 86_400_000 > 91) {
      throw new RangeError('History report limited to 92 days');
    }
    await ensure();
    /** Bounded sequential aggregate results, not private delivery documents. */
    const days: {
      /** Canonical UTC day label, never the current build time. */
      day: string;
      /** Finite known state counts of recorded transitions, not unique recipients. */
      counts: Record<EmailDeliveryState, number>;
      /** Sum of recorded state counts in this UTC day. */
      total: number;
    }[] = [];
    // Iterate only fixed indexes, bounded pages, known groups or the validated UTC window.
    for (let t = start; t <= end; t += 86_400_000) {
      /** Structured native result; failed reads/inserts never become empty successful data. */
      const r = await db.select({
        table,
        columns: [
          { expr: { kind: 'column', name: 'to_state' }, as: 'state' },
          {
            expr: {
              kind: 'function',
              name: 'COUNT',
              args: [{ kind: 'column', name: 'id' }],
            },
            as: 'event_count',
          },
        ],
        where: {
          and: [
            { field: 'campaign_id', operator: 'eq', value: campaignId },
            { field: 'occurred_at', operator: 'gte', value: t },
            { field: 'occurred_at', operator: 'lt', value: t + 86_400_000 },
          ],
        },
        groupBy: ['to_state'],
        limit: deliveryHistoryStates.length + 1,
      });
      if (
        !r?.ok ||
        !Array.isArray(r.rows) ||
        r.rows.length > deliveryHistoryStates.length
      ) {
        throw new Error('History aggregation unavailable');
      }
      /** Finite known state totals initialized only after a successful native query. */
      const counts = Object.fromEntries(
        deliveryHistoryStates.map((v) => [v, 0])
      ) as Record<EmailDeliveryState, number>;
      /** Per-day finite set rejecting duplicate native state groups. */
      const seen = new Set<string>();
      // Iterate only fixed indexes, bounded pages, known groups or the validated UTC window.
      for (const raw of r.rows) {
        /** Private durable record or grouped row; never include it in public aggregate logs. */
        const row = raw as Record<string, unknown>;
        /** Native grouped state label checked against the fixed vocabulary. */
        const key = row.state;
        /** Strict safe positive native integer count; malformed/unsafe values reject. */
        const n =
          typeof row.event_count === 'string' && /^\d+$/.test(row.event_count)
            ? Number(row.event_count)
            : row.event_count;
        if (
          typeof key !== 'string' ||
          !deliveryHistoryStates.includes(key as EmailDeliveryState) ||
          seen.has(key) ||
          typeof n !== 'number' ||
          !Number.isSafeInteger(n) ||
          n < 1
        ) {
          throw new Error('Invalid history aggregate');
        }
        seen.add(key);
        counts[key as EmailDeliveryState] = n;
      }
      days.push({
        day: new Date(t).toISOString().slice(0, 10),
        counts,
        total: Object.values(counts).reduce((sum, n) => sum + n, 0),
      });
    }
    return {
      campaignId,
      from,
      to,
      days,
      coverage: 'recorded-transitions-only' as const,
      snapshotConsistent: false as const,
    };
  }
  return { record, page, latest, trends, auditCurrent };
}
/** Borrow a delivery store and append history after successful create/state-changing CAS. A journal failure may occur after state persistence and must be reconciled; this wrapper is not a cross-resource transaction.
 * @param {T} store - Borrowed CAS delivery store; its connector and disposal remain host-owned.
 * @param {object} history - Borrowed transition recorder; failures reject even when state already committed.
 * @param {function} history.record - Append an observed transition.
 * @param {() => number} now - Optional fallback epoch-millisecond clock, default Date.now.
 * @returns {object} Explicit durable result or failure; private payloads are not returned in aggregate projections.
 */
export function createJournaledEmailDeliveryStore<
  T extends DurableEmailDeliveryStore & {
    /** Optional borrowed unique-insert operation; absence rejects create calls. */
    create?: (row: DurableEmailDeliveryRecord) => Promise<boolean>;
  },
>(
  store: T,
  history: { record: (event: EmailDeliveryTransition) => Promise<boolean> },
  now: () => number = Date.now
) {
  if (
    !store ||
    typeof store.load !== 'function' ||
    typeof store.save !== 'function' ||
    typeof history?.record !== 'function'
  ) {
    throw new TypeError(
      'Journaled delivery store requires persistence and history'
    );
  }
  return {
    load: (id: string) => store.load(id),
    /** Insert a private delivery record then journal its initial campaign state only when insertion succeeded. Journal failure does not roll back the delivery insert.
     * @param {DurableEmailDeliveryRecord} row - Private versioned durable delivery record to insert.
     * @returns {Promise<boolean>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
     */
    async create(row: DurableEmailDeliveryRecord) {
      if (!store.create) {
        throw new Error('Delivery store does not support inserts');
      }
      /** Underlying unique-insert receipt; history records only successful inserts. */
      const inserted = await store.create(row);
      if (inserted && row.campaignId) {
        await history.record({
          messageId: row.id,
          campaignId: row.campaignId,
          version: row.version,
          from: null,
          to: row.state,
          occurredAt: row.updatedAt,
        });
      }
      return inserted;
    },
    /** Load the expected revision, perform underlying CAS, then journal an actual campaign state change. Metadata-only revisions do not invent transitions; a postcommit history failure rejects.
     * @param {string} id - Opaque private delivery reference; never a recipient address.
     * @param {DurableEmailDeliveryRecord} next - Next private delivery record matching the store revision contract.
     * @param {number} expectedVersion - Required optimistic current revision; stale updates return false.
     * @returns {Promise<boolean>} Explicit durable result or failure; private payloads are not returned in aggregate projections.
     */
    async save(
      id: string,
      next: DurableEmailDeliveryRecord,
      expectedVersion: number
    ) {
      /** Current persisted transition/delivery record used to verify replay or optimistic revision. */
      const old = await store.load(id);
      if (!old || old.version !== expectedVersion) {
        return false;
      }
      /** Underlying optimistic CAS receipt; history records only successful state changes. */
      const saved = await store.save(id, next, expectedVersion);
      if (saved && next.campaignId && old.state !== next.state) {
        await history.record({
          messageId: next.id,
          campaignId: next.campaignId,
          version: next.version,
          from: old.state,
          to: next.state,
          occurredAt: next.updatedAt ?? now(),
        });
      }
      return saved;
    },
  };
}
