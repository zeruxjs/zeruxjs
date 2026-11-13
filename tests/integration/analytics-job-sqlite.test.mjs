import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnector } from '@zeruxjs/db-sqlite';
import { createAnalytics } from '../../packages/@zeruxjs/analytics/dist/index.js';

/** Test fixture or local value named context. */
const context = {
  connection: {
    slug: 'reporting',
    connector: 'sqlite',
    options: {},
    name: 'Reporting',
  },
};
/**
 * Adapt a SQLite connector to the analytics database facade used by the test.
 *
 * @param {{execute: Function}} driver - Connector under test.
 * @param {(operation: object) => boolean} shouldFail - Predicate for simulated failures.
 * @returns {object} Analytics database facade backed by the connector.
 */
const wrap = (driver, shouldFail = () => false) => ({
  createTable: (op) => driver.execute({ ...op, op: 'createTable' }, context),
  createIndex: (op) => driver.execute({ ...op, op: 'createIndex' }, context),
  select: (op) => driver.execute({ ...op, op: 'select' }, context),
  update: (op) => driver.execute({ ...op, op: 'update' }, context),
  insert: (op) =>
    shouldFail(op)
      ? { ok: false, error: { code: 'SIMULATED' } }
      : driver.execute({ ...op, op: 'insert' }, context),
});
/** Test fixture or local value named at. */
const at = Date.UTC(2024, 0, 1);

