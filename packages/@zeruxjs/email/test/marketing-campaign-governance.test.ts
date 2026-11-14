import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createMarketingCampaignService,
  createMarketingCampaignDashboard,
} from '../dist/index.js';
/** Fixed CommonJS bridge for the built native SQLite adapter. */
const require = createRequire(import.meta.url);
/** Public native factory used only with isolated in-memory state. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Fixed private structured operation context, never operator application storage. */
const ctx = {
  connection: {
    slug: 'campaign-governance',
    name: 'campaign-governance',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Open only an owned in-memory SQLite database for governance assertions.
 *
 * @returns {Promise<object>} Borrowed database port plus awaited disconnect cleanup.
 */
async function database() {
  /** Owned native in-memory connector; fixture returns its disconnect cleanup. */
  const conn = await createConnector({ filename: ':memory:', driver: 'node' });
  /** Borrowed finite operation port over the owned connector. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (args) => conn.execute({ op, ...args }, ctx)]
    )
  );
  return { db, close: () => conn.disconnect() };
}
/**
 * Create an isolated delivery identity/state protocol fixture.
 *
 * @returns {object} Local create/load port; no production durability claim.
 */
function deliveries() {
  /** Private synthetic message identities; Map state is not a durable delivery ledger. */
  const records = new Map();
  return {
    records,
    /**
     * Reserve one exact synthetic delivery identity without overwriting prior state.
     *
     * @param {object} r - Private synthetic pending delivery record.
     * @returns {Promise<boolean>} True for first creation, false for duplicate identity.
     */
    async create(r) {
      if (records.has(r.id)) {
        return false;
      }
      records.set(r.id, { ...r });
      return true;
    },
    /**
     * Read one private synthetic delivery record.
     *
     * @param {string} id - Opaque synthetic delivery reference.
     * @returns {Promise<object | null>} Fixture state or absence; no socket or native acquisition.
     */
    async load(id) {
      return records.get(id) ?? null;
    },
  };
}
/**
 * Build a finite inert campaign definition with explicit delivery policy overrides.
 *
 * @param {unknown[]} recipients - Finite synthetic recipient inputs.
 * @param {object} extra - Explicit synthetic definition/action fields, empty by default.
 * @returns {object} Synthetic input; no template/module code is executed.
 */
const createInput = (recipients, extra = {}) => ({
  name: 'Campaign governance',
  subject: 'Welcome {{name}} {{discount}}',
  html: '<p>{{name}}</p>',
  text: 'Plain {{name}}',
  account: 'primary',
  data: { discount: 'SAVE' },
  recipients,
  autoEnqueue: false,
  ...extra,
});

test('segmented campaigns: portable keyset batches, schedule, explicit consent and suppression', async () => {
  /** Owned synthetic database fixture retained and closed in finally. */
  const { db, close } = await database();
  try {
    /** Captured opaque native task requests; no external broker or SMTP. */
    const jobs = [];
    /** Synthetic delivery-state fixture; campaign revisions still use real in-memory SQLite CAS. */
    const store = deliveries();
    /** Fixed fixture epoch for deterministic schedule and native delay assertions. */
    const time = 1000;
    /** Function-first campaign service borrowing only explicitly injected fixture ports. */
    const service = createMarketingCampaignService({
      db,
      delivery: store,
      queue: {
        /**
         * Capture opaque native task requests or hold their actual settlement through a fixture gate.
         *
         * @param {string} name - Fixed native task name.
         * @param {object} data - Opaque message identity only; never body/recipient payloads.
         * @param {object} opts - Explicit stable identity, delay and retry fixture fields.
         * @returns {Promise<void>} Queue fixture settled; caller timeout alone does not release actual work.
         */
        async add(name, data, opts) {
          jobs.push({ name, data, opts });
        },
      },
      now: () => time,
      isSubscribed: (email) => email !== 'unsubscribed@example.com',
      isSuppressed: (email) => email === 'suppressed@example.com',
    });
    /** Finite private synthetic audience containing explicit consent/suppression/segment denials. */
    const users = [
      { email: 'unsubscribed@example.com', data: { tier: 'gold' } },
      { email: 'suppressed@example.com', data: { tier: 'gold' } },
      { email: 'bronze@example.com', data: { tier: 'bronze' } },
      ...Array.from({ length: 412 }, (_, i) => ({
        email: `user${i}@example.com`,
        data: { tier: 'gold' },
      })),
    ];
    /** Opaque synthetic campaign reference; access policy remains separate. */
    const code = await service.create(
      createInput(users, {
        segment: { all: [{ field: 'tier', operator: 'eq', value: 'gold' }] },
      })
    );
    /** Committed native schedule/enqueue projection; acceptance is not inbox delivery. */
    const scheduled = await service.schedule(code, 101_000);
    assert.equal(scheduled.queued, 412);
    assert.equal(scheduled.excluded, 3);
    assert.equal(jobs.length, 412);
    assert.ok(
      jobs.every(
        (j) =>
          j.name === 'email.deliver' &&
          j.data.messageId === j.opts.jobId &&
          j.opts.delay === 100_000
      )
    );
    assert.equal((await service.audience(code)).unqueued, 3);
    await assert.rejects(service.schedule(code, 200_000), /Already enqueued/);
    assert.equal((await service.enqueue(code)).queued, 0);
    /** Bounded private campaign list used only inside this fixture. */
    const list = await service.list();
    assert.equal(list.campaigns.length, 1);
    /** Bounded private preview page retaining explicit continuation. */
    const page = await service.previewPage(code, { limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].subject.includes('SAVE'), true);
    /** Default export projection; private recipient fields require separate authorization. */
    const redacted = await service.exportPage(code, { limit: 2 });
    assert.equal(redacted.items.length, 2);
    assert.ok(!('email' in redacted.items[0]));
    assert.equal(
      (
        await service.exportPage(code, {
          cursor: redacted.nextCursor,
          limit: 2,
        })
      ).items.length,
      2
    );
  } finally {
    await close();
  }
});

test('two workers sharing a SQL CAS store cannot simultaneously publish the same campaign page', async () => {
  /** Owned synthetic database fixture retained and closed in finally. */
  const { db, close } = await database();
  try {
    /** Synthetic delivery-state fixture; campaign revisions still use real in-memory SQLite CAS. */
    const store = deliveries();
    let release;
    let notify;
    /** Synthetic notification that the first enqueue owns its native pending call. */
    const entered = new Promise((ok) => (notify = ok));
    /** Owned pending native queue fixture gate; release/observe before database cleanup. */
    const blocker = new Promise((ok) => (release = ok));
    /** Captured opaque native task requests; no external broker or SMTP. */
    const jobs = [];
    /** Injected native add capability with a controllable pending gate; no broker connection. */
    const queue = {
      /**
       * Capture opaque native task requests or hold their actual settlement through a fixture gate.
       *
       * @param {string} name - Fixed native task name.
       * @param {object} data - Opaque message identity only; never body/recipient payloads.
       * @param {object} _opts - Explicit scheduling fields intentionally unused by the held-call fixture.
       * @returns {Promise<void>} Queue fixture settled; caller timeout alone does not release actual work.
       */
      async add(name, data, _opts) {
        jobs.push(data.messageId);
        notify();
        await blocker;
      },
    };
    /** First controller over the shared synthetic SQL CAS namespace. */
    const one = createMarketingCampaignService({
      db,
      delivery: store,
      queue,
      now: () => 1000,
    });
    /** Second controller testing lease contention, not cross-process worker qualification. */
    const two = createMarketingCampaignService({
      db,
      delivery: store,
      queue,
      now: () => 1000,
    });
    /** Opaque synthetic campaign reference; access policy remains separate. */
    const code = await one.create(createInput(['single@example.com']));
    /** Pending enqueue promise or bounded audience page; native work must settle before teardown. */
    const first = one.enqueue(code);
    try {
      await entered;
      await assert.rejects(two.enqueue(code), /operation is busy/);
      release();
      assert.equal((await first).queued, 1);
      assert.equal((await two.enqueue(code)).queued, 0);
      assert.deepEqual(jobs.length, 1);
    } finally {
      // Release and observe actual queue settlement before the enclosing database closes.
      release();
      await first.catch(() => {});
    }
  } finally {
    await close();
  }
});

test('archive blocks unknown SMTP outcomes; sensitive exports require extra permission; retention fails closed', async () => {
  /** Owned synthetic database fixture retained and closed in finally. */
  const { db, close } = await database();
  try {
    let allowPII = false,
      legalHold = true,
      time = 10_000;
    /** Synthetic create/load state for exact pending/sent/uncertain delivery identities. */
    const delivery = deliveries();
    /** Captured opaque native task requests; no external broker or SMTP. */
    const jobs = [];
    /** Function-first campaign service borrowing only explicitly injected fixture ports. */
    const service = createMarketingCampaignService({
      db,
      delivery,
      now: () => time,
      queue: {
        /**
         * Capture opaque native task requests or hold their actual settlement through a fixture gate.
         *
         * @param {string} _n - Fixed native task name; intentionally unused in this capture.
         * @param {object} d - Opaque synthetic message reference.
         * @returns {Promise<void>} Queue fixture settled; caller timeout alone does not release actual work.
         */
        async add(_n, d) {
          jobs.push(d.messageId);
        },
        /**
         * Supply explicit native absence evidence for an authorized pending redrive fixture.
         *
         * @returns {Promise<null>} Synthetic absent task; sent/uncertain records remain ineligible.
         */
        async getJob() {
          return null;
        },
      },
      authorize: (action) => action !== 'exportPII' || allowPII,
      approveRetention: () => !legalHold,
    });
    /** Opaque synthetic campaign reference; access policy remains separate. */
    const code = await service.create(
      createInput(
        [
          {
            email: 'alice@example.com',
            name: 'Alice',
            data: { secret: 'sensitive' },
          },
          'bob@example.com',
        ],
        { autoEnqueue: true }
      )
    );
    assert.equal(jobs.length, 2);
    assert.equal(
      (await service.redrivePending(code, { limit: 2 })).submitted,
      2
    ); // approved operator, absent jobs, pending records
    /** Pending enqueue promise or bounded audience page; native work must settle before teardown. */
    const first = await service.recipients(code);
    assert.equal(first.recipients.length, 2);
    /** Private synthetic delivery record changed only inside this fixture. */
    const row = delivery.records.get(first.recipients[0].id);
    delivery.records.set(row.id, { ...row, state: 'uncertain' });
    await service.cancel(code);
    await assert.rejects(service.archive(code), /pending or uncertain/);
    // Transition only the finite synthetic delivery identities to declared terminal states.
    for (const r of first.recipients) {
      /** Private fixture state used to set terminal suppression before archive eligibility. */
      const state = delivery.records.get(r.id);
      delivery.records.set(r.id, { ...state, state: 'suppressed' });
    }
    /** Committed archive state; archival is distinct from recipient/content erasure. */
    const archived = await service.archive(code);
    assert.equal(archived.status, 'archived');
    assert.equal(await service.deliveryGate({ campaignId: code }), 'suppress');
    /** Default bounded export; private mailbox and data must remain absent. */
    const redactedExport = await service.exportPage(code);
    assert.doesNotMatch(
      JSON.stringify(redactedExport),
      /alice@example.com|sensitive/
    );
    await assert.rejects(
      service.exportPage(code, { includePII: true }),
      /denied/
    );
    allowPII = true;
    /** Separately authorized private export after explicit exportPII approval. */
    const privateExport = await service.exportPage(code, { includePII: true });
    assert.match(JSON.stringify(privateExport), /sensitive/);
    time = 12_000;
    await assert.rejects(
      service.redactArchived(code, { olderThan: 11_000, dryRun: false }),
      /not approved/
    );
    legalHold = false;
    /** Approved preview receipt; payload erasure must remain zero by default. */
    const dry = await service.redactArchived(code, { olderThan: 11_000 });
    assert.equal(dry.deleted, 0);
    /** Approved synthetic retention result; no real user records are touched. */
    const erased = await service.redactArchived(code, {
      olderThan: 11_000,
      dryRun: false,
    });
    assert.equal(erased.deleted, 2);
    assert.equal(erased.redacted, true);
    /** Persisted campaign after final retention redaction; historical audit remains separate. */
    const saved = await service.get(code);
    assert.equal(saved.subject, '[redacted]');
    assert.deepEqual(saved.data, {});
    assert.equal(saved.redactedAt, 12_000);
    assert.equal((await service.exportPage(code)).items.length, 0);
    assert.equal(
      (await service.redactArchived(code, { olderThan: 11_000, dryRun: false }))
        .redacted,
      true
    );
  } finally {
    await close();
  }
});

test('operator dashboard enforces origin, CSRF, scoped schedule/export/archive permissions', async () => {
  /** Owned synthetic database fixture retained and closed in finally. */
  const { db, close } = await database();
  try {
    let permitted = 'schedule';
    /** Function-first campaign service borrowing only explicitly injected fixture ports. */
    const service = createMarketingCampaignService({
      db,
      delivery: deliveries(),
      queue: {
        /**
         * Capture opaque native task requests or hold their actual settlement through a fixture gate.
         *
         * @returns {Promise<void>} Queue fixture settled; caller timeout alone does not release actual work.
         */
        async add() {},
      },
      now: () => 1000,
    });
    /** Opaque synthetic campaign reference; access policy remains separate. */
    const code = await service.create(createInput(['one@example.com']));
    /** Local authorized management handler; no server listener is started. */
    const dash = createMarketingCampaignDashboard({
      service,
      authorize: () => ({ role: 'operator' }),
      authorizeCreate: () => true,
      authorizeCampaign: (_who, id, action) =>
        id === code && action === permitted,
      verifyCsrf: () => true,
      csrfToken: () => 'x'.repeat(32),
    });
    /** Synthetic fixed management origin/path, never an outbound destination. */
    const url = 'https://marketing.example.org/_email/marketing/api';
    /**
     * Create a local CSRF/origin policy request without performing network I/O.
     *
     * @param {string} action - Explicit management action; host policy must authorize it.
     * @param {object} extra - Explicit synthetic definition/action fields, empty by default.
     * @param {string} origin - Explicit request origin, default the fixed synthetic trusted origin.
     * @returns {Request} Synthetic write request for direct handler invocation.
     */
    const post = (
      action,
      extra = {},
      origin = 'https://marketing.example.org'
    ) =>
      new Request(url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ code, action, ...extra }),
      });
    assert.equal(
      (
        await dash.handle(
          post('schedule', { sendAt: 5000 }, 'https://attacker.example')
        )
      ).status,
      403
    );
    assert.equal(
      (await dash.handle(post('schedule', { sendAt: 5000 }))).status,
      200
    );
    permitted = 'export';
    /** Bounded default export projection returned by the local authenticated handler. */
    const e = await (
      await dash.handle(new Request(url + '?code=' + code + '&view=export'))
    ).json();
    assert.equal(e.items.length, 1);
    assert.ok(!('email' in e.items[0]));
    assert.equal((await dash.handle(post('archive'))).status, 403);
  } finally {
    await close();
  }
});

