import { createCacheHelper } from '@zeruxjs/cache-valkey';
import { createCacheManagerWithHelper } from '@zeruxjs/cache';

/** Write/read one greeting through a tenant-scoped local wrapper lifetime.
 * @param {string} url - Trusted host URL; use verified TLS/ACLs in production.
 * @returns {Promise<import("@zeruxjs/cache").CacheValue|undefined>} Validated JSON; native failures remain explicit.
 */
export async function greeting(url: string) {
  /** Explicitly configured native helper owned by the example manager. */
  const helper = await createCacheHelper({ url });
  /** Tenant-scoped manager; close drains helper work before its actual cleanup barrier. */
  const cache = createCacheManagerWithHelper(helper, {
    prefix: 'example:tenant-42',
  });
  try {
    await cache.set('greeting', { text: 'Hello' }, { ttlSeconds: 60 });
    return await cache.get('greeting');
  } finally {
    await cache.close();
    await helper.whenClosed();
  }
}
