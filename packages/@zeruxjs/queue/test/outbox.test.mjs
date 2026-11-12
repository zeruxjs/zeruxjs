import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabaseDeliveryOutbox,
  createDeliveryOutboxDispatcher,
  createOutboxBackedEmailQueue,
  createDatabaseEmailDeliveryStore,
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
/** Adapt explicit public connector operations into the fixture database contract.
 * @param {object} c - Borrowed disposable connector; outer fixture disconnects it.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const facade = (c) =>
  Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (arg) => c.execute({ op, ...arg }, ctx),
    ])
  );
/** Create explicit synthetic delivery facts with deterministic routing/state.
 * @param {string} id - Opaque synthetic job/record ID.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const mk = (id) => ({
  id,
  version: 1,
  purpose: 'marketing',
  recipient: 'secret@example.test',
  campaignId: 'campaign69',
  state: 'pending',
  lease: null,
  updatedAt: 5000,
});
/** Create isolated synthetic durable/native state; caller or callback owns teardown.
 * @param {function} fn - Explicit fixture callback/event handler.
 * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
async function fixture(fn) {
  /** Owned disposable fixture directory removed after dependent connector/service cleanup. */
  const dir = await mkdtemp(join(tmpdir(), 'zerux-outbox-'));
  let a, b;
  try {
    /** Owned synthetic database filename beneath the disposable directory. */
    const file = join(dir, 'mail.sqlite');
    a = await createConnector({ filename: file, driver: 'node' });
    b = await createConnector({ filename: file, driver: 'node' });
    return await fn(facade(a), facade(b));
  } finally {
    try {
      await a?.disconnect();
    } finally {
      try {
        await b?.disconnect();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
}
test('durable outbox survives Redis failure, crash after queue acceptance, concurrent workers', () =>
  fixture(async (dbA, dbB) => {
    let t = 5000;
    /** First isolated connector/store/service owner used for concurrency checks. */
    const a = createDatabaseDeliveryOutbox(
      dbA,
      'zerux_email_publish_outbox',
      () => t
    );
    /** Second isolated connector/store/service used for actual contention checks. */
    const b = createDatabaseDeliveryOutbox(
      dbB,
      'zerux_email_publish_outbox',
      () => t
    );
    /** Observed original-channel or destructive disposition with distinct guarantees. */
    const delivery = createDatabaseEmailDeliveryStore(dbA);
    await delivery.create(mk('one'));
    assert.deepEqual(
      await a.register('one', { scheduledAt: 9000, attempts: 5 }),
      { created: true, status: 'pending' }
    );
    assert.deepEqual(
      await b.register('one', { scheduledAt: 9000, attempts: 5 }),
      { created: false, status: 'pending' }
    );
    await assert.rejects(
      b.register('one', { scheduledAt: 9001, attempts: 5 }),
      /Conflicting/
    );
    /** Synthetic queued records or in-memory job map, scoped to one test. */
    const jobs = [];
    let fail = true;
    /** Injected opaque-reference producer, without real broker publication. */
    const publisher = {
      add: async (name, data, options) => {
        if (fail) {
          throw Error('Redis unavailable');
        }
        jobs.push({ name, data, options });
        return { id: options.jobId };
      },
    };
    /** First operation/record/page used as the normal concurrency control. */
    const first = createDeliveryOutboxDispatcher({
      outbox: a,
      queue: publisher,
      delivery,
      now: () => t,
      leaseMs: 3000,
    });
    /** Second independent page/claim/service used to check contention or continuation. */
    const second = createDeliveryOutboxDispatcher({
      outbox: b,
      queue: publisher,
      delivery,
      now: () => t,
      leaseMs: 3000,
    });
    await assert.rejects(first.dispatch('one'), /Redis unavailable/);
    assert.equal((await b.get('one')).status, 'pending');
    fail = false;
    /** Concurrent synthetic dispatch outcomes used to check one winning claim. */
    const [x, y] = await Promise.all([
      first.dispatch('one'),
      second.dispatch('one'),
    ]);
    assert.deepEqual([x, y].sort(), ['published', 'skipped']);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0], {
      name: 'email.deliver',
      data: { messageId: 'one' },
      options: { jobId: 'one', delay: 4000, attempts: 5 },
    });
    assert.equal((await first.runPage()).published, 0);
    assert.equal(
      JSON.stringify(await a.get('one')).includes('secret@example.test'),
      false
    );
    await delivery.create(mk('two'));
    await a.register('two', { scheduledAt: 9000 });
    /** Observed durable lease/claim receipt before contention or expiry. */
    const claim = await a.claim('two', 3000);
    assert.ok(claim.lease.token);
    assert.equal(await b.claim('two', 3000), null);
    t = 8001;
    /** New synthetic claim token after permitted lease recovery; old token must fail. */
    const stolen = await b.claim('two', 3000);
    assert.notEqual(stolen.lease.token, claim.lease.token);
    assert.equal(await a.settle('two', claim.lease.token, 'published'), false);
    assert.equal(await b.settle('two', stolen.lease.token, 'pending'), true);
    assert.equal(await first.dispatch('two'), 'published');
    assert.equal(jobs.at(-1).options.jobId, 'two');
  }));
