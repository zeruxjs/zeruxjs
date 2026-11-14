import {
  createMemoryCacheHelper,
  createCacheManagerWithHelper,
} from '@zeruxjs/cache';
import { createRouteDataCache } from 'zeruxjs/route-data-cache';
/** Owned process-local memory manager; this example does not claim durable caching. */
const cache = createCacheManagerWithHelper(createMemoryCacheHelper());
/** Owned route-data scope borrowing the cache manager until close settles. */
const data = createRouteDataCache({ application: 'shop', cache });
try {
  // Obtain tenant/principal from the host's verified session, never query parameters.
  /** Synthetic verified scope; real handlers obtain it from authenticated host context. */
  const key = {
    route: 'catalog',
    path: '/catalog',
    locale: 'en',
    scope: { tenant: 'demo', principal: 'verified-owner' },
  };
  /** Bounded cache receipt; no product data or authenticated session is collected here. */
  const result = await data.load(
    key,
    { freshMs: 1000, staleMs: 2000, tags: ['catalog'] },
    async ({ signal }) => {
      signal.throwIfAborted();
      return { products: [] };
    }
  );
  // A route returns result.response(); existing ETag handling remains authoritative.
  console.log(result.state, result.value);
  // Invoke only after authorized persistence commits (e.g. an actions invalidate callback).
  data.invalidate({ tenant: 'demo', tag: 'catalog' });
} finally {
  await data.close();
  await cache.close();
}
