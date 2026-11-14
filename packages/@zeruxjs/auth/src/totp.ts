import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
/** RFC-compatible Base32 alphabet; secrets are never logged or persisted automatically. */
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Generate bounded random Base32 enrollment material without persisting it.
 * @param {number} bytes - Random byte length, default 20 and supported range 16–64.
 * @returns {string} Private secret; host encrypts at rest and never logs it.
 */
export function generateTotpSecret(bytes = 20): string {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new RangeError('Invalid TOTP secret length');
  }
  let bits = 0,
    value = 0,
    output = '';
  // Encode fresh random bytes into Base32 without persisting enrollment state.
  for (const byte of randomBytes(bytes)) {
    value = (value << 8) | byte;
    bits += 8;
    // Emit each available five-bit group while retaining the final partial group.
    while (bits >= 5) {
      output += alphabet[(value >>> (bits -= 5)) & 31];
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}
/** Decode the supported bounded normalized Base32 enrollment spelling.
 * @param {string} secret - Private enrollment secret, never logged.
 * @returns {Buffer} Owned secret bytes; malformed inputs reject.
 */
function decodeBase32(secret: string): Buffer {
  if (typeof secret !== 'string' || secret.length > 128) {
    throw new Error('Invalid TOTP secret');
  }
  /** Normalized bounded Base32 spelling, validated before decoding secret bytes. */
  const input = secret.replace(/\s|-/g, '').toUpperCase().replace(/=+$/, '');
  if (input.length < 16 || !/^[A-Z2-7]+$/.test(input)) {
    throw new Error('Invalid TOTP secret');
  }
  let bits = 0,
    value = 0;
  /** Owned decoded secret bytes; no enrollment or replay state is created. */
  const result: number[] = [];
  // Decode only the validated Base32 alphabet into owned secret bytes.
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits -= 8)) & 255);
    }
  }
  return Buffer.from(result);
}
export interface TotpOptions {
  /** Time-step seconds, default 30 and supported 10–300. */
  period?: number;
  /** Six or eight output digits, default six. */
  digits?: 6 | 8;
  /** Explicit SHA-1/256/512 HMAC algorithm, default sha1. */
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  /** Trusted millisecond test time or current server time. */
  now?: number;
}
/** Compute an RFC-style current-step code with explicit bounded parameters. This does not persist enrollment or consume/replay-protect the code.
 * @param {string} secret - Host-enrolled private Base32 secret.
 * @param {TotpOptions} options - Period/digits/algorithm and optional trusted test time.
 * @returns {string} Zero-padded private code for the selected time step.
 */
export function generateTotp(
  secret: string,
  options: TotpOptions = {}
): string {
  /** Time-step seconds, default 30 and bounded to 10–300. */
  const period = options.period ?? 30;
  /** Explicit six/eight digit output, default six. */
  const digits = options.digits ?? 6;
  if (!['sha1', 'sha256', 'sha512'].includes(options.algorithm ?? 'sha1')) {
    throw new RangeError('Invalid TOTP algorithm');
  }
  if (
    !Number.isSafeInteger(period) ||
    period < 10 ||
    period > 300 ||
    (digits !== 6 && digits !== 8)
  ) {
    throw new RangeError('Invalid TOTP parameters');
  }
  /** Trusted/injected millisecond time used to derive the moving counter. */
  const timestamp = options.now ?? Date.now();
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError('Invalid TOTP time');
  }
  /** RFC time-step moving counter; validation alone does not consume it. */
  const counter = Math.floor(timestamp / (period * 1000));
  /** Owned eight-byte big-endian counter input to HMAC. */
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  /** Keyed HMAC bytes used for dynamic truncation; never exposed in diagnostics. */
  const digest = createHmac(options.algorithm ?? 'sha1', decodeBase32(secret))
    .update(bytes)
    .digest();
  /** RFC dynamic truncation offset from the final digest nibble. */
  const last = digest[digest.length - 1];
  if (last === undefined) {
    throw new Error('TOTP digest is empty');
  }
  /** Dynamic truncation offset selected from the final digest nibble. */
  const offset = last & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  ).padStart(digits, '0');
}
/** Compare a bounded drift window without stopping at the first match. Successful validation alone provides no one-time/replay protection.
 * @param {string} token - Private submitted decimal code.
 * @param {string} secret - Host-enrolled private Base32 secret.
 * @param {TotpOptions & { window?: number }} options - Explicit generation parameters plus bounded drift window.
 * @returns {boolean} Whether a supported time-step code matches; invalid parameters may throw.
 */
export function verifyTotp(
  token: string,
  secret: string,
  options: TotpOptions & { window?: number } = {}
): boolean {
  /** Explicit six/eight digit output, default six. */
  const digits = options.digits ?? 6;
  if (
    typeof token !== 'string' ||
    !new RegExp(`^[0-9]{${digits}}$`).test(token)
  ) {
    return false;
  }
  /** Time-step seconds, default 30 and bounded to 10–300. */
  const period = options.period ?? 30;
  /** Bounded accepted drift steps, default one and maximum five. */
  const window = options.window ?? 1;
  if (!Number.isSafeInteger(window) || window < 0 || window > 5) {
    throw new RangeError('Invalid TOTP window');
  }
  let match = false;
  // Compare the entire bounded drift window without short-circuiting at the first match.
  for (let n = -window; n <= window; n++) {
    /** Candidate drift-adjusted millisecond timestamp; negative times skip. */
    const stamp = (options.now ?? Date.now()) + n * period * 1000;
    if (stamp < 0) {
      continue;
    }
    /** Expected code for one bounded time step, compared without early-match termination. */
    const candidate = generateTotp(secret, { ...options, now: stamp });
    match =
      timingSafeEqual(Buffer.from(candidate), Buffer.from(token)) || match;
  }
  return match;
}
/** Create an enrollment URI containing private secret material. Host delivery/authentication and parameter policy remain required.
 * @param {string} secret - Private enrolled Base32 secret.
 * @param {string} account - Bounded host-owned account display label.
 * @param {string} issuer - Host-owned application label.
 * @param {TotpOptions} options - Explicit enrollment display parameters.
 * @returns {string} Private otpauth URI; never put it in logs or public manifests.
 */
export function totpUri(
  secret: string,
  account: string,
  issuer: string,
  options: TotpOptions = {}
): string {
  decodeBase32(secret);
  if (!account || !issuer) {
    throw new Error('Issuer and account are required');
  }
  /** Private enrollment URI fields; the generated URI contains the secret and must not be logged. */
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: (options.algorithm ?? 'sha1').toUpperCase(),
    digits: String(options.digits ?? 6),
    period: String(options.period ?? 30),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params}`;
}
