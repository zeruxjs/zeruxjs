import type { ShareData } from './types.js';
import { normalizedShareData, validatedShareUrl } from './url.js';
/** Encode ordinary quoted HTML metadata content; not script, stylesheet or URL policy.
 * @param {string} value - Authored literal metadata content.
 * @returns {string} Quoted-attribute-safe markup encoding.
 */
const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
/** Serialize escaped fixed Open Graph tags from trusted authored sharing fields. Host controls placement, visibility, CSP and preview facts; no URL is fetched.
 * @param {ShareData & {
    image?: string;
    siteName?: string;
    type?: 'website' | 'article';
  }} input - Typed authored URL/title/text/image/site/type facts, not arbitrary head HTML.
 * @param {{ maxTextLength?: number }} options - Optional finite text truncation policy.
 * @param {number} options.maxTextLength - Authored text cap, default300 and maximum10000 characters.
 * @returns {string[]} Ordered encoded meta tags; unsafe URL forms or invalid text limits throw.
 */
export function createShareMetadata(
  input: ShareData & {
    image?: string;
    siteName?: string;
    type?: 'website' | 'article';
  },
  options: { maxTextLength?: number } = {}
): string[] {
  /** Independent authored metadata fields with a normalized sharing URL. */
  const data = normalizedShareData(input);
  /** Validated authored text truncation limit, default300 and maximum10000 characters. */
  const max = options.maxTextLength ?? 300;
  if (!Number.isInteger(max) || max < 1 || max > 10000) {
    throw new RangeError('Invalid metadata text limit');
  }
  /** Fixed Open Graph metadata name/value pairs; missing facts are not inferred. */
  const tags: [string, string][] = [
    ['og:url', data.url],
    ['og:type', data.type ?? 'website'],
  ];
  if (data.title) {
    tags.push(['og:title', data.title.slice(0, max)]);
  }
  if (data.text) {
    tags.push(['og:description', data.text.slice(0, max)]);
  }
  if (data.image) {
    tags.push(['og:image', validatedShareUrl(data.image)]);
  }
  if (data.siteName) {
    tags.push(['og:site_name', data.siteName.slice(0, max)]);
  }
  return tags.map(
    ([name, value]) => `<meta property="${name}" content="${escape(value)}">`
  );
}
/** Serialize one HTML-attribute-escaped canonical link from a validated sharing URL. This does not enforce a configured route/public-prefix policy.
 * @param {string} url - Host-selected absolute credential-free HTTP(S) canonical URL.
 * @returns {string} Encoded link HTML for explicit host head insertion.
 */
export function createCanonicalShareLink(url: string): string {
  return `<link rel="canonical" href="${escape(validatedShareUrl(url))}">`;
}
