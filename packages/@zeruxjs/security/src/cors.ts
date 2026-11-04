export interface CorsOptions {
    origins: readonly string[] | ((origin: string) => boolean);
    methods?: readonly string[];
    headers?: readonly string[];
    exposeHeaders?: readonly string[];
    credentials?: boolean;
    maxAgeSeconds?: number;
}
export interface CorsResult { allowed: boolean; status: 200 | 204 | 403; headers: Record<string, string>; }
const httpToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const list = (values: readonly string[]) => {
    if (!Array.isArray(values) || values.length > 128 || values.some(v => typeof v !== 'string' || v.length > 128 || !httpToken.test(v))) throw new Error("Invalid CORS token");
    return values.join(", ");
};
/** Origin is never reflected without a matching allowlist or explicit predicate. */
export function evaluateCors(origin: string | undefined, options: CorsOptions, preflight?: { method: string; headers?: string }): CorsResult {
    if (!options || typeof options !== 'object' || (typeof options.origins !== 'function' && (!Array.isArray(options.origins) || options.origins.length > 128 || options.origins.some(value => typeof value !== 'string' || value.length > 2048)))) throw new TypeError('Invalid CORS origin policy');
    if (options.credentials !== undefined && typeof options.credentials !== 'boolean') throw new TypeError('Invalid CORS credentials policy');
    const headers: Record<string, string> = { vary: preflight ? 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers' : 'Origin' };
    if (typeof origin !== "string" || !origin || origin === "null" || origin.length > 2048) return { allowed: false, status: 403, headers };
    try { const source = new URL(origin); if (!['http:', 'https:'].includes(source.protocol) || source.origin !== origin) return { allowed: false, status: 403, headers }; }
    catch { return { allowed: false, status: 403, headers }; }
    if (typeof options.origins === 'function' && options.origins.constructor.name === 'AsyncFunction') throw new TypeError('CORS predicates must return a synchronous boolean');
    const allowed = typeof options.origins === "function" ? options.origins(origin) : options.origins.some(item => item === origin);
    if (allowed && typeof (allowed as unknown as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(allowed).catch(() => {});
        throw new TypeError('CORS predicates must return a synchronous boolean');
    }
    if (typeof allowed !== 'boolean') throw new TypeError('CORS predicates must return a synchronous boolean');
    if (!allowed) return { allowed: false, status: 403, headers };
    const configuredMethods = options.methods ?? ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
    list(configuredMethods);
    const methods = configuredMethods.map(value => value.toUpperCase());
    const allowedHeaders = options.headers ?? ["Content-Type", "Authorization", "X-CSRF-Token"];
    list(allowedHeaders);
    if (options.exposeHeaders !== undefined) list(options.exposeHeaders);
    if (preflight) {
        if (typeof preflight.method !== 'string' || preflight.method.length > 128 || !httpToken.test(preflight.method) || !methods.includes(preflight.method.toUpperCase())) return { allowed: false, status: 403, headers };
        if (preflight.headers !== undefined && (typeof preflight.headers !== 'string' || preflight.headers.length > 8192)) return { allowed: false, status: 403, headers };
        const requested = (preflight.headers ?? "").split(",").map(v => v.trim()).filter(Boolean);
        if (requested.length > 128 || requested.some(v => !httpToken.test(v) || !allowedHeaders.some(h => h.toLowerCase() === v.toLowerCase()))) return { allowed: false, status: 403, headers };
        headers["access-control-allow-methods"] = list(methods);
        headers["access-control-allow-headers"] = list(allowedHeaders);
        if (options.maxAgeSeconds !== undefined) {
            if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0 || options.maxAgeSeconds > 86400) throw new RangeError("Invalid CORS max age");
            headers["access-control-max-age"] = String(options.maxAgeSeconds);
        }
    }
    headers["access-control-allow-origin"] = origin;
    if (options.credentials) headers["access-control-allow-credentials"] = "true";
    if (options.exposeHeaders?.length) headers["access-control-expose-headers"] = list(options.exposeHeaders);
    return { allowed: true, status: preflight ? 204 : 200, headers };
}