test('durable PII-free audit trail and state reports never infer inbox delivery from SMTP acceptance', async () => {
  /** Owned synthetic database fixture retained and closed in finally. */
  const { db, close } = await database();
  try {
    /** Public database audit adapter; native database lifetime remains borrowed. */
    const { createDatabaseMarketingAuditLog } =
      await import('../dist/index.js');
    /** Borrowed aggregate-only audit journal over the synthetic database. */
    const log = createDatabaseMarketingAuditLog(db);
    /** Synthetic create/load state for exact pending/sent/uncertain delivery identities. */
    const delivery = deliveries();
    /** Function-first campaign service borrowing only explicitly injected fixture ports. */
    const service = createMarketingCampaignService({
      db,
      delivery,
      queue: {
        /**
         * Capture opaque native task requests or hold their actual settlement through a fixture gate.
         *
         * @returns {Promise<void>} Queue fixture settled; caller timeout alone does not release actual work.
         */
        async add() {},
      },
      now: () => 1000,
      onAudit: log.record,
    });
    /** Opaque synthetic campaign reference; access policy remains separate. */
    const code = await service.create(
      createInput(['one@example.com', 'two@example.com'], { autoEnqueue: true })
    );
    /** Bounded private audience page used to bind exact synthetic delivery identities. */
    const { recipients } = await service.recipients(code);
    /** Private synthetic delivery record changed only inside this fixture. */
    const row = delivery.records.get(recipients[0].id);
    delivery.records.set(row.id, { ...row, state: 'sent' });
    /** Partial-page delivery-state projection; coverage must remain explicit. */
    const result = await service.report(code, { limit: 1 });
    assert.equal(result.scanned, 1);
    assert.equal(result.done, false);
    /** Complete bounded fixture report; SMTP acceptance is never confirmed inbox delivery. */
    const entire = await service.report(code, { limit: 10 });
    assert.equal(entire.states.smtpAccepted, 1);
    assert.equal(entire.states.pending, 1);
    assert.match(entire.disclaimer, /not confirmed mailbox/);
    /** Native aggregate audit page checked for absence of synthetic private mailboxes. */
    const audit = await log.page(code);
    assert.ok(audit.items.some((x) => x.action === 'create'));
    assert.ok(audit.items.some((x) => x.action === 'enqueue'));
    assert.doesNotMatch(
      JSON.stringify(audit),
      /one@example.com|two@example.com/
    );
    /** Next exclusive audit page used to assert stable keyset continuation. */
    const second = await log.page(code, { limit: 1 });
    assert.equal(second.done, false);
    assert.equal(
      (await log.page(code, { cursor: second.nextCursor, limit: 1 })).items
        .length,
      1
    );
  } finally {
    await close();
  }
});

