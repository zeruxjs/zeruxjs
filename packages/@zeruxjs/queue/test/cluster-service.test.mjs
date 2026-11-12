import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueueService } from '../dist/index.js';
import { createBullMQRedisClusterConnections } from '../../cache-redis/dist/index.js';
/** Create injected native classes and counters without opening real connections.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const setup = () => {
  /** Injected native-client instances tracked for exact ownership assertions. */
  const clients = [];
  let sequence = 0;
  /** Injected native fixture; it opens no real broker connection. */
  class Cluster {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {object[]} nodes - Explicit isolated Cluster seeds.
     * @param {object} opts - Explicit synthetic native options.
     */
    constructor(nodes, opts) {
      this.nodes = nodes;
      this.opts = opts;
      this.id = ++sequence;
      this.closed = false;
      clients.push(this);
    }
    /** Record owned synthetic Cluster-client shutdown.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async quit() {
      this.closed = true;
    }
  }
  /** Injected native fixture; it opens no real broker connection. */
  class Queue {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {object} opts - Explicit synthetic native options.
     */
    constructor(name, opts) {
      this.name = name;
      this.opts = opts;
    }
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {}
    /** Return explicit fixture counts without exposing synthetic payload bodies.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobCounts() {
      return { waiting: 0 };
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {}
  }
  /** Injected native fixture; it opens no real broker connection. */
  class Worker {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {function} handler - Explicit injected fixture processor.
     * @param {object} opts - Explicit synthetic native options.
     */
    constructor(name, handler, opts) {
      this.opts = opts;
    }
    /** Register a synthetic native event callback; no real event transport starts.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    on() {
      return this;
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {}
  }
  return { Cluster, driver: { Queue, Worker }, clients };
};
test('real Cluster objects are distinct, hash-tagged and owned through managed shutdown', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = setup();
  /** Explicit synthetic backend configuration; private test credentials are not runtime defaults. */
  const config = {
    redis: {
      cluster: {
        nodes: [
          { host: '127.0.0.1', port: 7000 },
          { host: '127.0.0.1', port: 7001 },
        ],
      },
      password: 'secret',
    },
    prefix: '{tenant_75}',
    queues: ['work'],
    workers: { work: { processor: async () => {} } },
  };
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueService(config, f.driver, f.Cluster);
  try {
    assert.equal(f.clients.length, 2);
    assert.notEqual(f.clients[0], f.clients[1]);
    assert.equal(f.clients[0].opts.redisOptions.maxRetriesPerRequest, 1);
    assert.equal(f.clients[0].opts.redisOptions.enableOfflineQueue, false);
    assert.equal(f.clients[1].opts.redisOptions.maxRetriesPerRequest, null);
    assert.equal(f.clients[1].opts.redisOptions.enableOfflineQueue, true);
    assert.deepEqual(await service.health(), { work: true });
  } finally {
    await service.close();
  }
  assert.deepEqual(
    f.clients.map((x) => x.closed),
    [true, true]
  );
});
test('cluster mode refuses non-hash-tagged prefix and standalone/conflicting settings', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = setup();
  /** Explicit synthetic configuration or store underlying the current case. */
  const base = {
    redis: { cluster: { nodes: [{ host: 'localhost', port: 7000 }] } },
    queues: ['q'],
  };
  await assert.rejects(
    createQueueService(base, f.driver, f.Cluster),
    /hash-tagged/
  );
  await assert.rejects(
    createQueueService({ ...base, prefix: 'plain' }, f.driver, f.Cluster),
    /hash-tagged/
  );
  await assert.rejects(
    createQueueService(
      {
        ...base,
        prefix: '{same}',
        redis: { ...base.redis, url: 'redis://localhost' },
      },
      f.driver,
      f.Cluster
    ),
    /cannot specify standalone/
  );
  assert.throws(
    () =>
      createBullMQRedisClusterConnections(
        {
          ...base.redis,
          cluster: { nodes: [{ host: 'localhost', port: 70000 }] },
        },
        f.Cluster
      ),
    /seed node/
  );
  assert.equal(f.clients.length, 0);
});
test('cluster connections close on queue startup failure', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = setup();
  /** Injected native fixture; it opens no real broker connection. */
  class BadQueue extends f.driver.Queue {
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {
      throw new Error('cluster unavailable');
    }
  }
  await assert.rejects(
    createQueueService(
      {
        redis: { cluster: { nodes: [{ host: 'localhost', port: 7000 }] } },
        prefix: '{test}',
        queues: ['q'],
      },
      { ...f.driver, Queue: BadQueue },
      f.Cluster
    ),
    /cluster unavailable/
  );
  assert.deepEqual(
    f.clients.map((x) => x.closed),
    [true, true]
  );
});
