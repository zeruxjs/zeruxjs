/** Reject declaration delimiters/newlines/backslashes before composing bounded authored CSS values.
 * @param {string} value - Nonempty authored token; this guard alone is not a complete CSS grammar parser.
 * @returns {string} Original accepted token, not normalized or evaluated.
 */
export function cssToken(value: string): string {
  if (!value || /[;{}\r\n\\]/.test(value)) {
    throw new TypeError('Invalid CSS token');
  }
  return value;
}
/** Check the legacy explicit source URL grammar without resolving DNS or fetching bytes.
 * @param {string} value - HTTP(S), absolute/project-relative or data:font URL without unsafe attribute/CSS characters.
 * @returns {string} Original accepted URL; origin/egress/licensing remain host responsibilities.
 */
export function fontUrl(value: string): string {
  if (
    !/^(https?:\/\/|\/|\.\/|\.\.\/|data:font\/)/i.test(value) ||
    /["'()\s<>\\]/.test(value) ||
    /^(?:\/\/|\/\\)/.test(value)
  ) {
    throw new TypeError('Invalid font source');
  }
  return value;
}
/** Encode fixed HTML attribute/text delimiters; do not reuse this for CSS/JavaScript policy.
 * @param {string} value - Inert source text, never an unrestricted HTML fragment.
 * @returns {string} HTML delimiter-encoded text.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}
/** Validate a nonempty family token then quote it as a CSS string using the compatible serializer.
 * @param {string} value - Authored family name; not an arbitrary declaration.
 * @returns {string} Quoted family token, without loading or normalizing a font.
 */
export function fontFamily(value: string): string {
  return JSON.stringify(cssToken(value));
}
/** Restrict the optional CSS format hint to a literal alphanumeric/hyphen identifier.
 * @param {string} value - Authored format hint, not an executable source or MIME authorization.
 * @returns {string} Original accepted hint; actual font decoding remains browser/tool-owned.
 */
export function fontFormat(value: string): string {
  if (!/^[a-z0-9-]+$/i.test(value)) {
    throw new TypeError('Invalid font format');
  }
  return value;
}
