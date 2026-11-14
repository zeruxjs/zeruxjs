import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabaseCampaignPerformanceReporter,
  createDatabaseProviderOutcomeLedger,
} from '../dist/index.js';

/** Create a minimal injected database supporting only the tested structured operations.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function db() {
  /** Fixture-local database tables; isolated from operator data. */
  const tables = new Map();
  let down = false;
  /** Conservative synthetic query predicate supporting only the tested structured operators.
   * @param {object} row - Synthetic stored/query row.
   * @param {object} w - Structured synthetic query predicate.
   * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
   */
  const filter = (row, w) =>
    !w || w.and
      ? (w?.and?.every((part) => filter(row, part)) ?? true)
      : row[w.field] === w.value;
  return {
    tables,
    /** Toggle a declared fixture database outage; no production endpoint changes.
     * @param {unknown} v - Synthetic failure-mode switch.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    setDown(v) {
      down = v;
    },
    /** Initialize only the fixed synthetic in-memory table.
     * @param {object} input - Explicit structured synthetic operation.
     * @param {unknown} input.table - Explicit synthetic table field used by the tested query shape.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async createTable({ table }) {
      if (!tables.has(table)) {
        tables.set(table, new Map());
      }
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
     * @param {unknown} input.table - Explicit synthetic table field used by the tested query shape.
     * @param {unknown} input.values - Explicit synthetic values field used by the tested query shape.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async insert({ table, values }) {
      if (down) {
        throw Error('offline');
      }
      /** Synthetic table rows or copied query results, scoped to one fixture. */
      const rows = tables.get(table);
      if (rows.has(values.id)) {
        throw Error('duplicate');
      }
      rows.set(values.id, { ...values });
      return { ok: true };
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
      if (down) {
        throw Error('offline');
      }
      if (!tables.has(table)) {
        throw Error('missing table');
      }
      let rows = [...tables.get(table).values()].filter((r) =>
        filter(r, where)
      );
      if (groupBy) {
        /** Synthetic compound/map/group identity or test-only signing key. */
        const key = groupBy[0];
        /** Synthetic aggregate counts computed without private payload projection. */
        const groups = new Map();
        // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
        for (const row of rows) {
          groups.set(row[key], (groups.get(row[key]) || 0) + 1);
        }
        rows = [...groups]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([category, event_count]) => ({ category, event_count }));
      }
      return { ok: true, rows: rows.slice(0, limit ?? rows.length) };
    },
    /** Apply an explicit synthetic conditional update or the declared unsupported-operation failure.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async update() {
      throw Error('not needed');
    },
  };
}
/** Deterministic synthetic provider outcome factory; no recipient labels.
 * @param {number} i - Deterministic synthetic record sequence.
 * @param {string} kind - Fixed provider outcome kind.
 * @param {string} campaignId - Opaque synthetic campaign scope.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const event = (i, kind = 'delivered', campaignId = 'fall') => ({
  provider: 'mailprovider',
  eventId: `evt-${i}`,
  campaignId,
  messageId: `mail-${i}`,
  kind,
  occurredAt: 1000 + i,
});
test('native campaign states count over 100,000 records without reading payloads', async () => {
  /** Owned synthetic database facade or disposable native handle. */
  const database = db();
  await database.createTable({ table: 'zerux_email_delivery' });
  /** Synthetic table selected for fixed count/consistency checks. */
  const table = database.tables.get('zerux_email_delivery');
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (let i = 0; i < 100_123; i++) {
    table.set(`mail-${i}`, {
      id: `mail-${i}`,
      campaign_id: i % 2 ? 'fall' : 'other',
      state: i % 3 ? 'sent' : 'uncertain',
    });
  }
  /** Observed bounded coverage-labelled synthetic report. */
  const report = await createDatabaseCampaignPerformanceReporter({
    db: database,
  })('fall');
  assert.equal(report.total, 50_061);
  assert.equal(report.counts.sent + report.counts.uncertain, report.total);
  assert.equal(report.mode, 'database');
  assert.equal(report.dailyCoverage, 'not-computed');
  assert.equal(report.activityCoverage, 'not-computed');
  assert.equal(report.provider, null);
  assert.equal('days' in report, false);
});
test('provider outcomes dedupe replay, reject conflicts, and scope counts per campaign', async () => {
  /** Owned synthetic database facade or disposable native handle. */
  const database = db();
  /** Synthetic durable publish/history/provider ledger; no memory-to-production guarantee. */
  const ledger = createDatabaseProviderOutcomeLedger(database);
  assert.equal(await ledger.record(event(1)), true);
  assert.equal(await ledger.record(event(1)), false);
  await assert.rejects(
    ledger.record({ ...event(1), kind: 'complaint' }),
    /Conflicting/
  );
  assert.equal(await ledger.record(event(2, 'hard-bounce')), true);
  assert.equal(await ledger.record(event(3, 'complaint', 'other')), true);
  /** Observed synthetic aggregate with explicit denominator/coverage. */
  const total = await ledger.summarize('fall');
  assert.equal(total.events, 2);
  assert.equal(total.counts.delivered, 1);
  assert.equal(total.counts['hard-bounce'], 1);
  /** Observed bounded coverage-labelled synthetic report. */
  const report = await createDatabaseCampaignPerformanceReporter({
    db: database,
    provider: ledger,
  })('fall').catch(() => null);
  assert.equal(report, null); // caller must initialize the delivery store first, never return false zeros
  await database.createTable({ table: 'zerux_email_delivery' });
  /** Observed bounded native invocation/result used for exact expectations. */
  const actual = await createDatabaseCampaignPerformanceReporter({
    db: database,
    provider: ledger,
  })('fall');
  assert.equal(actual.total, 0);
  assert.equal(actual.provider.events, 2);
  database.setDown(true);
  await assert.rejects(ledger.summarize('fall'), /offline/);
  await assert.rejects(
    createDatabaseCampaignPerformanceReporter({ db: database })('fall'),
    /offline/
  );
});
test('invalid provider events and corrupt grouped counts are rejected', async () => {
  /** Owned synthetic database facade or disposable native handle. */
  const database = db();
  /** Synthetic durable publish/history/provider ledger; no memory-to-production guarantee. */
  const ledger = createDatabaseProviderOutcomeLedger(database);
  await assert.rejects(
    ledger.record({ ...event(2), messageId: 'evil@address' }),
    /Invalid/
  );
  await assert.rejects(
    ledger.record({ ...event(2), occurredAt: -1 }),
    /Invalid/
  );
  await assert.rejects(ledger.summarize('../outside'), /Invalid/);
  await database.createTable({ table: 'zerux_email_delivery' });
  database.tables
    .get('zerux_email_delivery')
    .set('bad', { id: 'bad', campaign_id: 'fall', state: 'corrupt' });
  await assert.rejects(
    createDatabaseCampaignPerformanceReporter({ db: database })('fall'),
    /Invalid/
  );
});
