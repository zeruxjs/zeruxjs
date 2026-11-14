import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createDatabaseEmailDeliveryStore,
  createDatabaseEmailDeliveryHistory,
  createDatabaseDeliveryHistoryGapLedger,
  createDeliveryHistoryGapScanner,
} from '../dist/index.js';
/** Installed local dependency resolver; no arbitrary package discovery. */
const require = createRequire(import.meta.url);
/** Existing public SQLite connector used only with synthetic disposable databases. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Trusted synthetic connection context used by the database facade. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
test('history gap observations preserve missing/stale current versions without inventing transitions', async () => {
  /** Owned disposable SQLite connector; disconnect in finally. */
  const c = await createConnector({ filename: ':memory:', driver: 'node' });
  try {
    /** Synthetic/injected database facade; its underlying connector remains separately owned. */
    const db = Object.fromEntries(
      ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
        op,
        (arg) => c.execute({ op, ...arg }, ctx),
      ])
    );
    /** Isolated synthetic CAS/delivery store, never operator data. */
    const store = createDatabaseEmailDeliveryStore(db);
    /** Synthetic append-only transition ledger, distinct from current delivery state. */
    const history = createDatabaseEmailDeliveryHistory(db);
    /** Synthetic durable publish/history/provider ledger; no memory-to-production guarantee. */
    const ledger = createDatabaseDeliveryHistoryGapLedger(db);
    /** Explicit synthetic configuration or store underlying the current case. */
    const base = Date.parse('2026-10-01T00:00:00Z');
    /** Create explicit synthetic delivery facts with deterministic routing/state.
     * @param {string} id - Opaque synthetic job/record ID.
     * @param {string} state - Explicit synthetic delivery state.
     * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
     */
    const mk = (id, state = 'pending') => ({
      id,
      campaignId: 'camp62',
      version: 1,
      purpose: 'marketing',
      state,
      lease: null,
      recipient: `${id}@test.org`,
      updatedAt: base,
    });
    await store.create(mk('a'));
    await store.create(mk('b'));
    await store.create(mk('c'));
    await history.record({
      messageId: 'a',
      campaignId: 'camp62',
      version: 1,
      from: null,
      to: 'pending',
      occurredAt: base,
    });
    await history.record({
      messageId: 'c',
      campaignId: 'camp62',
      version: 1,
      from: null,
      to: 'pending',
      occurredAt: base,
    });
    /** Original synthetic delivery revision before a guarded update. */
    const c0 = await store.load('c');
    await store.save(
      'c',
      { ...c0, version: 2, state: 'sent', updatedAt: base + 1 },
      1
    );
    /** Explicit bounded gap/recovery scanner; no background scan starts. */
    const scanner = createDeliveryHistoryGapScanner({
      source: store,
      history,
      ledger,
      now: () => base + 1000,
    });
    /** First bounded synthetic scan/page result. */
    const one = await scanner('camp62', { limit: 2 });
    assert.deepEqual([one.covered, one.missing, one.stale], [1, 1, 0]);
    /** Second bounded synthetic scan/page result. */
    const two = await scanner('camp62', { cursor: one.nextCursor, limit: 2 });
    assert.equal(two.stale, 1);
    /** Repeated synthetic scan result used to verify idempotent observations. */
    const repeats = await scanner('camp62', { limit: 3 });
    assert.equal(repeats.observationsCreated, 0);
    /** Redacted synthetic audit entries or coverage result; no payloads/addresses. */
    const audit = await history.auditCurrent('camp62', store, { limit: 3 });
    assert.equal(audit.covered, 1);
    assert.equal(audit.missing, 1);
    assert.equal(audit.stale, 1);
    /** Observed recorded transition page; missing history is not fabricated. */
    const historyItems = await history.page('camp62');
    assert.equal(historyItems.events.length, 2);
    /** Bounded synthetic store page with scope/ordering checks. */
    const page = await ledger.page('camp62');
    assert.equal(page.entries.length, 2);
    assert.equal(
      page.entries.every((v) => !JSON.stringify(v).includes('@test.org')),
      true
    );
    await assert.rejects(
      ledger.record({ ...page.entries[0], currentState: 'sent' }),
      /Conflicting/
    );
    assert.equal((await ledger.page('other')).entries.length, 0);
  } finally {
    await c.disconnect();
  }
});
