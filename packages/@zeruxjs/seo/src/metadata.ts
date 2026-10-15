import type { SeoConfig } from './types.js';
import { escapeHtml, safeUrl } from './escape.js';
export function createJsonLd(value: unknown):string {
  const serialized = JSON.stringify(value); if (serialized === undefined) throw new TypeError('JSON-LD must be JSON-serializable');
  return `<script type="application/ld+json">${serialized.replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')}</script>`;
}
export function createMetaTags(config: SeoConfig): string {
  if (!config.title) throw new TypeError('SEO title is required');
  const tags:string[]=[];
  const meta=(name:string,content?:string,property=false) => { if(content !== undefined && content !== '') tags.push(`<meta ${property?'property':'name'}="${escapeHtml(name)}" content="${escapeHtml(content)}">`); };
  tags.push(`<title>${escapeHtml(config.title)}</title>`);
  meta('description',config.description); meta('robots',config.robots); meta('keywords',config.keywords?.join(', '));
  meta('og:title',config.title,true); meta('og:description',config.description,true); meta('og:type',config.type??'website',true);
  meta('og:site_name',config.siteName,true); meta('og:locale',config.locale,true);
  meta('twitter:title',config.title); meta('twitter:description',config.description); meta('twitter:site',config.twitterSite);
  if(config.canonical){ const canonical=safeUrl(config.canonical);tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);meta('og:url',canonical,true); }
  if(config.image){ const image=safeUrl(config.image);meta('og:image',image,true);meta('twitter:image',image);meta('twitter:card','summary_large_image'); }
  else meta('twitter:card','summary');
  for(const [lang,href] of Object.entries(config.alternates??{})) tags.push(`<link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(safeUrl(href))}">`);
  if(config.jsonLd !== undefined) for(const ld of Array.isArray(config.jsonLd)?config.jsonLd:[config.jsonLd])tags.push(createJsonLd(ld));
  return tags.join('\n');
}
