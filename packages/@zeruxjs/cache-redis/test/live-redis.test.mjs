import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCacheHelper, createIORedisCacheHelper } from '../dist/index.js';
import { createCacheManagerWithHelper } from '@zeruxjs/cache';

test(
  'LIVE Redis: two tenants share a standalone Redis without global namespace flushing',
  { skip: !process.env.CACHE_REDIS_URL, timeout: 20_000 },
  async () => {
    /** Explicit configured standalone helper; no server starts automatically. */
    const client = await createCacheHelper({
      driver: 'ioredis',
      url: process.env.CACHE_REDIS_URL,
    });
    /** Random disposable namespace for this isolated acceptance run. */
    const base = `cache_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    /** First namespaced test manager. */
    const a = createCacheManagerWithHelper(client, { prefix: base + '_a' });
    /** Second namespace used to verify preservation. */
    const b = createCacheManagerWithHelper(client, { prefix: base + '_b' });
    try {
      await a.setMany({ first: 1, second: 2 });
      await b.set('first', 3);
      await a.clear();
      assert.equal(await a.get('first'), undefined);
      assert.equal(await b.get('first'), 3);
    } finally {
      await b.delete('first');
      await client.close();
    }
  }
);
test(
  'LIVE Redis Cluster: scan every master and clear only the tenant prefix',
  { skip: !process.env.CACHE_REDIS_CLUSTER_NODES, timeout: 30_000 },
  async () => {
    /** Explicit supported driver loaded only within the configured live gate. */
    const { default: IORedis } = await import('ioredis');
    /** Operator-configured Cluster seed list; never inferred from one endpoint. */
    const nodes = process.env.CACHE_REDIS_CLUSTER_NODES.split(',').map(
      (endpoint) => {
        /** Configured seed address split before driver construction. */
        const [host, port] = endpoint.split(':');
        return { host, port: Number(port) };
      }
    );
    /** Owned actual Cluster connection for this live-only fixture. */
    const redis = new IORedis.Cluster(nodes, {
      redisOptions: {
        password: process.env.CACHE_REDIS_CLUSTER_PASSWORD || undefined,
      },
    });
    /** Wrapper owning the isolated live Cluster connection. */
    const adapter = createIORedisCacheHelper(redis, { ownClient: true });
    /** Random disposable namespace for this isolated acceptance run. */
    const base = `cache_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    /** First namespaced test manager. */
    const a = createCacheManagerWithHelper(adapter, { prefix: base + '_a' });
    /** Second namespace used to verify preservation. */
    const b = createCacheManagerWithHelper(adapter, { prefix: base + '_b' });
    try {
      // Populate several disposable keys spanning potential Cluster slots.
      for (let n = 0; n < 35; n++) {
        await a.set(`key${n}`, n);
      }
      await b.set('safe', true);
      await a.clear();
      // Verify every populated tenant key was removed from the primary sweep.
      for (let n = 0; n < 35; n++) {
        assert.equal(await a.get(`key${n}`), undefined);
      }
      assert.equal(await b.get('safe'), true);
    } finally {
      try {
        await b.delete('safe');
      } finally {
        await adapter.close();
      }
    }
  }
);
