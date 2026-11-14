/**
 * Re-export the cache package's compatibility facade without creating a manager.
 * Convenience calls use its process-wide active manager. Prefer a host-owned
 * scoped manager when application generations need independent configuration
 * and cleanup; importing this facade does not transfer manager ownership.
 */
export {
  cache as default,
  cache,
  clear,
  configureCacheManager,
  createCacheError,
  createCacheManager,
  delete,
  deleteMany,
  decrement,
  get,
  getMany,
  getActiveCacheManager,
  has,
  increment,
  native,
  remove,
  set,
  setMany,
  setActiveCacheManager,
  touch,
} from '@zeruxjs/cache';
export type {
  CacheErrorShape,
  CacheHelper,
  CacheHelperFactory,
  CacheManager,
  CacheManagerConfig,
  CachePrimitive,
  CacheSetOptions,
  CacheValue,
  MaybePromise,
} from '@zeruxjs/cache';
