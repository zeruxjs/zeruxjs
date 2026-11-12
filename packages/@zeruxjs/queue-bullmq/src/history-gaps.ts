/** Append-only *observations* of missing/stale delivery history. This ledger NEVER
 * backdates or invents transitions: it records a snapshot discrepancy separately. */
import { createHash } from 'node:crypto';
import type { CampaignDeliverySource, DeliveryDatabase } from './reporting.js';
import type { EmailDeliveryHistoryEntry } from './history.js';
import type { EmailDeliveryState } from './delivery.js';

/** Conservative opaque campaign syntax; tenant authorization remains host-owned. */
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Conservative opaque delivery identity and scan-cursor syntax. */
const msgPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Finite durable state vocabulary; discrepancies never synthesize transitions. */
const states = [
  'pending',
  'claimed',
  'sending',
  'sent',
  'suppressed',
  'uncertain',
  'rejected',
] as const;
export interface DeliveryHistoryGap {
  /** SHA-256 campaign/message/version observation identity; not proof of permission. */
  id: string;
  /** Opaque host-authorized campaign reference. */
  campaignId: string;
  /** Private opaque delivery reference; never publish in aggregate analytics. */
  messageId: string;
  /** Positive current durable delivery revision observed by the scan. */
  deliveryVersion: number;
  /** Known current durable state, not an invented historical transition. */
  currentState: EmailDeliveryState;
  /** Latest known journal revision, or null when history is absent. */
  lastRecordedVersion: number | null;
  /** Latest known journal state, or null when history is absent. */
  lastRecordedState: EmailDeliveryState | null;
  /** Missing journal entry versus stale revision/state comparison. */
  kind: 'missing' | 'stale';
  /** Observation epoch milliseconds; never backdated as a transition timestamp. */
  observedAt: number;
}
/** Borrow a durable database for append-only discrepancy observations. These are private operational facts, not reconstructed transitions; the host owns authorization and connector disposal.
 * @param {DeliveryDatabase} db - Borrowed create/insert/select facade scoped by the host.
 * @param {string} table - Conservative host-selected table name; defaults to zerux_email_history_gaps.
 * @returns {object} Lazy ledger with record/page operations; no separate connection owner.
 */
