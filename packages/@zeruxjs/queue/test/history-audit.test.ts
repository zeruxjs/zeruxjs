import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createDatabaseEmailDeliveryHistory,
  createDatabaseEmailDeliveryStore,
  createJournaledEmailDeliveryStore,
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
test('history audit detects missing and stale current state without fabricating events', async () => {
  /** Owned disposable SQLite connector; disconnect in finally. */
  const c = await createConnector({ filename: ':memory:', driver: 'node' });
  /** Synthetic/injected database facade; its underlying connector remains separately owned. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (args) => c.execute({ op, ...args }, ctx),
    ])
  );
  try {
    /** Synthetic append-only transition ledger, distinct from current delivery state. */
    const history = createDatabaseEmailDeliveryHistory(db);
    /** Explicit synthetic configuration or store underlying the current case. */
    const base = createDatabaseEmailDeliveryStore(db);
    createJournaledEmailDeliveryStore(base, history);
    /** Fixed synthetic UTC/epoch clock for deterministic transition checks. */
    const t = Date.parse('2026-10-13T12:00:00Z');
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (const id of ['mail-a', 'mail-b', 'mail-c']) {
      await base.create({
        id,
        campaignId: 'camp-1',
        version: 1,
        purpose: 'marketing',
        recipient: `${id}@example.com`,
        state: 'pending',
        lease: null,
        updatedAt: t,
      });
    }
    await history.record({
      messageId: 'mail-a',
      campaignId: 'camp-1',
      version: 1,
      from: null,
      to: 'pending',
      occurredAt: t,
    });
    await history.record({
      messageId: 'mail-b',
      campaignId: 'camp-1',
      version: 1,
      from: null,
      to: 'sent',
      occurredAt: t,
    });
    /** First operation/record/page used as the normal concurrency control. */
    const first = await history.auditCurrent('camp-1', base, { limit: 2 });
    assert.equal(first.checked, 2);
    assert.equal(first.covered, 1);
    assert.equal(first.stale, 1);
    assert.equal(first.complete, false);
    /** Second independent page/claim/service used to check contention or continuation. */
    const second = await history.auditCurrent('camp-1', base, {
      cursor: first.nextCursor,
      limit: 2,
    });
    assert.equal(second.missing, 1);
    assert.equal(second.complete, true);
    /** Observed empty synthetic page; not an invented zero for storage outages. */
    const empty = await history.auditCurrent('other-camp', base);
    assert.equal(empty.checked, 0);
    /** Observed complete bounded synthetic page. */
    const full = await history.page('camp-1', { limit: 2 });
    assert.equal(full.done, true);
    assert.equal(full.nextCursor, null);
    await assert.rejects(
      history.auditCurrent('camp-1', {
        pageCampaign: async () => [
          { id: 'bad', campaignId: 'other-camp', state: 'pending' },
        ],
      }),
      /Out of scope/
    );
  } finally {
    await c.disconnect();
  }
});