test('registration-only producer preserves intent through outages and scans recover pending rows', () =>
  fixture(async (db) => {
    let t = 10000;
    /** Synthetic durable publish-intent ledger, separate from broker storage. */
    const outbox = createDatabaseDeliveryOutbox(
      db,
      'zerux_email_publish_outbox',
      () => t
    );
    /** Observed original-channel or destructive disposition with distinct guarantees. */
    const delivery = createDatabaseEmailDeliveryStore(db);
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (const id of ['a', 'b', 'c']) {
      await delivery.create(mk(id));
    }
    /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
    const queue = createOutboxBackedEmailQueue({ outbox, now: () => t });
    /** Explicit synthetic publication callback; admission is not business durability.
     * @param {string} id - Opaque synthetic job/record ID.
     * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
     */
    const push = (id) =>
      queue.add(
        'email.deliver',
        { messageId: id },
        { jobId: id, delay: 5000, attempts: 3 }
      );
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (const id of ['a', 'b', 'c']) {
      assert.equal((await push(id)).persisted, true);
    }
    t = 11000;
    await push('a');
    assert.equal((await outbox.get('a')).scheduledAt, 15000);
    await assert.rejects(
      queue.add(
        'email.deliver',
        { messageId: 'a' },
        { jobId: 'a', delay: 0, attempts: 2 }
      ),
      /Conflicting/
    );
    let attempts = 0;
    /** Explicit bounded publish-intent dispatcher; no background loop starts. */
    const dispatcher = createDeliveryOutboxDispatcher({
      outbox,
      queue: {
        add: async () => {
          attempts++;
          return { id: 'ok' };
        },
      },
      delivery,
      now: () => t,
    });
    /** First bounded dispatch page and continuation. */
    const p1 = await dispatcher.runPage({ limit: 2 });
    assert.equal(p1.published, 2);
    assert.ok(p1.nextCursor);
    /** Second bounded dispatch page using the returned cursor. */
    const p2 = await dispatcher.runPage({ cursor: p1.nextCursor, limit: 2 });
    assert.equal(p2.published, 1);
    assert.equal(attempts, 3);
    assert.equal((await outbox.page({ limit: 2 })).items.length, 2);
    /** Exact prior synthetic revision required by compare-and-swap. */
    const old = await delivery.load('c');
    assert.equal(
      await delivery.save('c', { ...old, state: 'sent', version: 2 }, 1),
      true
    );
    assert.equal(await dispatcher.dispatch('c'), 'skipped');
    // Reset with a new pending row whose delivery is already terminal.
    await delivery.create({ ...mk('terminal'), state: 'sent' });
    await outbox.register('terminal', { scheduledAt: 11000 });
    assert.equal(await dispatcher.dispatch('terminal'), 'abandoned');
    assert.equal((await outbox.get('terminal')).status, 'abandoned');
  }));
