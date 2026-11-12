import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabaseEmailDeliveryStore,
  createCampaignDeliveryReporter,
  createDurableEmailDeliveryProcessor,
} from '../dist/index.js';

/** Create isolated synthetic rows and conservative query/update operations.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function database() {
  /** Synthetic table rows or copied query results, scoped to one fixture. */
  const rows = new Map();
  let down = false;
  /** Synthetic structured-predicate evaluator; no arbitrary query DSL.
   * @param {object} row - Synthetic stored/query row.
   * @param {object} where - Allowlisted structured synthetic condition.
   * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
   */
  const conditions = (row, where) =>
    !where ||
    (where.and
      ? where.and.every((c) => conditions(row, c))
      : {
          eq: row[where.field] === where.value,
          gt: row[where.field] > where.value,
        }[where.operator]);
  return {
    rows,
    /** Toggle a declared fixture database outage; no production endpoint changes.
     * @param {unknown} value - Explicit synthetic stored value or outage mode.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    setDown(value) {
      down = value;
    },
    /** Initialize only the fixed synthetic in-memory table.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async createTable() {
      return { ok: true };
    },
    /** Return the explicit synthetic index-creation receipt without native storage.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async createIndex() {
      return { ok: true };
    },
    /** Insert explicit synthetic rows or journal on the supplied pin; never a separate connection.
     * @param {object} input - Explicit structured synthetic operation.
     * @param {unknown} input.values - Explicit synthetic values field used by the tested query shape.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async insert({ values }) {
      if (rows.has(values.id)) {
        throw Error('duplicate');
      }
      rows.set(values.id, { ...values });
      return { ok: true };
    },
    /** Execute only the fixed synthetic structured query shapes and bounded projections.
     * @param {object} input - Explicit structured synthetic operation.
     * @param {unknown} input.where - Explicit synthetic where field used by the tested query shape.
     * @param {unknown} input.orderBy - Explicit synthetic orderBy field used by the tested query shape.
     * @param {unknown} input.limit - Explicit synthetic limit field used by the tested query shape.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async select({ where, orderBy, limit = 500 }) {
      if (down) {
        throw Error('database unavailable');
      }
      /** Copied bounded synthetic query rows before deterministic ordering. */
      const list = [...rows.values()].filter((row) => conditions(row, where));
      if (orderBy) {
        list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      }
      return { ok: true, rows: list.slice(0, limit) };
    },
    /** Apply an explicit synthetic conditional update or the declared unsupported-operation failure.
     * @param {object} input - Explicit structured synthetic operation.
     * @param {unknown} input.where - Explicit synthetic where field used by the tested query shape.
     * @param {unknown} input.values - Explicit synthetic values field used by the tested query shape.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async update({ where, values }) {
      if (down) {
        throw Error('database unavailable');
      }
      let n = 0;
      // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
      for (const [id, row] of rows) {
        if (conditions(row, where)) {
          rows.set(id, { ...row, ...values });
          n++;
        }
      }
      return { ok: true, affectedCount: n };
    },
  };
}
/** Observed original-channel or destructive disposition with distinct guarantees.
 * @param {number} i - Deterministic synthetic record sequence.
 * @param {string} state - Explicit synthetic delivery state.
 * @param {string} campaignId - Opaque synthetic campaign scope.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const delivery = (i, state = 'pending', campaignId = 'campaignA') => ({
  id: `message${String(i).padStart(5, '0')}`,
  version: 1,
  purpose: 'marketing',
  campaignId,
  recipient: 'hidden@example.test',
  state,
  lease: null,
  updatedAt: 1000 + i,
});

test('database delivery records use atomic CAS and support durable delivery worker', async () => {
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = database();
  /** First isolated connector/store/service owner used for concurrency checks. */
  const a = createDatabaseEmailDeliveryStore(db);
  /** Second isolated connector/store/service used for actual contention checks. */
  const b = createDatabaseEmailDeliveryStore(db);
  assert.equal(await a.create(delivery(1)), true);
  assert.equal(await b.create(delivery(1)), false);
  /** First operation/record/page used as the normal concurrency control. */
  const first = await a.load('message00001');
  assert.equal(
    await a.save(first.id, { ...first, version: 2, state: 'claimed' }, 1),
    true
  );
  assert.equal(
    await b.save(first.id, { ...first, version: 2, state: 'sent' }, 1),
    false
  );
  await assert.rejects(
    a.save(first.id, { ...first, version: 3, campaignId: 'campaignOther' }, 2),
    /routing identity/
  );
  /** Observed post-CAS synthetic state from a second store. */
  const found = await b.load('message00001');
  assert.equal(found.state, 'claimed');
  /** Explicit allowlisted fixture processor; handlers are never discovered from source strings. */
  const processor = createDurableEmailDeliveryProcessor({
    store: a,
    isSubscribed: async () => true,
    send: async () => {},
    now: () => 2000,
  });
  assert.deepEqual(
    await processor({
      name: 'email.deliver',
      data: { messageId: 'message00001' },
    }),
    { status: 'sent' }
  );
  assert.equal((await b.load('message00001')).state, 'sent');
});

