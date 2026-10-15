/**
 * Title: Shared cache abstraction types
 * Description: Declares the stable contract shared by the cache manager and all helper packages.
 * Global Variables: none
 */

export type MaybePromise<T> = T | Promise<T>;
export type CachePrimitive = string | number | boolean | null;
export type CacheValue = CachePrimitive | CacheValue[] | { [key: string]: CacheValue; };

export interface CacheSetOptions {
    ttlSeconds?: number;
    /** Atomic adapter-level conditional write, where supported. */
    ifAbsent?: boolean;
    ifPresent?: boolean;
}

export interface CacheHelper {
    get(key: string): MaybePromise<CacheValue | undefined>;
    set(key: string, value: CacheValue, options?: CacheSetOptions): MaybePromise<void>;
    delete(key: string): MaybePromise<boolean>;
    has(key: string): MaybePromise<boolean>;
    clear(): MaybePromise<void>;
    /** Delete only keys under this namespace, never other application keys. */
    clearPrefix?(prefix: string): MaybePromise<void>;
    getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>>;
    setMany(values: Record<string, CacheValue>, options?: CacheSetOptions): MaybePromise<void>;
    deleteMany(keys: string[]): MaybePromise<number>;
    increment(key: string, amount?: number): MaybePromise<number>;
    decrement(key: string, amount?: number): MaybePromise<number>;
    touch(key: string, ttlSeconds: number): MaybePromise<boolean>;
    close?(): MaybePromise<void>;
    native?(): unknown;
}

export interface CacheHelperFactory {
    (options: Record<string, unknown>): MaybePromise<CacheHelper>;
}

export interface CacheManagerConfig {
    helper: string;
    options?: Record<string, unknown>;
    prefix?: string;
    defaultTtlSeconds?: number;
}

export interface CacheManager {
    readonly helper: string;
    readonly prefix?: string;
    readonly defaultTtlSeconds?: number;
    get(key: string): MaybePromise<CacheValue | undefined>;
    set(key: string, value: CacheValue, options?: CacheSetOptions): MaybePromise<void>;
    delete(key: string): MaybePromise<boolean>;
    has(key: string): MaybePromise<boolean>;
    clear(): MaybePromise<void>;
    getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>>;
    setMany(values: Record<string, CacheValue>, options?: CacheSetOptions): MaybePromise<void>;
    deleteMany(keys: string[]): MaybePromise<number>;
    increment(key: string, amount?: number): MaybePromise<number>;
    decrement(key: string, amount?: number): MaybePromise<number>;
    touch(key: string, ttlSeconds: number): MaybePromise<boolean>;
    close(): MaybePromise<void>;
    native(): unknown;
    remember(key: string, producer: () => MaybePromise<CacheValue>, options?: CacheSetOptions): Promise<CacheValue>;
}

export interface CacheErrorShape {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}