test('queue acknowledgement crash may replay ID but never changes stable job identity', () =>
  fixture(async (db) => {
    let t = 1000;
    /** Synthetic durable publish/history/provider ledger; no memory-to-production guarantee. */
    const ledger = createDatabaseDeliveryOutbox(
      db,
      'zerux_email_publish_outbox',
      () => t
    );
    /** Observed original-channel or destructive disposition with distinct guarantees. */
    const delivery = createDatabaseEmailDeliveryStore(db);
    await delivery.create(mk('crash'));
    await ledger.register('crash', { scheduledAt: 1000 });
    /** Fixture-local observed stable job IDs, not delivery exactly-once proof. */
    const observed = [];
    /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
    const queue = {
      add: async (name, data, opts) => {
        observed.push(opts.jobId);
        return { id: opts.jobId };
      },
    };
    /** Explicit bounded publish-intent dispatcher; no background loop starts. */
    const dispatcher = createDeliveryOutboxDispatcher({
      outbox: ledger,
      queue,
      delivery,
      now: () => t,
      leaseMs: 3000,
    });
    /** Synthetic lease/namespace token, never an operator access credential. */
    const token = (await ledger.claim('crash', 3000)).lease.token;
    // Simulate a process that published to Redis but died before DB ack.
    await queue.add(
      'email.deliver',
      { messageId: 'crash' },
      { jobId: 'crash', delay: 0, attempts: 3 }
    );
    t = 4001;
    assert.equal(await dispatcher.dispatch('crash'), 'published');
    assert.deepEqual(observed, ['crash', 'crash']);
    assert.equal(await ledger.settle('crash', token, 'published'), false);
  }));
test('due scans skip published history, redrive is authorized and only reopens missing pending jobs', () =>
  fixture(async (db) => {
    /** Public authorized reconciliation helpers with explicit bounded polling. */
    const { createDeliveryOutboxRedriver, createDeliveryOutboxJobProcessor } =
      await import('../dist/index.js');
    /** Synthetic durable publish-intent ledger, separate from broker storage. */
    const outbox = createDatabaseDeliveryOutbox(
      db,
      'zerux_email_publish_outbox',
      () => 5000
    );
    /** Observed original-channel or destructive disposition with distinct guarantees. */
    const delivery = createDatabaseEmailDeliveryStore(db);
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (let i = 0; i < 18; i++) {
      /** Validated synthetic opaque record/job identity, not authorization. */
      const id = `item${String(i).padStart(2, '0')}`;
      await delivery.create(mk(id));
      await outbox.register(id, { scheduledAt: 5000 });
    }
    /** Recorded synthetic published references, not raw messages. */
    const published = [];
    /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
    const queue = {
      add: async (_name, _data, opt) => {
        published.push(opt.jobId);
        return { id: opt.jobId };
      },
      getJob: async () => null,
    };
    /** Explicit bounded publish-intent dispatcher; no background loop starts. */
    const dispatcher = createDeliveryOutboxDispatcher({
      outbox,
      queue,
      delivery,
      now: () => 5000,
    });
    /** Explicit bounded synthetic outbox-page processor. */
    const poll = createDeliveryOutboxJobProcessor(dispatcher, {
      pageSize: 5,
      maxPages: 10,
    });
    /** First operation/record/page used as the normal concurrency control. */
    const first = await poll({ name: 'email.outbox.poll', data: {} });
    assert.deepEqual(
      [first.published, first.done, published.length],
      [18, true, 18]
    );
    assert.equal((await outbox.due({ limit: 5 })).items.length, 0);
    await delivery.create(mk('zzNew'));
    await outbox.register('zzNew', { scheduledAt: 5000 });
    /** Explicit synthetic recovery/report/processor callback selected by this test. */
    const run = await dispatcher.runPage({ limit: 1 });
    assert.equal(run.published, 1);
    assert.equal(published.at(-1), 'zzNew');
    /** Deliberately denied privileged operation used to prove fail-closed policy. */
    const blocked = createDeliveryOutboxRedriver({
      outbox,
      queue,
      delivery,
      authorize: () => false,
    });
    await assert.rejects(blocked('item00'), /not authorized/);
    /** Explicit authorized synthetic reconciliation operation; never automatic resend. */
    const redrive = createDeliveryOutboxRedriver({
      outbox,
      queue,
      delivery,
      authorize: () => true,
    });
    assert.deepEqual(await redrive('item00'), {
      reopened: true,
      reason: 'queue-job-missing',
    });
    assert.equal((await outbox.due()).items[0].id, 'item00');
    assert.equal(await dispatcher.dispatch('item00'), 'published');
    assert.equal(published.filter((x) => x === 'item00').length, 2);
    /** Synthetic broker-presence control preventing unnecessary redrive. */
    const jobExists = createDeliveryOutboxRedriver({
      outbox,
      queue: { getJob: async () => ({ id: 'item01' }) },
      delivery,
      authorize: () => true,
    });
    assert.deepEqual(await jobExists('item01'), {
      reopened: false,
      reason: 'queue-job-present',
    });
    await assert.rejects(
      poll({ name: 'email.outbox.poll', data: { private: 'value' } }),
      /no job payload/
    );
  }));
