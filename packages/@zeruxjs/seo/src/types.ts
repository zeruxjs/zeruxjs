export interface SeoConfig {
  /** Required authored title; semantic headings/content remain component responsibilities. */
  title: string;
  /** Optional authored description; no facts are manufactured. */
  description?: string;
  /** Optional absolute canonical URL; strict site-prefix policy is separate. */
  canonical?: string;
  /** Optional absolute media URL; serialization never fetches it. */
  image?: string;
  /** Legacy authored crawler hint text; never authorization. */
  robots?: string;
  /** Authored locale metadata; strict BCP47 site binding is separate. */
  locale?: string;
  /** Authored Open Graph type; strict composition constrains its supported vocabulary. */
  type?: string;
  /** Optional authored site label. */
  siteName?: string;
  /** Optional legacy authored keywords, not a ranking guarantee. */
  keywords?: string[];
  /** Optional authored social-account label. */
  twitterSite?: string;
  /** Explicit authored locale-to-URL metadata; strict configured prefixes require composition/public policy. */
  alternates?: Record<string, string>;
  /** Supplied facts only; legacy native JSON callbacks remain trusted. */
  jsonLd?: unknown | unknown[];
}
export interface SitemapEntry {
  /** Authored absolute sitemap URL; strict public source separately excludes signed/private URLs. */
  loc: string;
  /** Content-owned valid modification date; omission emits no invented timestamp. */
  lastmod?: string | Date;
  /** Protocol-supported frequency hint; runtime validation rejects unknown values. */
  changefreq?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
  /** Finite priority from zero through one; not a ranking guarantee. */
  priority?: number;
  /** Explicit authored locale-to-URL metadata; strict configured prefixes require composition/public policy. */
  alternates?: Record<string, string>;
  /** Explicit absolute image URLs; these are metadata, not permission to fetch. */
  images?: string[];
}
export interface RobotsGroup {
  /** Explicit crawler name or names; not an access-control principal. */
  userAgent: string | string[];
  /** Authored allowed paths; controls/line breaks reject. */
  allow?: string[];
  /** Authored denied paths; publishing a rule can reveal a path. */
  disallow?: string[];
  /** Optional finite nonnegative nonstandard hint; crawlers may ignore it. */
  crawlDelay?: number;
}
