export interface RateLimitOptions { windowMs: number; max: number; maxKeys?: number; now?: () => number; }
export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number; }
/** Bounded in-process rate limiter. Use a shared store for multiple instances. */
export function createRateLimiter(options: RateLimitOptions) {
    if (![options.windowMs, options.max].every(n => Number.isSafeInteger(n) && n > 0)) throw new RangeError("Invalid limiter settings");
    const cap = options.maxKeys ?? 10000;
    if (!Number.isSafeInteger(cap) || cap < 1) throw new RangeError("Invalid maxKeys");
    const now = options.now ?? Date.now;
    const buckets = new Map<string, { count: number; reset: number }>();
    return {
        check(key: string, weight = 1): RateLimitResult {
            if (!key || key.length > 512 || !Number.isSafeInteger(weight) || weight < 1) throw new Error("Invalid rate-limit key or weight");
            const stamp = now();
            let state = buckets.get(key);
            if (state && state.reset <= stamp) { buckets.delete(key); state = undefined; }
            if (!state) {
                if (buckets.size >= cap) {
                    for (const [name, item] of buckets) { if (item.reset <= stamp) buckets.delete(name); }
                    if (buckets.size >= cap) return { allowed: false, remaining: 0, resetAt: stamp + options.windowMs, retryAfterSeconds: Math.ceil(options.windowMs / 1000) };
                }
                state = { count: 0, reset: stamp + options.windowMs };
                buckets.set(key, state);
            }
            const allowed = state.count + weight <= options.max;
            if (allowed) state.count += weight;
            return { allowed, remaining: Math.max(0, options.max - state.count), resetAt: state.reset, retryAfterSeconds: allowed ? 0 : Math.ceil((state.reset - stamp) / 1000) };
        },
        reset(key?: string) { if (key) buckets.delete(key); else buckets.clear(); },
        get size() { return buckets.size; }
    };
}