test('in-flight claimed delivery is deferred rather than permanently abandoned, recovery restores it', () =>
  fixture(async (db) => {
    /** Public bounded lease recovery scanner; sending outcomes remain uncertain. */
    const { createEmailDeliveryRecoveryScanner } =
      await import('../dist/index.js');
    /** Fixed synthetic epoch clock; this case never advances it. */
    const t = 7000;
    /** Synthetic durable publish-intent ledger, separate from broker storage. */
    const outbox = createDatabaseDeliveryOutbox(
      db,
      'zerux_email_publish_outbox',
      () => t
    );
    /** Observed original-channel or destructive disposition with distinct guarantees. */
    const delivery = createDatabaseEmailDeliveryStore(db);
    await delivery.create({
      ...mk('claimed'),
      state: 'claimed',
      lease: { owner: 'process', token: 'old', expiresAt: 6000 },
    });
    await outbox.register('claimed', { scheduledAt: 7000 });
    /** Observed synthetic opaque-reference enqueue receipt. */
    const queued = [];
    /** Explicit bounded synthetic publication operation or result. */
    const dispatch = createDeliveryOutboxDispatcher({
      outbox,
      queue: {
        add: async (_n, _d, o) => {
          queued.push(o.jobId);
          return {};
        },
      },
      delivery,
      now: () => t,
    });
    assert.equal(await dispatch.dispatch('claimed'), 'deferred');
    assert.equal((await outbox.get('claimed')).status, 'pending');
    assert.deepEqual(queued, []);
    /** Explicit synthetic scan invoked by the test, without automatic scheduling. */
    const scan = createEmailDeliveryRecoveryScanner({
      store: delivery,
      now: () => t,
    });
    /** Observed recovery counts; missing outcomes are not fabricated. */
    const recovered = await scan('campaign69', { dryRun: false });
    assert.equal(recovered.recoveredClaims, 1);
    assert.equal(await dispatch.dispatch('claimed'), 'published');
    assert.deepEqual(queued, ['claimed']);
  }));

