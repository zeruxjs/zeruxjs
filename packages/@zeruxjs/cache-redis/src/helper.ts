import type { CacheHelper, CacheSetOptions, CacheValue } from "@zeruxjs/cache";
import { serialize, deserialize, expiration, counterAmount, prefixGlob } from "./codec.js";
import type { RedisCacheClient } from "./types.js";

export interface RedisHelperConfig { allowFlushDb?: boolean; ownClient?: boolean; }

/** Redis cache adapter: atomic counters, namespaced SCAN deletion, opt-in database flush. */
export class RedisCacheHelper implements CacheHelper {
    constructor(private readonly client: RedisCacheClient, private readonly config: RedisHelperConfig = {}) {}
    async get(key: string): Promise<CacheValue | undefined> {
        const value = await this.client.get(key);
        return value === null ? undefined : deserialize(value);
    }
    async set(key: string, value: CacheValue, opts: CacheSetOptions = {}): Promise<void> {
        if (opts.ifAbsent && opts.ifPresent) throw new TypeError("Conflicting conditional writes");
        const expiry = expiration(opts.ttlSeconds);
        await this.client.set(key, serialize(value), {
            ...(expiry === undefined ? {} : { EX: expiry }),
            ...(opts.ifAbsent ? { NX: true } : {}),
            ...(opts.ifPresent ? { XX: true } : {})
        });
    }
    async delete(key: string): Promise<boolean> { return await this.client.del(key) > 0; }
    async has(key: string): Promise<boolean> { return await this.client.exists(key) > 0; }
    async clear(): Promise<void> {
        if (!this.config.allowFlushDb || !this.client.flushDb) {
            throw new Error("Redis FLUSHDB is disabled; set allowFlushDb explicitly or use a cache prefix");
        }
        await this.client.flushDb();
    }
    async clearPrefix(prefix: string): Promise<void> {
        if (typeof prefix !== 'string' || !prefix.length || prefix.length > 256) throw new TypeError("Invalid cache namespace prefix");
        let batch: string[] = [];
        // A multi-key DEL may fail with CROSSSLOT on Redis Cluster. Delete each
        // fully verified namespaced key; bounded batches avoid socket flooding.
        const flush = async () => {
            if (!batch.length) return;
            const keys = batch; batch = [];
            await Promise.all(keys.map(key => this.client.del(key)));
        };
        for await (const page of this.client.scanIterator({ MATCH: prefixGlob(prefix), COUNT: 100 })) {
            for (const key of typeof page === "string" ? [page] : page) {
                // Treat the match expression as a hint; never trust it as an authorization check.
                if (!key.startsWith(prefix + ":")) continue;
                batch.push(key);
                if (batch.length >= 100) await flush();
            }
        }
        await flush();
    }
    async getMany(keys: string[]): Promise<Record<string, CacheValue | undefined>> {
        const result: Record<string, CacheValue | undefined> = Object.create(null);
        if (!keys.length) return result;
        const data = await this.client.mGet(keys);
        keys.forEach((key, i) => Object.defineProperty(result, key, {
            value: data[i] == null ? undefined : deserialize(data[i]!), enumerable: true, configurable: true, writable: true
        }));
        return result;
    }
    async setMany(values: Record<string, CacheValue>, opts: CacheSetOptions = {}): Promise<void> {
        const entries = Object.entries(values);
        if (!entries.length) return;
        if (opts.ttlSeconds !== undefined || opts.ifAbsent || opts.ifPresent) {
            // Individual SET commands preserve TTL and conditional write semantics.
            await Promise.all(entries.map(([key, value]) => this.set(key, value, opts)));
            return;
        }
        await this.client.mSet(Object.fromEntries(entries.map(([key, value]) => [key, serialize(value)])));
    }
    async deleteMany(keys: string[]): Promise<number> {
        let removed = 0;
        // Even when using a standalone client this works; with Redis Cluster,
        // separate keys may be in different hash slots.
        for (let i = 0; i < keys.length; i += 32) {
            const results = await Promise.all(keys.slice(i, i + 32).map(key => this.client.del(key)));
            for (const result of results) removed += result;
        }
        return removed;
    }
    async increment(key: string, amount = 1): Promise<number> { return this.client.incrBy(key, counterAmount(amount)); }
    async decrement(key: string, amount = 1): Promise<number> { return this.client.decrBy(key, counterAmount(amount)); }
    async touch(key: string, seconds: number): Promise<boolean> { return Boolean(await this.client.expire(key, expiration(seconds)!)); }
    async close(): Promise<void> { if (this.config.ownClient) await this.client.close?.(); }
    native(): RedisCacheClient { return this.client; }
}
export const createRedisCacheHelper = (client: RedisCacheClient, config: RedisHelperConfig = {}): RedisCacheHelper => new RedisCacheHelper(client, config);
