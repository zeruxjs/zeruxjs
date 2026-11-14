import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMarketingCampaignService } from '../dist/index.js';
import { createVariableRegistry } from '../../../zeruxjs/dist/variables.js';
/** Fixed bridge for the built SQLite CommonJS adapter; no caller-selected packages. */
const require = createRequire(import.meta.url);
/** Public native SQLite factory; fixtures use only isolated in-memory databases. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Fixed structured database context, separate from operator state. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Open a synthetic in-memory database and expose borrowed operation ports.
 *
 * @returns {Promise<object>} Database port plus disconnect cleanup; caller owns the native fixture.
 */
async function database() {
  /** Owned in-memory SQLite handle returned with disconnect cleanup. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Borrowed finite operation port over the owned native fixture. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (args) => connector.execute({ op, ...args }, ctx),
    ])
  );
  return { db, close: () => connector.disconnect() };
}
/**
 * Create local create-only/load state for synthetic durable identities.
 *
 * @returns {object} Map-backed protocol fixture; no cross-worker durability claim.
 */
const delivery = () => {
  /** Private synthetic delivery identity map; no production durability claim. */
  const rows = new Map();
  return {
    map: rows,
    /**
     * Reserve one unique synthetic identity without overwriting prior state.
     *
     * @param {object} v - Private synthetic delivery row.
     * @returns {Promise<boolean>} True for first creation, false for an existing identity.
     */
    async create(v) {
      if (rows.has(v.id)) {
        return false;
      }
      rows.set(v.id, { ...v });
      return true;
    },
    /**
     * Load one exact synthetic identity without opening resources.
     *
     * @param {string} id - Opaque synthetic delivery identity.
     * @returns {Promise<object | null>} Private fixture row or absence.
     */
    async load(id) {
      return rows.get(id) ?? null;
    },
  };
};
test('draft-style creation, appended recipients, counts, exact pagination, pause and resume', async () => {
  /** Owned synthetic database fixture closed in the enclosing finally block. */
  const { db, close } = await database();
  try {
    /** Captured opaque native task requests; no Redis or broker connection. */
    const jobs = [];
    /** Function-first campaign service borrowing only explicit synthetic ports. */
    const service = createMarketingCampaignService({
      db,
      queue: {
        /**
         * Capture explicit native task fields or inject a declared queue outage.
         *
         * @param {string} name - Fixed native queue task name.
         * @param {object} data - Opaque message reference only; no recipient/template payload.
         * @param {object} opts - Explicit native scheduling and stable identity fields.
         * @returns {Promise<void>} Capture completed, or explicit dependency failure; never delivery evidence.
         */
        async add(name, data, opts) {
          jobs.push({ name, data, opts });
        },
      },
      delivery: delivery(),
      now: () => 1000,
    });
    /** Opaque synthetic campaign identity; permissions are always separately checked. */
    const code = await service.create({
      name: 'Big',
      subject: 'Hello {{name}}',
      content: '<p>{{name}}</p>',
      account: 'main',
      autoEnqueue: false,
      recipients: ['first@example.com'],
    });
    assert.equal(jobs.length, 0);
    assert.equal((await service.audience(code)).unqueued, 1);
    /** Bounded append receipt; identical replay must reconcile and conflicting private values reject. */
    const added = await service.appendRecipients(code, [
      { name: 'Second', email: 'second@example.com' },
      'third@example.com',
    ]);
    assert.equal(added.added, 2);
    assert.equal(added.recipientCount, 3);
    assert.equal(
      (
        await service.appendRecipients(code, [
          { name: 'Second', email: 'second@example.com' },
        ])
      ).existing,
      1
    );
    await assert.rejects(
      service.appendRecipients(code, [
        { name: 'Different', email: 'second@example.com' },
      ]),
      /Conflicting/
    );
    /** Finite synthetic recipient identities used to check exact keyset pagination. */
    const ids = [];
    let cursor = null;
    // Process only the finite synthetic corpus with explicit native continuation; no unbounded scan.
    do {
      /** Bounded private audience page; continuation is an opaque exclusive ID. */
      const page = await service.recipients(code, { cursor, limit: 1 });
      ids.push(...page.recipients.map((v) => v.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(new Set(ids).size, 3);
    /** Single-campaign list lookahead result; no phantom next page may be returned. */
    const first = await service.list({ limit: 1 });
    assert.equal(first.done, true);
    assert.equal(first.nextCursor, null);
    /** Committed paused campaign state; queued jobs must defer rather than silently send. */
    const paused = await service.pause(code);
    assert.equal(paused.status, 'paused');
    assert.equal(await service.deliveryGate({ campaignId: code }), 'defer');
    await assert.rejects(service.enqueue(code), /cannot be enqueued/);
    await service.resume(code);
    assert.equal(await service.deliveryGate({ campaignId: code }), 'allow');
    /** Aggregate native enqueue receipt; queue acceptance is not SMTP delivery. */
    const progress = await service.enqueue(code);
    assert.equal(progress.queued, 3);
    assert.equal(jobs.length, 3);
    /** Native exact audience counts after committed enqueue checkpoints. */
    const totals = await service.audience(code);
    assert.equal(totals.enqueued, 3);
    assert.equal(totals.unqueued, 0);
    assert.equal(
      (await service.appendRecipients(code, ['fourth@example.com'], true))
        .queued,
      1
    );
    assert.equal(jobs.length, 4);
    await service.pause(code);
    await assert.rejects(
      service.sendById(ids[0], {
        send: async () => {
          throw Error('should not send');
        },
      }),
      /deferred/
    );
    await service.resume(code);
    await service.cancel(code);
    assert.equal(await service.deliveryGate({ campaignId: code }), 'suppress');
    await assert.rejects(
      service.appendRecipients(code, ['fifth@example.com']),
      /Cannot append/
    );
  } finally {
    await close();
  }
});
test('registered async variables resolve once across subject, HTML, text; output is HTML escaped', async () => {
  /** Owned synthetic database fixture closed in the enclosing finally block. */
  const { db, close } = await database();
  try {
    /** Trusted registered async variable capability; campaign strings do not execute arbitrary code. */
    const registry = createVariableRegistry();
    let calls = 0;
    registry.register('offer.code', async () => {
      calls++;
      return '<SAVE>';
    });
    /** Function-first campaign service borrowing only explicit synthetic ports. */
    const service = createMarketingCampaignService({
      db,
      renderer: registry,
      delivery: delivery(),
      queue: {
        /**
         * Capture explicit native task fields or inject a declared queue outage.
         *
         * @returns {Promise<void>} Capture completed, or explicit dependency failure; never delivery evidence.
         */
        async add() {},
      },
      now: () => 1000,
    });
    /** Opaque synthetic campaign identity; permissions are always separately checked. */
    const code = await service.create({
      name: 'Offer',
      subject: '{{offer.code}} {{offer.code}}',
      html: '<b>{{offer.code}}</b>',
      text: '{{offer.code}}',
      account: 'main',
      recipients: [{ name: 'Alice', email: 'alice@example.com' }],
      autoEnqueue: false,
    });
    /** Bounded private recipient page used for exact authorized preview/redrive selection. */
    const { recipients } = await service.recipients(code);
    /** Private rendered fixture message checked for HTML versus text escaping. */
    const message = await service.preview(code, recipients[0].id);
    assert.equal(calls, 1);
    assert.equal(message.subject, '<SAVE> <SAVE>');
    assert.equal(message.html, '<b>&lt;SAVE&gt;</b>');
    assert.equal(message.text, '<SAVE>');
    assert.deepEqual(registry.extract('{{name}} {{offer.code}} {{name}}'), [
      'name',
      'offer.code',
    ]);
  } finally {
    await close();
  }
});
test('campaign list uses a true lookahead cursor for exact page boundaries', async () => {
  /** Owned synthetic database fixture closed in the enclosing finally block. */
  const { db, close } = await database();
  try {
    /** Function-first campaign service borrowing only explicit synthetic ports. */
    const service = createMarketingCampaignService({
      db,
      delivery: delivery(),
      queue: {
        /**
         * Capture explicit native task fields or inject a declared queue outage.
         *
         * @returns {Promise<void>} Capture completed, or explicit dependency failure; never delivery evidence.
         */
        async add() {},
      },
      now: () => 1000,
    });
    // Process only the finite synthetic corpus with explicit native continuation; no unbounded scan.
    for (let i = 0; i < 3; i++) {
      await service.create({
        name: 'Campaign' + i,
        subject: 'Hi',
        text: 'Plain',
        account: 'main',
        autoEnqueue: false,
        recipients: [`u${i}@example.com`],
      });
    }
    let cursor = null;
    /** Finite accumulated synthetic list records; the binding never changes during paging. */
    const records = [];
    // Process only the finite synthetic corpus with explicit native continuation; no unbounded scan.
    do {
      /** Bounded native campaign list page with an exact lookahead continuation. */
      const p = await service.list({ cursor, limit: 1 });
      records.push(...p.campaigns);
      cursor = p.nextCursor;
    } while (cursor);
    assert.equal(records.length, 3);
    assert.equal(new Set(records.map((r) => r.code)).size, 3);
  } finally {
    await close();
  }
});
test('operator redrive requeues only previously enqueued pending records, never sent or uncertain', async () => {
  /** Owned synthetic database fixture closed in the enclosing finally block. */
  const { db, close } = await database();
  try {
    /** Captured opaque native task requests; no Redis or broker connection. */
    const jobs = [];
    /** Shared private delivery protocol fixture used to mark sent/uncertain identities. */
    const state = delivery();
    /** Function-first campaign service borrowing only explicit synthetic ports. */
    const service = createMarketingCampaignService({
      db,
      delivery: state,
      queue: {
        /**
         * Capture explicit native task fields or inject a declared queue outage.
         *
         * @param {string} name - Fixed native queue task name.
         * @param {object} data - Opaque message reference only; no recipient/template payload.
         * @param {object} options - Explicit native scheduling and stable identity fields.
         * @returns {Promise<void>} Capture completed, or explicit dependency failure; never delivery evidence.
         */
        async add(name, data, options) {
          jobs.push({ name, data, options });
        },
        /**
         * Return explicit native task absence for this authorized redrive fixture.
         *
         * @returns {Promise<null>} Synthetic absent task; durable pending identity and fresh policy are checked separately.
         */
        async getJob() {
          return null;
        },
      },
      now: () => 1000,
    });
    /** Opaque synthetic campaign identity; permissions are always separately checked. */
    const code = await service.create({
      name: 'Recovery',
      subject: 'Hello',
      text: 'Content',
      account: 'main',
      recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    });
    assert.equal(jobs.length, 3);
    /** Bounded private recipient page used for exact authorized preview/redrive selection. */
    const { recipients } = await service.recipients(code, { limit: 3 });
    /** Synthetic SMTP-accepted delivery record; redrive must never requeue it. */
    const sent = state.map.get(recipients[0].id);
    state.map.set(sent.id, { ...sent, state: 'sent' });
    /** Synthetic uncertain delivery record; no automatic replay is safe. */
    const unknown = state.map.get(recipients[1].id);
    state.map.set(unknown.id, { ...unknown, state: 'uncertain' });
    /** Explicit redrive receipt for only the still-pending missing native task. */
    const once = await service.redrivePending(code, { limit: 3 });
    assert.equal(once.eligible, 1);
    assert.equal(once.submitted, 1);
    assert.equal(jobs.length, 4);
    assert.equal(jobs[3].data.messageId, recipients[2].id);
    await service.pause(code);
    await assert.rejects(service.redrivePending(code), /cannot be redriven/);
    await service.resume(code);
    /** Separate campaign service whose host policy explicitly denies redrive. */
    const strict = createMarketingCampaignService({
      db,
      delivery: state,
      queue: {
        /**
         * Capture explicit native task fields or inject a declared queue outage.
         *
         * @returns {Promise<void>} Capture completed, or explicit dependency failure; never delivery evidence.
         */
        async add() {},
      },
      authorize: (action) => action !== 'redrive',
    });
    await assert.rejects(strict.redrivePending(code), /denied/);
  } finally {
    await close();
  }
});
test('provider checks, retryable queue outages, and PII-free audit hooks', async () => {
  /** Owned synthetic database fixture closed in the enclosing finally block. */
  const { db, close } = await database();
  try {
    let online = false;
    /** Captured aggregate-only postcommit audit metadata; sink failure must not replay native work. */
    const audit = [];
    /** Function-first campaign service borrowing only explicit synthetic ports. */
    const service = createMarketingCampaignService({
      db,
      delivery: delivery(),
      now: () => 1000,
      queue: {
        /**
         * Capture explicit native task fields or inject a declared queue outage.
         *
         * @returns {Promise<void>} Capture completed, or explicit dependency failure; never delivery evidence.
         */
        async add() {
          if (!online) {
            throw new Error('Redis temporarily down');
          }
        },
      },
      verifyProvider: (account) => account === 'authorized',
      onAudit: (e) => {
        audit.push(e);
        throw new Error('audit sink down');
      },
    });
    await assert.rejects(
      service.create({
        name: 'Invalid provider',
        subject: 'Hi',
        text: 'Hello',
        account: 'unknown',
        recipients: ['one@example.com'],
        autoEnqueue: false,
      }),
      /provider unavailable/
    );
    /** Opaque synthetic campaign identity; permissions are always separately checked. */
    const code = await service.create({
      name: 'Recovery',
      subject: 'Hi',
      text: 'Hello',
      account: 'authorized',
      recipients: ['one@example.com'],
      autoEnqueue: false,
    });
    assert.equal((await service.get(code)).status, 'ready');
    await assert.rejects(service.enqueue(code), /Redis temporarily down/);
    assert.equal((await service.get(code)).status, 'queue_failed');
    online = true;
    assert.equal((await service.enqueue(code)).queued, 1);
    assert.equal((await service.get(code)).status, 'ready');
    assert.ok(
      audit.every((entry) => !JSON.stringify(entry).includes('one@example.com'))
    );
  } finally {
    await close();
  }
});
