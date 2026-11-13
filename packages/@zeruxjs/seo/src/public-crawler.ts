import { createHash } from 'node:crypto';
import { createSitemap, createSitemapIndex } from './sitemap.js';
import { createRobotsTxt } from './robots.js';
import {
  plain,
  publicPolicy,
  language,
  type PublicSite,
  type CrawlerRequestContext,
} from './public-policy.js';
import type { SitemapEntry } from './types.js';
export * from './public-policy.js';
export * from './redirects.js';
export interface PublicSitemapEntry extends SitemapEntry {
  /** Mandatory explicit public classification; never proof of host tenant/content authorization. */
  visibility: 'public';
}
export interface PagedSitemapSource {
  /** Load one explicitly bounded page of host-authorized public content. The service borrows this source and never assumes its visibility flag authenticates content.
 * @param {{
    cursor?: string;
    limit: number;
    signal: AbortSignal;
  }} input - Opaque source cursor, finite requested limit and cooperative build signal.
 * @returns {Promise<{items: readonly PublicSitemapEntry[], nextCursor?: string}>} One bounded page; omitted nextCursor terminates enumeration and repeated cursors reject.
 */
  load(input: {
    /** Optional opaque host-source continuation; bounded/repeated values are validated by the service. */
    cursor?: string;
    /** Maximum source items requested for this one page. */
    limit: number;
    /** Borrowed cooperative shared build scope; no forced JavaScript cancellation. */
    signal: AbortSignal;
  }): Promise<{
    /** Explicit public-only records selected by the host; unknown/private fields reject. */
    items: readonly PublicSitemapEntry[];
    /** Optional bounded continuation; omission ends enumeration. */
    nextCursor?: string;
  }>;
}
export interface PublicCrawlerOptions {
  /** Trusted strict public origin/prefix/locale/media/proxy policy. */
  site: PublicSite;
  /** Borrowed explicit paged content source; no automatic database discovery. */
  source: PagedSitemapSource;
  /** Source page request cap, default500 and maximum1000. */
  pageSize?: number;
  /** Total source page cap, default1000 and maximum10000. */
  maxSourcePages?: number;
  /** Total source record cap, default100000 and maximum500000. */
  maxEntries?: number;
  /** XML URL-file entry cap, default10000 and maximum50000. */
  maxUrlsPerFile?: number;
  /** Per-file/index XML byte ceiling, default45000000 and maximum52428800. */
  maxXmlBytes?: number;
  /** Combined XML candidate ceiling, default33554432 and maximum134217728. */
  maxSnapshotBytes?: number;
  /** Cooperative build/waiter timeout, default5000 ms and maximum60000. */
  timeoutMs?: number;
  /** Observing caller cap, default32 and maximum256. */
  maxWaiters?: number;
  /** Process-local completed snapshot lifetime; defaults zero, maximum one day. */
  snapshotTtlMs?: number;
  /** Public representation max-age; default600 seconds, maximum one year. */
  cacheSeconds?: number;
  /** Explicit root crawler hints; no authorization/noindex standard is inferred. */
  robots?: Parameters<typeof createRobotsTxt>[0];
  /** Host-reviewed literal custom file, not an SEO standard and never fetched. */ trustTxt?: string;
}
/** Create explicit strict public crawler handlers with bounded paged source work, complete-candidate publication and cooperative drain. Hosts mount handlers and own source authorization/dependencies.
 * @param {PublicCrawlerOptions} options - Trusted site/source and finite page/XML/snapshot/cache/deadline policy.
 * @returns {object} Owned handler/routes/invalidate/status/close scope; imports and construction start no listener.
 */
