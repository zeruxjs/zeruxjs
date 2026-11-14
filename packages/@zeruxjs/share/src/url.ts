/** Validate a bounded credential-free HTTP(S) sharing URL. No destination fetch, tenant authorization or private-query detection is performed.
 * @param {string} value - Authored absolute URL up to8192 characters; controls and embedded credentials reject.
 * @returns {string} Normalized public-scheme URL; the host still selects what content/parameters are safe to share.
 */
export function validatedShareUrl(value: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 8192 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new TypeError('Invalid share URL');
  }
  /** Parsed HTTP(S) sharing URL; credential-bearing or unsupported schemes reject without fetching it. */
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Only public HTTP(S) sharing URLs are supported');
  }
  return url.href;
}
/** Copy trusted authored sharing fields and normalize the URL; this is not an inert-record/accessor sandbox.
 * @param {T} data - Typed host sharing payload; extra authored fields remain compatible.
 * @returns {T} Independent shallow field copy with the validated normalized URL.
 */
export function normalizedShareData<T extends { url: string }>(data: T): T {
  return { ...data, url: validatedShareUrl(data.url) };
}