export function createDatabaseDeliveryHistoryGapLedger(
  db: DeliveryDatabase,
  table = 'zerux_email_history_gaps'
) {
  if (
    !db ||
    !['createTable', 'insert', 'select'].every(
      (k) => typeof (db as any)[k] === 'function'
    ) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(table)
  ) {
    throw new TypeError('Invalid history gap store');
  }
  let initialized: Promise<void> | undefined;
  /** Share lazy schema initialization; clear a rejected initialization for later explicit retry.
   * @returns {Promise<void>} Explicit lookup/validation result; durable failures reject.
   */
  const ensure = () =>
    (initialized ??= (async () => {
      /** Structured durable operation receipt; dependency failures are not empty successful data. */
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
          { name: 'payload_json', type: 'text', notNull: true },
        ],
      });
      if (!r?.ok) {
        throw new Error('History discrepancy ledger unavailable');
      }
      if (db.createIndex) {
        try {
          await db.createIndex({
            table,
            name: `${table.slice(0, 39)}_campaign_idx`,
            columns: ['campaign_id', 'id'],
            ifNotExists: true,
          });
        } catch {
          /* optional */
        }
      }
    })().catch((e) => {
      initialized = undefined;
      throw e;
    }));
  /** Load one observation for replay comparison and verify identity columns against its JSON.
   * @param {string} id - Private ledger identity or existing observation to compare.
   * @returns {Promise<DeliveryHistoryGap | null>} Explicit lookup/validation result; durable failures reject.
   */
  const read = async (id: string): Promise<DeliveryHistoryGap | null> => {
    await ensure();
    /** Structured durable operation receipt; dependency failures are not empty successful data. */
    const r = await db.select({
      table,
      columns: ['id', 'campaign_id', 'message_id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: id },
      limit: 1,
    });
    if (!r?.ok || !Array.isArray(r.rows)) {
      throw new Error('History gap lookup unavailable');
    }
    if (!r.rows.length) {
      return null;
    }
    /** Private durable row; never emit directly as a public aggregate. */
    const row = r.rows[0] as Record<string, unknown>;
    /** Parsed private observation checked against indexed identity columns; not a full schema parser. */
    const v = JSON.parse(String(row.payload_json)) as DeliveryHistoryGap;
    if (
      v.id !== id ||
      v.messageId !== row.message_id ||
      v.campaignId !== row.campaign_id ||
      v.deliveryVersion !== Number(row.version)
    ) {
      throw new Error('Corrupt history gap');
    }
    return v;
  };
  return {
    /** Record one observed discrepancy per campaign/message/version. An identical replay retains the first observation time; conflicting facts reject. Insert failure is checked against durable state before classifying replay.
     * @param {Omit<DeliveryHistoryGap, 'id' | 'observedAt'>} value - Validated discrepancy facts excluding generated identity/time.
     * @param {number} observedAt - Safe nonnegative observation epoch milliseconds, default Date.now(); not the missing transition time.
     * @returns {Promise<boolean>} True for a new observation, false for matching replay; unavailable/corrupt storage rejects.
     */
    async record(
      value: Omit<DeliveryHistoryGap, 'id' | 'observedAt'>,
      observedAt = Date.now()
    ) {
      if (
        !campaignPattern.test(value.campaignId) ||
        !msgPattern.test(value.messageId) ||
        !Number.isSafeInteger(value.deliveryVersion) ||
        value.deliveryVersion < 1 ||
        !['missing', 'stale'].includes(value.kind) ||
        !states.includes(value.currentState) ||
        (value.lastRecordedState !== null &&
          !states.includes(value.lastRecordedState)) ||
        (value.lastRecordedVersion !== null &&
          (!Number.isSafeInteger(value.lastRecordedVersion) ||
            value.lastRecordedVersion < 1)) ||
        !Number.isSafeInteger(observedAt) ||
        observedAt < 0
      ) {
        throw new TypeError('Invalid history observation');
      }
      /** Deterministic campaign/message/revision hash binding one immutable discrepancy. */
      const id = createHash('sha256')
        .update(
          value.campaignId +
            '\0' +
            value.messageId +
            '\0' +
            value.deliveryVersion
        )
        .digest('hex');
      /** New observation carrying current facts and the first observation time. */
      const entry: DeliveryHistoryGap = { ...value, id, observedAt };
      await ensure();
      /** Compare immutable facts while intentionally ignoring replay observation timestamps.
       * @param {DeliveryHistoryGap} existing - Private ledger identity or existing observation to compare.
       * @returns {void} Explicit lookup/validation result; durable failures reject.
       */
      const equivalent = (existing: DeliveryHistoryGap) => {
        /** Existing observation facts without its first-seen timestamp. */
        const { observedAt: a, ...one } = existing;
        /** Candidate facts without the later replay timestamp. */
        const { observedAt: b, ...two } = entry;
        if (JSON.stringify(one) !== JSON.stringify(two)) {
          throw new Error(
            'Conflicting history observation for delivery version'
          );
        }
      };
      try {
        /** Structured durable operation receipt; dependency failures are not empty successful data. */
        const r = await db.insert({
          table,
          values: {
            id,
            campaign_id: value.campaignId,
            message_id: value.messageId,
            version: value.deliveryVersion,
            payload_json: JSON.stringify(entry),
          },
        });
        if (r?.ok) {
          return true;
        }
      } catch (error) {
        /** Persisted observation used to distinguish matching replay from insertion failure. */
        const existing = await read(id);
        if (!existing) {
          throw error;
        }
        equivalent(existing);
        return false;
      }
      /** Persisted observation used to distinguish matching replay from insertion failure. */
      const existing = await read(id);
      if (existing) {
        equivalent(existing);
        return false;
      }
      throw new Error('History gap insertion unavailable');
    },
    /** Read a bounded campaign-scoped discrepancy page in hash-ID order. This private API checks row scope but does not fully validate every stored JSON field; storage and access must remain trusted.
     * @param {string} campaignId - Host-authorized opaque campaign scope.
     * @param {object} [options] - Optional bounded pagination.
     * @param {string|null} [options.cursor] - Exclusive hash continuation.
     * @param {number} [options.limit] - Default 100; maximum 200.
     * @returns {Promise<object>} Private entries, next cursor and terminal flag; no snapshot-consistency guarantee.
     */
    async page(
      campaignId: string,
      {
        cursor = null,
        limit = 100,
      }: {
        /** Exclusive ordered continuation; null begins a bounded page. */
        cursor?: string | null;
        /** Finite page size; defaults100 and rejects above200. */
        limit?: number;
      } = {}
    ) {
      if (
        !campaignPattern.test(campaignId) ||
        (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200
      ) {
        throw new TypeError('Invalid gap scan');
      }
      await ensure();
      /** Structured campaign constraint plus optional exclusive hash continuation. */
      const where: any[] = [
        { field: 'campaign_id', operator: 'eq', value: campaignId },
      ];
      if (cursor) {
        where.push({ field: 'id', operator: 'gt', value: cursor });
      }
      /** Structured durable operation receipt; dependency failures are not empty successful data. */
      const r = await db.select({
        table,
        columns: ['id', 'campaign_id', 'message_id', 'version', 'payload_json'],
        where: { and: where },
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit: limit + 1,
      });
      if (!r?.ok || !Array.isArray(r.rows) || r.rows.length > limit + 1) {
        throw new Error('History gap scan unavailable');
      }
      /** A lookahead row signals another bounded page; never count it twice. */
      const more = r.rows.length > limit;
      /** Bounded private selected page; campaign scope checked before returning. */
      const rows = r.rows.slice(0, limit) as Record<string, unknown>[];
      // Inspect only the bounded page; never scan an unbounded delivery table.
      for (const row of rows) {
        if (row.campaign_id !== campaignId) {
          throw new Error('Out of scope gap row');
        }
      }
      return {
        entries: rows.map(
          (row) => JSON.parse(String(row.payload_json)) as DeliveryHistoryGap
        ),
        nextCursor: more ? String(rows.at(-1)!.id) : null,
        done: !more,
      };
    },
  };
}
/** Build an explicitly invoked, bounded comparison of current delivery rows and latest journal versions. Record discrepancies without backdating or inventing transitions; separate reads are not one atomic snapshot.
 * @param {object} options - Borrowed source, history, ledger and optional clock; host owns all lifetimes.
 * @param {CampaignDeliverySource} options.source - Ordered campaign-scoped source.
 * @param {object} options.history - Latest observed journal lookup.
 * @param {function} options.history.latest - Authorized latest-transition reader.
 * @param {object} options.ledger - Immutable discrepancy recorder.
 * @param {function} [options.now] - Optional observation clock.
 * @returns {function} Async paged scanner; the host authorizes each campaign and persists continuation if required.
 */
export function createDeliveryHistoryGapScanner(options: {
  /** Borrowed campaign-scoped durable delivery pager. */
  source: CampaignDeliverySource;
  /** Borrowed latest-transition lookup; does not imply transactional reads. */
  history: {
    /** Borrow the latest observed transition lookup; the host must authorize the campaign/message scope.
     * @param {string} campaignId - Authorized opaque campaign scope.
     * @param {string} messageId - Opaque durable message reference, never a recipient address.
     * @returns {Promise<EmailDeliveryHistoryEntry|null>} Latest known transition or null; absence does not prove no state change occurred.
     */
    latest(
      campaignId: string,
      messageId: string
    ): Promise<EmailDeliveryHistoryEntry | null>;
  };
  /** Borrowed append-only observation ledger; no automatic repair/delete. */
  ledger: ReturnType<typeof createDatabaseDeliveryHistoryGapLedger>;
  /** Optional host clock used only when recording an actual observation. */
  now?: () => number;
}) {
  if (
    !options?.source?.pageCampaign ||
    !options.history?.latest ||
    !options.ledger?.record
  ) {
    throw new TypeError('Invalid history scanner');
  }
  return async function scan(
    campaignId: string,
    {
      cursor = null,
      limit = 100,
    }: {
      /** Exclusive ordered continuation; null begins a bounded page. */
      cursor?: string | null;
      /** Finite page size; defaults100 and rejects above200. */
      limit?: number;
    } = {}
  ) {
    if (
      !campaignPattern.test(campaignId) ||
      (cursor !== null && !msgPattern.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new TypeError('Invalid history scan bounds');
    }
    /** Bounded private selected page; campaign scope checked before returning. */
    const rows = await options.source.pageCampaign(
      campaignId,
      cursor,
      limit + 1
    );
    if (!Array.isArray(rows) || rows.length > limit + 1) {
      throw new Error('Invalid history scan page');
    }
    let covered = 0,
      missing = 0,
      stale = 0,
      observationsCreated = 0,
      previous = cursor;
    /** Only the requested bounded delivery slice, excluding lookahead. */
    const selected = rows.slice(0, limit);
    // Inspect only the bounded page; never scan an unbounded delivery table.
    for (const row of selected) {
      if (
        !row ||
        !msgPattern.test(row.id) ||
        row.campaignId !== campaignId ||
        (previous !== null && row.id <= previous) ||
        !Number.isSafeInteger(row.version) ||
        row.version! < 1 ||
        !states.includes(row.state)
      ) {
        throw new Error(
          'History scanner requires versioned ordered delivery rows'
        );
      }
      previous = row.id;
      /** Latest recorded transition for this delivery; missing data remains explicit. */
      const last = await options.history.latest(campaignId, row.id);
      if (last && last.version === row.version && last.to === row.state) {
        covered++;
        continue;
      }
      /** Whether no journal entry exists or its version/state is stale. */
      const kind = last ? 'stale' : 'missing';
      if (kind === 'missing') {
        missing++;
      } else {
        stale++;
      }
      if (
        await options.ledger.record(
          {
            campaignId,
            messageId: row.id,
            deliveryVersion: row.version!,
            currentState: row.state,
            lastRecordedVersion: last?.version ?? null,
            lastRecordedState: last?.to ?? null,
            kind,
          },
          (options.now ?? Date.now)()
        )
      ) {
        observationsCreated++;
      }
    }
    /** A lookahead row signals another bounded page; never count it twice. */
    const more = rows.length > limit;
    return {
      campaignId,
      checked: selected.length,
      covered,
      missing,
      stale,
      observationsCreated,
      nextCursor: more ? selected.at(-1)!.id : null,
      done: !more,
      coverage: 'nontransactional-observed-discrepancies' as const,
      snapshotConsistent: false as const,
    };
  };
}
