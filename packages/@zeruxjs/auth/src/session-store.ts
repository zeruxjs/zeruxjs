/** Create an optional bounded process-local revocation registry. It does not provide shared revocation across replicas.
 * @param {{ maxEntries?: number; now?: () => number }} options - Optional finite capacity and trusted millisecond clock.
 * @param {number|undefined} options.maxEntries - Process-local revocation cap, default 10000.
 * @param {(() => number)|undefined} options.now - Trusted injected millisecond clock or Date.now.
 * @returns {ReturnType<typeof createSessionRevocationStore>} Local registry with no timers, connection or close handle.
 */
export function createSessionRevocationStore(
  options: { maxEntries?: number; now?: () => number } = {}
) {
  /** Process-local revocation entries; never infer distributed invalidation from this map. */
  const revoked = new Map<string, number>();
  /** Explicit retained entry cap, default 10000; overflow rejects rather than silently evicting revocations. */
  const max = options.maxEntries ?? 10000;
  /** Trusted host clock or Date.now, returning milliseconds. */
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('Invalid revocation capacity');
  }
  return {
    /** Retain an explicit session revocation until its Unix-second expiry.
     * @param {string} jti - Validated public session identifier.
     * @param {number} expiresAtUnixSeconds - Original session expiry in Unix seconds.
     * @returns {void} Invalid input/capacity overflow throws; old expired entries prune first.
     */
    revoke(jti: string, expiresAtUnixSeconds: number) {
      if (
        !/^[A-Za-z0-9_-]{22}$/.test(jti) ||
        !Number.isSafeInteger(expiresAtUnixSeconds)
      ) {
        throw new Error('Invalid session identity');
      }
      // Release only expired local revocations before admission; never silently evict a live denial.
      for (const [id, exp] of revoked) {
        if (exp * 1000 <= now()) {
          revoked.delete(id);
        }
      }
      if (!revoked.has(jti) && revoked.size >= max) {
        throw new Error('Revocation store full');
      }
      revoked.set(jti, expiresAtUnixSeconds);
    },
    /** Check one session ID against local retained revocations.
     * @param {{ jti?: string; expiresAt?: number }} session - Previously verified session metadata; this method does not authenticate it.
     * @param {string|undefined} session.jti - Previously verified public session identifier.
     * @param {number|undefined} session.expiresAt - Previously verified session expiry metadata; this lookup uses its stored expiry.
     * @returns {boolean} True only for a retained unexpired revocation; expired queried entries are pruned.
     */
    isRevoked(session: { jti?: string; expiresAt?: number }): boolean {
      if (!session.jti) {
        return false;
      }
      /** Stored Unix-second expiry for this exact session ID. */
      const expiry = revoked.get(session.jti);
      if (expiry === undefined) {
        return false;
      }
      if (expiry * 1000 <= now()) {
        revoked.delete(session.jti);
        return false;
      }
      return true;
    },
    /** Read retained local entry count; this is not a distributed session inventory.
     * @returns {number} Current map size before any future opportunistic pruning.
     */
    get size() {
      return revoked.size;
    },
  };
}
