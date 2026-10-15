import type { CacheHelper, CacheSetOptions, CacheValue } from "./types.js";

export interface MemoryCacheOptions {
    maxEntries?: number;
    /** Injected clock for deterministic testing; milliseconds since Unix epoch. */
    now?: () => number;
}
export interface MemoryCacheStats { entries: number; hits: number; misses: number; evictions: number; }
interface Entry { value: CacheValue; expiresAt?: number; }

const clone = (value: CacheValue): CacheValue => {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Cache values must be JSON serializable");
    return JSON.parse(serialized) as CacheValue;
};
const checkTtl = (value?: number): number | undefined => {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value <= 0) throw new RangeError("Cache TTL must be positive and finite");
    return value * 1000;
};

/** Bounded, LRU-evicted, TTL-aware in-memory adapter. Scoped to one helper instance. */
export const createMemoryCacheHelper = (options: MemoryCacheOptions = {}): CacheHelper & { stats(): MemoryCacheStats } => {
    const maxEntries = options.maxEntries ?? 1000;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError("maxEntries must be a positive integer");
    const now = options.now ?? Date.now;
    const entries = new Map<string, Entry>();
    const stats = { hits: 0, misses: 0, evictions: 0 };
    const lookup = (key: string, promote = true): Entry | undefined => {
        const found = entries.get(key);
        if (!found) return undefined;
        if (found.expiresAt !== undefined && found.expiresAt <= now()) { entries.delete(key); return undefined; }
        if (promote) { entries.delete(key); entries.set(key, found); }
        return found;
    };
    const adapter: CacheHelper & { stats(): MemoryCacheStats } = {
        get(key) { const found = lookup(key); if (!found) { stats.misses++; return undefined; } stats.hits++; return clone(found.value); },
        set(key, value, opts: CacheSetOptions = {}) {
            if (opts.ifAbsent && opts.ifPresent) throw new TypeError("Contradictory cache conditions");
            const ttlMs = checkTtl(opts.ttlSeconds);
            const present = lookup(key, false) !== undefined;
            if ((opts.ifAbsent && present) || (opts.ifPresent && !present)) return;
            const copy = clone(value);
            entries.delete(key);
            entries.set(key, { value: copy, expiresAt: ttlMs === undefined ? undefined : now() + ttlMs });
            while (entries.size > maxEntries) { entries.delete(entries.keys().next().value!); stats.evictions++; }
        },
        delete(key) { return entries.delete(key); },
        has(key) { return lookup(key, false) !== undefined; },
        clear() { entries.clear(); },
        clearPrefix(prefix) { for (const key of entries.keys()) if (key.startsWith(prefix + ":")) entries.delete(key); },
        getMany(keys) { const result: Record<string, CacheValue | undefined> = Object.create(null); for (const key of keys) Object.defineProperty(result, key, { value: adapter.get(key), enumerable: true, configurable: true, writable: true }); return result; },
        setMany(values, opts) { for (const [key, value] of Object.entries(values)) adapter.set(key, value, opts); },
        deleteMany(keys) { let n = 0; for (const key of keys) if (adapter.delete(key)) n++; return n; },
        increment(key, amount = 1) {
            if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Counter amount must be a non-negative safe integer");
            const old = lookup(key, false);
            const current = old ? old.value : 0;
            if (typeof current !== "number" || !Number.isSafeInteger(current)) throw new TypeError("Cache counter must be an integer");
            const next = current + amount;
            if (!Number.isSafeInteger(next)) throw new RangeError("Cache counter overflow");
            entries.delete(key);
            entries.set(key, { value: next, expiresAt: old?.expiresAt });
            return next;
        },
        decrement(key, amount = 1) {
            if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Counter amount must be a non-negative safe integer");
            const old = lookup(key, false);
            const current = old ? old.value : 0;
            if (typeof current !== "number" || !Number.isSafeInteger(current)) throw new TypeError("Cache counter must be an integer");
            const next = current - amount;
            if (!Number.isSafeInteger(next)) throw new RangeError("Cache counter overflow");
            entries.delete(key);
            entries.set(key, { value: next, expiresAt: old?.expiresAt });
            return next;
        },
        touch(key, ttlSeconds) { const ms = checkTtl(ttlSeconds)!; const old = lookup(key, false); if (!old) return false; old.expiresAt = now() + ms; return true; },
        native() { return entries; },
        close() { entries.clear(); },
        stats() { for (const key of entries.keys()) lookup(key, false); return { entries: entries.size, ...stats }; }
    };
    return adapter;
};
