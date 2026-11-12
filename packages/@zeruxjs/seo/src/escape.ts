/** Legacy HTML/XML escaping with existing disallowed-control removal; not a script/CSS/URL sanitizer.
 * @param {string} value - Authored text; native string coercion remains trusted host code.
 * @returns {string} Text with markup-sensitive characters encoded and legacy controls removed.
 */
export const escapeHtml = (value: string): string =>
  String(value)
    // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
/** Normalize an absolute HTTP(S) URL without embedded credentials. No configured site/tenant policy or network egress authorization is inferred.
 * @param {string} value - Host-supplied absolute URL; legacy serializers may retain queries/fragments.
 * @returns {string} Normalized URL; invalid/unsupported schemes reject without fetching anything.
 */
export function safeUrl(value: string): string {
  /** Native absolute URL checked for HTTP(S) scheme and absence of embedded credentials. */
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Expected an HTTP(S) URL without credentials');
  }
  return url.href;
}
/** Validate the authored modification date and emit its UTC calendar date. Never substitutes the build/request timestamp.
 * @param {Date | string} value - Content-owned valid Date or parseable date text.
 * @returns {string} UTC YYYY-MM-DD date; invalid dates throw.
 */
export function iso(value: Date | string): string {
  /** Native parsed date checked before emitting the source-owned UTC date. */
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Invalid sitemap date');
  }
  return date.toISOString().slice(0, 10);
}
