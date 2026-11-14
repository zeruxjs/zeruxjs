import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCacheHelper } from '../dist/index.js';
// Keep explicit live acceptance gates separate for both supported drivers.
for (const driver of ['redis', 'ioredis']) {
  test(
    `LIVE ${driver}: dedicated unavailable endpoint rejects without cache miss`,
    {
      skip: !process.env.CACHE_REDIS_OUTAGE_URL
        ? 'CACHE_REDIS_OUTAGE_URL is not configured'
        : false,
      timeout: 10000,
    },
    async () => {
      await assert.rejects(
        createCacheHelper({
          driver,
          url: process.env.CACHE_REDIS_OUTAGE_URL,
          connectTimeoutMs: 500,
          maxReconnectAttempts: 0,
        }),
        (error) => error.code === 'REDIS_CONNECT_FAILED'
      );
    }
  );
  test(
    `LIVE ${driver}: configured ACL denies access`,
    {
      skip: !process.env.CACHE_REDIS_ACL_URL
        ? 'CACHE_REDIS_ACL_URL with denied GET is not configured'
        : false,
      timeout: 10000,
    },
    async () => {
      let helper;
      try {
        await assert.rejects(
          async () => {
            helper = await createCacheHelper({
              driver,
              url: process.env.CACHE_REDIS_ACL_URL,
            });
            await helper.get(`zx_acl_${randomUUID()}`);
          },
          (error) => {
            let cause = error;
            // Inspect only a bounded cause chain for the configured ACL rejection.
            for (let i = 0; i < 8 && cause; i++, cause = cause.cause) {
              if (/^(NOPERM|NOAUTH|WRONGPASS)/.test(cause.message ?? '')) {
                return true;
              }
            }
            return false;
          }
        );
      } finally {
        await helper?.close?.();
      }
    }
  );
  test(
    `LIVE ${driver}: verified TLS dedicated prefix`,
    {
      skip: !process.env.CACHE_REDIS_TLS_URL
        ? 'CACHE_REDIS_TLS_URL and trusted certificates are not configured'
        : false,
      timeout: 10000,
    },
    async () => {
      assert.equal(
        new URL(process.env.CACHE_REDIS_TLS_URL).protocol,
        'rediss:'
      );
      /** Explicit dedicated TLS test helper disposed in finally. */
      const helper = await createCacheHelper({
        driver,
        url: process.env.CACHE_REDIS_TLS_URL,
      });
      /** Random disposable item removed before helper shutdown. */
      const key = `zx_tls_${randomUUID()}`;
      try {
        await helper.set(key, { ok: true }, { ttlSeconds: 30 });
        assert.deepEqual(await helper.get(key), { ok: true });
      } finally {
        try {
          await helper.delete(key);
        } finally {
          await helper.close();
        }
      }
    }
  );
}
