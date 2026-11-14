import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMarketingCampaignService } from '../dist/index.js';
import { createVariableRegistry } from '../../../zeruxjs/dist/variables.js';
/** Fixed ESM/CommonJS bridge for the built SQLite dependency; never caller-selected module loading. */
const require = createRequire(import.meta.url);
/** Public built SQLite connector factory; only isolated in-memory state is opened. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Synthetic database execution context, separate from operator application state. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Open a synthetic in-memory database with only the declared operation allowlist.
 *
 * @returns {Promise<object>} Database port plus awaited disconnect cleanup; caller owns the native fixture.
 */
async function database() {
  /** Owned in-memory SQLite handle; setup returns its disconnect cleanup. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Explicit finite structured operation allowlist over the owned SQLite fixture. */
  const operations = [
    'createTable',
    'insert',
    'select',
    'update',
    'createIndex',
  ];
  /** Borrowed structured port over the owned synthetic SQLite handle. */
  const db = Object.fromEntries(
    operations.map((op) => [
      op,
      (args) => connector.execute({ op, ...args }, ctx),
    ])
  );
  return { db, close: () => connector.disconnect() };
}
/**
 * Create local create-only/load protocol state for durable identity assertions.
 *
 * @returns {object} Map-backed fixture; no real queue or distributed durability.
 */
