import type { CacheValue } from "@zeruxjs/cache";

/** Minimal Redis protocol surface; supports injected clients without a live Redis service. */
export interface RedisCacheClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; NX?: boolean; XX?: boolean }): Promise<unknown>;
    del(keys: string | string[]): Promise<number>;
    exists(key: string): Promise<number>;
    mGet(keys: string[]): Promise<Array<string | null>>;
    mSet(values: Record<string, string>): Promise<unknown>;
    incrBy(key: string, amount: number): Promise<number>;
    decrBy(key: string, amount: number): Promise<number>;
    expire(key: string, seconds: number): Promise<number | boolean>;
    scanIterator(options?: { MATCH?: string; COUNT?: number }): AsyncIterable<string | string[]>;
    flushDb?(): Promise<unknown>;
    close?(): Promise<unknown>;
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface RedisCacheHelperOptions {
    client?: RedisCacheClient;
    /** Dangerous global operation; never enabled by default. */
    allowFlushDb?: boolean;
    /** Close injected client when this helper is closed; defaults to false. */
    ownClient?: boolean;
    [key: string]: unknown;
}
export type { CacheValue };
