import type { SitemapEntry } from './types.js';
import { escapeHtml, safeUrl, iso } from './escape.js';
export function createSitemap(urls: Iterable<SitemapEntry>): string {
  const entries=[...urls]; if(entries.length>50000)throw new RangeError('A sitemap supports at most 50,000 URLs');
  const alternates=entries.some(entry => Object.keys(entry.alternates??{}).length>0);
  const images=entries.some(entry => (entry.images?.length??0)>0);
  const body=entries.map(entry=>{
    const tags=[`<loc>${escapeHtml(safeUrl(entry.loc))}</loc>`];
    if(entry.lastmod)tags.push(`<lastmod>${iso(entry.lastmod)}</lastmod>`);
    if(entry.changefreq)tags.push(`<changefreq>${entry.changefreq}</changefreq>`);
    if(entry.priority!==undefined){if(!Number.isFinite(entry.priority)||entry.priority<0||entry.priority>1)throw new RangeError('Sitemap priority must be between 0 and 1');tags.push(`<priority>${entry.priority.toFixed(1)}</priority>`);}
    for(const [lang,url] of Object.entries(entry.alternates??{}))tags.push(`<xhtml:link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(safeUrl(url))}"/>`);
    for(const image of entry.images??[])tags.push(`<image:image><image:loc>${escapeHtml(safeUrl(image))}</image:loc></image:image>`);
    return `<url>${tags.join('')}</url>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${alternates?' xmlns:xhtml="http://www.w3.org/1999/xhtml"':''}${images?' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"':''}>${body}</urlset>`;
}
export function createSitemapIndex(sitemaps: Iterable<{loc:string;lastmod?:Date|string}>):string {
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...sitemaps].map(s=>`<sitemap><loc>${escapeHtml(safeUrl(s.loc))}</loc>${s.lastmod?`<lastmod>${iso(s.lastmod)}</lastmod>`:''}</sitemap>`).join('')}</sitemapindex>`;
}
