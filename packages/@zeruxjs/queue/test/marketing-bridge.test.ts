import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMarketingCampaignService } from '../../email/dist/index.js';
import {
  createDatabaseEmailDeliveryStore,
  createJournaledEmailDeliveryStore,
  createDatabaseEmailDeliveryHistory,
  createDurableEmailDeliveryProcessor,
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
test('end-to-end persisted marketing queue respects consent, cancel, and journaled SMTP state', async () => {
  /** Owned synthetic SQLite connector disconnected in finally. */
  const sqlite = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  try {
    /** Synthetic/injected database facade; its underlying connector remains separately owned. */
    const db = Object.fromEntries(
      ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
        op,
        (args) => sqlite.execute({ op, ...args }, context),
      ])
    );
    /** Synthetic durable transition journal; no email body/recipient labels. */
    const journal = createDatabaseEmailDeliveryHistory(db);
    /** Isolated synthetic CAS/delivery store, never operator data. */
    const store = createJournaledEmailDeliveryStore(
      createDatabaseEmailDeliveryStore(db),
      journal
    );
    /** Synthetic queued records or in-memory job map, scoped to one test. */
    const jobs = [];
    /** Explicit synthetic campaign service with injected queue/database boundaries. */
    const campaigns = createMarketingCampaignService({
      db,
      delivery: store,
      queue: {
        add: async (name, data) => {
          jobs.push({ name, data });
        },
      },
    });
    /** Validated synthetic opaque record/job identity, not authorization. */
    const id = await campaigns.create({
      name: 'Campaign 60',
      subject: 'Hi {{name}}',
      content: 'Text {{email}}',
      contentType: 'text',
      account: 'mailer',
      emails: [
        { name: 'A', email: 'a@example.org' },
        { name: 'B', email: 'b@example.org' },
      ],
      isTracking: true,
    });
    assert.equal(jobs.length, 2);
    /** Fixture-local recorded authorized sends or headers, never a live SMTP claim. */
    const sent = [];
    /** Explicit injected processor or native worker options for the test. */
    const worker = createDurableEmailDeliveryProcessor({
      store,
      isSubscribed: async () => true,
      isSuppressed: async () => false,
      campaignGate: campaigns.deliveryGate,
      send: (messageId) =>
        campaigns.sendById(messageId, {
          /** Simulate a declared SMTP/HTTPS result without a real external delivery.
           * @param {object} message - Explicit synthetic saved message; no live SMTP send.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async send(message) {
            sent.push(message);
            return { account: message.account, accepted: [], rejected: [] };
          },
        }),
    });
    /** First operation/record/page used as the normal concurrency control. */
    const first = await worker(jobs[0]);
    assert.equal(first.status, 'sent');
    /** Repeated synthetic invocation used to prove terminal-state replay safety. */
    const again = await worker(jobs[0]);
    assert.equal(again.status, 'sent');
    assert.equal(sent.length, 1);
    /** Observed bounded coverage-labelled synthetic report. */
    const report = await journal.trends(
      id,
      new Date().toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    );
    assert.equal(report.days[0].counts.sent, 1);
    assert.equal(report.days[0].counts.pending, 2);
    await campaigns.cancel(id);
    assert.equal((await worker(jobs[1])).status, 'suppressed');
    assert.equal(sent.length, 1);
    assert.equal(
      (
        await journal.trends(
          id,
          new Date().toISOString().slice(0, 10),
          new Date().toISOString().slice(0, 10)
        )
      ).days[0].counts.suppressed,
      1
    );
  } finally {
    await sqlite.disconnect();
  }
});
