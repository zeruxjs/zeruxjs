import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Double-submit friendly, session-bound signed token. The caller must store the session identifier securely. */
export interface CsrfOptions {
  /** Explicit 32–4096-byte host secret; copied into the legacy token manager. */
  secret: string | Buffer;
  /** Token lifetime in seconds; defaults 3600 and caps at seven days. */
  ttlSeconds?: number;
  /** Trusted Unix-millisecond clock, validated whenever read. */
  now?: () => number;
}
export interface CsrfTokenManager {
  /** Issue a fresh bounded CSRF token bound to the host session and current clock.
   * @param {string} sessionId - Nonempty host session identifier within 1024 UTF-8 bytes and no controls.
   * @returns {string} Canonical signed token; invalid session/clock or native randomness failure throws.
   */
  issue(sessionId: string): string;
  /** Check canonical token syntax, bounded age and session-bound native MAC. Tokens are reusable until expiry; invalid token/session returns false.
   * @param {string | undefined} token - Caller-provided token, capped at 512 characters.
   * @param {string} sessionId - Verified host session identifier under the same issue policy.
   * @returns {boolean} True only for an authenticated current token/session pair; invalid trusted clock throws.
   */
  verify(token: string | undefined, sessionId: string): boolean;
}
/** Canonical base64url payload encoding; no token value is logged.
 * @param {string} value - Bounded issued timestamp/nonce payload.
 * @returns {string} Canonical unpadded base64url text.
 */
const encode = (value: string) => Buffer.from(value).toString('base64url');
/** Validate and copy bounded host secret bytes; caller mutation cannot change issued signatures.
 * @param {string | Buffer} value - Host-provided 32–4096-byte key material.
 * @returns {Buffer} Independent key snapshot; invalid input throws.
 */
const validSecret = (value: string | Buffer): Buffer => {
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
    throw new TypeError('Invalid CSRF secret');
  }
  /** UTF-8 byte size for strings or existing byte-buffer length. */
  const length =
    typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.length;
  if (length < 32 || length > 4096) {
    throw new Error('CSRF secret must contain 32–4096 bytes');
  }
  return Buffer.from(value);
};
/** Create a session-bound signed CSRF token manager over a copied explicit secret. Tokens may replay until expiry; host authentication and unsafe-method origin checks remain separate.
 * @param {CsrfOptions} options - Explicit 32–4096-byte secret, bounded TTL and optional trusted clock.
 * @returns {CsrfTokenManager} Synchronous issue/verify manager; no service starts and no one-time/revocation store is created.
 */