export function createPublicCrawlerService(options: PublicCrawlerOptions) {
  plain(options, [
    'site',
    'source',
    'pageSize',
    'maxSourcePages',
    'maxEntries',
    'maxUrlsPerFile',
    'maxXmlBytes',
    'maxSnapshotBytes',
    'timeoutMs',
    'maxWaiters',
    'snapshotTtlMs',
    'cacheSeconds',
    'robots',
    'trustTxt',
  ]);
  /** Captured strict public URL/locale/media/direct-proxy policy; never derived from forwarding headers. */
  const policy = publicPolicy(options.site);
  if (typeof options.source?.load !== 'function') {
    throw new TypeError('Paged source required');
  }
  /** Validate one explicit safe-integer crawler budget before accepting source work.
   * @param {number | undefined} value - Optional explicit limit.
   * @param {number} fallback - Default used when undefined.
   * @param {number} min - Inclusive minimum for this setting.
   * @param {number} max - Inclusive hard maximum.
   * @returns {number} Validated integer; unsupported settings throw before source work.
   */
  const limit = (
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ) => {
    /** Resolved safe numeric limit; zero is allowed only where the supplied minimum permits it. */
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < min || n > max) {
      throw new RangeError('Invalid crawler limit');
    }
    return n;
  };
  /** Maximum records requested per source page, default500 and maximum1000. */
  const pageSize = limit(options.pageSize, 500, 1, 1000);
  /** Maximum accepted source calls per snapshot, default1000 and maximum10000. */
  const maxPages = limit(options.maxSourcePages, 1000, 1, 10000);
  /** Maximum total public records per candidate, default100000 and maximum500000. */
  const maxEntries = limit(options.maxEntries, 100000, 1, 500000);
  /** Maximum URLs per XML file, default10000 and maximum50000. */
  const maxUrls = limit(options.maxUrlsPerFile, 10000, 1, 50000);
  /** Maximum uncompressed XML bytes per file/index; bounded by the protocol50-MiB ceiling. */
  const maxBytes = limit(options.maxXmlBytes, 45000000, 2048, 52428800);
  /** Complete combined XML byte ceiling, independent of total JavaScript heap overhead. */
  const maxSnapshot = limit(
    options.maxSnapshotBytes,
    33554432,
    2048,
    134217728
  );
  /** Cooperative build and per-waiter observation deadline, default5000 ms and maximum60000. */
  const timeout = limit(options.timeoutMs, 5000, 1, 60000);
  /** Bounded observing callers, independent of the single actual in-flight source build. */
  const maxWaiters = limit(options.maxWaiters, 32, 1, 256);
  /** Completed process-local snapshot lifetime; zero expires immediately after settlement. */
  const ttl = limit(options.snapshotTtlMs, 0, 0, 86400000);
  /** Explicit public HTTP max-age; the host must supply public-only data. */
  const cache = limit(options.cacheSeconds, 600, 0, 31536000);
  /** Complete bounded configured root robots text; crawler hints never replace authorization. */
  const robots = createRobotsTxt(
    options.robots ?? {
      sitemap: policy.root + policy.basePath + 'sitemap.xml',
    }
  );
  if (Buffer.byteLength(robots) > 65536) {
    throw new RangeError('Robots byte limit');
  }
  // Every configured sitemap directive must itself be a public local URL.
  for (const value of [options.robots?.sitemap ?? []].flat()) {
    policy.page(value);
  }
  /** Optional literal host-reviewed custom trust.txt; no standard/discovery or remote fetch is implied. */
  const trust = options.trustTxt;
  if (
    trust !== undefined &&
    (typeof trust !== 'string' ||
      Buffer.byteLength(trust) > 65536 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(trust))
  ) {
    throw new TypeError('Invalid custom trust file');
  }
  type Snapshot = { pages: string[]; index: string };
  let cached: Snapshot | undefined,
    expires = 0,
    closed = false,
    waiters = 0,
    pending: Promise<Snapshot> | undefined,
    controller: AbortController | undefined,
    closing: Promise<void> | undefined;
  /** Borrowed paged host source; visibility/tenant authorization belongs to its owner. */
  const source = options.source;
  /** Validate a declared public source record and select only supported sitemap fields under exact prefix/locale/media policy.
   * @param {PublicSitemapEntry} input - Host-selected record; private/query/signed/unknown fields reject the whole candidate.
   * @returns {SitemapEntry} Validated supported fields; the host still proves that the underlying content is public.
   */
  function checked(input: PublicSitemapEntry): SitemapEntry {
    plain(input, [
      'visibility',
      'loc',
      'lastmod',
      'changefreq',
      'priority',
      'alternates',
      'images',
    ]);
    if (input.visibility !== 'public') {
      throw new TypeError('Private sitemap record denied');
    }
    /** Selected validated sitemap fields under the captured public-prefix policy. */
    const entry: SitemapEntry = { loc: policy.page(input.loc) };
    if (input.lastmod !== undefined) {
      if (
        !(input.lastmod instanceof Date) &&
        typeof input.lastmod !== 'string'
      ) {
        throw new TypeError('Content lastmod required');
      }
      entry.lastmod = input.lastmod;
    }
    if (input.changefreq !== undefined) {
      entry.changefreq = input.changefreq;
    }
    if (input.priority !== undefined) {
      entry.priority = input.priority;
    }
    if (input.alternates !== undefined) {
      plain(input.alternates);
      if (Object.keys(input.alternates).length > 32) {
        throw new RangeError('Alternate limit');
      }
      /** Fresh canonical locale-to-public-URL map; duplicate aliases reject. */
      const alt: Record<string, string> = Object.create(null);
      // Normalize declared locale aliases and validate each exact configured public prefix.
      for (const [key, url] of Object.entries(input.alternates)) {
        /** Canonical configured locale label; unknown locale prefixes cannot emit alternates. */
        const lang = language(key);
        if (Object.hasOwn(alt, lang)) {
          throw new TypeError('Duplicate locale');
        }
        alt[lang] = policy.page(url, lang);
      }
      entry.alternates = alt;
    }
    if (input.images !== undefined) {
      if (!Array.isArray(input.images) || input.images.length > 32) {
        throw new RangeError('Image limit');
      }
      entry.images = input.images.map((value) => policy.image(value));
    }
    return entry;
  }
  /** Enumerate bounded source pages and stage all escaped XML before publishing. Source failures, repeated cursors, duplicates or budget exhaustion reject the whole candidate.
   * @param {AbortSignal} signal - Cooperative shared build cancellation/invalidation/deadline scope.
   * @returns {Promise<Snapshot>} Complete XML pages/index; source native settlement stays owned even after observation timeout.
   */
  async function build(signal: AbortSignal): Promise<Snapshot> {
    /** Complete XML pages staged before any snapshot is published. */
    const pages: string[] = [];
    /** Previously observed source cursors; repeat/cycle/oversized cursor forms reject. */
    const seen = new Set<string>();
    /** Snapshot-local canonical URL deduplication set. */
    const urls = new Set<string>();
    let cursor: string | undefined,
      count = 0,
      group: SitemapEntry[] = [],
      estimate = 512,
      total = 0;
    /** Serialize a complete count/byte-bounded group, then charge combined snapshot bytes.
     * @returns {void} Retains one complete XML page and clears the candidate group; limits throw.
     */
    const flush = () => {
      if (!group.length) {
        return;
      }
      /** Complete escaped group XML checked before retention. */
      const xml = createSitemap(group);
      if (Buffer.byteLength(xml) > maxBytes) {
        throw new RangeError('Sitemap byte limit');
      }
      total += Buffer.byteLength(xml);
      if (total > maxSnapshot || pages.length >= 50000) {
        throw new RangeError('Snapshot limit');
      }
      pages.push(xml);
      group = [];
      estimate = 512;
    };
    // Every native page belongs to one bounded shared build; partial results never publish.
    for (let page = 0; ; page++) {
      signal.throwIfAborted();
      if (page >= maxPages) {
        throw new RangeError('Source page limit');
      }
      /** One native source page; size, cursor and public-field policy validate before publication. */
      const batch = await source.load({ cursor, limit: pageSize, signal });
      signal.throwIfAborted();
      plain(batch, ['items', 'nextCursor']);
      if (!Array.isArray(batch.items) || batch.items.length > pageSize) {
        throw new RangeError('Source batch limit');
      }
      // Validate visibility/URLs and duplicate identities before staging any record.
      for (const raw of batch.items) {
        if (++count > maxEntries) {
          throw new RangeError('Entry limit');
        }
        /** Selected validated sitemap fields under the captured public-prefix policy. */
        const entry = checked(raw);
        if (urls.has(entry.loc)) {
          throw new TypeError('Duplicate sitemap URL');
        }
        urls.add(entry.loc);
        /** Conservative encoded record/file byte estimate, separately verified on final serialization. */
        const bytes = Buffer.byteLength(createSitemap([entry]));
        if (bytes > maxBytes) {
          throw new RangeError('Single URL byte limit');
        }
        if (
          group.length &&
          (group.length >= maxUrls || estimate + bytes > maxBytes)
        ) {
          flush();
        }
        group.push(entry);
        estimate += bytes;
      }
      if (batch.nextCursor === undefined) {
        break;
      }
      if (
        typeof batch.nextCursor !== 'string' ||
        !batch.nextCursor ||
        batch.nextCursor.length > 512 ||
        seen.has(batch.nextCursor)
      ) {
        throw new TypeError('Invalid/repeated source cursor');
      }
      seen.add(batch.nextCursor);
      cursor = batch.nextCursor;
    }
    flush();
    if (!pages.length) {
      pages.push(createSitemap([]));
    }
    /** Complete deterministic sitemap index; no synthetic lastmod is added. */
    const index = createSitemapIndex(
      pages.map((_, i) => ({
        loc: policy.root + policy.basePath + `sitemaps/${i + 1}`,
      }))
    );
    if (
      Buffer.byteLength(index) > maxBytes ||
      total + Buffer.byteLength(index) > maxSnapshot
    ) {
      throw new RangeError('Sitemap index/snapshot limit');
    }
    return { pages, index };
  }
  /** Coalesce one actual build or return a current completed snapshot. Invalidated/expired candidates are never silently served after a failed replacement.
   * @returns {Promise<Snapshot>} Complete shared snapshot; a still-unsettled old build prevents an overlapping replacement.
   */
  function read(): Promise<Snapshot> {
    if (closed) {
      return Promise.reject(new Error('Closed'));
    }
    if (cached && Date.now() < expires) {
      return Promise.resolve(cached);
    }
    if (pending) {
      return pending;
    }
    /** Owned cooperative controller for the one accepted build; stale work remains owned until settlement. */
    const current = new AbortController();
    controller = current;
    /** Combined build invalidation/close/deadline signal; it cannot force JavaScript cancellation. */
    const signal = AbortSignal.any([
      current.signal,
      AbortSignal.timeout(timeout),
    ]);
    /** Actual shared build promise; native ownership is retained until source settlement and cleanup. */
    const task = build(signal)
      .then((result) => {
        signal.throwIfAborted();
        cached = result;
        expires = Date.now() + ttl;
        return result;
      })
      .finally(() => {
        if (pending === task) {
          pending = undefined;
          controller = undefined;
        }
      });
    pending = task;
    return task;
  }
  /** Create one deterministic public GET/HEAD representation with strong ETag and weak/star request matching.
   * @param {Request} request - Borrowed admitted crawler request.
   * @param {string} body - Complete public XML/plain-text body, never partial source content.
   * @param {string} type - Fixed representation media type.
   * @returns {Response} 200/304 representation with body removed for HEAD or a matching validator.
   */
  function response(request: Request, body: string, type: string) {
    /** Strong hash of the exact selected representation bytes; weak request validators may match it. */
    const etag =
      '"' + createHash('sha256').update(body).digest('base64url') + '"';
    /** Fresh fixed public representation headers; no user/private values become cache labels. */
    const headers = {
      'content-type': type,
      'cache-control': `public, max-age=${cache}`,
      'x-content-type-options': 'nosniff',
      etag,
    };
    /** Explicit weak/strong/star If-None-Match comparison for the selected representation. */
    const match = request.headers
      .get('if-none-match')
      ?.split(',')
      .some(
        (value) =>
          value.trim().replace(/^W\//, '') === etag || value.trim() === '*'
      );
    return new Response(match || request.method === 'HEAD' ? null : body, {
      status: match ? 304 : 200,
      headers,
    });
  }
  /** Admit fixed public crawler routes only after explicit origin/direct-peer checks. Observe shared source work with bounded per-request waiters and body-free no-store errors.
   * @param {Request} request - Borrowed Fetch request; GET/HEAD only.
   * @param {CrawlerRequestContext} context - Optional trusted direct socket peer; forwarded headers never grant access.
   * @returns {Promise<Response>} Complete representation or fixed421/404/405/503 result; native source failures are not reflected.
   */
  async function handler(
    request: Request,
    context?: CrawlerRequestContext
  ): Promise<Response> {
    if (closed) {
      return new Response(null, { status: 503 });
    }
    if (!policy.request(request, context)) {
      return new Response(null, { status: 421 });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    /** Fixed request pathname used only to select known public crawler routes. */
    const path = new URL(request.url).pathname;
    /** Configured mounted public sitemap prefix; robots/custom trust remain at host root. */
    const base = policy.basePath;
    if (path === '/robots.txt') {
      return response(request, robots, 'text/plain; charset=utf-8');
    }
    if (path === '/trust.txt' && trust !== undefined) {
      return response(request, trust, 'text/plain; charset=utf-8');
    }
    /** Mounted fixed sitemap/page suffix; arbitrary paths never choose a data source. */
    const suffix = path.startsWith(base) ? path.slice(base.length) : '';
    if (suffix !== 'sitemap.xml' && !/^sitemaps\/[1-9][0-9]*$/.test(suffix)) {
      return new Response(null, { status: 404 });
    }
    if (waiters >= maxWaiters) {
      return new Response(null, {
        status: 503,
        headers: { 'retry-after': '1' },
      });
    }
    waiters++;
    let abort: () => void = () => {},
      timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (request.signal.aborted) {
        throw new Error('Canceled');
      }
      /** Per-waiter cancellation observation; another caller’s shared build is not aborted. */
      const canceled = new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Canceled'));
        request.signal.addEventListener('abort', abort, { once: true });
      });
      /** Shared actual build promise; waiter deadline/cancellation does not release native ownership. */
      const work = read();
      /** Per-waiter timeout observation, removed in finally. */
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Crawler deadline')),
          timeout
        );
      });
      /** Complete successfully staged shared snapshot, never a partial page candidate. */
      const snapshot = await Promise.race([work, canceled, deadline]);
      if (suffix === 'sitemap.xml') {
        return response(
          request,
          snapshot.pages.length === 1
            ? (snapshot.pages[0] ?? snapshot.index)
            : snapshot.index,
          'application/xml; charset=utf-8'
        );
      }
      /** Validated zero-based XML file lookup after a complete snapshot exists. */
      const page = Number(suffix.slice(9)) - 1;
      if (!Number.isSafeInteger(page) || page >= snapshot.pages.length) {
        return new Response(null, { status: 404 });
      }
      /** Requested XML page retained only after the complete snapshot bounds check. */
      const pageXml = snapshot.pages[page];
      if (pageXml === undefined) {
        return new Response(null, { status: 404 });
      }
      return response(
        request,
        pageXml,
        'application/xml; charset=utf-8'
      );
    } catch {
      return new Response(null, {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '1' },
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      waiters--;
      request.signal.removeEventListener('abort', abort);
    }
  }
  return {
    routes: [
      { path: '/robots.txt', handler },
      { path: policy.basePath + 'sitemap.xml', handler },
      { path: policy.basePath + 'sitemaps/:page', handler },
      ...(trust === undefined ? [] : [{ path: '/trust.txt', handler }]),
    ],
    handler,
    /** Expire cache and cancel the current candidate cooperatively. It does not detach actual native work or start an overlapping source build.
     * @returns {void} Future reads wait for existing settlement before rebuilding; closed service rejects.
     */
    invalidate() {
      if (closed) {
        throw new Error('Closed');
      }
      expires = 0;
      controller?.abort();
    },
    /** Reject new observation, abort cooperative source work and await actual settlement before dropping completed cache. The host retains source/DB/transport ownership.
     * @returns {Promise<void>} Idempotently drained service; noncooperative native source work may delay completion.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      controller?.abort();
      return (closing = (async () => {
        await Promise.allSettled(pending ? [pending] : []);
        cached = undefined;
      })());
    },
    /** Read fixed native-work/observer counts without private URLs or source content.
     * @returns {object} Frozen closed/pending/waiter counters only.
     */
    status: () => Object.freeze({ closed, pending: !!pending, waiters }),
  };
}
