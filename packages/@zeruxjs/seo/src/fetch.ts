import { createHash } from 'node:crypto';
import type { SitemapEntry } from './types.js';
import { createSitemap, createSitemapIndex } from './sitemap.js';
import { createRobotsTxt } from './robots.js';

export interface CrawlerRoutesOptions {
  /** Explicit canonical root HTTP(S) public origin. */
  origin: string;
  /** Borrowed authored public-only iterable or supplier; legacy whole-source cap is500000 records. */
  entries:
    | Iterable<SitemapEntry>
    | (() => Iterable<SitemapEntry> | Promise<Iterable<SitemapEntry>>);
  /** Optional explicit legacy robots directives; never authorization. */
  robots?: Parameters<typeof createRobotsTxt>[0];
  /** Finite per-file URL cap, default10000 and maximum50000. */
  maxUrlsPerSitemap?: number;
  /** Finite per-file uncompressed byte ceiling, default45000000 and maximum52428800. */
  maxXmlBytes?: number;
  /** Public response cache lifetime, default600 seconds; hosts must exclude private content. */
  cacheSeconds?: number;
  /** Optional server-side snapshot TTL; zero rebuilds on every request. */
  snapshotTtlMs?: number;
}
export interface CrawlerRoute {
  /** Fixed host-mounted route path or declared sitemap page pattern. */
  path: string;
  /** Borrowed Fetch route callback; does not bind/start a server. */
  handler: (request: Request) => Promise<Response>;
}
/** Build a legacy GET/HEAD crawler representation with exact ETag/star matching. Weak matching and strict public-origin admission belong to the separate public API.
 * @param {Request} request - Borrowed initiating GET/HEAD request.
 * @param {string} body - Complete public-only encoded body.
 * @param {string} contentType - Fixed representation media type.
 * @param {number} cacheSeconds - Explicit validated public max-age policy.
 * @returns {Response} Strong-validator response, bodyless HEAD/304 or405; no authorization is performed.
 */
