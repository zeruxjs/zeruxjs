import type { SitemapEntry } from './types.js';
import { escapeHtml, safeUrl, iso } from './escape.js';
/** Protocol uncompressed50-MiB ceiling; per-format header reserves are charged conservatively. */
const maxBytes = 52428800;
/** Bound legacy sitemap URL text before absolute HTTP(S) validation; privacy/site policy belongs to the strict public source API.
 * @param {string} value - Authored URL text capped at8192 characters.
 * @returns {string} Normalized absolute HTTP(S) URL without embedded credentials.
 */
function url(value: string) {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new TypeError('Invalid sitemap URL');
  }
  return safeUrl(value);
}
/** Serialize a bounded complete URL set, closing source iteration on failure. Dates are authored facts; general serialization does not certify public visibility.
 * @param {Iterable<SitemapEntry>} urls - Iterable of at most50000 URL records within the uncompressed byte budget.
 * @returns {string} Complete escaped XML with namespaces only when used; validation/budget failure throws.
 */
export function createSitemap(urls: Iterable<SitemapEntry>): string {
  /** Complete bounded XML records staged before returning a whole document. */
  const chunks: string[] = [];
  let count = 0,
    bytes = 512,
    alternates = false,
    images = false;
  // Bound the iterable and validate each record before retaining encoded URL XML.
  for (const entry of urls) {
    if (++count > 50000) {
      throw new RangeError('A sitemap supports at most 50,000 URLs');
    }
    if (
      !entry ||
      typeof entry !== 'object' ||
      (entry.images !== undefined &&
        (!Array.isArray(entry.images) || entry.images.length > 1000)) ||
      (entry.alternates !== undefined &&
        (!entry.alternates ||
          typeof entry.alternates !== 'object' ||
          Array.isArray(entry.alternates) ||
          Object.keys(entry.alternates).length > 32))
    ) {
      throw new TypeError('Invalid sitemap entry');
    }
    /** Validated source-owned fields for one URL; optional namespaces are tracked separately. */
    const tags = [`<loc>${escapeHtml(url(entry.loc))}</loc>`];
    if (entry.lastmod !== undefined) {
      tags.push(`<lastmod>${iso(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq !== undefined) {
      if (
        ![
          'always',
          'hourly',
          'daily',
          'weekly',
          'monthly',
          'yearly',
          'never',
        ].includes(entry.changefreq)
      ) {
        throw new TypeError('Invalid sitemap change frequency');
      }
      tags.push(`<changefreq>${entry.changefreq}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      if (
        !Number.isFinite(entry.priority) ||
        entry.priority < 0 ||
        entry.priority > 1
      ) {
        throw new RangeError('Sitemap priority must be between 0 and 1');
      }
      tags.push(`<priority>${entry.priority.toFixed(1)}</priority>`);
    }
    // Escape explicit alternate metadata and enable its namespace only when used.
    for (const [lang, href] of Object.entries(entry.alternates ?? {})) {
      if (typeof lang !== 'string' || lang.length > 64) {
        throw new TypeError('Invalid sitemap locale');
      }
      alternates = true;
      tags.push(
        `<xhtml:link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(url(href))}"/>`
      );
    }
    // Emit only supplied validated image locations; no remote media is fetched.
    for (const image of entry.images ?? []) {
      images = true;
      tags.push(
        `<image:image><image:loc>${escapeHtml(url(image))}</image:loc></image:image>`
      );
    }
    /** One fully encoded URL/index record charged before retaining it. */
    const chunk = `<url>${tags.join('')}</url>`;
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) {
      throw new RangeError('Sitemap exceeds 50 MiB');
    }
    chunks.push(chunk);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${alternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}${images ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''}>${chunks.join('')}</urlset>`;
}
/** Serialize a bounded sitemap index using only supplied locations/modification dates; no build-time date is synthesized.
 * @param {Iterable<{ loc: string; lastmod?: Date | string }>} sitemaps - At most50000 source-owned sitemap records within the byte ceiling.
 * @returns {string} Complete escaped index XML; iterator cleanup follows for-of failure semantics.
 */
export function createSitemapIndex(
  sitemaps: Iterable<{ loc: string; lastmod?: Date | string }>
): string {
  /** Complete bounded XML records staged before returning a whole document. */
  const chunks: string[] = [];
  let count = 0,
    bytes = 256;
  // Charge complete encoded index records; no build-time lastmod is synthesized.
  for (const item of sitemaps) {
    if (++count > 50000) {
      throw new RangeError('A sitemap index supports at most 50,000 sitemaps');
    }
    /** One fully encoded URL/index record charged before retaining it. */
    const chunk = `<sitemap><loc>${escapeHtml(url(item.loc))}</loc>${item.lastmod !== undefined ? `<lastmod>${iso(item.lastmod)}</lastmod>` : ''}</sitemap>`;
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) {
      throw new RangeError('Sitemap index exceeds 50 MiB');
    }
    chunks.push(chunk);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${chunks.join('')}</sitemapindex>`;
}