export function createCsrfProtection(options: CsrfOptions): CsrfTokenManager {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Invalid CSRF options');
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('Invalid CSRF clock');
  }
  /** Validated CSRF token lifetime in seconds, default one hour and at most seven days. */
  const ttl = options.ttlSeconds ?? 3600;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400 * 7) {
    throw new RangeError('Invalid CSRF lifetime');
  }
  /** Owned snapshot of host CSRF key bytes; no public destroy method exists on this legacy manager. */
  const secret = validSecret(options.secret);
  /** Borrowed trusted clock, default Date.now; validated at each timestamp read. */
  const now = options.now ?? Date.now;
  /** Read/validate the clock and convert integer Unix milliseconds into seconds.
   * @returns {number} Nonnegative integer Unix seconds; invalid trusted clocks throw.
   */
  const timestamp = () => {
    /** Trusted clock result checked before computing token age. */
    const stamp = now();
    if (!Number.isSafeInteger(stamp) || stamp < 0) {
      throw new RangeError('Invalid CSRF clock');
    }
    return Math.floor(stamp / 1000);
  };
  /** Authenticate payload and host session identity with an unambiguous separator.
   * @param {string} payload - Canonical bounded timestamp/nonce token payload.
   * @param {string} sessionId - Verified host session identity, never a browser role claim.
   * @returns {Buffer} Native HMAC-SHA-256 bytes.
   */
  function signature(payload: string, sessionId: string): Buffer {
    return createHmac('sha256', secret)
      .update(sessionId)
      .update('\0')
      .update(payload)
      .digest();
  }
  return {
    /** Issue a fresh bounded CSRF token bound to the host session and current clock.
     * @param {string} sessionId - Nonempty host session identifier within 1024 UTF-8 bytes and no controls.
     * @returns {string} Canonical signed token; invalid session/clock or native randomness failure throws.
     */
    issue(sessionId) {
      if (
        typeof sessionId !== 'string' ||
        !sessionId ||
        Buffer.byteLength(sessionId) > 1024 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
        /[\x00-\x1f\x7f]/.test(sessionId)
      ) {
        throw new Error('Session identifier is required');
      }
      /** Canonical issued/decoded timestamp and random nonce payload; not a principal identity. */
      const payload = `${timestamp()}.${randomBytes(24).toString('base64url')}`;
      return `${encode(payload)}.${signature(payload, sessionId).toString('base64url')}`;
    },
    /** Check canonical token syntax, bounded age and session-bound native MAC. Tokens are reusable until expiry; invalid token/session returns false.
     * @param {string | undefined} token - Caller-provided token, capped at 512 characters.
     * @param {string} sessionId - Verified host session identifier under the same issue policy.
     * @returns {boolean} True only for an authenticated current token/session pair; invalid trusted clock throws.
     */
    verify(token, sessionId) {
      if (
        typeof sessionId !== 'string' ||
        !sessionId ||
        Buffer.byteLength(sessionId) > 1024 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
        /[\x00-\x1f\x7f]/.test(sessionId) ||
        typeof token !== 'string' ||
        !token ||
        token.length > 512
      ) {
        return false;
      }
      /** Two canonical base64url token components; extra components reject. */
      const parts = token.split('.');
      if (
        parts.length !== 2 ||
        !parts[0] ||
        !parts[1] ||
        !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
        !/^[A-Za-z0-9_-]+$/.test(parts[1])
      ) {
        return false;
      }
      /** Decoded canonical payload bytes before syntax/age checks. */
      const payloadBytes = Buffer.from(parts[0], 'base64url');
      if (payloadBytes.toString('base64url') !== parts[0]) {
        return false;
      }
      /** Canonical issued/decoded timestamp and random nonce payload; not a principal identity. */
      const payload = payloadBytes.toString('utf8');
      /** Bounded payload fields; extra delimiters reject. */
      const [time, nonce, ...extra] = payload.split('.');
      if (
        extra.length ||
        !time ||
        !nonce ||
        !/^(0|[1-9][0-9]*)$/.test(time) ||
        !/^[A-Za-z0-9_-]{32}$/.test(nonce)
      ) {
        return false;
      }
      /** Safe integer token issue timestamp in seconds. */
      const issued = Number(time);
      /** Current validated trusted-clock seconds for expiry/future-skew checks. */
      const current = timestamp();
      if (
        !Number.isSafeInteger(issued) ||
        issued > current + 60 ||
        issued + ttl < current
      ) {
        return false;
      }
      /** Canonical received MAC bytes; compared only against an equal-length expected MAC. */
      const actual = Buffer.from(parts[1], 'base64url');
      /** Expected session-bound signature or parsed canonical expected origin. */
      const expected = signature(payload, sessionId);
      return (
        actual.toString('base64url') === parts[1] &&
        actual.length === expected.length &&
        timingSafeEqual(actual, expected)
      );
    },
  };
}
/** Compare canonical serialized HTTP(S) origins for cookie-authenticated unsafe requests. This check does not authenticate the initiating session.
 * @param {string | undefined} origin - Supplied origin; absence/null/noncanonical forms fail closed.
 * @param {string} expectedOrigin - Fixed trusted canonical public application origin.
 * @returns {boolean} Whether both canonical HTTP(S) origins match; parsing failures return false.
 */
export function isSameOriginRequest(
  origin: string | undefined,
  expectedOrigin: string
): boolean {
  try {
    if (!origin || origin === 'null') {
      return false;
    }
    /** Parsed supplied serialized origin; credentials/path/query cannot become same-origin proof. */
    const source = new URL(origin);
    /** Expected session-bound signature or parsed canonical expected origin. */
    const expected = new URL(expectedOrigin);
    return (
      ['http:', 'https:'].includes(source.protocol) &&
      ['http:', 'https:'].includes(expected.protocol) &&
      source.origin === origin &&
      expected.origin === expectedOrigin &&
      source.origin === expected.origin
    );
  } catch {
    return false;
  }
}