test('completed campaigns transition only after all durable SMTP outcomes become terminal', async () => {
  /** Owned synthetic database fixture retained and closed in finally. */
  const { db, close } = await database();
  try {
    /** Synthetic create/load state for exact pending/sent/uncertain delivery identities. */
    const delivery = deliveries();
    /** Function-first campaign service borrowing only explicitly injected fixture ports. */
    const service = createMarketingCampaignService({
      db,
      delivery,
      queue: {
        /**
         * Capture opaque native task requests or hold their actual settlement through a fixture gate.
         *
         * @returns {Promise<void>} Queue fixture settled; caller timeout alone does not release actual work.
         */
        async add() {},
      },
      now: () => 1000,
    });
    /** Opaque synthetic campaign reference; access policy remains separate. */
    const code = await service.create(
      createInput(['one@example.org', 'two@example.org'], { autoEnqueue: true })
    );
    /** Finalization receipt while registered delivery states remain nonterminal. */
    const pending = await service.finalize(code);
    assert.equal(pending.status, 'ready');
    assert.equal(pending.nonterminal, 2);
    // Transition only the finite synthetic delivery identities to declared terminal states.
    for (const id of delivery.records.keys()) {
      /** Private synthetic delivery record changed only inside this fixture. */
      const row = delivery.records.get(id);
      delivery.records.set(id, { ...row, state: 'sent' });
    }
    /** Finalization receipt after every registered fixture delivery becomes terminal. */
    const complete = await service.finalize(code);
    assert.equal(complete.status, 'completed');
    assert.equal((await service.get(code)).status, 'completed');
    assert.equal(await service.deliveryGate({ campaignId: code }), 'suppress');
    await assert.rejects(service.enqueue(code), /cannot be enqueued/);
    assert.equal((await service.archive(code)).status, 'archived');
  } finally {
    await close();
  }
});
