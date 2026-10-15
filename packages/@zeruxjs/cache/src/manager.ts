import { createRequire } from "node:module";
import path from "node:path";
import { createMemoryCacheHelper } from "./memory.js";
import type { MemoryCacheOptions } from "./memory.js";

import type {
    CacheHelper,
    CacheManager,
    CacheManagerConfig,
    CacheSetOptions,
    CacheValue,
    MaybePromise
} from "./types.js";
import {
    createCacheError,
    extractCacheHelperFactory,
    normalizeCacheConfig
} from "./utils.js";

/**
 * Title: Application-scoped helper import
 * Description: Resolves cache helper packages from the running application's node_modules before falling back to package-local resolution.
 * Global Variables: process.cwd()
 * @param packageName Helper package name from Zerux config.
 * @returns Imported helper module namespace.
 */
const importHelperPackage = async (packageName: string): Promise<Record<string, unknown>> => {
    try {
        const appRequire = createRequire(path.join(process.cwd(), "package.json"));
        return await import(appRequire.resolve(packageName)) as Record<string, unknown>;
    } catch {
        return await import(packageName) as Record<string, unknown>;
    }
};

/**
 * Title: Cache manager implementation
 * Description: Applies global defaults, namespaces keys, and delegates storage operations to one configured helper.
 * Global Variables: none
 */
class CacheManagerImpl implements CacheManager {
    public readonly helper: string;
    public readonly prefix?: string;
    public readonly defaultTtlSeconds?: number;
    readonly #adapter: CacheHelper;
    readonly #pending = new Map<string, Promise<CacheValue>>();

    constructor(config: Required<Pick<CacheManagerConfig, "helper">> & CacheManagerConfig, adapter: CacheHelper) {
        this.helper = config.helper;
        this.prefix = config.prefix;
        this.defaultTtlSeconds = config.defaultTtlSeconds;
        this.#adapter = adapter;
    }

    get(key: string): MaybePromise<CacheValue | undefined> {
        return this.#adapter.get(this.#key(key));
    }

