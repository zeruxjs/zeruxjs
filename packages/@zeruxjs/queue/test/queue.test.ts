import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueueService,
  createAnalyticsReconciliationProcessor,
} from '../dist/index.js';

/** Create only injected native classes/counters; no Redis connections.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const makeFake = () => {
  /** Recorded injected native calls; no real broker operation occurs in this fixture. */
  const calls = [];
  /** Injected live-handle map used to assert ownership, not native certification. */
  const active = new Map();
  /** Injected native fixture; it opens no real broker connection. */
  class Queue {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {object} opts - Explicit synthetic native options.
     */
    constructor(name, opts) {
      this.name = name;
      this.options = opts;
      calls.push(['queue', name, opts]);
      active.set(name, this);
      this.jobs = [];
    }
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {
      calls.push(['ready', this.name]);
    }
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
     * @param {object} options - Explicit synthetic request/native settings.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(name, data, options) {
      /** One explicit synthetic task with bounded opaque record-reference data. */
      const job = {
        id: options?.jobId ?? `job-${this.jobs.length + 1}`,
        name,
        data,
        options,
      };
      this.jobs.push(job);
      return job;
    }
    /** Map only the explicit bounded synthetic jobs through the injected add contract.
     * @param {object[]} jobs - Explicit synthetic bulk input.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async addBulk(jobs) {
      return Promise.all(jobs.map((j) => this.add(j.name, j.data, j.opts)));
    }
    /** Read one synthetic raw job behind trusted fixture access.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJob(id) {
      return this.jobs.find((j) => j.id === id);
    }
    /** Return explicit fixture counts without exposing synthetic payload bodies.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobCounts() {
      return { waiting: this.jobs.length };
    }
    /** Record the synthetic local/global pause operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async pause() {
      calls.push(['pause', this.name]);
    }
    /** Record the synthetic local/global resume operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async resume() {
      calls.push(['resume', this.name]);
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {
      calls.push(['closeQueue', this.name]);
    }
  }
  /** Injected native fixture; it opens no real broker connection. */
  class Worker {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {function} process - Explicit injected worker handler, unrelated to Node process.
     * @param {object} options - Explicit synthetic request/native settings.
     */
    constructor(name, process, options) {
      calls.push(['worker', name, options]);
      this.processor = process;
      this.callbacks = {};
    }
    /** Register a synthetic native event callback; no real event transport starts.
     * @param {string} event - Fixed synthetic event name.
     * @param {function} fn - Explicit fixture callback/event handler.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    on(event, fn) {
      this.callbacks[event] = fn;
      return this;
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @param {boolean} force - Explicit native force-close request, not forced JavaScript cancellation.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close(force) {
      calls.push(['closeWorker', force ?? false]);
    }
  }
  return { driver: { Queue, Worker }, active, calls };
};
test('producer and worker use distinct Redis policies, enqueue and lifecycle close', async () => {
  /** Injected native factory/counters; not live broker certification. */
  const fake = makeFake();
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueService(
    {
      redis: { url: 'rediss://user:pwd@localhost:6380/2' },
      prefix: 'product',
      queues: [{ name: 'emails', defaultJobOptions: { attempts: 4 } }],
      workers: {
        emails: { processor: async (job) => job.data, concurrency: 3 },
      },
    },
    fake.driver
  );
  /** Observed native producer options or inert outbox-backed producer. */
  const producer = fake.calls.find((c) => c[0] === 'queue')[2];
  /** Explicit injected processor or native worker options for the test. */
  const worker = fake.calls.find((c) => c[0] === 'worker')[2];
  assert.equal(producer.connection.maxRetriesPerRequest, 1);
  assert.equal(producer.connection.enableOfflineQueue, false);
  assert.equal(worker.connection.maxRetriesPerRequest, null);
  assert.equal(worker.connection.enableOfflineQueue, true);
  assert.equal(worker.connection.password, 'pwd');
  assert.equal(worker.connection.db, 2);
  assert.deepEqual(worker.connection.tls, {});
  assert.equal(producer.prefix, 'product');
  assert.equal(producer.defaultJobOptions.attempts, 4);
  assert.equal(producer.defaultJobOptions.removeOnComplete.count, 10000);
  /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
  const queue = service.queue('emails');
  /** One explicit synthetic task with bounded opaque record-reference data. */
  const job = await queue.add(
    'deliver',
    { emailId: 'mail-1' },
    {
      jobId: 'mail-1',
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );
  assert.equal((await queue.getJob('mail-1')).id, job.id);
  assert.equal((await queue.counts('waiting')).waiting, 1);
  await queue.addBulk([
    { name: 'deliver', data: { emailId: 'mail-2' } },
    { name: 'deliver', data: { emailId: 'mail-3' } },
  ]);
  assert.equal((await queue.counts('waiting')).waiting, 3);
  await queue.pause();
  await queue.resume();
  assert.deepEqual(await service.health(), { emails: true });
  await Promise.all([service.close(), service.close()]);
  assert.equal(fake.calls.filter((c) => c[0] === 'closeWorker').length, 1);
  assert.equal(fake.calls.filter((c) => c[0] === 'closeQueue').length, 1);
  assert.ok(
    fake.calls.findIndex((c) => c[0] === 'closeWorker') <
      fake.calls.findIndex((c) => c[0] === 'closeQueue')
  );
  assert.throws(() => queue.add('deliver', {}), /closed/);
});
test('fail closed on bad queue/job names, missing processors and Redis key prefixes', async () => {
  /** Injected native factory/counters; not live broker certification. */
  const fake = makeFake();
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const opts of [
    { queues: ['emails', 'emails'] },
    { queues: ['emails'], workers: { missing: { processor: () => {} } } },
    {
      queues: ['emails'],
      workers: { emails: { processor: 'not a function' } },
    },
    { queues: ['bad:queue'] },
    { queues: ['emails'], redis: { host: 'localhost', keyPrefix: 'bad' } },
  ]) {
    await assert.rejects(
      createQueueService(
        { redis: { host: 'localhost' }, ...opts },
        fake.driver
      ),
      /Duplicate|unknown|function|Invalid|keyPrefix/
    );
  }
  /** Owned injected queue service closed after its assertions. */
  const manager = await createQueueService(
    { redis: { host: 'localhost' }, queues: ['emails'] },
    fake.driver
  );
  assert.throws(() => manager.queue('emails').add('not:valid', {}), /Invalid/);
  assert.throws(
    () => manager.queue('emails').add('valid', {}, { jobId: 'danger:colon' }),
    /jobId/
  );
  assert.throws(
    () => manager.queue('emails').add('valid', {}, { repeat: { every: 0 } }),
    /Repeat interval/
  );
  assert.throws(() => manager.queue('nope'), /Unknown queue/);
  await manager.close();
});
test('startup failure closes all successfully created producer queues', async () => {
  /** Injected native factory/counters; not live broker certification. */
  const fake = makeFake();
  /** Injected native fixture; it opens no real broker connection. */
  class BrokenQueue extends fake.driver.Queue {
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {
      if (this.name === 'b') {
        throw new Error('Redis failed');
      }
    }
  }
  await assert.rejects(
    createQueueService(
      { redis: { host: '127.0.0.1' }, queues: ['a', 'b'] },
      { ...fake.driver, Queue: BrokenQueue }
    ),
    /Redis failed/
  );
  assert.equal(fake.calls.filter((c) => c[0] === 'closeQueue').length, 2);
});
test('worker errors are sent to app hook and callback exceptions do not escape', async () => {
  /** Injected native factory/counters; not live broker certification. */
  const fake = makeFake();
  /** Observed synthetic worker-hook failures, not production exception logs. */
  const errors = [];
  /** Owned injected queue service closed after its assertions. */
  const manager = await createQueueService(
    {
      redis: { host: 'localhost' },
      queues: ['jobs'],
      workers: { jobs: { processor: async () => {}, autorun: false } },
      onWorkerError: (name, error) => {
        errors.push([name, error.message]);
        throw Error('log failed');
      },
    },
    fake.driver
  );
  assert.doesNotThrow(() =>
    manager.worker('jobs').callbacks.error(new Error('temporary outage'))
  );
  assert.deepEqual(errors, [['jobs', 'temporary outage']]);
  await manager.close();
});

test('analytics reconciliation worker runs only allowlisted administrative jobs', async () => {
  /** Observed synthetic reconciliation owner IDs, not user identities. */
  const owners = [];
  /** Explicit allowlisted fixture processor; handlers are never discovered from source strings. */
  const processor = createAnalyticsReconciliationProcessor({
    year2025: {
      runOnce: async (owner) => {
        owners.push(owner);
        return { busy: false, state: { status: 'running' } };
      },
    },
  });
  /** Observed operation outcome compared with explicit fixture expectations. */
  const result = await processor({
    name: 'analytics.reconcile',
    data: { id: 'year2025' },
  });
  assert.equal(result.status, 'running');
  assert.match(owners[0], /^bullmq-/);
  await assert.rejects(
    processor({ name: 'analytics.reconcile', data: { id: 'other' } }),
    /Unknown/
  );
  await assert.rejects(
    processor({ name: 'not_analytics', data: { id: 'year2025' } }),
    /Unexpected/
  );
});
