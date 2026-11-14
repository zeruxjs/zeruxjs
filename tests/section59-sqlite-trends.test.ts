/** Optional cross-package real SQLite smoke test; not part of Queue's mock-only suite.
 * Run after compiling @zeruxjs/db, db-sql-core, db-sqlite and Queue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createDatabaseCampaignTrendsReporter,
  createDatabaseEmailDeliveryStore,
  createDatabaseProviderOutcomeLedger,
} from '@zeruxjs/queue';
/** Test fixture or local value named require. */
const require = createRequire(import.meta.url);
/** SQLite connector factory loaded from the built package under test. */
const { createConnector } = require('@zeruxjs/db-sqlite');
/** Test fixture or local value named context. */
const context = {
  connection: {
    slug: 'default',
    name: 'default',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Convert an ISO calendar date to a UTC timestamp.
 *
 * @param {string} d - ISO date without a time component.
 * @returns {number} UTC timestamp in milliseconds.
 */
const day = (d) => Date.parse(`${d}T00:00:00Z`);
test('real SQLite day-grouped states and verified events across two independent connections', async () => {
  /** Test fixture or local value named dir. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zerux-section59-'));
  /** Test fixture or local value named filename. */
  const filename = path.join(dir, 'campaign.sqlite');
  /** Test fixture or local value named a. */
  const a = await createConnector({ filename, driver: 'node' });
  /** Test fixture or local value named b. */
  const b = await createConnector({ filename, driver: 'node' });
  /**
   * Adapt a connector to the campaign trends database facade.
   *
   * @param {{execute: Function}} conn - Connector under test.
   * @returns {object} Database facade used by the reporter.
   */
  const db = (conn) => ({
    createTable: (q) => conn.execute({ op: 'createTable', ...q }, context),
    createIndex: (q) => conn.execute({ op: 'createIndex', ...q }, context),
    insert: (q) => conn.execute({ op: 'insert', ...q }, context),
    select: (q) => conn.execute({ op: 'select', ...q }, context),
    update: (q) => conn.execute({ op: 'update', ...q }, context),
  });
  try {
    /** Test fixture or local value named store. */
    const store = createDatabaseEmailDeliveryStore(db(a));
    await store.create({
      id: 'intro',
      version: 1,
      purpose: 'marketing',
      campaignId: 'fall',
      recipient: 'redacted@example.test',
      state: 'sent',
      lease: null,
      updatedAt: day('2026-10-10'),
    });
    /** Test fixture or local value named insert. */
    const insert = a
      .getNativeConnection()
      .prepare(
        'INSERT INTO zerux_email_delivery (id,version,campaign_id,state,updated_at,payload_json) VALUES (?,?,?,?,?,?)'
      );
    for (let i = 0; i < 1200; i++)
      insert.run(
        `x${i}`,
        1,
        i % 2 ? 'fall' : 'other',
        i % 3 ? 'sent' : 'suppressed',
        day(i % 4 ? '2026-10-10' : '2026-10-11') + i,
        '{}'
      );
    /** Test fixture or local value named ledger. */
    const ledger = createDatabaseProviderOutcomeLedger(db(a));
    await ledger.record({
      eventId: 'e-1',
      provider: 'localtest',
      campaignId: 'fall',
      messageId: 'intro',
      kind: 'delivered',
      occurredAt: day('2026-10-10'),
    });
    await ledger.record({
      eventId: 'e-2',
      provider: 'localtest',
      campaignId: 'fall',
      messageId: 'intro',
      kind: 'complaint',
      occurredAt: day('2026-10-11'),
    });
    /** Test fixture or local value named reporter. */
    const reporter = createDatabaseCampaignTrendsReporter({
      db: db(b),
      providerTable: 'zerux_email_provider_outcomes',
    });
    /** Test fixture or local value named result. */
    const result = await reporter('fall', '2026-10-10', '2026-10-12');
    assert.equal(result.total, 601);
    assert.equal(result.providerEvents, 2);
    assert.equal(
      result.days.reduce((n, d) => n + d.total, 0),
      601
    );
    assert.deepEqual(
      result.days.map((d) => d.providerEvents),
      [1, 1, 0]
    );
    assert.equal(result.days[2].total, 0);
    await assert.rejects(
      reporter('fall', '2026-09-30', '2026-09-29'),
      /range|window|bounds/
    );
  } finally {
    await a.disconnect();
    await b.disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
