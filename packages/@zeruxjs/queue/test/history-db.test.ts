import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createDatabaseEmailDeliveryHistory,
  createJournaledEmailDeliveryStore,
  createDatabaseEmailDeliveryStore,
} from '../dist/index.js';
/** Installed local dependency resolver; no arbitrary package discovery. */
const require = createRequire(import.meta.url);
/** Existing public SQLite connector used only with synthetic disposable databases. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Trusted synthetic connector routing context, never browser role data. */
const context = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/** Create an isolated disposable SQLite fixture and return explicit cleanup ownership.
 * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
async function setup() {
  /** Owned borrowed-handle/disposable SQLite connector; disconnect before removing fixture files. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (args) => connector.execute({ op, ...args }, context),
    ])
  );
  return { db, close: () => connector.disconnect() };
}
test('append-only delivery transitions are idempotent and aggregate by actual transition day', async () => {
  /** Owned fixture database facade plus exact teardown callback. */
  const { db, close } = await setup();
  try {
    /** Synthetic durable publish/history/provider ledger; no memory-to-production guarantee. */
    const ledger = createDatabaseEmailDeliveryHistory(db);
    /** Explicit synthetic configuration or store underlying the current case. */
    const base = createDatabaseEmailDeliveryStore(db);
    /** Isolated synthetic CAS/delivery store, never operator data. */
    const store = createJournaledEmailDeliveryStore(base, ledger);
    /** Fixed UTC fixture timestamp, never a fresh synthetic lastmod. */
    const day = Date.parse('2026-10-13T03:00:00Z');
    /** Explicit synthetic stored record inspected for state/revision consistency. */
    const row = {
      id: 'mail1',
      campaignId: 'campaign1',
      version: 1,
      purpose: 'marketing',
      recipient: 'a@example.org',
      state: 'pending',
      lease: null,
      updatedAt: day,
    };
    assert.equal(await store.create(row), true);
    assert.equal(await store.create(row), false);
    assert.equal(
      await store.save(
        'mail1',
        { ...row, version: 2, state: 'claimed', updatedAt: day + 1000 },
        1
      ),
      true
    );
    assert.equal(
      await store.save(
        'mail1',
        { ...row, version: 2, state: 'sent', updatedAt: day + 1000 },
        1
      ),
      false
    );
    assert.equal(
      await store.save(
        'mail1',
        { ...row, version: 3, state: 'sent', updatedAt: day + 2000 },
        2
      ),
      true
    );
    assert.equal(
      await store.save(
        'mail1',
        { ...row, version: 4, state: 'sent', updatedAt: day + 3000 },
        3
      ),
      true
    ); // same-state metadata update is not a new transition
    /** Observed transition-day report with explicit recorded-only coverage. */
    const timeline = await ledger.trends(
      'campaign1',
      '2026-10-13',
      '2026-10-13'
    );
    assert.equal(timeline.days[0].total, 3);
    assert.equal(timeline.days[0].counts.pending, 1);
    assert.equal(timeline.days[0].counts.claimed, 1);
    assert.equal(timeline.days[0].counts.sent, 1);
    assert.equal(timeline.coverage, 'recorded-transitions-only');
    /** First bounded synthetic page and its continuation. */
    const page1 = await ledger.page('campaign1', { limit: 2 });
    assert.equal(page1.events.length, 2);
    assert.equal(page1.done, false);
    /** Second bounded synthetic page using the returned continuation. */
    const page2 = await ledger.page('campaign1', {
      cursor: page1.nextCursor,
      limit: 2,
    });
    assert.equal(page2.events.length, 1);
    /** Previously observed immutable event or unique-claim fixture, not a second side effect. */
    const replay = page1.events[0];
    assert.equal(await ledger.record(replay), false);
    await assert.rejects(
      ledger.record({ ...replay, to: 'uncertain' }),
      /Conflicting/
    );
    assert.equal((await ledger.page('another')).events.length, 0);
  } finally {
    await close();
  }
});
