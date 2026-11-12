import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createMemcacheHelper } from '../dist/index.js';
test(
  'opt-in disposable Memcached conditional/counter acceptance',
  {
    skip: !process.env.ZX_TEST_MEMCACHE_HOST
      ? 'ZX_TEST_MEMCACHE_HOST is not configured'
      : false,
  },
  async () => {
    /** Explicitly configured dedicated-server helper; this test is never run without operator configuration. */
    const helper = createMemcacheHelper({
      host: process.env.ZX_TEST_MEMCACHE_HOST,
      port: Number(process.env.ZX_TEST_MEMCACHE_PORT ?? 11211),
    });
    /** Random disposable namespace preventing collisions with another acceptance run. */
    const prefix = `zx_${randomBytes(8).toString('hex')}`;
    /** Disposable JSON key deleted in finally. */
    const key = `${prefix}:json`;
    /** Disposable counter key deleted before helper shutdown. */
    const count = `${prefix}:counter`;
    try {
      await helper.set(key, { ok: true }, { ifAbsent: true, ttlSeconds: 30 });
      await helper.set(key, { ok: false }, { ifAbsent: true });
      assert.deepEqual(await helper.get(key), { ok: true });
      await helper.set(count, 2, { ttlSeconds: 30 });
      assert.equal(await helper.decrement(count, 4), 0);
      assert.equal(await helper.increment(count, 1), 1);
      assert.throws(
        () => helper.clearPrefix(prefix),
        (error) => error.code === 'MEMCACHE_NAMESPACE_CLEAR_UNSUPPORTED'
      );
    } finally {
      try {
        await helper.deleteMany([key, count]);
      } finally {
        await helper.close();
      }
    }
  }
);