function respond(
  request: Request,
  body: string,
  contentType: string,
  cacheSeconds: number
): Response {
  /** Strong hash of the exact selected legacy response bytes; variants have independent validators. */
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
  /** New explicit public crawler response headers; host must supply public content only. */
  const headers = {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'cache-control': `public, max-age=${cacheSeconds}`,
    etag,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  if (
    request.headers
      .get('if-none-match')
      ?.split(',')
      .some((t) => t.trim() === etag || t.trim() === '*')
  ) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
/** Create explicit legacy whole-source crawler routes and optional local snapshot cache. No listener, source authorization, timeout, abort/drain or close API is installed; use the public paged service for those contracts.
 * @param {CrawlerRoutesOptions} options - Trusted origin/source and finite XML/cache settings.
 * @returns {{routes: CrawlerRoute[], invalidate(): void}} Inert routes plus generation-fenced cache invalidation; source/transport ownership remains with the host.
 */
export function createCrawlerService(options: CrawlerRoutesOptions): {
  routes: CrawlerRoute[];
  /** Expire legacy cache and detach the current pending slot. Does not abort or drain the older supplier; overlapping new builds remain possible in this compatibility API.
   * @returns {void} Advances local generation so an older build cannot republish the cache.
   */
  invalidate(): void;
} {
  /** Configured canonical root HTTP(S) origin, never derived from request forwarding headers. */
  const origin = new URL(options.origin);
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new TypeError('Crawler origin must be an HTTP(S) origin');
  }
  /** Validated URL count per legacy XML file, default10000 and maximum50000. */
  const maxUrls = options.maxUrlsPerSitemap ?? 10000;
  /** Validated per-file XML ceiling, default45 million bytes and at most50 MiB. */
  const maxBytes = options.maxXmlBytes ?? 45_000_000;
  /** Explicit public response cache age, default600 seconds; not private-response authorization. */
  const ttl = options.cacheSeconds ?? 600;
  /** Opt-in process-local snapshot lifetime; zero retains no server-side completed cache. */
  const snapshotTtlMs = options.snapshotTtlMs ?? 0;
  if (!Number.isSafeInteger(maxUrls) || maxUrls < 1 || maxUrls > 50000) {
    throw new RangeError('Invalid sitemap URL limit');
  }
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 2048 ||
    maxBytes > 52_428_800
  ) {
    throw new RangeError('Invalid sitemap size limit');
  }
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 31536000) {
    throw new RangeError('Invalid crawler cache lifetime');
  }
  if (
    !Number.isSafeInteger(snapshotTtlMs) ||
    snapshotTtlMs < 0 ||
    snapshotTtlMs > 86400000
  ) {
    throw new RangeError('Invalid sitemap snapshot TTL');
  }
  type Snapshot = { pages: string[]; index: string };
  /** Build a bounded whole legacy source snapshot; the paged cancellable public API is separate.
   * @returns {Promise<Snapshot>} Complete public-only XML pages and index; supplier/validation errors propagate.
   */
  const build = async (): Promise<Snapshot> => {
    /** Borrowed authored entry iterable from an explicit host supplier; no source discovery occurs. */
    const source =
      typeof options.entries === 'function'
        ? await options.entries()
        : options.entries;
    /** Bounded materialized legacy source, at most500000 records; not a database query planner. */
    const entries: SitemapEntry[] = [];
    // Bound the legacy whole-source materialization before building XML pages.
    for (const entry of source) {
      if (entries.length >= 500000) {
        throw new RangeError('Too many sitemap URLs');
      }
      entries.push(entry);
    }
    /** Complete XML page candidates retained before an index response is returned. */
    const pages: string[] = [];
    /** Recursively split a candidate only when its serialized bytes exceed the page ceiling.
     * @param {SitemapEntry[]} group - Bounded candidate page records.
     * @returns {void} Retains fully serialized pages; a single unfit record throws.
     */
    const append = (group: SitemapEntry[]): void => {
      /** Complete encoded XML candidate measured before retaining a page. */
      const xml = createSitemap(group);
      if (Buffer.byteLength(xml) <= maxBytes) {
        pages.push(xml);
        return;
      }
      if (group.length === 1) {
        throw new RangeError('Sitemap entry exceeds byte limit');
      }
      /** Deterministic midpoint used to divide an over-budget multi-entry group. */
      const split = Math.floor(group.length / 2);
      append(group.slice(0, split));
      append(group.slice(split));
    };
    // Start with count-bounded groups; append applies the separate serialized-byte ceiling.
    for (let i = 0; i < entries.length; i += maxUrls) {
      append(entries.slice(i, i + maxUrls));
    }
    if (!pages.length) {
      pages.push(createSitemap([]));
    }
    /** Serialized sitemap index or validated requested page number, depending on scope. */
    const index = createSitemapIndex(
      pages.map((_, i) => ({ loc: new URL(`/sitemaps/${i + 1}`, origin).href }))
    );
    if (Buffer.byteLength(index) > 52_428_800) {
      throw new RangeError('Sitemap index exceeds the 50 MiB maximum');
    }
    return { pages, index };
  };
  let cached: Snapshot | undefined;
  let expires = 0;
  let pending: { promise: Promise<Snapshot> } | undefined;
  let generation = 0;
  /** Coalesce the current legacy build and publish cache only under its captured invalidation generation.
   * @returns {Promise<Snapshot>} Current/fresh complete snapshot; failed builds are never silently replaced with expired cache.
   */
  const read = async (): Promise<Snapshot> => {
    if (snapshotTtlMs && cached && Date.now() < expires) {
      return cached;
    }
    if (pending) {
      return pending.promise;
    }
    /** Captured local generation; an older build cannot republish cache after invalidation. */
    const current = generation;
    /** Pending promise identity used to avoid clearing a newer legacy build. */
    const slot = { promise: build() };
    pending = slot;
    try {
      /** Complete bounded legacy snapshot accepted only after its build settles. */
      const result = await slot.promise;
      if (snapshotTtlMs && current === generation) {
        cached = result;
        expires = Date.now() + snapshotTtlMs;
      }
      return result;
    } finally {
      if (pending === slot) {
        pending = undefined;
      }
    }
  };
  /** Inert legacy Fetch route handler; no listener is registered automatically.
   * @param {Request} request - Borrowed fixed-path crawler request.
   * @returns {Promise<Response>} Fixed public representation,404/405 or a propagated supplier error.
   */
  const dispatch = async (request: Request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    /** Request pathname used only for fixed robots/sitemap route selection. */
    const path = new URL(request.url).pathname;
    if (path === '/robots.txt') {
      return respond(
        request,
        createRobotsTxt(
          options.robots ?? { sitemap: new URL('/sitemap.xml', origin).href }
        ),
        'text/plain; charset=utf-8',
        ttl
      );
    }
    /** Complete legacy XML pages/index; no private access policy is inferred. */
    const snapshot = await read();
    if (path === '/sitemap.xml') {
      return respond(
        request,
        snapshot.pages.length === 1 ? (snapshot.pages[0] ?? snapshot.index) : snapshot.index,
        'application/xml; charset=utf-8',
        ttl
      );
    }
    /** Restricted positive page-number route match; arbitrary paths return404. */
    const matched = /^\/sitemaps\/([1-9][0-9]*)$/.exec(path);
    if (!matched) {
      return new Response(null, { status: 404 });
    }
    /** Serialized sitemap index or validated requested page number, depending on scope. */
    const index = Number(matched[1]) - 1;
    if (!Number.isSafeInteger(index) || index >= snapshot.pages.length) {
      return new Response(null, { status: 404 });
    }
    /** Requested XML page retained only after the complete snapshot bounds check. */
    const pageXml = snapshot.pages[index];
    if (pageXml === undefined) {
      return new Response(null, { status: 404 });
    }
    return respond(
      request,
      pageXml,
      'application/xml; charset=utf-8',
      ttl
    );
  };
  // Wildcard route is optional; frameworks supporting dynamic paths can use the dispatch handler.
  return {
    routes: [
      { path: '/robots.txt', handler: dispatch },
      { path: '/sitemap.xml', handler: dispatch },
      { path: '/sitemaps/:page', handler: dispatch },
    ],
    /** Expire legacy cache and detach the current pending slot. Does not abort or drain the older supplier; overlapping new builds remain possible in this compatibility API.
     * @returns {void} Advances local generation so an older build cannot republish the cache.
     */
    invalidate() {
      generation++;
      cached = undefined;
      expires = 0;
      pending = undefined;
    },
  };
}

/** Return only compatible legacy route definitions, without exposing the optional cache invalidator. No listener starts and no close contract is invented.
 * @param {CrawlerRoutesOptions} options - Explicit legacy public-only source and origin/XML/cache policy.
 * @returns {CrawlerRoute[]} Inert host-mounted Fetch route descriptors.
 */
export function createCrawlerRoutes(
  options: CrawlerRoutesOptions
): CrawlerRoute[] {
  return createCrawlerService(options).routes;
}