const delivery = () => {
  /** Process-local durable-store protocol rows; no crash-recovery guarantee is inferred. */
  const map = new Map();
  return {
    map,
    /**
     * Reserve one synthetic delivery identity without overwriting an existing row.
     *
     * @param {object} row - Private synthetic durable record.
     * @returns {Promise<boolean>} True for first creation, false for matching-key contention; callers verify record identity.
     */
    async create(row) {
      if (map.has(row.id)) {
        return false;
      }
      map.set(row.id, { ...row });
      return true;
    },
    /**
     * Read one synthetic delivery identity without acquiring a native handle.
     *
     * @param {string} id - Opaque synthetic message identity.
     * @returns {Promise<object | null>} Private fixture record or null.
     */
    async load(id) {
      return map.get(id) ?? null;
    },
  };
};
test('marketing campaign saves one template, returns code and renders paginated recipient data', async () => {
  /** Owned in-memory fixture retained and disconnected in finally. */
  const { db, close } = await database();
  try {
    /** Captured opaque native queue requests; no Redis or broker connection is made. */
    const jobs = [];
    /** Borrowed synthetic message identity store shared with this campaign service. */
    const mailStore = delivery();
    /** Synthetic native add port capturing opaque job identities and scheduling options. */
    const queue = {
      /**
       * Capture only explicit native queue requests without publishing to a broker.
       *
       * @param {string} name - Fixed explicit queue task name.
       * @param {object} data - Opaque message reference only, never a recipient body.
       * @param {object} options - Explicit stable job identity, delay and attempt fixture fields.
       * @returns {Promise<void>} Capture completed, or deliberate queue-outage rejection.
       */
      async add(name, data, options) {
        jobs.push({ name, data, options });
      },
    };
    /** Function-first campaign service borrowing only isolated fixtures. */
    const service = createMarketingCampaignService({
      db,
      queue,
      delivery: mailStore,
      now: () => 10_000,
    });
    /** Opaque synthetic campaign reference; configured host authorization remains authoritative. */
    const code = await service.create({
      name: 'October launch',
      subject: 'Hello {{name}} {{promo}}',
      html: '<p>{{email}} - {{plan}}</p>',
      providers: ['primary', 'backup'],
      data: { promo: 'SAVE25' },
      isTracking: true,
      recipients: [
        { email: 'a@example.org', name: 'A & B', data: { plan: 'Plus' } },
        { email: 'b@example.org', name: 'B', data: { plan: 'Free' } },
      ],
    });
    assert.match(code, /^camp_[a-f0-9]{32}$/);
    /** Private campaign record checked for single-template persistence and explicit tracking choice. */
    const saved = await service.get(code);
    assert.equal(saved.recipientCount, 2);
    assert.equal(saved.subject, 'Hello {{name}} {{promo}}');
    assert.equal(saved.status, 'ready');
    assert.equal(saved.tracking.enabled, true);
    /** First bounded private audience page; continuation is an exclusive opaque identity. */
    const page = await service.recipients(code, { limit: 1 });
    assert.equal(page.recipients.length, 1);
    assert.equal(page.done, false);
    /** Next bounded private audience page; previous recipients must not be repeated. */
    const next = await service.recipients(code, {
      cursor: page.nextCursor,
      limit: 1,
    });
    assert.equal(next.recipients.length, 1);
    /** Finite concatenation of two synthetic pages for exact recipient assertions. */
    const items = [...page.recipients, ...next.recipients];
    /** Synthetic recipient selected by its mailbox only within the test fixture. */
    const alice = items.find((x) => x.email === 'a@example.org');
    assert.ok(alice);
    assert.equal(alice.deliveryState, 'pending');
    /** Authorized private render result; HTML remains inert data in this Node fixture. */
    const preview = await service.preview(code, alice.id);
    assert.equal(preview.subject, 'Hello A & B SAVE25');
    assert.equal(preview.html, '<p>a@example.org - Plus</p>');
    assert.ok(['primary', 'backup'].includes(preview.account));
    assert.equal(preview.purpose, 'marketing');
    assert.equal(preview.tracking.campaign, code);
    assert.equal(jobs.length, 2);
    assert.ok(
      jobs.every(
        (j) =>
          j.name === 'email.deliver' && j.data.messageId === j.options.jobId
      )
    );
    assert.equal((await service.list()).campaigns.length, 1);
    assert.equal((await service.enqueue(code)).queued, 0);
    /** Captured synthetic rendered messages; no SMTP connection or inbox delivery. */
    const sent = [];
    await service.sendById(alice.id, {
      /**
       * Capture the rendered private message without delivering through SMTP.
       *
       * @param {object} mail - Private rendered synthetic marketing message.
       * @returns {Promise<object>} Synthetic normalized acceptance; not inbox-delivery proof.
       */
      async send(mail) {
        sent.push(mail);
        return { account: mail.account, accepted: [alice.email], rejected: [] };
      },
    });
    assert.equal(sent[0].html, '<p>a@example.org - Plus</p>');
    await service.cancel(code);
    await assert.rejects(
      service.sendById(alice.id, {
        send: async () => {
          throw Error('must not send');
        },
      }),
      /cancelled/
    );
  } finally {
    await close();
  }
});
test('queue outage leaves a durable campaign that can be re-enqueued; authorization and invalid JSON are rejected', async () => {
  /** Owned in-memory fixture retained and disconnected in finally. */
  const { db, close } = await database();
  try {
    /** Borrowed synthetic message identity store shared with this campaign service. */
    const mailStore = delivery();
    /** Captured opaque native queue requests; no Redis or broker connection is made. */
    const jobs = [];
    let offline = true;
    /** Synthetic native add port capturing opaque job identities and scheduling options. */
    const queue = {
      /**
       * Capture only explicit native queue requests without publishing to a broker.
       *
       * @param {string} name - Fixed explicit queue task name.
       * @param {object} data - Opaque message reference only, never a recipient body.
       * @param {object} settings - Explicit native task scheduling fields.
       * @returns {Promise<void>} Capture completed, or deliberate queue-outage rejection.
       */
      async add(name, data, settings) {
        if (offline) {
          throw Error('queue offline');
        }
        jobs.push({ name, data, settings });
      },
    };
    /** Function-first campaign service borrowing only isolated fixtures. */
    const service = createMarketingCampaignService({
      db,
      queue,
      delivery: mailStore,
      now: () => 10_000,
    });
    /** Opaque synthetic campaign reference; configured host authorization remains authoritative. */
    const code = await service.create({
      name: 'Retry',
      subject: 'Hi {{name}}',
      text: 'Welcome {{email}}',
      account: 'primary',
      recipients: ['sample@example.org'],
    });
    assert.equal((await service.get(code)).status, 'queue_failed');
    offline = false;
    /** Aggregate import/enqueue progress; never a recipient data log. */
    const progress = await service.enqueue(code);
    assert.equal(progress.queued, 1);
    assert.equal((await service.get(code)).status, 'ready');
    assert.equal(jobs.length, 1);
    await assert.rejects(
      service.create({
        name: 'Bad',
        subject: 'subject',
        text: 'body',
        account: 'primary',
        data: { nested: { constructor: 1 } },
        recipients: ['a@example.org'],
      }),
      /Forbidden/
    );
    await assert.rejects(
      service.create({
        name: 'Bad',
        subject: 'subject',
        text: 'body',
        account: 'primary',
        recipients: ['a@example.org', 'A@example.org'],
      }),
      /Duplicate/
    );
    /** Separate service whose explicit host authorization always denies management reads. */
    const guarded = createMarketingCampaignService({
      db,
      queue,
      delivery: mailStore,
      authorize: () => false,
    });
    await assert.rejects(guarded.get(code), /denied/);
  } finally {
    await close();
  }
});