test('exact campaign counts beyond 500 rows, explicit incomplete scans, and date totals', async () => {
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = database();
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createDatabaseEmailDeliveryStore(db);
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (let i = 0; i < 1103; i++) {
    await store.create(
      delivery(
        i,
        (() => {
          if (i % 7 === 0) {
            return 'uncertain';
          } else {
            if (i % 4 === 0) {
              return 'suppressed';
            } else {
              return 'sent';
            }
          }
        })()
      )
    );
  }
  await store.create(delivery(99999, 'sent', 'campaignOther'));
  /** Observed operation outcome compared with explicit fixture expectations. */
  const result = await createCampaignDeliveryReporter({
    source: store,
    pageSize: 123,
    maxRecords: 1103,
  })('campaignA');
  assert.equal(result.scanned, 1103);
  assert.equal(result.complete, true);
  assert.equal(
    result.counts.sent + result.counts.suppressed + result.counts.uncertain,
    1103
  );
  assert.ok(result.sentPercent > 0);
  assert.equal(result.days.length, 1);
  assert.equal(JSON.stringify(result).includes('hidden@example.test'), false);
  assert.equal(JSON.stringify(result).includes('message00001'), false);
  /** Coverage-labelled truncated synthetic result; never exact total claims. */
  const partial = await createCampaignDeliveryReporter({
    source: store,
    pageSize: 200,
    maxRecords: 500,
  })('campaignA');
  assert.equal(partial.scanned, 500);
  assert.equal(partial.complete, false);
  assert.equal(partial.sentPercent, null);
  /** Independent synthetic campaign/source used to prove scope isolation. */
  const other = await createCampaignDeliveryReporter({ source: store })(
    'campaignOther'
  );
  assert.equal(other.scanned, 1);
  assert.equal(other.counts.sent, 1);
});

test('activity counts are coverage-labelled, optional, and never infer absent activity is zero engagement', async () => {
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = database();
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createDatabaseEmailDeliveryStore(db);
  await store.create(delivery(1, 'sent'));
  await store.create(delivery(2, 'sent'));
  /** Observed bounded coverage-labelled synthetic report. */
  const report = await createCampaignDeliveryReporter({
    source: store,
    activity: {
      get: async (id) =>
        id === 'message00001'
          ? {
              opens: 3,
              clicks: 2,
              downloadClicks: 1,
              downloads: 1,
              downloadedBytes: 2500,
            }
          : null,
    },
  })('campaignA');
  assert.equal(report.activity.coverage, 'available-summaries-only');
  assert.equal(report.activity.summariesAvailable, 1);
  assert.equal(report.activity.uniqueOpens, 1);
  assert.equal(report.activity.opens, 3);
  assert.equal(report.activity.downloadedBytes, 2500);
});

test('connector errors, corrupt index fields and out of scope rows fail closed', async () => {
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = database();
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createDatabaseEmailDeliveryStore(db);
  await store.create(delivery(1, 'sent'));
  db.setDown(true);
  await assert.rejects(
    createCampaignDeliveryReporter({ source: store })('campaignA'),
    /unavailable/
  );
  db.setDown(false);
  db.rows.get('message00001').campaign_id = 'campaignB';
  await assert.rejects(store.load('message00001'), /mismatch/);
  await assert.rejects(
    createCampaignDeliveryReporter({
      source: {
        pageCampaign: async () => [
          { ...delivery(1, 'sent'), campaignId: 'campaignOther' },
        ],
      },
    })('campaignA'),
    /out-of-scope|unordered/
  );
});
