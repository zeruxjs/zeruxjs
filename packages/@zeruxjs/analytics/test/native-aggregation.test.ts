import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, aggregateEventCounts } from '../dist/index.js';

/** Synthetic boundary timestamp; UTC millisecond semantics are intentional. */
const at = Date.UTC(2026, 9, 11, 23, 59, 59, 999);
/** Create an isolated SQLite or injected database fixture with explicit teardown/fault controls.
 * @returns {object} Isolated fixture values for the following assertions.
 */
function database() {
  /** Synthetic source rows retained only in this fixture. */
  const records = [];
  let fail = false;
  /** Borrowed synthetic facade or owned in-memory SQLite connector. */
  const conn = {
    async createTable() {
      return { ok: true };
    },
    async insert({ values }) {
      records.push(values);
      return { ok: true };
    },
    async select(op) {
      if (fail) {
        return { ok: false, error: { code: 'OFFLINE' } };
      }
      if (
        op.columns?.some((c) => typeof c === 'object' && c.as === 'event_count')
      ) {
        /** Structured conditions interpreted by the injected adapter. */
        const filters = op.where?.and ?? (op.where ? [op.where] : []);
        /** Bounded fixture query rows, not production data. */
        const rows = records.filter((row) =>
          filters.every((f) => {
            if (f.operator === 'eq') {
              return row[f.field] === f.value;
            } else {
              if (f.operator === 'gte') {
                return row[f.field] >= f.value;
              } else {
                return row[f.field] <= f.value;
              }
            }
          })
        );
        /** Native COUNT descriptor verified before fixture aggregation. */
        const counter = op.columns[op.columns.length - 1];
        assert.equal(counter.expr.kind, 'function');
        assert.equal(counter.expr.name, 'COUNT');
        if (!op.groupBy) {
          return { ok: true, rows: [{ event_count: rows.length }] };
        }
        /** Allowlisted grouping column chosen by the production query translator. */
        const field = op.groupBy[0];
        /** Native aggregate result, independent of displayed group truncation. */
        const totals = new Map();
        // Count only eligible synthetic rows by the allowlisted grouping column.
        for (const row of rows) {
          totals.set(row[field], (totals.get(row[field]) ?? 0) + 1);
        }
        return {
          ok: true,
          rows: [...totals]
            .map(([category, event_count]) => ({ category, event_count }))
            .sort(
              (a, b) =>
                b.event_count - a.event_count ||
                a.category.localeCompare(b.category)
            )
            .slice(0, op.limit),
        };
      }
      return { ok: true, rows: [] };
    },
  };
  /** Synthetic named connection registry used by the fixture. */
  const manager = {
    connectionSlugs: ['reporting'],
    getConnectionFacade() {
      return conn;
    },
  };
  return {
    records,
    conn,
    manager,
    setOffline(value) {
      fail = value;
    },
  };
}
test('exact grouping reads all 1200+ events instead of stopping at 500', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = database();
  /** Manager configured only against the fixture-owned or injected database. */
  const analytics = createAnalytics({
    analytics: 'reporting',
    database: db.manager,
    onWarning: () => {},
  });
  await analytics.initialize();
  // load independently to avoid spending time generating thousands of UUIDs
  for (let i = 0; i < 1203; i++) {
    db.records.push({
      id: String(i),
      event_name: i % 3 === 0 ? 'purchase' : 'view',
      source: 'web',
      site: i % 2 ? 'site-b' : 'site-a',
      pathname: '/',
      occurred_at: at,
      properties_json: '{}',
    });
  }
  /** Whole-filter persisted count checked beyond the legacy recent-row cap. */
  const all = await analytics.aggregate({ groupBy: 'event' });
  assert.equal(all.total, 1203);
  assert.deepEqual(all.groups, [
    { category: 'view', value: 802 },
    { category: 'purchase', value: 401 },
  ]);
  assert.equal(all.mode, 'database');
  assert.equal(all.truncated, false);
  /** Explicitly filtered event/site aggregate. */
  const narrow = await analytics.aggregate({
    groupBy: 'event',
    name: 'purchase',
    site: 'site-a',
  });
  assert.equal(narrow.total, 201);
  assert.deepEqual(narrow.groups, [{ category: 'purchase', value: 201 }]);
  /** Group/page limit receipt used to assert truncation independently of totals. */
  const limit = await analytics.aggregate({ groupBy: 'event', limit: 1 });
  assert.equal(limit.total, 1203);
  assert.equal(limit.truncated, true);
  assert.equal(limit.groups.length, 1);
});
test('exact UTC day intervals handle midnight and inclusive millisecond boundaries', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = database();
  db.records.push(
    ...[at, at + 1, at + 2, at + 86400000].map((stamp, i) => ({
      id: String(i),
      event_name: 'view',
      source: 'web',
      site: 'app',
      pathname: '/',
      occurred_at: stamp,
      properties_json: '{}',
    }))
  );
  /** Actual operation receipt checked by the following assertions. */
  const result = await aggregateEventCounts(db.conn, 'analytics_events', {
    groupBy: 'day',
    since: at,
    until: at + 2,
  });
  assert.equal(result.total, 3);
  assert.deepEqual(result.groups, [
    { category: '2026-10-11', value: 1 },
    { category: '2026-10-12', value: 2 },
  ]);
  assert.equal(result.truncated, false);
});
test('offline native aggregation rejects rather than reporting fabricated zero counts', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = database();
  /** First fixture manager, worker or response in the scoped comparison. */
  const a = createAnalytics({ analytics: 'reporting', database: db.manager });
  db.setOffline(true);
  await assert.rejects(a.aggregate({ groupBy: 'event' }), /unavailable/);
});
test('rejects invalid group dimensions, time ranges, unsafe filters and nonnumeric counts', async () => {
  /** Isolated fixture database or injected facade for this test. */
  const db = database();
  // Each invalid dimension/window/filter/count request must reject rather than fabricate totals.
  for (const q of [
    { groupBy: '__proto__' },
    { groupBy: 'event', site: 'test\nX' },
    { groupBy: 'event', since: 4, until: 3 },
    { groupBy: 'day', since: at },
    { groupBy: 'day', since: 0, until: Date.UTC(2026, 9, 12) },
    { groupBy: 'event', limit: 501 },
  ]) {
    await assert.rejects(aggregateEventCounts(db.conn, 'analytics_events', q));
  }
  /** Injected malformed or failed dependency used for fail-closed checks. */
  const broken = {
    select: async () => ({ ok: true, rows: [{ event_count: 'bad' }] }),
  };
  await assert.rejects(
    aggregateEventCounts(broken, 'analytics_events', { groupBy: 'event' }),
    /Invalid analytics count/
  );
});
