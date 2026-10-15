import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export interface IssuedToken { token: string; id: string; expiresAt: number; }
export interface TokenRecord { id: string; subject: string; scopes: string[]; expiresAt: number; revoked: boolean; digest: string; }
/** Local API/reset-token registry. Persist records in a DB for multi-process use. */
export function createTokenStore(options: { maxTokens?: number; now?: () => number } = {}) {
    const entries = new Map<string, TokenRecord>();
    const max = options.maxTokens ?? 10000, now = options.now ?? Date.now;
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("Invalid token capacity");
    const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
    return {
        issue(subject: string, scopes: string[] = [], ttlMs = 3600000): IssuedToken {
            if (!subject || subject.length > 512 || !scopes.every(s => /^[a-zA-Z0-9:_*-]{1,100}$/.test(s))) throw new Error("Invalid token subject or scopes");
            if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000 * 365) throw new RangeError("Invalid token lifetime");
            for (const [key, item] of entries) if (item.expiresAt <= now() || item.revoked) entries.delete(key);
            if (entries.size >= max) throw new Error("Token store full");
            const id = randomBytes(12).toString("base64url"), secret = randomBytes(32).toString("base64url");
            const token = `zx_${id}.${secret}`, expiresAt = now() + ttlMs;
            entries.set(id, { id, subject, scopes: [...scopes], expiresAt, revoked: false, digest: digest(token) });
            return { token, id, expiresAt };
        },
        verify(token: string, scope?: string): Omit<TokenRecord, "digest"> | null {
            if (typeof token !== "string" || token.length > 256) return null;
            const matched = /^zx_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(token);
            if (!matched) return null;
            const record = entries.get(matched[1]);
            if (!record || record.revoked || record.expiresAt <= now()) return null;
            const expected = Buffer.from(record.digest, "hex"), actual = Buffer.from(digest(token), "hex");
            if (!timingSafeEqual(expected, actual) || (scope && !record.scopes.includes(scope) && !record.scopes.includes("*"))) return null;
            const { digest: _digest, ...publicRecord } = record;
            return { ...publicRecord, scopes: [...publicRecord.scopes] };
        },
        revoke(id: string) { const item = entries.get(id); if (!item) return false; item.revoked = true; return true; },
        clear() { entries.clear(); },
        get size() { return entries.size; }
    };
}
