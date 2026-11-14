import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueService, QUEUE_JOB_LIMITS } from '@zeruxjs/queue-bullmq';
/** Create isolated injected native constructors and operation logs without opening Redis connections.
 * @returns {unknown} Injected test receipt or intentional fixture failure.
 */
function fixture() {
  /** Fixture-native operation log; contains synthetic values only. */
  const log = [];
  /** Injected worker instances retained only for exercising actual wrapper callbacks. */
  const workers = [];
  /** Injected event instances used to verify startup/shutdown ownership. */
  const events = [];
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Queue {
    /** Construct an injected synthetic native owner; retain only state needed by lifecycle assertions.
     */
    constructor() {}
    /** Resolve readiness in the injected fixture; failing overrides exercise startup rollback.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async waitUntilReady() {}
    /** Capture a synthetic native enqueue so wrapper validation/snapshotting can be asserted.
     * @param {unknown} name - Synthetic native argument supplied by the queue wrapper.
     * @param {unknown} data - Synthetic native argument supplied by the queue wrapper.
     * @param {unknown} opts - Synthetic native argument supplied by the queue wrapper.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async add(name, data, opts) {
      log.push(['add', data]);
      return { id: 'one', name, data };
    }
    /** Capture the finite synthetic batch after all wrapper guards pass.
     * @param {unknown} jobs - Synthetic native argument supplied by the queue wrapper.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async addBulk(jobs) {
      log.push(['bulk', jobs]);
      return jobs;
    }
    /** Expose synthetic native close settlement or the fixture force-close receipt.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async close() {
      log.push('queue-close');
    }
    /** Capture the native scheduling template without creating a real broker schedule.
     * @param {unknown} id - Synthetic native argument supplied by the queue wrapper.
     * @param {unknown} repeat - Synthetic native argument supplied by the queue wrapper.
     * @param {unknown} template - Synthetic native argument supplied by the queue wrapper.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async upsertJobScheduler(id, repeat, template) {
      log.push(['scheduler', template]);
      return { id };
    }
  }
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Worker {
    /** Construct an injected synthetic native owner; retain only state needed by lifecycle assertions.
     * @param {unknown} name - Synthetic native argument supplied by the queue wrapper.
     * @param {unknown} processor - Synthetic native argument supplied by the queue wrapper.
     */
    constructor(name, processor) {
      this.processor = processor;
      workers.push(this);
    }
    /** Register a synthetic listener receipt or exercise intentional startup failure.
     * @returns {unknown} Injected test receipt or intentional fixture failure.
     */
    on() {
      return this;
    }
    /** Expose synthetic native close settlement or the fixture force-close receipt.
     * @param {unknown} force - Synthetic native argument supplied by the queue wrapper.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async close(force) {
      log.push(force ? 'force-close' : 'worker-close');
    }
  }
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class QueueEvents {
    /** Construct an injected synthetic native owner; retain only state needed by lifecycle assertions.
     */
    constructor() {
      events.push(this);
    }
    /** Register a synthetic listener receipt or exercise intentional startup failure.
     * @returns {unknown} Injected test receipt or intentional fixture failure.
     */
    on() {
      return this;
    }
    /** Resolve readiness in the injected fixture; failing overrides exercise startup rollback.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async waitUntilReady() {}
    /** Expose synthetic native close settlement or the fixture force-close receipt.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async close() {
      log.push('events-close');
    }
  }
  return { driver: { Queue, Worker, QueueEvents }, log, workers, events };
}
/** Synthetic injected-client configuration; no Redis socket is opened. */
const config = { redis: { host: 'localhost' }, queues: ['jobs'] };
test('direct and bulk data snapshot/byte/count/depth checks run before any native enqueue', async () => {
  /** Fresh isolated driver fixture; no live provider is contacted. */
  const f = fixture();
  /** Owned queue wrapper closed by this synthetic fixture. */
  const service = await createQueueService(config, f.driver);
  /** Borrowed named producer; the service owns its lifetime. */
  const queue = service.queue('jobs');
  try {
    /** Synthetic payload whose mutation/invalid shape exercises snapshot validation. */
    const data = { id: 'one', nested: { ok: true } };
    /** In-flight injected enqueue receipt observed after source mutation. */
    const pending = queue.add('send', data);
    data.nested.ok = false;
    assert.equal((await pending).data.nested.ok, true);
    assert.equal(QUEUE_JOB_LIMITS.maxBulk, 256);
    /** Injected bounded batch receipt. */
    const bulk = await queue.addBulk([
      { name: 'one', data: {} },
      { name: 'two', data: { id: 2 } },
    ]);
    assert.equal(bulk.length, 2);
    /** Native operation baseline; invalid input must not dispatch. */
    const count = f.log.length;
    // Exercise only the finite synthetic invalid cases, archive targets or fixed depth bound.
    for (const data of [
      { large: 'é'.repeat(40000) },
      JSON.parse('{"constructor":1}'),
      {
        /** Represent a forbidden executable payload member; validation must reject without invoking it.
         * @returns {unknown} Injected test receipt or intentional fixture failure.
         */
        fn() {},
      },
      { bad: NaN },
      {
        /** Throw if payload validation accidentally evaluates an untrusted accessor.
         * @returns {unknown} Injected test receipt or intentional fixture failure.
         */
        get secret() {
          throw Error('SECRET');
        },
      },
      new Date(),
    ]) {
      assert.throws(
        () => queue.add('send', data),
        (error) => !/SECRET/.test(error.message)
      );
    }
    /** Synthetic cyclic payload; never execute serialization hooks. */
    const cycle = {};
    cycle.cycle = cycle;
    assert.throws(() => queue.add('send', cycle));
    /** Synthetic over-depth payload. */
    const deep = {};
    let node = deep;
    // Exercise only the finite synthetic invalid cases, archive targets or fixed depth bound.
    for (let i = 0; i < 34; i++) {
      node = node.child = {};
    }
    assert.throws(() => queue.add('send', deep), /nesting/);
    assert.throws(
      () =>
        queue.addBulk(
          Array.from({ length: 257 }, () => ({ name: 'send', data: {} }))
        ),
      /count/
    );
    assert.throws(
      () =>
        queue.addBulk(
          Array.from({ length: 20 }, () => ({
            name: 'send',
            data: { large: 'x'.repeat(60000) },
          }))
        ),
      /bulk byte/
    );
    assert.throws(() =>
      queue.addBulk([
        { name: 'send', data: {} },
        { name: 'bad:name', data: {} },
      ])
    );
    assert.equal(f.log.length, count);
    await service
      .schedules('jobs')
      .every('daily', { task: 'sync', data: { id: 'one' } }, 1000);
    assert.ok(f.log.some((item) => item[0] === 'scheduler'));
  } finally {
    await service.close();
  }
});
test('worker counts survive force-close until processor and original native close really settle', async () => {
  /** Fresh isolated driver fixture; no live provider is contacted. */
  const f = fixture();
  let complete, finishClose;
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Worker extends f.driver.Worker {
    /** Expose synthetic native close settlement or the fixture force-close receipt.
     * @param {unknown} force - Synthetic native argument supplied by the queue wrapper.
     * @returns {unknown} Injected test receipt or intentional fixture failure.
     */
    close(force) {
      if (force) {
        return Promise.resolve();
      }
      return new Promise((resolve) => (finishClose = resolve));
    }
  }
  /** Owned queue wrapper closed by this synthetic fixture. */
  const service = await createQueueService(
    {
      ...config,
      shutdownGraceMs: 5,
      workers: {
        jobs: {
          processor: () => new Promise((resolve) => (complete = resolve)),
        },
      },
    },
    { ...f.driver, Worker }
  );
  /** Actual processor settlement retained through shutdown, even after grace expiry. */
  const running = f.workers[0].processor({ name: 'send', data: { id: 'one' } });
  assert.equal(service.shutdownStatus().activeProcessors, 1);
  /** Short fixture timer keeping the unref shutdown deadline observable; always cleared. */
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await service.close();
    /** Path/value-free shutdown snapshot, not a worker crash-recovery claim. */
    const status = service.shutdownStatus();
    assert.equal(status.state, 'incomplete');
    assert.equal(status.workerDeadlines, 1);
    assert.equal(status.forceCloseAttempts, 1);
    assert.equal(status.activeProcessors, 1);
    assert.equal(status.pendingClosures, 1);
    assert.equal(JSON.stringify(status).includes('id'), false);
    complete();
    finishClose();
    await running;
    await Promise.resolve();
    assert.equal(service.shutdownStatus().state, 'closed');
  } finally {
    clearTimeout(keepAlive);
    complete?.();
    finishClose?.();
    // A deadline ends waiting, not JavaScript work; release and observe actual settlement.
    await running;
    await Promise.resolve();
  }
});
test('listener/stream startup failures close already acquired worker, events, queues and Cluster clients', async () => {
  /** Fresh isolated driver fixture; no live provider is contacted. */
  const f = fixture();
  /** Injected owned Cluster instances used only to check cleanup/fallback. */
  const clusters = [];
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Cluster {
    /** Construct an injected synthetic native owner; retain only state needed by lifecycle assertions.
     */
    constructor() {
      clusters.push(this);
    }
    /** Expose owned Cluster shutdown success or an intentional private-cause failure.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async quit() {
      this.closed = true;
    }
  }
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Worker extends f.driver.Worker {
    /** Register a synthetic listener receipt or exercise intentional startup failure.
     * @returns {unknown} Injected test receipt or intentional fixture failure.
     */
    on() {
      throw Error('listener failed');
    }
  }
  await assert.rejects(
    createQueueService(
      {
        ...config,
        redis: { cluster: { nodes: [{ host: 'localhost', port: 7000 }] } },
        prefix: '{isolated}',
        events: { enabled: true },
        workers: { jobs: { processor: async () => {} } },
      },
      { ...f.driver, Worker },
      Cluster
    ),
    /listener failed/
  );
  assert.deepEqual(f.log, ['worker-close', 'events-close', 'queue-close']);
  assert.ok(clusters.every((client) => client.closed));
  /** Independent event-startup failure fixture. */
  const g = fixture();
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Events extends g.driver.QueueEvents {
    /** Resolve readiness in the injected fixture; failing overrides exercise startup rollback.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async waitUntilReady() {
      throw Error('stream unavailable');
    }
  }
  await assert.rejects(
    createQueueService(
      { ...config, events: { enabled: true } },
      { ...g.driver, QueueEvents: Events }
    ),
    /stream unavailable/
  );
  assert.deepEqual(g.log, ['events-close', 'queue-close']);
});
test('failed owned Cluster quit uses disconnect, records failure and never repeats cleanup', async () => {
  /** Fresh isolated driver fixture; no live provider is contacted. */
  const f = fixture();
  /** Injected owned Cluster instances used only to check cleanup/fallback. */
  const clusters = [];
  /** Injected native driver double; this fixture does not certify broker behavior.
   */
  class Cluster {
    /** Construct an injected synthetic native owner; retain only state needed by lifecycle assertions.
     */
    constructor() {
      clusters.push(this);
    }
    /** Expose owned Cluster shutdown success or an intentional private-cause failure.
     * @returns {Promise<unknown>} Injected test receipt or intentional fixture failure.
     */
    async quit() {
      throw Error('private credentials');
    }
    /** Capture forced native fallback exactly once after an injected quit failure.
     * @returns {unknown} Injected test receipt or intentional fixture failure.
     */
    disconnect() {
      this.disconnected = (this.disconnected ?? 0) + 1;
    }
  }
  /** Owned queue wrapper closed by this synthetic fixture. */
  const service = await createQueueService(
    {
      ...config,
      redis: { cluster: { nodes: [{ host: 'localhost', port: 7000 }] } },
      prefix: '{isolated}',
    },
    f.driver,
    Cluster
  );
  await assert.rejects(service.close(), /shutdown failed/);
  await assert.rejects(service.close());
  assert.equal(service.shutdownStatus().state, 'failed');
  assert.equal(service.shutdownStatus().cleanupFailures, 2);
  assert.ok(clusters.every((c) => c.disconnected === 1));
});
test('incoming invalid jobs and handler rejection never leak active slots or invoke handlers after close', async () => {
  /** Fresh isolated driver fixture; no live provider is contacted. */
  const f = fixture();
  let calls = 0;
  /** Owned queue wrapper closed by this synthetic fixture. */
  const service = await createQueueService(
    {
      ...config,
      workers: {
        jobs: {
          processor: async () => {
            calls++;
            throw Error('handler failed');
          },
        },
      },
    },
    f.driver
  );
  /** Borrowed wrapped worker callback tested for payload guards and closed-state denial. */
  const process = f.workers[0].processor;
  await assert.rejects(
    process({ name: 'send', data: { huge: 'x'.repeat(70000) } }),
    /byte limit/
  );
  assert.equal(calls, 0);
  assert.equal(service.shutdownStatus().activeProcessors, 0);
  await assert.rejects(
    process({ name: 'send', data: { id: 'one' } }),
    /handler failed/
  );
  assert.equal(calls, 1);
  assert.equal(service.shutdownStatus().activeProcessors, 0);
  await service.close();
  await assert.rejects(process({ name: 'send', data: {} }), /closed/);
  assert.equal(calls, 1);
});