test('function-first campaign can enqueue to durable outbox without Redis and dispatch later', () =>
  fixture(async (db) => {
    /** Existing public campaign contract injected with synthetic database/queue. */
    const { createMarketingCampaignService } =
      await import('../../email/dist/index.js');
    /** Fixed synthetic epoch clock; this case never advances it. */
    const t = 1000;
    /** Synthetic durable publish-intent ledger, separate from broker storage. */
    const outbox = createDatabaseDeliveryOutbox(
      db,
      'zerux_email_publish_outbox',
      () => t
    );
    /** Observed original-channel or destructive disposition with distinct guarantees. */
    const delivery = createDatabaseEmailDeliveryStore(db);
    /** Observed native producer options or inert outbox-backed producer. */
    const producer = createOutboxBackedEmailQueue({ outbox, now: () => t });
    /** Synthetic campaign owner/service with no actual recipient delivery. */
    const campaign = createMarketingCampaignService({
      db,
      queue: producer,
      delivery,
      now: () => t,
    });
    /** Fixed expected public error code or deliberate synthetic validation helper. */
    const code = await campaign.create({
      name: 'Outbox recovery',
      subject: 'Hello {{name}}',
      content: 'Welcome {{email}}',
      contentType: 'text',
      account: 'primary',
      recipients: [
        { name: 'A', email: 'a@example.org' },
        { name: 'B', email: 'b@example.org' },
      ],
    });
    assert.equal((await campaign.audience(code)).enqueued, 2);
    assert.equal((await outbox.due()).items.length, 2);
    /** Synthetic queued records or in-memory job map, scoped to one test. */
    const jobs = [];
    /** Explicit bounded publish-intent dispatcher; no background loop starts. */
    const dispatcher = createDeliveryOutboxDispatcher({
      outbox,
      delivery,
      now: () => t,
      queue: {
        add: async (name, data, opts) => {
          jobs.push({ name, data, opts });
          return { id: opts.jobId };
        },
      },
    });
    /** Recorded synthetic published references, not raw messages. */
    const published = await dispatcher.runPage();
    assert.equal(published.published, 2);
    assert.equal(jobs.length, 2);
    assert.equal(
      jobs.every(
        (j) =>
          j.name === 'email.deliver' &&
          Object.keys(j.data).join() === 'messageId'
      ),
      true
    );
    assert.deepEqual(
      jobs.map((job) => Object.keys(job.data)),
      [['messageId'], ['messageId']]
    );
    /** Explicit synthetic source/database query projection; no remote content loading. */
    const source = await campaign.recipients(code);
    assert.equal(source.recipients.length, 2);
    assert.equal((await outbox.due()).items.length, 0);
  }));

test('missing outbox intent after delivery commit is repaired only for approved pending messages', () =>
  fixture(async (db) => {
    /** Public explicit missing-intent repair scanner requiring host approval. */
    const { createMissingEmailPublishIntentScanner } =
      await import('../dist/index.js');
    /** Synthetic durable publish/history/provider ledger; no memory-to-production guarantee. */
    const ledger = createDatabaseDeliveryOutbox(
      db,
      'zerux_email_publish_outbox',
      () => 3000
    );
    /** Isolated synthetic CAS/delivery store, never operator data. */
    const store = createDatabaseEmailDeliveryStore(db);
    await store.create(mk('missed'));
    await store.create({ ...mk('done'), state: 'sent' });
    /** Deliberately unauthorized synthetic workflow/transport. */
    const denied = createMissingEmailPublishIntentScanner({
      source: store,
      outbox: ledger,
      allowCampaign: () => false,
    });
    await assert.rejects(
      denied('campaign69', { scheduledAt: 3000 }),
      /forbidden/
    );
    /** Explicit synthetic scan invoked by the test, without automatic scheduling. */
    const scan = createMissingEmailPublishIntentScanner({
      source: store,
      outbox: ledger,
      allowCampaign: () => true,
    });
    /** Nonmutating synthetic preview receipt; must not create/delete records. */
    const dry = await scan('campaign69', { scheduledAt: 4000 });
    assert.equal(dry.missing, 1);
    assert.equal((await ledger.due()).items.length, 0);
    /** First operation/record/page used as the normal concurrency control. */
    const first = await scan('campaign69', {
      scheduledAt: 4000,
      dryRun: false,
    });
    assert.equal(first.registered, 1);
    assert.equal((await ledger.get('missed')).scheduledAt, 4000);
    assert.equal(await ledger.get('done'), null);
    /** Previously observed immutable event or unique-claim fixture, not a second side effect. */
    const replay = await scan('campaign69', {
      scheduledAt: 4000,
      dryRun: false,
    });
    assert.equal(replay.registered, 0);
  }));
