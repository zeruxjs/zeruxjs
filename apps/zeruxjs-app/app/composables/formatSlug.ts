/** Convert authored route slug text to a display label without evaluating it.
 * @param {string} value - Candidate slug; empty/nullish text uses the existing empty fallback.
 * @returns {string} Space-separated words with initial characters capitalized.
 */
export default (value: string) =>
  String(value ?? '')
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