    set(key: string, value: CacheValue, options: CacheSetOptions = {}): MaybePromise<void> {
        this.#assertTtl(options.ttlSeconds);

        return this.#adapter.set(this.#key(key), value, {
            ...options,
            ttlSeconds: options.ttlSeconds ?? this.defaultTtlSeconds
        });
    }

    delete(key: string): MaybePromise<boolean> {
        return this.#adapter.delete(this.#key(key));
    }

    has(key: string): MaybePromise<boolean> {
        return this.#adapter.has(this.#key(key));
    }

    clear(): MaybePromise<void> {
        if (!this.prefix) return this.#adapter.clear();
        if (!this.#adapter.clearPrefix) {
            throw createCacheError({ code: "NAMESPACE_CLEAR_UNSUPPORTED", message: "Helper cannot safely clear a namespace" });
        }
        return this.#adapter.clearPrefix(this.prefix);
    }

    getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>> {
        const namespaced = keys.map((key) => this.#key(key));
        const restore = (result: Record<string, CacheValue | undefined>) => {
            const mapped: Record<string, CacheValue | undefined> = Object.create(null);
            keys.forEach((key, index) => { Object.defineProperty(mapped, key, { value: result[namespaced[index]], enumerable: true, configurable: true, writable: true }); });
            return mapped;
        };
        const result = this.#adapter.getMany(namespaced);
        return result && typeof (result as Promise<unknown>).then === "function"
            ? Promise.resolve(result).then(restore)
            : restore(result as Record<string, CacheValue | undefined>);
    }

    setMany(values: Record<string, CacheValue>, options: CacheSetOptions = {}): MaybePromise<void> {
        this.#assertTtl(options.ttlSeconds);
        return this.#adapter.setMany(
            Object.fromEntries(Object.entries(values).map(([key, value]) => [this.#key(key), value])),
            { ...options, ttlSeconds: options.ttlSeconds ?? this.defaultTtlSeconds }
        );
    }

    deleteMany(keys: string[]): MaybePromise<number> {
        return this.#adapter.deleteMany(keys.map((key) => this.#key(key)));
    }

    increment(key: string, amount = 1): MaybePromise<number> {
        this.#assertAmount(amount);
        return this.#adapter.increment(this.#key(key), amount);
    }

    decrement(key: string, amount = 1): MaybePromise<number> {
        this.#assertAmount(amount);
        return this.#adapter.decrement(this.#key(key), amount);
    }

    touch(key: string, ttlSeconds: number): MaybePromise<boolean> {
        this.#assertTtl(ttlSeconds);
        return this.#adapter.touch(this.#key(key), ttlSeconds);
    }

    close(): MaybePromise<void> {
        this.#pending.clear();
        return this.#adapter.close?.();
    }

    /** Coalesce concurrent misses within this manager; cache only successful producer results. */
    async remember(key: string, producer: () => MaybePromise<CacheValue>, options: CacheSetOptions = {}): Promise<CacheValue> {
        const scoped = this.#key(key);
        if (typeof producer !== "function") throw new TypeError("Cache producer must be a function");
        const existing = await this.get(key);
        if (existing !== undefined) return existing;
        const active = this.#pending.get(scoped);
        if (active) return active;
        const job = (async () => {
            const value = await producer();
            await this.set(key, value, options);
            return value;
        })();
        this.#pending.set(scoped, job);
        try { return await job; }
        finally { if (this.#pending.get(scoped) === job) this.#pending.delete(scoped); }
    }

    native(): unknown {
        return this.#adapter.native?.() ?? this.#adapter;
    }

    #key(key: string): string {
        if (typeof key !== "string" || key.length === 0) {
            throw createCacheError({
                code: "INVALID_KEY",
                message: "Cache key must be a non-empty string"
            });
        }

        return this.prefix ? `${this.prefix}:${key}` : key;
    }

    #assertTtl(ttlSeconds: number | undefined): void {
        if (ttlSeconds !== undefined && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) {
            throw createCacheError({
                code: "INVALID_TTL",
                message: "ttlSeconds must be a positive finite number"
            });
        }
    }

    #assertAmount(amount: number): void {
        if (!Number.isSafeInteger(amount) || amount < 0) {
            throw createCacheError({
                code: "INVALID_AMOUNT",
                message: "Cache increment and decrement amounts must be non-negative safe integers"
            });
        }
    }
}

let activeManager: CacheManager | null = null;

/**
 * Title: Cache manager factory
 * Description: Creates a manager and loads the configured helper package.
 * Global Variables: none
 * @param config Cache manager config.
 * @returns Cache manager.
 */
export const createCacheManager = async (config: CacheManagerConfig): Promise<CacheManager> => {
    const normalized = normalizeCacheConfig(config);
    if (normalized.helper === "memory" || normalized.helper === "@zeruxjs/cache/memory") {
        return new CacheManagerImpl(normalized, createMemoryCacheHelper(normalized.options as MemoryCacheOptions));
    }
    const imported = await importHelperPackage(normalized.helper);
    const factory = extractCacheHelperFactory(imported);
    const adapter = await factory(normalized.options ?? {});

    return new CacheManagerImpl(normalized, adapter);
};

/**
 * Title: Active cache manager setter
 * Description: Updates the process-wide manager used by convenience exports.
 * Global Variables: activeManager
 * @param manager Cache manager instance.
 */
export const setActiveCacheManager = (manager: CacheManager): void => {
    activeManager = manager;
};

/**
 * Title: Active cache manager getter
 * Description: Returns the configured process-wide cache manager.
 * Global Variables: activeManager
 * @returns Active manager instance.
 */
export const getActiveCacheManager = (): CacheManager => {
    if (!activeManager) {
        throw createCacheError({
            code: "CACHE_MANAGER_NOT_INITIALIZED",
            message: "Cache manager has not been initialized yet"
        });
    }

    return activeManager;
};

/**
 * Title: Cache manager configurator
 * Description: Creates and installs the active manager in one step.
 * Global Variables: activeManager
 * @param config Cache manager config.
 * @returns Installed manager.
 */
export const configureCacheManager = async (config: CacheManagerConfig): Promise<CacheManager> => {
    const manager = await createCacheManager(config);
    setActiveCacheManager(manager);
    return manager;
};

/** Construct a manager from an existing adapter (useful for memory and test adapters). */
export const createCacheManagerWithHelper = (helper: CacheHelper, config: Omit<CacheManagerConfig, "helper"> & { helper?: string } = {}): CacheManager => {
    const normalized = normalizeCacheConfig({ ...config, helper: config.helper ?? "custom" });
    return new CacheManagerImpl(normalized, helper);
};
