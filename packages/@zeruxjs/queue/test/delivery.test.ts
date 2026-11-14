import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDurableEmailDeliveryProcessor,
  createMemoryEmailDeliveryStore,
  enqueueEmailCampaignBatch,
} from '../dist/index.js';
/** Synthetic durable record or record factory; authoritative state remains in the fixture store.
 * @param {string} id - Opaque synthetic job/record ID.
 * @param {string} purpose - Explicit marketing/transactional fixture classification.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const record = (id, purpose = 'transactional') => ({
  id,
  version: 1,
  purpose,
  recipient: purpose === 'marketing' ? 'buyer@example.test' : undefined,
  state: 'pending',
  lease: null,
  updatedAt: 0,
});
/** One explicit synthetic task with bounded opaque record-reference data.
 * @param {string} id - Opaque synthetic job/record ID.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const job = (id) => ({ name: 'email.deliver', data: { messageId: id } });
test('concurrent workers do not send the same message twice', async () => {
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([record('once')]);
  let sends = 0,
    release;
  /** Held synthetic handler barrier, released before teardown even after an assertion fails. */
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => true,
    send: async () => {
      sends++;
      await hold;
    },
  });
  /** First operation/record/page used as the normal concurrency control. */
  const first = process(job('once'));
  while (sends === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await assert.rejects(process(job('once')), /claim busy/);
  release();
  assert.equal((await first).status, 'sent');
  assert.equal((await process(job('once'))).status, 'sent');
  assert.equal(sends, 1);
  assert.equal((await store.load('once')).state, 'sent');
});
test('marketing unsubscribed is suppressed and tracking has no implicit connection', async () => {
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([
    record('marketing1', 'marketing'),
  ]);
  let delivered = 0;
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => false,
    send: async () => {
      delivered++;
    },
  });
  assert.equal((await process(job('marketing1'))).status, 'suppressed');
  assert.equal(delivered, 0);
  assert.equal((await store.load('marketing1')).state, 'suppressed');
});
test('consent outage releases pre-send claim so worker can safely retry', async () => {
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([
    record('marketing2', 'marketing'),
  ]);
  let allow = false,
    delivered = 0;
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => {
      if (!allow) {
        throw Error('db offline');
      }
      return true;
    },
    send: async () => {
      delivered++;
    },
  });
  await assert.rejects(process(job('marketing2')), /db offline/);
  assert.equal((await store.load('marketing2')).state, 'pending');
  allow = true;
  assert.equal((await process(job('marketing2'))).status, 'sent');
  assert.equal(delivered, 1);
});
test('SMTP timeout is uncertain and never automatically resent, including job retries', async () => {
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([record('smtp1')]);
  let sends = 0,
    alerts = 0;
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => true,
    send: async () => {
      sends++;
      throw Error('ETIMEDOUT');
    },
    onUncertain: () => alerts++,
  });
  assert.equal((await process(job('smtp1'))).status, 'uncertain');
  assert.equal((await process(job('smtp1'))).status, 'uncertain');
  assert.equal(sends, 1);
  assert.equal(alerts, 1);
  assert.equal((await store.load('smtp1')).state, 'uncertain');
});
test('crashed sending lease expires into uncertain state, without repeat SMTP', async () => {
  let now = 100_000,
    sends = 0,
    alerts = 0;
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([record('crash')]);
  let fire;
  /** Actual unsettled synthetic operation retained until its barrier is released. */
  const pending = new Promise((resolve) => {
    fire = resolve;
  });
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => true,
    send: async () => {
      sends++;
      await pending;
    },
    now: () => now,
    leaseMs: 3000,
    onUncertain: () => {
      alerts++;
    },
  });
  /** Admitted synthetic delivery whose settlement remains observed after cancellation. */
  const inFlight = process(job('crash'));
  while (sends === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  now += 4000;
  assert.equal((await process(job('crash'))).status, 'uncertain');
  fire();
  assert.equal((await inFlight).status, 'uncertain');
  assert.equal(sends, 1);
  assert.equal((await store.load('crash')).state, 'uncertain');
  assert.equal(alerts, 1);
});
test('campaign batch contains only IDs and delays, validates all input before enqueue', async () => {
  /** Observed bounded native invocation/result used for exact expectations. */
  const actual = [];
  /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
  const queue = {
    addBulk: async (jobs) => {
      actual.push(...jobs);
      return jobs;
    },
  };
  await enqueueEmailCampaignBatch(queue, ['m01', 'm02'], {
    sendAt: 20_000,
    now: 10_000,
  });
  assert.equal(actual.length, 2);
  assert.deepEqual(actual[0].data, { messageId: 'm01' });
  assert.deepEqual(actual[0].options, {
    jobId: 'email-m01',
    delay: 10_000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });
  await assert.rejects(
    enqueueEmailCampaignBatch(queue, ['m01', 'm01'], {
      sendAt: 20_000,
      now: 10_000,
    }),
    /distinct/
  );
  await assert.rejects(
    enqueueEmailCampaignBatch(queue, ['m00'], { sendAt: 1, now: 100_000 }),
    /time/
  );
  assert.equal(actual.length, 2);
});
test('uncertain SMTP delivery requires explicit privileged resolution, never resubmission', async () => {
  /** Public privileged reconciliation API, never automatic SMTP replay. */
  const { resolveUncertainEmailDelivery } = await import('../dist/index.js');
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([
    { ...record('uncertain01'), state: 'uncertain' },
  ]);
  /** Explicit synthetic options; invalid fields must fail before native startup. */
  const options = {
    context: { admin: true },
    authorize: async (ctx) => ctx?.admin === true,
  };
  await assert.rejects(
    resolveUncertainEmailDelivery(store, 'uncertain01', 'sent', {
      ...options,
      context: { admin: false },
    }),
    /forbidden/
  );
  assert.equal((await store.load('uncertain01')).state, 'uncertain');
  assert.equal(
    await resolveUncertainEmailDelivery(store, 'uncertain01', 'sent', options),
    true
  );
  assert.equal((await store.load('uncertain01')).state, 'sent');
  await assert.rejects(
    resolveUncertainEmailDelivery(store, 'uncertain01', 'sent', options),
    /Only uncertain/
  );
});

test('expired claim before SMTP may be reclaimed without losing a job', async () => {
  /** Synthetic expired pre-send claim, distinct from an uncertain sending lease. */
  const stale = {
    ...record('preflight'),
    state: 'claimed',
    lease: { owner: 'offline', token: 'old', expiresAt: 1000 },
  };
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = createMemoryEmailDeliveryStore([stale]);
  let sends = 0;
  /** Explicit synthetic email processor; unrelated to the Node global process. */
  const process = createDurableEmailDeliveryProcessor({
    store,
    isSubscribed: async () => true,
    send: async () => {
      sends++;
    },
    now: () => 2000,
    leaseMs: 3000,
  });
  assert.equal((await process(job('preflight'))).status, 'sent');
  assert.equal(sends, 1);
});
