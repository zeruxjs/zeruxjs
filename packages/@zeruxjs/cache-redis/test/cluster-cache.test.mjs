import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIORedisCacheHelper } from '../dist/index.js';
import { createCacheManagerWithHelper } from '@zeruxjs/cache';

/** Own one synthetic master map with a complete-page SCAN.
 * @returns {{values:Map<string,string>,scan:Function}} One fixture primary, not a real Cluster node.
 */
function shard() {
  /** One synthetic primary keyspace. */
  const values = new Map();
  return {
    values,
    async scan(_cursor, ..._args) {
      return ['0', [...values.keys()]];
    },
  };
}
/** Route synthetic keys across three primaries while rejecting cross-slot commands.
 * @returns {object} Injected native-compatible fixture and its observations.
 */
function cluster() {
  /** Three independent synthetic master maps. */
  const shards = [shard(), shard(), shard()];
  /** Observed deletes; each must contain only one key. */
  const calls = [];
  /** Deterministically route synthetic keys across primaries.
   * @param {string} key - Fixture key.
   * @returns {Map<string,string>} Selected primary map; no actual Cluster network. */
  const which = (key) =>
    shards[
      Array.from(key).reduce((acc, c) => acc + c.charCodeAt(0), 0) %
        shards.length
    ].values;
  return {
    nodes(role) {
      assert.equal(role, 'master');
      return shards;
    },
    calls,
    shards,
    async get(key) {
      return which(key).get(key) ?? null;
    },
    async set(key, value, ..._args) {
      which(key).set(key, value);
      return 'OK';
    },
    async del(...keys) {
      assert.equal(keys.length, 1, 'Cluster DEL must never be cross slot');
      calls.push(keys[0]);
      return Number(which(keys[0]).delete(keys[0]));
    },
    async exists(key) {
      return Number(which(key).has(key));
    },
    async mget() {
      throw Error('cross slot MGET');
    },
    async mset() {
      throw Error('cross slot MSET');
    },
    async incrby(key, n) {
      /** Synthetic counter result on its selected primary. */
      const x = Number(which(key).get(key) ?? 0) + n;
      which(key).set(key, String(x));
      return x;
    },
    async decrby(key, n) {
      return this.incrby(key, -n);
    },
    async expire() {
      return 1;
    },
    async scan() {
      throw Error('SCAN must run on each master');
    },
    async flushdb() {
      throw Error('FLUSHDB must not run on cluster');
    },
    async quit() {},
    on() {
      return this;
    },
  };
}
test('cluster scans each primary, uses cross-slot safe deletes, preserves other tenant and similarly prefixed keys', async (t) => {
  /** Injected multi-primary fixture with cross-slot operations deliberately disabled. */
  const redis = cluster();
  /** Closeable wrapper around the borrowed fixture Cluster. */
  const adapter = createIORedisCacheHelper(redis, { allowFlushDb: true });
  /** First tenant facade whose writes span several primaries. */
  const alpha = createCacheManagerWithHelper(adapter, {
    prefix: 'tenant-alpha',
  });
  /** Second tenant facade whose data must survive clearing. */
  const beta = createCacheManagerWithHelper(adapter, { prefix: 'tenant-beta' });
  t.after(async () => {
    await alpha.close();
    await beta.close();
  });
  await alpha.setMany({ one: 1, two: 2, three: 3 });
  await beta.set('one', 99);
  await adapter.set('tenant-alphax:one', 'untouchable');
  assert.deepEqual(
    { ...(await alpha.getMany(['one', 'two', 'three'])) },
    { one: 1, two: 2, three: 3 }
  );
  await alpha.clear();
  assert.equal(await alpha.get('two'), undefined);
  assert.equal(await beta.get('one'), 99);
  assert.equal(await adapter.get('tenant-alphax:one'), 'untouchable');
  assert.equal(redis.calls.length, 3);
  await assert.rejects(adapter.clear(), /disabled/);
  await adapter.deleteMany(['tenant-beta:one', 'tenant-alphax:one']);
  assert.equal(await beta.has('one'), false);
});

test('cluster refuses absent primary inventory rather than silently reporting clear success', async (t) => {
  /** Injected multi-primary fixture with cross-slot operations deliberately disabled. */
  const redis = cluster();
  redis.nodes = () => [];
  /** Closeable wrapper around the borrowed fixture Cluster. */
  const adapter = createIORedisCacheHelper(redis);
  t.after(() => adapter.close());
  await assert.rejects(adapter.clearPrefix('tenant'), /masters unavailable/);
});
