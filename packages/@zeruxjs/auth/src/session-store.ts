/** Optional in-process session invalidation registry. Requires a distributed implementation for multi-node deployments. */
export function createSessionRevocationStore(options: { maxEntries?: number; now?: () => number } = {}) {
    const revoked = new Map<string, number>();
    const max = options.maxEntries ?? 10000;
    const now = options.now ?? Date.now;
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("Invalid revocation capacity");
    return {
        revoke(jti: string, expiresAtUnixSeconds: number) {
            if (!/^[A-Za-z0-9_-]{22}$/.test(jti) || !Number.isSafeInteger(expiresAtUnixSeconds)) throw new Error("Invalid session identity");
            for (const [id, exp] of revoked) if (exp * 1000 <= now()) revoked.delete(id);
            if (!revoked.has(jti) && revoked.size >= max) throw new Error("Revocation store full");
            revoked.set(jti, expiresAtUnixSeconds);
        },
        isRevoked(session: { jti?: string; expiresAt?: number }): boolean {
            if (!session.jti) return false;
            const expiry = revoked.get(session.jti);
            if (expiry === undefined) return false;
            if (expiry * 1000 <= now()) { revoked.delete(session.jti); return false; }
            return true;
        },
        get size() { return revoked.size; }
    };
}
