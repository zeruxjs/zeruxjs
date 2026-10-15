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
    if (values.some(v => !httpToken.test(v))) throw new Error("Invalid CORS token");
    return values.join(", ");
};
/** Origin is never reflected without a matching allowlist or explicit predicate. */
export function evaluateCors(origin: string | undefined, options: CorsOptions, preflight?: { method: string; headers?: string }): CorsResult {
    const headers: Record<string, string> = { vary: "Origin" };
    if (!origin || origin === "null") return { allowed: false, status: 403, headers };
    const allowed = typeof options.origins === "function" ? options.origins(origin) : options.origins.some(item => item === origin);
    if (!allowed) return { allowed: false, status: 403, headers };
    try { if (new URL(origin).origin !== origin) return { allowed: false, status: 403, headers }; }
    catch { return { allowed: false, status: 403, headers }; }
    const methods = options.methods ?? ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
    const allowedHeaders = options.headers ?? ["Content-Type", "Authorization", "X-CSRF-Token"];
    if (preflight) {
        if (!httpToken.test(preflight.method) || !methods.includes(preflight.method.toUpperCase())) return { allowed: false, status: 403, headers };
        const requested = (preflight.headers ?? "").split(",").map(v => v.trim()).filter(Boolean);
        if (requested.some(v => !httpToken.test(v) || !allowedHeaders.some(h => h.toLowerCase() === v.toLowerCase()))) return { allowed: false, status: 403, headers };
        headers.vary += ", Access-Control-Request-Method, Access-Control-Request-Headers";
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