test('two SQLite connections coordinate fenced durable jobs, recover a dead worker, and repeat late-data scans', async () => {
  /** Test fixture or local value named directory. */
  const directory = await mkdtemp(join(tmpdir(), 'zerux-analytics-jobs-'));
  let d1, d2;
  try {
    /** Test fixture or local value named file. */
    const file = join(directory, 'reporting.sqlite');
    d1 = await createConnector(
      { filename: file, driver: 'node' },
      context.connection
    );
    d2 = await createConnector(
      { filename: file, driver: 'node' },
      context.connection
    );
    let failFact = false,
      clock = at + 100000;
    /** Test fixture or local value named a1. */
    const a1 = wrap(d1, (op) => failFact && op.table.endsWith('_numeric'));
    /** Test fixture or local value named a2. */
    const a2 = wrap(d2);
    /**
     * Create an analytics manager using a supplied database facade.
     *
     * @param {object} connection - Database facade used by the manager.
     * @param {string[]} fields - Numeric fields registered for analytics.
     * @returns {object} Configured analytics manager.
     */
    const mk = (connection, fields = ['amount', 'quantity']) =>
      createAnalytics({
        analytics: 'reporting',
        numericFields: fields,
        database: {
          connectionSlugs: ['reporting'],
          getConnectionFacade: () => connection,
        },
        onWarning: () => {},
      });
    /** Test fixture or local value named analyticsA. */
    const analyticsA = mk(a1),
      analyticsB = mk(a2);
    assert.equal(await analyticsA.initialize(), true);
    assert.equal(await analyticsB.initialize(), true);
    for (let i = 0; i < 211; i++) {
      /** Test fixture or local value named result. */
      const result = await a1.insert({
        table: 'analytics_events',
        values: {
          id: `ev${String(i).padStart(34, '0')}`,
          event_name: 'purchase',
          source: 'server',
          site: 'shop',
          pathname: '/pay',
          session_id: '',
          occurred_at: at,
          properties_json: JSON.stringify({ amount: i + 1, quantity: 2 }),
        },
      });
      assert.equal(result.ok, true);
    }
    /** Test fixture or local value named window. */
    const window = { since: at, until: at, site: 'shop', batchSize: 35 };
    /** Test fixture or local value named jobA. */
    const jobA = analyticsA.createReconciliationJob('historical_2024', window, {
      leaseMs: 3000,
      now: () => clock,
    });
    /** Test fixture or local value named jobB. */
    const jobB = analyticsB.createReconciliationJob('historical_2024', window, {
      leaseMs: 3000,
      now: () => clock,
    });
    /** Test fixture or local value named crashed. */
    const crashed = await jobA.acquire('replica-A');
    assert.ok(crashed?.token);
    assert.equal(await jobB.acquire('replica-B'), null);
    assert.equal((await jobB.runOnce('replica-B')).busy, true);
    assert.equal((await jobA.get()).lease.owner, 'replica-A');
    assert.equal(
      (await jobA.get()).lease.token,
      undefined,
      'public state must hide fencing token'
    );
    clock += 4000; // simulate lease expiry after an unclean worker shutdown
    /** Test fixture or local value named first. */
    const first = await jobB.runOnce('replica-B');
    assert.equal(first.busy, false);
    assert.equal(first.state.scanned, 35);
    assert.equal(first.state.pages, 1);
    /** Test fixture or local value named fake. */
    const fake = {
      scanned: 35,
      expectedFacts: 70,
      created: 70,
      existing: 0,
      invalidRows: 0,
      nextCursor: 'ev0000',
      hasMore: true,
      windowExhausted: false,
    };
    await assert.rejects(jobA.checkpoint(crashed, fake), /lease lost/);
    await assert.rejects(jobA.renew(crashed), /lease lost/);
    assert.equal(
      (await jobA.get()).scanned,
      35,
      'stale workers cannot advance shared cursor'
    );

    // After the checkpoint, simulate a transient fact-store outage on the next page.
    failFact = true;
    await assert.rejects(jobA.runOnce('replica-A'), /insert failed/);
    assert.equal(
      (await jobB.get()).scanned,
      35,
      'failed page cannot commit cursor'
    );
    assert.equal((await jobB.get()).status, 'failed');
    failFact = false;
    let cycles = 0;
    while ((await jobA.get()).status !== 'completed') {
      /** Test fixture or local value named step. */
      const step = await (cycles % 2 ? jobA : jobB).runOnce(
        `replica-${cycles % 2 ? 'A' : 'B'}`
      );
      assert.equal(step.busy, false);
      cycles++;
      assert.ok(cycles < 20);
    }
    /** Test fixture or local value named done. */
    const done = await jobB.get();
    assert.equal(done.scanned, 211);
    assert.equal(done.created, 422);
    assert.equal(done.pages, 7);
    assert.equal(done.status, 'completed');
    assert.equal((await jobA.runOnce('idle-replica')).busy, true);
    assert.equal(
      d1
        .getNativeConnection()
        .prepare('SELECT COUNT(*) AS n FROM analytics_events_numeric')
        .get().n,
      422
    );
    // Same ID cannot silently adopt a different tenant or numericFields configuration.
    await assert.rejects(
      analyticsB
        .createReconciliationJob('historical_2024', {
          ...window,
          site: 'other',
        })
        .get(),
      /conflict/
    );
    /** Test fixture or local value named differentFields. */
    const differentFields = mk(a2, ['amount']);
    await differentFields.initialize();
    await assert.rejects(
      differentFields.createReconciliationJob('historical_2024', window).get(),
      /conflict/
    );

    // Restarting a finished scan is explicit; late events are picked up without duplicate facts.
    await a1.insert({
      table: 'analytics_events',
      values: {
        id: 'zzlate',
        event_name: 'purchase',
        source: 'server',
        site: 'shop',
        pathname: '/pay',
        session_id: '',
        occurred_at: at,
        properties_json: JSON.stringify({ amount: 99, quantity: 1 }),
      },
    });
    /** Test fixture or local value named restarted. */
    const restarted = await jobB.restart();
    assert.equal(restarted.status, 'pending');
    assert.equal(restarted.scanned, 0);
    assert.equal(restarted.epoch, done.epoch + 1);
    let replay = 0;
    while ((await jobA.get()).status !== 'completed') {
      await jobA.runOnce('replay-worker');
      replay++;
      assert.ok(replay < 20);
    }
    /** Test fixture or local value named replayed. */
    const replayed = await jobA.get();
    assert.equal(replayed.scanned, 212);
    assert.equal(replayed.created, 2);
    assert.equal(replayed.existing, 422);
    assert.equal(
      d1
        .getNativeConnection()
        .prepare('SELECT COUNT(*) AS n FROM analytics_events_numeric')
        .get().n,
      424
    );
  } finally {
    await d1?.disconnect?.();
    await d2?.disconnect?.();
    await rm(directory, { recursive: true, force: true });
  }
});
