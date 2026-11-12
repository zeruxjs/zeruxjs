import type { SeoConfig } from './types.js';
import { escapeHtml, safeUrl } from './escape.js';
/** Serialize supplied legacy JSON-LD facts with independent script-termination escaping. Native getters/toJSON remain trusted host code; this is not the stricter inert-data composition validator.
 * @param {unknown} value - Host-authored JSON-compatible facts; authors/reviews/dates are not invented.
 * @returns {string} One script element; unsupported native JSON serialization throws.
 */
export function createJsonLd(value: unknown): string {
  /** Native JSON serialization of trusted authored facts; callbacks remain trusted executable host code. */
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('JSON-LD must be JSON-serializable');
  }
  return `<script type="application/ld+json">${serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}</script>`;
}
/** Serialize legacy authored metadata with HTML/URL/script encoding. It does not compose layouts, authorize private pages or apply configured canonical/media origins automatically.
 * @param {SeoConfig} config - Trusted typed legacy page facts with required title.
 * @returns {string} Ordered head HTML; callers own CSP, route visibility, duplicate insertion and response policy.
 */
export function createMetaTags(config: SeoConfig): string {
  if (!config.title) {
    throw new TypeError('SEO title is required');
  }
  /** Ordered legacy head fragments; the stricter structured composition API remains separate. */
  const tags: string[] = [];
  /** Append one escaped fixed meta tag; unknown content facts are never inferred.
   * @param {string} name - Fixed authored metadata key selected by this serializer.
   * @param {string} content - Optional supplied content; empty/undefined omits the tag.
   * @param {boolean} property - Select property rather than name syntax; defaults false.
   * @returns {void} Appends at most one encoded tag to the local ordered output.
   */
  const meta = (name: string, content?: string, property = false) => {
    if (content !== undefined && content !== '') {
      tags.push(
        `<meta ${property ? 'property' : 'name'}="${escapeHtml(name)}" content="${escapeHtml(content)}">`
      );
    }
  };
  tags.push(`<title>${escapeHtml(config.title)}</title>`);
  meta('description', config.description);
  meta('robots', config.robots);
  meta('keywords', config.keywords?.join(', '));
  meta('og:title', config.title, true);
  meta('og:description', config.description, true);
  meta('og:type', config.type ?? 'website', true);
  meta('og:site_name', config.siteName, true);
  meta('og:locale', config.locale, true);
  meta('twitter:title', config.title);
  meta('twitter:description', config.description);
  meta('twitter:site', config.twitterSite);
  if (config.canonical) {
    /** Validated absolute HTTP(S) canonical; legacy serializer does not apply a configured site-prefix policy. */
    const canonical = safeUrl(config.canonical);
    tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
    meta('og:url', canonical, true);
  }
  if (config.image) {
    /** Validated absolute HTTP(S) media URL; legacy serializer does not fetch or authorize it. */
    const image = safeUrl(config.image);
    meta('og:image', image, true);
    meta('twitter:image', image);
    meta('twitter:card', 'summary_large_image');
  } else {
    meta('twitter:card', 'summary');
  }
  // Legacy serialization escapes authored locale/URL values; strict configured-prefix policy is separate.
  for (const [lang, href] of Object.entries(config.alternates ?? {})) {
    tags.push(
      `<link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(safeUrl(href))}">`
    );
  }
  if (config.jsonLd !== undefined) {
    // Serialize only supplied legacy facts; native JSON callbacks remain trusted host code.
    for (const ld of Array.isArray(config.jsonLd)
      ? config.jsonLd
      : [config.jsonLd]) {
      tags.push(createJsonLd(ld));
    }
  }
  return tags.join('\n');
}
