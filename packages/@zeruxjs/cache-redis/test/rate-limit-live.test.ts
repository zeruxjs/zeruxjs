import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import {
  createRedisCacheHelper,
  createRedisRateLimitStore,
} from '../dist/index.js';
test(
  'LIVE isolated Redis atomic multi-client claims, TTL and bounded cardinality',
  {
    skip: !process.env.CACHE_RATE_LIMIT_REDIS_URL
      ? 'CACHE_RATE_LIMIT_REDIS_URL is not configured'
      : false,
    timeout: 15000,
  },
  async () => {
    /** Random isolated hash tag for the two disposable limiter keys. */
    const namespace = `zx_${randomBytes(8).toString('hex')}`;
    /** Two explicitly configured native clients for real atomicity acceptance. */
    const clients = [
      createClient({
        url: process.env.CACHE_RATE_LIMIT_REDIS_URL,
        disableOfflineQueue: true,
        socket: { connectTimeout: 1000, reconnectStrategy: false },
      }),
      createClient({
        url: process.env.CACHE_RATE_LIMIT_REDIS_URL,
        disableOfflineQueue: true,
        socket: { connectTimeout: 1000, reconnectStrategy: false },
      }),
    ];
    // Handle native error events without logging private endpoint details.
    for (const client of clients) {
      client.on('error', () => {});
    }
    /** Borrowing wrappers closed before native connections. */
    const helpers = [];
    /** Store facades closed before their helper wrappers. */
    const stores = [];
    /** Exact disposable same-slot limiter keys removed in finally. */
    const keys = [
      `zerux:rl:{${namespace}}:counts`,
      `zerux:rl:{${namespace}}:expires`,
    ];
    try {
      await Promise.all(clients.map((c) => c.connect()));
      // Retain each borrowing helper/store for ordered cleanup.
      for (const client of clients) {
        /** One borrowed-client wrapper retained for orderly cleanup. */
        const helper = createRedisCacheHelper(client);
        helpers.push(helper);
        stores.push(
          createRedisRateLimitStore(helper, {
            namespace,
            maxKeys: 1,
            maxWindowMs: 1000,
          })
        );
      }
      /** Synthetic opaque subject claim for concurrent native Lua execution. */
      const input = { key: 'x'.repeat(43), windowMs: 1000, max: 7, weight: 1 };
      /** Concurrent outcomes used to count accepted claims without invented distribution guarantees. */
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => stores[i % 2].claim(input))
      );
      assert.equal(results.filter((r) => r.allowed).length, 7);
      assert.equal(
        (await stores[0].claim({ ...input, key: 'y'.repeat(43) })).reason,
        'capacity'
      );
      assert.ok((await clients[0].pTTL(keys[0])) > 0);
      await new Promise((r) => setTimeout(r, 1100));
      assert.equal(await clients[0].exists(keys[0]), 0);
      assert.equal(
        (await stores[1].claim({ ...input, key: 'y'.repeat(43) })).allowed,
        true
      );
      await clients[0].del(keys[1]);
      await assert.rejects(stores[0].claim(input));
    } finally {
      // Fence all stores before closing their borrowing helpers.
      for (const store of stores) {
        await store.close();
      }
      // Drain wrappers before tearing down native clients.
      for (const helper of helpers) {
        await helper.close();
      }
      // Remove disposable state and close every configured native client.
      for (const client of clients) {
        try {
          if (client.isReady) {
            // Delete only the exact isolated limiter keys.
            for (const key of keys) {
              await client.del(key);
            }
          }
        } finally {
          if (client.isOpen) {
            client.destroy();
          }
        }
      }
    }
  }
);
