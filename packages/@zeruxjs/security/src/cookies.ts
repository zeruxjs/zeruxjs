export interface CookieOptions {
  /** Optional nonnegative safe-integer lifetime; omission creates no Max-Age attribute. */
  maxAgeSeconds?: number;
  /** Absolute cookie path; defaults to root. */
  path?: string;
  /** Optional validated host domain; __Host- forbids Domain. */
  domain?: string;
  /** Emit HttpOnly unless explicitly false. */
  httpOnly?: boolean;
  /** Require secure transport semantics; mandatory for Secure/Host prefixes and SameSite None. */
  secure?: boolean;
  /** Strict, Lax(default) or None; None requires Secure. */
  sameSite?: 'Strict' | 'Lax' | 'None';
}
/** Serialize one reviewed cookie with validated prefix, flags and inert value encoding. It does not set response headers or authenticate a session.
 * @param {string} name - Fixed valid HTTP cookie name; Host/Secure prefixes enforce their browser constraints.
 * @param {string} value - Literal value encoded with encodeURIComponent after rejecting controls/semicolons.
 * @param {CookieOptions} options - Explicit cookie policy; defaults path root, HttpOnly true and SameSite Lax.
 * @returns {string} Set-Cookie value; invalid policy/value throws before any header is emitted.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  if (
    typeof name !== 'string' ||
    typeof value !== 'string' ||
    !options ||
    typeof options !== 'object'
  ) {
    throw new TypeError('Invalid cookie input');
  }
  // Reject truthy/nonboolean configuration rather than accidentally emitting a security flag.
  for (const key of ['secure', 'httpOnly'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError('Invalid cookie flag');
    }
  }
  if (options.path !== undefined && typeof options.path !== 'string') {
    throw new TypeError('Invalid cookie path');
  }
  if (options.domain !== undefined && typeof options.domain !== 'string') {
    throw new TypeError('Invalid cookie domain');
  }
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    throw new Error('Invalid cookie name');
  }
  // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
  if (/[\u0000-\u001f\u007f;]/.test(value)) {
    throw new Error('Invalid cookie value');
  }
  if (
    name.startsWith('__Host-') &&
    (options.secure !== true || options.path !== '/' || options.domain)
  ) {
    throw new Error('__Host- cookies require Secure, Path=/ and no Domain');
  }
  if (name.startsWith('__Secure-') && !options.secure) {
    throw new Error('__Secure- cookies require Secure');
  }
  /** Validated cookie SameSite policy; defaults to Lax and None requires Secure. */
  const sameSite = options.sameSite ?? 'Lax';
  if (!['Strict', 'Lax', 'None'].includes(sameSite)) {
    throw new TypeError('Invalid cookie SameSite policy');
  }
  if (sameSite === 'None' && !options.secure) {
    throw new Error('SameSite=None requires Secure');
  }
  /** Validated cookie serialization segments; no raw header concatenation from unchecked flags. */
  const parts = [`${name}=${encodeURIComponent(value)}`];
  /** Explicit absolute cookie path, defaulting to root; controls and separators reject. */
  const path = options.path ?? '/';
  // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
  if (!path.startsWith('/') || /[\u0000-\u001f\u007f;]/.test(path)) {
    throw new Error('Invalid cookie path');
  }
  parts.push(`Path=${path}`);
  if (options.domain) {
    if (!/^(?!-)[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(options.domain)) {
      throw new Error('Invalid cookie domain');
    }
    parts.push(`Domain=${options.domain}`);
  }
  if (options.maxAgeSeconds !== undefined) {
    if (
      !Number.isSafeInteger(options.maxAgeSeconds) ||
      options.maxAgeSeconds < 0
    ) {
      throw new RangeError('Invalid cookie Max-Age');
    }
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }
  if (options.httpOnly ?? true) {
    parts.push('HttpOnly');
  }
  parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}
