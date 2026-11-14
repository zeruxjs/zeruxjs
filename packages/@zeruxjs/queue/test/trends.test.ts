import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseCampaignTrendsReporter } from '../dist/index.js';
/** Convert a fixed validated fixture UTC day to epoch milliseconds.
 * @param {string} day - Fixed UTC fixture day.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const stamp = (day) => Date.parse(day + 'T00:00:00Z');
/** Create deterministic synthetic grouped reporting data without live database access.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function fakeDb() {
  /** Fixture-local database tables; isolated from operator data. */
  const tables = new Map([
    ['zerux_email_delivery', []],
    ['zerux_email_provider_outcomes', []],
  ]);
  let offline = false,
    queries = 0,
    payloadRead = false;
  /** Synthetic bounded structured-condition evaluator, never arbitrary regex/client DSL.
   * @param {object} r - Synthetic row compared by the fixed structured predicate.
   * @param {object} w - Structured synthetic query predicate.
   * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
   */
  const matches = (r, w) =>
    (() => {
      if (w.and) {
        return w.and.every((x) => matches(r, x));
      } else {
        if (w.operator === 'eq') {
          return r[w.field] === w.value;
        } else {
          if (w.operator === 'gte') {
            return r[w.field] >= w.value;
          } else {
            if (w.operator === 'lt') {
              return r[w.field] < w.value;
            } else {
              return false;
            }
          }
        }
      }
    })();
  return {
    tables,
    /** Toggle the declared synthetic report-storage outage.
     * @param {unknown} v - Synthetic failure-mode switch.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    setOffline(v) {
      offline = v;
    },
    get queries() {
      return queries;
    },
    get payloadRead() {
      return payloadRead;
    },
    /** Execute only the fixed synthetic structured query shapes and bounded projections.
     * @param {object} input - Explicit structured synthetic operation.
     * @param {unknown} input.table - Explicit synthetic table field used by the tested query shape.
     * @param {unknown} input.where - Explicit synthetic where field used by the tested query shape.
     * @param {unknown} input.groupBy - Explicit synthetic groupBy field used by the tested query shape.
     * @param {unknown} input.columns - Explicit synthetic columns field used by the tested query shape.
     * @param {unknown} input.limit - Explicit synthetic limit field used by the tested query shape.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async select({ table, where, groupBy, columns, limit }) {
      if (offline) {
        throw Error('database is offline');
      }
      queries++;
      if (columns.some((c) => c === 'payload_json')) {
        payloadRead = true;
      }
      if (!tables.has(table)) {
        throw Error('missing source table');
      }
      /** Synthetic aggregate counts computed without private payload projection. */
      const groups = new Map();
      // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
      for (const row of tables.get(table)) {
        if (matches(row, where)) {
          groups.set(row[groupBy[0]], (groups.get(row[groupBy[0]]) ?? 0) + 1);
        }
      }
      return {
        ok: true,
        rows: [...groups]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(0, limit)
          .map(([category, event_count]) => ({ category, event_count })),
      };
    },
  };
}
/** Seed only synthetic count rows for the fixed reporting workload.
 * @param {object} db - Synthetic in-memory aggregate fixture.
 * @param {string} day - Fixed UTC fixture day.
 * @param {number} number - Explicit finite synthetic row count.
 * @param {string} campaign - Opaque synthetic campaign label.
 * @param {string} state - Explicit synthetic delivery state.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const add = (db, day, number, campaign = 'fall', state = 'sent') => {
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (let i = 0; i < number; i++) {
    db.tables.get('zerux_email_delivery').push({
      id: `${campaign}_${day}_${i}`,
      campaign_id: campaign,
      state,
      updated_at: stamp(day) + i,
    });
  }
};
/** Seed one synthetic provider notification independent of SMTP acceptance.
 * @param {object} db - Synthetic in-memory aggregate fixture.
 * @param {string} day - Fixed UTC fixture day.
 * @param {string} campaign - Opaque synthetic campaign label.
 * @param {string} kind - Fixed provider outcome kind.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const outcome = (db, day, campaign = 'fall', kind = 'delivered') =>
  db.tables.get('zerux_email_provider_outcomes').push({
    id: `${campaign}_${day}_${kind}`,
    campaign_id: campaign,
    kind,
    occurred_at: stamp(day) + 1,
  });
test('database-native daily counts avoid capped row scans, isolate campaigns and count notifications separately', async () => {
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = fakeDb();
  add(db, '2026-10-11', 110_013);
  add(db, '2026-10-12', 1023);
  add(db, '2026-10-12', 77, 'another');
  outcome(db, '2026-10-11');
  outcome(db, '2026-10-11', 'another');
  outcome(db, '2026-10-12', 'fall', 'complaint');
  /** Observed bounded coverage-labelled synthetic report. */
  const report = await createDatabaseCampaignTrendsReporter({
    db,
    providerTable: 'zerux_email_provider_outcomes',
  })('fall', '2026-10-11', '2026-10-13');
  assert.equal(report.total, 111036);
  assert.equal(report.providerEvents, 2);
  assert.deepEqual(
    report.days.map((x) => x.total),
    [110013, 1023, 0]
  );
  assert.deepEqual(
    report.days.map((x) => x.providerEvents),
    [1, 1, 0]
  );
  assert.equal(report.deliveryCoverage, 'last-state-update-day');
  assert.equal(report.providerCoverage, 'reported-events-only');
  assert.equal(report.snapshotConsistent, false);
  assert.equal(db.queries, 6);
  assert.equal(db.payloadRead, false);
  /** Serialized sanitized report inspected for accidental private fields. */
  const encoded = JSON.stringify(report);
  assert.ok(!encoded.includes('id:'));
});
test('range validation rejects invalid dates and unbounded requests', async () => {
  /** Explicit bounded report callback, separate from statistical causality. */
  const trends = createDatabaseCampaignTrendsReporter({ db: fakeDb() });
  await assert.rejects(trends('fall', '2026-02-29', '2026-03-01'), /Invalid/);
  await assert.rejects(
    trends('fall', '2026-03-01', '2026-02-28'),
    /range|window/
  );
  await assert.rejects(trends('fall', '2026-01-01', '2026-10-01'), /window/);
  await assert.rejects(
    trends('../oops', '2026-10-01', '2026-10-02'),
    /Invalid/
  );
  await assert.rejects(trends('fall', '2026-10-1', '2026-10-02'), /Invalid/);
  /** Observed synthetic report/response result. */
  const r = await trends('fall', '2026-10-01', '2026-10-01');
  assert.equal(r.providerEvents, null);
  assert.equal(r.days[0].provider, null);
});
test('unavailable storage and corrupt grouping fail rather than inventing zero', async () => {
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = fakeDb();
  db.setOffline(true);
  await assert.rejects(
    createDatabaseCampaignTrendsReporter({ db })(
      'fall',
      '2026-10-01',
      '2026-10-02'
    ),
    /offline/
  );
  /** Deliberately corrupt grouped-count fixture; must fail instead of zero-filling. */
  const corrupt = {
    select: async () => ({
      ok: true,
      rows: [{ category: 'unrecognized', event_count: 2 }],
    }),
  };
  await assert.rejects(
    createDatabaseCampaignTrendsReporter({ db: corrupt })(
      'fall',
      '2026-10-01',
      '2026-10-01'
    ),
    /category/
  );
  /** Deliberately unsafe count fixture proving numeric precision limits. */
  const overflow = {
    select: async () => ({
      ok: true,
      rows: [{ category: 'sent', event_count: '9007199254740999' }],
    }),
  };
  await assert.rejects(
    createDatabaseCampaignTrendsReporter({ db: overflow })(
      'fall',
      '2026-10-01',
      '2026-10-01'
    ),
    /count/
  );
});
