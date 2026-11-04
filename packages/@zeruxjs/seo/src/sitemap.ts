import type { SitemapEntry } from "./types.js";
import { escapeHtml, safeUrl, iso } from "./escape.js";
const maxBytes = 52428800;
function url(value: string) {
  if (typeof value !== "string" || value.length > 8192)
    throw new TypeError("Invalid sitemap URL");
  return safeUrl(value);
}
/** Bounded iteration closes a source iterator on failure; no dates are synthesized. */
export function createSitemap(urls: Iterable<SitemapEntry>): string {
  const chunks: string[] = [];
  let count = 0,
    bytes = 512,
    alternates = false,
    images = false;
  for (const entry of urls) {
    if (++count > 50000)
      throw new RangeError("A sitemap supports at most 50,000 URLs");
    if (
      !entry ||
      typeof entry !== "object" ||
      (entry.images !== undefined &&
        (!Array.isArray(entry.images) || entry.images.length > 1000)) ||
      (entry.alternates !== undefined &&
        (!entry.alternates ||
          typeof entry.alternates !== "object" ||
          Array.isArray(entry.alternates) ||
          Object.keys(entry.alternates).length > 32))
    )
      throw new TypeError("Invalid sitemap entry");
    const tags = [`<loc>${escapeHtml(url(entry.loc))}</loc>`];
    if (entry.lastmod !== undefined)
      tags.push(`<lastmod>${iso(entry.lastmod)}</lastmod>`);
    if (entry.changefreq !== undefined) {
      if (
        ![
          "always",
          "hourly",
          "daily",
          "weekly",
          "monthly",
          "yearly",
          "never",
        ].includes(entry.changefreq)
      )
        throw new TypeError("Invalid sitemap change frequency");
      tags.push(`<changefreq>${entry.changefreq}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      if (
        !Number.isFinite(entry.priority) ||
        entry.priority < 0 ||
        entry.priority > 1
      )
        throw new RangeError("Sitemap priority must be between 0 and 1");
      tags.push(`<priority>${entry.priority.toFixed(1)}</priority>`);
    }
    for (const [lang, href] of Object.entries(entry.alternates ?? {})) {
      if (typeof lang !== "string" || lang.length > 64)
        throw new TypeError("Invalid sitemap locale");
      alternates = true;
      tags.push(
        `<xhtml:link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(url(href))}"/>`,
      );
    }
    for (const image of entry.images ?? []) {
      images = true;
      tags.push(
        `<image:image><image:loc>${escapeHtml(url(image))}</image:loc></image:image>`,
      );
    }
    const chunk = `<url>${tags.join("")}</url>`;
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) throw new RangeError("Sitemap exceeds 50 MiB");
    chunks.push(chunk);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${alternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ""}${images ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ""}>${chunks.join("")}</urlset>`;
}
export function createSitemapIndex(
  sitemaps: Iterable<{ loc: string; lastmod?: Date | string }>,
): string {
  const chunks: string[] = [];
  let count = 0,
    bytes = 256;
  for (const item of sitemaps) {
    if (++count > 50000)
      throw new RangeError("A sitemap index supports at most 50,000 sitemaps");
    const chunk = `<sitemap><loc>${escapeHtml(url(item.loc))}</loc>${item.lastmod !== undefined ? `<lastmod>${iso(item.lastmod)}</lastmod>` : ""}</sitemap>`;
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) throw new RangeError("Sitemap index exceeds 50 MiB");
    chunks.push(chunk);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${chunks.join("")}</sitemapindex>`;
}
