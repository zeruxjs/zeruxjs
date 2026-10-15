import type {
    CacheManager,
    CacheManagerConfig,
    CacheSetOptions,
    CacheValue,
    MaybePromise
} from "./types.js";
import {
    configureCacheManager,
    createCacheManager,
    createCacheManagerWithHelper,
    getActiveCacheManager,
    setActiveCacheManager
} from "./manager.js";
import { createCacheError } from "./utils.js";

/**
 * Title: Default cache facade
 * Description: Exposes the configured helper through stable convenience methods.
 * Global Variables: active cache manager
 */
export const cache: CacheManager = {
    get helper() {
        return getActiveCacheManager().helper;
    },
    get prefix() {
        return getActiveCacheManager().prefix;
    },
    get defaultTtlSeconds() {
        return getActiveCacheManager().defaultTtlSeconds;
    },
    get(key: string): MaybePromise<CacheValue | undefined> {
        return getActiveCacheManager().get(key);
    },
    set(key: string, value: CacheValue, options?: CacheSetOptions): MaybePromise<void> {
        return getActiveCacheManager().set(key, value, options);
    },
    delete(key: string): MaybePromise<boolean> {
        return getActiveCacheManager().delete(key);
    },
    has(key: string): MaybePromise<boolean> {
        return getActiveCacheManager().has(key);
    },
    clear(): MaybePromise<void> {
        return getActiveCacheManager().clear();
    },
    getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>> {
        return getActiveCacheManager().getMany(keys);
    },
    setMany(values: Record<string, CacheValue>, options?: CacheSetOptions): MaybePromise<void> {
        return getActiveCacheManager().setMany(values, options);
    },
    deleteMany(keys: string[]): MaybePromise<number> {
        return getActiveCacheManager().deleteMany(keys);
    },
    increment(key: string, amount?: number): MaybePromise<number> {
        return getActiveCacheManager().increment(key, amount);
    },
    decrement(key: string, amount?: number): MaybePromise<number> {
        return getActiveCacheManager().decrement(key, amount);
    },
    touch(key: string, ttlSeconds: number): MaybePromise<boolean> {
        return getActiveCacheManager().touch(key, ttlSeconds);
    },
    close(): MaybePromise<void> {
        return getActiveCacheManager().close();
    },
    remember(key: string, producer: () => MaybePromise<CacheValue>, options?: CacheSetOptions) {
        return getActiveCacheManager().remember(key, producer, options);
    },
    native(): unknown {
        return getActiveCacheManager().native();
    }
};

export const get = (key: string) => getActiveCacheManager().get(key);
export const set = (key: string, value: CacheValue, options?: CacheSetOptions) =>
    getActiveCacheManager().set(key, value, options);
export const remove = (key: string) => getActiveCacheManager().delete(key);
export const has = (key: string) => getActiveCacheManager().has(key);
export const clear = () => getActiveCacheManager().clear();
export const getMany = (keys: string[]) => getActiveCacheManager().getMany(keys);
export const setMany = (values: Record<string, CacheValue>, options?: CacheSetOptions) =>
    getActiveCacheManager().setMany(values, options);
export const deleteMany = (keys: string[]) => getActiveCacheManager().deleteMany(keys);
export const increment = (key: string, amount?: number) => getActiveCacheManager().increment(key, amount);
export const decrement = (key: string, amount?: number) => getActiveCacheManager().decrement(key, amount);
export const touch = (key: string, ttlSeconds: number) => getActiveCacheManager().touch(key, ttlSeconds);
export const remember = (key: string, producer: () => MaybePromise<CacheValue>, options?: CacheSetOptions) =>
    getActiveCacheManager().remember(key, producer, options);
export const native = () => getActiveCacheManager().native();

export { remove as delete };
export {
    configureCacheManager,
    createCacheError,
    createCacheManager,
    createCacheManagerWithHelper,
    getActiveCacheManager,
    setActiveCacheManager
};
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
} from "./types.js";

export default cache;

export { createMemoryCacheHelper } from "./memory.js";
export type { MemoryCacheOptions, MemoryCacheStats } from "./memory.js";
