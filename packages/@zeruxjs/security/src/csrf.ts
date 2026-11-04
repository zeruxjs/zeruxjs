import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Double-submit friendly, session-bound signed token. The caller must store the session identifier securely. */
export interface CsrfOptions { secret: string | Buffer; ttlSeconds?: number; now?: () => number; }
export interface CsrfTokenManager {
    issue(sessionId: string): string;
    verify(token: string | undefined, sessionId: string): boolean;
}
const encode = (value: string) => Buffer.from(value).toString("base64url");
const validSecret = (value: string | Buffer): Buffer => {
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) throw new TypeError('Invalid CSRF secret');
    const length = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.length;
    if (length < 32 || length > 4096) throw new Error('CSRF secret must contain 32–4096 bytes');
    return Buffer.from(value);
};
export function createCsrfProtection(options: CsrfOptions): CsrfTokenManager {
    if (!options || typeof options !== 'object') throw new TypeError('Invalid CSRF options');
    if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('Invalid CSRF clock');
    const ttl = options.ttlSeconds ?? 3600;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400 * 7) throw new RangeError("Invalid CSRF lifetime");
    const secret = validSecret(options.secret);
    const now = options.now ?? Date.now;
    const timestamp = () => {
        const stamp = now();
        if (!Number.isSafeInteger(stamp) || stamp < 0) throw new RangeError('Invalid CSRF clock');
        return Math.floor(stamp / 1000);
    };
    function signature(payload: string, sessionId: string): Buffer {
        return createHmac("sha256", secret).update(sessionId).update("\0").update(payload).digest();
    }
    return {
        issue(sessionId) {
            if (typeof sessionId !== 'string' || !sessionId || Buffer.byteLength(sessionId) > 1024 || /[\x00-\x1f\x7f]/.test(sessionId)) throw new Error("Session identifier is required");
            const payload = `${timestamp()}.${randomBytes(24).toString("base64url")}`;
            return `${encode(payload)}.${signature(payload, sessionId).toString("base64url")}`;
        },
        verify(token, sessionId) {
            if (typeof sessionId !== 'string' || !sessionId || Buffer.byteLength(sessionId) > 1024 || /[\x00-\x1f\x7f]/.test(sessionId) || typeof token !== 'string' || !token || token.length > 512) return false;
            const parts = token.split(".");
            if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
            const payloadBytes = Buffer.from(parts[0], "base64url");
            if (payloadBytes.toString("base64url") !== parts[0]) return false;
            const payload = payloadBytes.toString("utf8");
            const [time, nonce, ...extra] = payload.split(".");
            if (extra.length || !/^(0|[1-9][0-9]*)$/.test(time) || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) return false;
            const issued = Number(time), current = timestamp();
            if (!Number.isSafeInteger(issued) || issued > current + 60 || issued + ttl < current) return false;
            const actual = Buffer.from(parts[1], "base64url"), expected = signature(payload, sessionId);
            return actual.toString("base64url") === parts[1] && actual.length === expected.length && timingSafeEqual(actual, expected);
        }
    };
}
/** Enforce same-origin checks for unsafe cookie-authenticated requests. */
export function isSameOriginRequest(origin: string | undefined, expectedOrigin: string): boolean {
    try {
        if (!origin || origin === "null") return false;
        const source = new URL(origin), expected = new URL(expectedOrigin);
        return ['http:', 'https:'].includes(source.protocol) && ['http:', 'https:'].includes(expected.protocol) && source.origin === origin && expected.origin === expectedOrigin && source.origin === expected.origin;
    } catch { return false; }
}
