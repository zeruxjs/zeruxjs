import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export interface IssuedToken {
  /** Private full bearer token returned to its issuer only. */
  token: string;
  /** Public random token-record identifier. */
  id: string;
  /** Absolute millisecond expiry. */
  expiresAt: number;
}
export interface TokenRecord {
  /** Public random token-record identifier. */
  id: string;
  /** Host-verified opaque subject label. */
  subject: string;
  /** Explicit copied legacy scopes; may include wildcard. */
  scopes: string[];
  /** Absolute millisecond expiry. */
  expiresAt: number;
  /** Whether the local record has been explicitly revoked. */
  revoked: boolean;
  /** Private stored full-token SHA-256 digest; omitted from verified public results. */
  digest: string;
}
/** Create a bounded process-local legacy API/reset-token digest registry. No durable or cross-replica revocation is implied.
 * @param {{ maxTokens?: number; now?: () => number }} options - Optional capacity and trusted millisecond clock.
 * @param {number|undefined} options.maxTokens - Process-local token cap, default 10000.
 * @param {(() => number)|undefined} options.now - Trusted injected millisecond clock or Date.now.
 * @returns {ReturnType<typeof createTokenStore>} Local owner with explicit clear; no timer/connection lifecycle.
 */
export function createTokenStore(
  options: { maxTokens?: number; now?: () => number } = {}
) {
  /** Process-local token digests and scope records; no plaintext bearer token is retained. */
  const entries = new Map<string, TokenRecord>();
  /** Retained token budget, default 10000; expired/revoked entries prune before issuance. */
  const max = options.maxTokens ?? 10000;
  /** Trusted millisecond clock or Date.now. */
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('Invalid token capacity');
  }
  /** Hash the full opaque bearer spelling before storing or comparing it.
   * @param {string} raw - Private full bearer token; never log it.
   * @returns {string} SHA-256 hex digest. */
  const digest = (raw: string) =>
    createHash('sha256').update(raw).digest('hex');
  return {
    /** Issue one random bearer token and retain only its digest plus scoped metadata.
     * @param {string} subject - Host-verified subject label.
     * @param {string[]} scopes - Explicit legacy scope list; wildcard behavior is retained.
     * @param {number} ttlMs - Lifetime milliseconds, default one hour and maximum 365 days.
     * @returns {IssuedToken} Private bearer returned once; host must authorize issuance and deliver/store it securely.
     */
    issue(
      subject: string,
      scopes: string[] = [],
      ttlMs = 3600000
    ): IssuedToken {
      if (
        !subject ||
        subject.length > 512 ||
        !scopes.every((s) => /^[a-zA-Z0-9:_*-]{1,100}$/.test(s))
      ) {
        throw new Error('Invalid token subject or scopes');
      }
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000 * 365) {
        throw new RangeError('Invalid token lifetime');
      }
      // Prune only expired/revoked local token records before new issuance.
      for (const [key, item] of entries) {
        if (item.expiresAt <= now() || item.revoked) {
          entries.delete(key);
        }
      }
      if (entries.size >= max) {
        throw new Error('Token store full');
      }
      /** Fresh random public token-record ID, not the bearer secret. */
      const id = randomBytes(12).toString('base64url');
      /** Fresh random 256-bit bearer secret returned only to the issuer. */
      const secret = randomBytes(32).toString('base64url');
      /** Full one-time-issued bearer spelling; the registry stores only its digest. */
      const token = `zx_${id}.${secret}`;
      /** Absolute millisecond expiry derived from the trusted clock and explicit lifetime. */
      const expiresAt = now() + ttlMs;
      entries.set(id, {
        id,
        subject,
        scopes: [...scopes],
        expiresAt,
        revoked: false,
        digest: digest(token),
      });
      return { token, id, expiresAt };
    },
    /** Validate local bearer digest, expiry/revocation and optional legacy scope.
     * @param {string} token - Private submitted bearer, never logged.
     * @param {string} scope - Optional exact scope, with compatible explicit wildcard acceptance.
     * @returns {Omit<TokenRecord, 'digest'>|null} Detached public record or denial; legacy wildcard scope remains supported.
     */
    verify(token: string, scope?: string): Omit<TokenRecord, 'digest'> | null {
      if (typeof token !== 'string' || token.length > 256) {
        return null;
      }
      /** Exact supported bearer grammar match before record lookup. */
      const matched = /^zx_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(
        token
      );
      if (!matched) {
        return null;
      }
      /** Digest captured from the fixed-format opaque token. */
      const tokenDigest = matched[1];
      if (!tokenDigest) {
        return null;
      }
      /** Stored local digest/scopes/expiry; revoked or expired records deny. */
      const record = entries.get(tokenDigest);
      if (!record || record.revoked || record.expiresAt <= now()) {
        return null;
      }
      /** Stored digest bytes compared only after fixed-format token validation. */
      const expected = Buffer.from(record.digest, 'hex');
      /** Computed candidate digest bytes; constant-time comparison does not imply authorization alone. */
      const actual = Buffer.from(digest(token), 'hex');
      if (
        !timingSafeEqual(expected, actual) ||
        (scope &&
          !record.scopes.includes(scope) &&
          !record.scopes.includes('*'))
      ) {
        return null;
      }
      /** Public metadata excludes the private digest and returns a detached scope list. */
      const { digest: _digest, ...publicRecord } = record;
      return { ...publicRecord, scopes: [...publicRecord.scopes] };
    },
    /** Mark one known local token ID revoked.
     * @param {string} id - Public token-record identifier, not the bearer secret.
     * @returns {boolean} Whether a stored record was found; no distributed revocation is performed.
     */
    revoke(id: string) {
      /** Current local token record explicitly marked revoked. */
      const item = entries.get(id);
      if (!item) {
        return false;
      }
      item.revoked = true;
      return true;
    },
    /** Destroy all local token/revocation records during explicit owner teardown.
     * @returns {void} Existing local credentials cease to verify; no persistence is touched.
     */
    clear() {
      entries.clear();
    },
    /** Read retained local entry count; this is not a distributed session inventory.
     * @returns {number} Current map size before any future opportunistic pruning.
     */
    get size() {
      return entries.size;
    },
  };
}
