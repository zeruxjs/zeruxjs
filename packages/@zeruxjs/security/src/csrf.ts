import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Double-submit friendly, session-bound signed token. The caller must store the session identifier securely. */
export interface CsrfOptions { secret: string | Buffer; ttlSeconds?: number; now?: () => number; }
export interface CsrfTokenManager {
    issue(sessionId: string): string;
    verify(token: string | undefined, sessionId: string): boolean;
}
const encode = (value: string) => Buffer.from(value).toString("base64url");
const validSecret = (value: string | Buffer): Buffer => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    if (buffer.length < 32) throw new Error("CSRF secret must contain at least 32 bytes");
    return buffer;
};
export function createCsrfProtection(options: CsrfOptions): CsrfTokenManager {
    const secret = validSecret(options.secret);
    const ttl = options.ttlSeconds ?? 3600;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400 * 7) throw new RangeError("Invalid CSRF lifetime");
    const now = options.now ?? Date.now;
    function signature(payload: string, sessionId: string): Buffer {
        return createHmac("sha256", secret).update(sessionId).update("\0").update(payload).digest();
    }
    return {
        issue(sessionId) {
            if (!sessionId) throw new Error("Session identifier is required");
            const payload = `${Math.floor(now() / 1000)}.${randomBytes(24).toString("base64url")}`;
            return `${encode(payload)}.${signature(payload, sessionId).toString("base64url")}`;
        },
        verify(token, sessionId) {
            if (!sessionId || !token || token.length > 512) return false;
            const parts = token.split(".");
            if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
            const payload = Buffer.from(parts[0], "base64url").toString("utf8");
            const [time, nonce, ...extra] = payload.split(".");
            if (extra.length || !/^(0|[1-9][0-9]*)$/.test(time) || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) return false;
            const issued = Number(time), current = Math.floor(now() / 1000);
            if (!Number.isSafeInteger(issued) || issued > current + 60 || issued + ttl < current) return false;
            const actual = Buffer.from(parts[1], "base64url"), expected = signature(payload, sessionId);
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        }
    };
}
/** Enforce same-origin checks for unsafe cookie-authenticated requests. */
export function isSameOriginRequest(origin: string | undefined, expectedOrigin: string): boolean {
    try {
        if (!origin || origin === "null") return false;
        const source = new URL(origin), expected = new URL(expectedOrigin);
        return source.origin === expected.origin && source.username === "" && source.password === "";
    } catch { return false; }
}
