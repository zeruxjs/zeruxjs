import { escapeHtmlText } from './encoding.js';
import crypto from 'node:crypto';
import path from 'node:path';

/** Lexical parent-segment detector; it does not inspect symlinks or authorize filesystem access. */
const unsafePathPattern = /(^|[\\/])\.\.(?:[\\/]|$)/;

/** Generate a fresh native random CSP nonce; no request/header value can substitute for entropy.
 * @param {number} size - Native random bytes, from 16 through 64; defaults to 16.
 * @returns {string} Fresh base64 nonce; native randomness failures propagate.
 */
export const createNonce = (size = 16) => {
  if (!Number.isSafeInteger(size) || size < 16 || size > 64) {
    throw new RangeError('CSP nonce size must be 16–64 bytes');
  }
  return crypto.randomBytes(size).toString('base64');
};

/** Legacy HTML text/quoted ordinary-attribute encoder; not a generic sanitizer. */
export const escapeHtml = escapeHtmlText;
export { serializeJsonForScript } from './encoding.js';

/** Trim only edge dashes in linear time without changing safe interior characters.
 * @param {string} value - Normalized candidate whose edge dashes are removed.
 * @returns {string} Slice without leading/trailing dashes.
 */
const trimDashes = (value: string) => {
  let start = 0,
    end = value.length;
  // Move each edge once; long identifier runs remain linear-time.
  while (start < end && value[start] === '-') {
    start++;
  }
  while (end > start && value[end - 1] === '-') {
    end--;
  }
  return value.slice(start, end);
};
/** Lossy identifier normalization; collisions are possible and output is never proof of identity.
 * @param {unknown} value - Trusted input coercible to text; this helper does not sandbox custom coercion.
 * @param {string} fallback - Fallback normalized independently; defaults to item.
 * @returns {string} Lossy safe-character identifier, or item when neither candidate is usable.
 */
export const sanitizeIdentifier = (value: unknown, fallback = 'item') => {
  /** Candidate string after trimming, replacing unsupported characters and collapsing dash runs. */
  const normalized = trimDashes(
    String(value ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
  );
  /** Independently normalized fallback; unsafe fallback text is never emitted verbatim. */
  const safeFallback = trimDashes(
    String(fallback ?? 'item').replace(/[^a-zA-Z0-9_-]+/g, '-')
  );
  return normalized || safeFallback || 'item';
};

/** Reject lexical traversal/absolute/encoded path forms before normalizing separators; no filesystem access occurs.
 * @param {unknown} value - Candidate asset reference; custom string coercion remains trusted host code.
 * @returns {string | null} Normalized relative lexical path or null for a rejected form.
 */
export const sanitizeRelativeAssetPath = (value: unknown) => {
  /** Trimmed lexical asset path candidate, never a canonical filesystem authorization result. */
  const target = String(value ?? '').trim();
  if (
    !target ||
    path.isAbsolute(target) ||
    /^[A-Za-z]:/.test(target) ||
    target.startsWith('\\\\') ||
    target.startsWith('//') ||
    target.includes('\0') ||
    /[?#:]|%(?:2e|2f|5c)/i.test(target) ||
    unsafePathPattern.test(target)
  ) {
    return null;
  }
  return target.replace(/\\/g, '/');
};

/** Lexical path containment helper; hosts must separately prevent symlink escapes and authorize access.
 * @param {string} rootDir - Host-selected lexical root directory.
 * @param {string} targetPath - Host-selected lexical target path.
 * @returns {boolean} Whether the lexical relationship stays within root; no realpath/symlink guarantee.
 */
export const ensurePathInsideRoot = (rootDir: string, targetPath: string) => {
  /** Platform-relative relationship; parent/absolute results cannot establish containment. */
  const relative = path.relative(rootDir, targetPath);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

/** Legacy reviewed low-level CSP builder; modern structured host/module composition is a separate API.
 * @param {string} nonce - Host-generated response nonce with validated syntax.
 * @param {{frameAncestors?: string[]}} options - Optional explicit legacy framing configuration.
 * @param {string[]} options.frameAncestors - Explicit bounded self/none/HTTPS ancestor list.
 * @returns {string} Legacy CSP text; callers commit it before sending response bytes.
 */
export const buildContentSecurityPolicy = (
  nonce: string,
  options?: { frameAncestors?: string[] }
) => {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9+/_=-]{16,256}$/.test(nonce)) {
    throw new Error('Invalid CSP nonce');
  }
  if (
    options !== undefined &&
    (!options || typeof options !== 'object' || Array.isArray(options))
  ) {
    throw new TypeError('Invalid CSP options');
  }
  if (
    options?.frameAncestors !== undefined &&
    (!Array.isArray(options.frameAncestors) ||
      options.frameAncestors.length > 64 ||
      options.frameAncestors.some(
        (item) => typeof item !== 'string' || item.length > 256
      ))
  ) {
    throw new TypeError('Invalid frame-ancestors sources');
  }
  if (
    options?.frameAncestors?.includes("'none'") &&
    options.frameAncestors.length > 1
  ) {
    throw new TypeError('Invalid frame-ancestors sources');
  }
  /** Validated legacy ancestor sources or self default; never derived from untrusted headers. */
  const frameAncestors = options?.frameAncestors?.length
    ? options.frameAncestors.join(' ')
    : "'self'";

  if (
    options?.frameAncestors?.some(
      (item) =>
        !/^(?:'self'|'none'|https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?)$/.test(
          item
        )
    )
  ) {
    throw new Error('Invalid frame-ancestors source');
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: http: https:",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
};
