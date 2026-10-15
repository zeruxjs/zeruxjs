export interface SecureHeadersOptions {
    hsts?: boolean | { maxAgeSeconds: number; includeSubDomains?: boolean; preload?: boolean };
    csp?: string;
    referrerPolicy?: "no-referrer" | "strict-origin-when-cross-origin" | "same-origin";
    frameOptions?: "DENY" | "SAMEORIGIN";
}
/** HTTPS-only HSTS and defense-in-depth browser headers. CSP must be reviewed per application. */
export function createSecurityHeaders(options: SecureHeadersOptions = {}, https = false): Record<string, string> {
    const headers: Record<string, string> = {
        "x-content-type-options": "nosniff",
        "referrer-policy": options.referrerPolicy ?? "strict-origin-when-cross-origin",
        "x-frame-options": options.frameOptions ?? "DENY",
        "cross-origin-opener-policy": "same-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()"
    };
    if (options.csp) {
        if (/[\r\n]/.test(options.csp)) throw new Error("Invalid CSP");
        headers["content-security-policy"] = options.csp;
    }
    if (https && options.hsts) {
        const config = options.hsts === true ? { maxAgeSeconds: 31536000 } : options.hsts;
        if (!Number.isSafeInteger(config.maxAgeSeconds) || config.maxAgeSeconds < 0 || config.maxAgeSeconds > 63072000) throw new RangeError("Invalid HSTS max age");
        headers["strict-transport-security"] = `max-age=${config.maxAgeSeconds}` + ("includeSubDomains" in config && config.includeSubDomains ? "; includeSubDomains" : "") + ("preload" in config && config.preload ? "; preload" : "");
    }
    return headers;
}
