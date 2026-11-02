export interface SecureHeadersOptions {
    crossOriginResourcePolicy?: 'same-origin' | 'same-site' | 'cross-origin';
    crossOriginOpenerPolicy?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none';
    crossOriginEmbedderPolicy?: 'require-corp' | 'credentialless' | 'unsafe-none';
    hsts?: boolean | { maxAgeSeconds: number; includeSubDomains?: boolean; preload?: boolean };
    csp?: string;
    referrerPolicy?: "no-referrer" | "strict-origin-when-cross-origin" | "same-origin";
    frameOptions?: "DENY" | "SAMEORIGIN";
}
/** HTTPS-only HSTS and defense-in-depth browser headers. CSP must be reviewed per application. */
export function createSecurityHeaders(options: SecureHeadersOptions = {}, https = false): Record<string, string> {
    if (!options || typeof options !== 'object' || typeof https !== 'boolean') throw new TypeError('Invalid security header options');
    if (options.referrerPolicy !== undefined && !['no-referrer', 'strict-origin-when-cross-origin', 'same-origin'].includes(options.referrerPolicy)) throw new TypeError('Invalid referrer policy');
    if (options.frameOptions !== undefined && !['DENY', 'SAMEORIGIN'].includes(options.frameOptions)) throw new TypeError('Invalid frame policy');
    if (options.csp !== undefined && (typeof options.csp !== 'string' || options.csp.length > 16384)) throw new TypeError('Invalid CSP');
    if (options.hsts !== undefined && typeof options.hsts !== 'boolean' && (!options.hsts || typeof options.hsts !== 'object' || Array.isArray(options.hsts))) throw new TypeError('Invalid HSTS policy');
    if (typeof options.hsts === 'object' && (!Number.isSafeInteger(options.hsts.maxAgeSeconds) || options.hsts.maxAgeSeconds < 0 || options.hsts.maxAgeSeconds > 63072000)) throw new RangeError('Invalid HSTS max age');
    if (typeof options.hsts === 'object') for (const flag of ['includeSubDomains', 'preload'] as const) {
        if (options.hsts[flag] !== undefined && typeof options.hsts[flag] !== 'boolean') throw new TypeError('Invalid HSTS flag');
    }
    for (const [value, allowed] of [
        [options.crossOriginResourcePolicy, ['same-origin', 'same-site', 'cross-origin']],
        [options.crossOriginOpenerPolicy, ['same-origin', 'same-origin-allow-popups', 'unsafe-none']],
        [options.crossOriginEmbedderPolicy, ['require-corp', 'credentialless', 'unsafe-none']]
    ] as const) if (value !== undefined && !(allowed as readonly string[]).includes(value)) throw new TypeError('Invalid cross-origin header policy');
    const headers: Record<string, string> = {
        "x-content-type-options": "nosniff",
        "referrer-policy": options.referrerPolicy ?? "strict-origin-when-cross-origin",
        "x-frame-options": options.frameOptions ?? "DENY",
        "cross-origin-opener-policy": options.crossOriginOpenerPolicy ?? "same-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()"
    };
    if (options.crossOriginResourcePolicy) headers['cross-origin-resource-policy'] = options.crossOriginResourcePolicy;
    if (options.crossOriginEmbedderPolicy) headers['cross-origin-embedder-policy'] = options.crossOriginEmbedderPolicy;
    if (options.csp) {
        if (/[\x00-\x1f\x7f]/.test(options.csp)) throw new Error("Invalid CSP");
        headers["content-security-policy"] = options.csp;
    }
    if (https && options.hsts) {
        const config = options.hsts === true ? { maxAgeSeconds: 31536000 } : options.hsts;
        headers["strict-transport-security"] = `max-age=${config.maxAgeSeconds}` + ("includeSubDomains" in config && config.includeSubDomains ? "; includeSubDomains" : "") + ("preload" in config && config.preload ? "; preload" : "");
    }
    return headers;
}