test('one-call content/emails API supports registered ZeruxJS variables and delayed queue jobs', async () => {
  /** Owned in-memory fixture retained and disconnected in finally. */
  const { db, close } = await database();
  try {
    /** Trusted registered framework variable evaluator; campaign strings never execute arbitrary source. */
    const registry = createVariableRegistry();
    registry.register('app.support', async () => 'team@example.org');
    /** Captured opaque native queue requests; no Redis or broker connection is made. */
    const jobs = [];
    /** Fixed future epoch milliseconds used to assert native queue delay. */
    const future = 25_000;
    /** Function-first service with an explicit trusted renderer and fixed clock. */
    const marketing = createMarketingCampaignService({
      db,
      queue: {
        /**
         * Capture only explicit native queue requests without publishing to a broker.
         *
         * @param {string} name - Fixed explicit queue task name.
         * @param {object} data - Opaque message reference only, never a recipient body.
         * @param {object} opts - Explicit native task scheduling fields.
         * @returns {Promise<void>} Capture completed, or deliberate queue-outage rejection.
         */
        async add(name, data, opts) {
          jobs.push({ name, data, opts });
        },
      },
      delivery: delivery(),
      renderer: registry,
      now: () => 10_000,
    });
    /** Opaque synthetic campaign reference; configured host authorization remains authoritative. */
    const code = await marketing.create({
      name: 'Product',
      subject: 'Hi {{name}} - {{app.support}}',
      content: '<p>Hi {{name}}. Contact {{app.support}} for {{offer}}</p>',
      providers: ['smtp'],
      data: { offer: '<private>' },
      emails: [{ email: 'user@example.org', name: 'Sam' }],
      isTracking: false,
      sendAt: future,
    });
    /** Bounded private audience page used to select one authorized preview. */
    const { recipients } = await marketing.recipients(code);
    /** Authorized private render result; HTML remains inert data in this Node fixture. */
    const preview = await marketing.preview(code, recipients[0].id);
    assert.equal(preview.subject, 'Hi Sam - team@example.org');
    assert.equal(
      preview.html,
      '<p>Hi Sam. Contact team@example.org for &lt;private&gt;</p>'
    );
    assert.equal(preview.tracking.enabled, false);
    assert.equal(jobs[0].opts.delay, 15_000);
    assert.equal(await marketing.deliveryGate({ campaignId: code }), 'defer');
    assert.equal(await marketing.deliveryGate({}), 'allow');
    await marketing.cancel(code);
    assert.equal(
      await marketing.deliveryGate({ campaignId: code }),
      'suppress'
    );
  } finally {
    await close();
  }
});
