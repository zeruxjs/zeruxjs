/**
 * Title: Shared cache abstraction types
 * Description: Declares the stable contract shared by the cache manager and all helper packages.
 * Global Variables: none
 */

export type MaybePromise<T> = T | Promise<T>;
export type CachePrimitive = string | number | boolean | null;
export type CacheValue = CachePrimitive | CacheValue[] | { [key: string]: CacheValue; };

export type CacheCapability='supported'|'unsupported'|'unknown';
export interface CacheCapabilities {conditionalWrites?:CacheCapability;counters?:CacheCapability;namespaceClear?:CacheCapability;bulkAtomicity?:CacheCapability;ownership?:'owned'|'borrowed'|'unknown'}
export interface CachePolicy {maxBulk?:number;maxPendingProducers?:number;maxKeyBytes?:number;maxValueBytes?:number;maxDepth?:number;requireCapabilities?:Array<'conditionalWrites'|'counters'|'namespaceClear'|'bulkAtomicity'>;ownHelper?:boolean}
export interface CacheProducerContext {readonly signal:AbortSignal;readonly deadline?:number}
export interface CacheRememberOptions extends CacheSetOptions {signal?:AbortSignal;deadline?:number;timeoutMs?:number}

export interface CacheSetOptions {
    ttlSeconds?: number;
    /** Atomic adapter-level conditional write, where supported. */
    ifAbsent?: boolean;
    ifPresent?: boolean;
}

export interface CacheHelper {
    readonly capabilities?:Readonly<CacheCapabilities>;
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
    policy?:CachePolicy;
    options?: Record<string, unknown>;
    prefix?: string;
    defaultTtlSeconds?: number;
}

export interface CacheManager {
    readonly capabilities?:Readonly<CacheCapabilities>;
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
    remember(key: string, producer: (context:CacheProducerContext) => MaybePromise<CacheValue>, options?: CacheRememberOptions): Promise<CacheValue>;
}

export interface CacheErrorShape {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}
