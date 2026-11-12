import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertId } from './validation.js';
/** Issue the compatible HMAC ID/expiry capability under an explicit host-owned key. It does not authenticate a principal or embed tenant permission.
 * @throws {TypeError} Invalid ID or too-short signing key.
 * @throws {RangeError} Nonfuture/invalid expiration.
 * @param {string} id - Validated stored media UUID.
 * @param {string | Uint8Array} secret - Private key; creation requires at least 16 string code units or binary bytes.
 * @param {number} expiresAt - Future safe-integer epoch milliseconds.
 * @returns {string} Sensitive ID/expiry/MAC token; never include it in default logs or analytics labels.
 */
export function createSignedMediaToken(
  id: string,
  secret: string | Uint8Array,
  expiresAt: number
): string {
  assertId(id);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new RangeError('Expiration must be in the future');
  }
  if (
    !secret ||
    (typeof secret === 'string' && secret.length < 16) ||
    (typeof secret !== 'string' && secret.length < 16)
  ) {
    throw new TypeError('Secret must be at least 16 bytes');
  }
  /** Compatible ID/epoch-expiry signing payload; no raw user identity is encoded. */
  const payload = `${id}.${expiresAt}`;
  /** Private HMAC capability authenticator, returned only as part of the sensitive token. */
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
/** Verify the compatible bounded token spelling, expiry and constant-time MAC comparison. Host supplies a trusted signing key/clock and separately authorizes returned IDs.
 * @param {string} token - Untrusted opaque capability string, never executable content.
 * @param {string | Uint8Array} secret - Trusted host signing key; verification does not repeat the creation minimum-length guard.
 * @param {number} now - Trusted comparison epoch milliseconds; defaults to Date.now().
 * @returns {string | null} Authentic unexpired ID or null for malformed/expired/tampered input; crypto configuration failures can still throw.
 */
export function verifySignedMediaToken(
  token: string,
  secret: string | Uint8Array,
  now = Date.now()
): string | null {
  if (typeof token !== 'string') {
    return null;
  }
  /** Three expected dot-separated token components; no source content is evaluated. */
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  /** Untrusted components checked for ID/expiry/MAC syntax before acceptance. */
  const [id, expires, mac] = parts;
  if (
    !/^[0-9]+$/.test(expires) ||
    !Number.isSafeInteger(Number(expires)) ||
    Number(expires) <= now
  ) {
    return null;
  }
  try {
    assertId(id);
  } catch {
    return null;
  }
  /** Raw host-key HMAC bytes used only for constant-time comparison. */
  const expected = createHmac('sha256', secret)
    .update(`${id}.${expires}`)
    .digest();
  if (!/^[a-zA-Z0-9_-]{43}$/.test(mac)) {
    return null;
  }
  /** Decoded fixed-length candidate MAC; length must match before timingSafeEqual. */
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  return id;
}
