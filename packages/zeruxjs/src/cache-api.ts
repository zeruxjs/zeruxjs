/**
 * Title: Zerux cache public API
 * Description: Re-exports the active cache facade so applications can import from `zeruxjs/cache`.
 * Global Variables: active cache manager in @zeruxjs/cache
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
    touch
} from "@zeruxjs/cache";
export type {
    CacheErrorShape,
    CacheHelper,
    CacheHelperFactory,
    CacheManager,
    CacheManagerConfig,
    CachePrimitive,
    CacheSetOptions,
    CacheValue,
    MaybePromise
} from "@zeruxjs/cache";
