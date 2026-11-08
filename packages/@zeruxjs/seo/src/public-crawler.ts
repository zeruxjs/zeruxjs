import { createHash } from "node:crypto";
import { createSitemap, createSitemapIndex } from "./sitemap.js";
import { createRobotsTxt } from "./robots.js";
import {
  plain,
  publicPolicy,
  language,
  type PublicSite,
  type CrawlerRequestContext,
} from "./public-policy.js";
import type { SitemapEntry } from "./types.js";
export * from "./public-policy.js";
export * from "./redirects.js";
export interface PublicSitemapEntry extends SitemapEntry {
  visibility: "public";
}
export interface PagedSitemapSource {
  load(input: {
    cursor?: string;
    limit: number;
    signal: AbortSignal;
  }): Promise<{ items: readonly PublicSitemapEntry[]; nextCursor?: string }>;
}
export interface PublicCrawlerOptions {
  site: PublicSite;
  source: PagedSitemapSource;
  pageSize?: number;
  maxSourcePages?: number;
  maxEntries?: number;
  maxUrlsPerFile?: number;
  maxXmlBytes?: number;
  maxSnapshotBytes?: number;
  timeoutMs?: number;
  maxWaiters?: number;
  snapshotTtlMs?: number;
  cacheSeconds?: number;
  robots?: Parameters<typeof createRobotsTxt>[0];
  /** Host-reviewed literal custom file, not an SEO standard and never fetched. */ trustTxt?: string;
}
export function createPublicCrawlerService(options: PublicCrawlerOptions) {
  plain(options, [
    "site",
    "source",
    "pageSize",
    "maxSourcePages",
    "maxEntries",
    "maxUrlsPerFile",
    "maxXmlBytes",
    "maxSnapshotBytes",
    "timeoutMs",
    "maxWaiters",
    "snapshotTtlMs",
    "cacheSeconds",
    "robots",
    "trustTxt",
  ]);
  const policy = publicPolicy(options.site);
  if (typeof options.source?.load !== "function")
    throw new TypeError("Paged source required");
  const limit = (
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new RangeError("Invalid crawler limit");
    return n;
  };
  const pageSize = limit(options.pageSize, 500, 1, 1000),
    maxPages = limit(options.maxSourcePages, 1000, 1, 10000),
    maxEntries = limit(options.maxEntries, 100000, 1, 500000),
    maxUrls = limit(options.maxUrlsPerFile, 10000, 1, 50000),
    maxBytes = limit(options.maxXmlBytes, 45000000, 2048, 52428800),
    maxSnapshot = limit(options.maxSnapshotBytes, 33554432, 2048, 134217728),
    timeout = limit(options.timeoutMs, 5000, 1, 60000),
    maxWaiters = limit(options.maxWaiters, 32, 1, 256),
    ttl = limit(options.snapshotTtlMs, 0, 0, 86400000),
    cache = limit(options.cacheSeconds, 600, 0, 31536000);
  const robots = createRobotsTxt(
    options.robots ?? {
      sitemap: policy.root + policy.basePath + "sitemap.xml",
    },
  );
  if (Buffer.byteLength(robots) > 65536)
    throw new RangeError("Robots byte limit");
  // Every configured sitemap directive must itself be a public local URL.
  for (const value of [options.robots?.sitemap ?? []].flat())
    policy.page(value);
  const trust = options.trustTxt;
  if (
    trust !== undefined &&
    (typeof trust !== "string" ||
      Buffer.byteLength(trust) > 65536 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(trust))
  )
    throw new TypeError("Invalid custom trust file");
  type Snapshot = { pages: string[]; index: string };
  let cached: Snapshot | undefined,
    expires = 0,
    closed = false,
    waiters = 0,
    pending: Promise<Snapshot> | undefined,
    controller: AbortController | undefined,
    closing: Promise<void> | undefined;
  const source = options.source;
  function checked(input: PublicSitemapEntry): SitemapEntry {
    plain(input, [
      "visibility",
      "loc",
      "lastmod",
      "changefreq",
      "priority",
      "alternates",
      "images",
    ]);
    if (input.visibility !== "public")
      throw new TypeError("Private sitemap record denied");
    const entry: SitemapEntry = { loc: policy.page(input.loc) };
    if (input.lastmod !== undefined) {
      if (!(input.lastmod instanceof Date) && typeof input.lastmod !== "string")
        throw new TypeError("Content lastmod required");
      entry.lastmod = input.lastmod;
    }
    if (input.changefreq !== undefined) entry.changefreq = input.changefreq;
    if (input.priority !== undefined) entry.priority = input.priority;
    if (input.alternates !== undefined) {
      plain(input.alternates);
      if (Object.keys(input.alternates).length > 32)
        throw new RangeError("Alternate limit");
      const alt: Record<string, string> = Object.create(null);
      for (const [key, url] of Object.entries(input.alternates)) {
        const lang = language(key);
        if (Object.hasOwn(alt, lang)) throw new TypeError("Duplicate locale");
        alt[lang] = policy.page(url, lang);
      }
      entry.alternates = alt;
    }
    if (input.images !== undefined) {
      if (!Array.isArray(input.images) || input.images.length > 32)
        throw new RangeError("Image limit");
      entry.images = input.images.map((value) => policy.image(value));
    }
    return entry;
  }
  async function build(signal: AbortSignal): Promise<Snapshot> {
    const pages: string[] = [],
      seen = new Set<string>(),
      urls = new Set<string>();
    let cursor: string | undefined,
      count = 0,
      group: SitemapEntry[] = [],
      estimate = 512,
      total = 0;
    const flush = () => {
      if (!group.length) return;
      const xml = createSitemap(group);
      if (Buffer.byteLength(xml) > maxBytes)
        throw new RangeError("Sitemap byte limit");
      total += Buffer.byteLength(xml);
      if (total > maxSnapshot || pages.length >= 50000)
        throw new RangeError("Snapshot limit");
      pages.push(xml);
      group = [];
      estimate = 512;
    };
    for (let page = 0; ; page++) {
      signal.throwIfAborted();
      if (page >= maxPages) throw new RangeError("Source page limit");
      const batch = await source.load({ cursor, limit: pageSize, signal });
      signal.throwIfAborted();
      plain(batch, ["items", "nextCursor"]);
      if (!Array.isArray(batch.items) || batch.items.length > pageSize)
        throw new RangeError("Source batch limit");
      for (const raw of batch.items) {
        if (++count > maxEntries) throw new RangeError("Entry limit");
        const entry = checked(raw);
        if (urls.has(entry.loc)) throw new TypeError("Duplicate sitemap URL");
        urls.add(entry.loc);
        const bytes = Buffer.byteLength(createSitemap([entry]));
        if (bytes > maxBytes) throw new RangeError("Single URL byte limit");
        if (
          group.length &&
          (group.length >= maxUrls || estimate + bytes > maxBytes)
        )
          flush();
        group.push(entry);
        estimate += bytes;
      }
      if (batch.nextCursor === undefined) break;
      if (
        typeof batch.nextCursor !== "string" ||
        !batch.nextCursor ||
        batch.nextCursor.length > 512 ||
        seen.has(batch.nextCursor)
      )
        throw new TypeError("Invalid/repeated source cursor");
      seen.add(batch.nextCursor);
      cursor = batch.nextCursor;
    }
    flush();
    if (!pages.length) pages.push(createSitemap([]));
    const index = createSitemapIndex(
      pages.map((_, i) => ({
        loc: policy.root + policy.basePath + `sitemaps/${i + 1}`,
      })),
    );
    if (
      Buffer.byteLength(index) > maxBytes ||
      total + Buffer.byteLength(index) > maxSnapshot
    )
      throw new RangeError("Sitemap index/snapshot limit");
    return { pages, index };
  }
  function read(): Promise<Snapshot> {
    if (closed) return Promise.reject(new Error("Closed"));
    if (cached && Date.now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    const current = new AbortController();
    controller = current;
    const signal = AbortSignal.any([
      current.signal,
      AbortSignal.timeout(timeout),
    ]);
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
  function response(request: Request, body: string, type: string) {
    const etag =
        '"' + createHash("sha256").update(body).digest("base64url") + '"',
      headers = {
        "content-type": type,
        "cache-control": `public, max-age=${cache}`,
        "x-content-type-options": "nosniff",
        etag,
      };
    const match = request.headers
      .get("if-none-match")
      ?.split(",")
      .some(
        (value) =>
          value.trim().replace(/^W\//, "") === etag || value.trim() === "*",
      );
    return new Response(match || request.method === "HEAD" ? null : body, {
      status: match ? 304 : 200,
      headers,
    });
  }
  async function handler(
    request: Request,
    context?: CrawlerRequestContext,
  ): Promise<Response> {
    if (closed) return new Response(null, { status: 503 });
    if (!policy.request(request, context))
      return new Response(null, { status: 421 });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    const path = new URL(request.url).pathname,
      base = policy.basePath;
    if (path === "/robots.txt")
      return response(request, robots, "text/plain; charset=utf-8");
    if (path === "/trust.txt" && trust !== undefined)
      return response(request, trust, "text/plain; charset=utf-8");
    const suffix = path.startsWith(base) ? path.slice(base.length) : "";
    if (suffix !== "sitemap.xml" && !/^sitemaps\/[1-9][0-9]*$/.test(suffix))
      return new Response(null, { status: 404 });
    if (waiters >= maxWaiters)
      return new Response(null, {
        status: 503,
        headers: { "retry-after": "1" },
      });
    waiters++;
    let abort: () => void = () => {},
      timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (request.signal.aborted) throw new Error("Canceled");
      const canceled = new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Canceled"));
        request.signal.addEventListener("abort", abort, { once: true });
      });
      const work = read();
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Crawler deadline")),
          timeout,
        );
      });
      const snapshot = await Promise.race([work, canceled, deadline]);
      if (suffix === "sitemap.xml")
        return response(
          request,
          snapshot.pages.length === 1 ? snapshot.pages[0] : snapshot.index,
          "application/xml; charset=utf-8",
        );
      const page = Number(suffix.slice(9)) - 1;
      if (!Number.isSafeInteger(page) || page >= snapshot.pages.length)
        return new Response(null, { status: 404 });
      return response(
        request,
        snapshot.pages[page],
        "application/xml; charset=utf-8",
      );
    } catch {
      return new Response(null, {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "1" },
      });
    } finally {
      if (timer) clearTimeout(timer);
      waiters--;
      request.signal.removeEventListener("abort", abort);
    }
  }
  return {
    routes: [
      { path: "/robots.txt", handler },
      { path: policy.basePath + "sitemap.xml", handler },
      { path: policy.basePath + "sitemaps/:page", handler },
      ...(trust === undefined ? [] : [{ path: "/trust.txt", handler }]),
    ],
    handler,
    invalidate() {
      if (closed) throw new Error("Closed");
      expires = 0;
      controller?.abort();
    },
    close() {
      if (closing) return closing;
      closed = true;
      controller?.abort();
      return (closing = (async () => {
        await Promise.allSettled(pending ? [pending] : []);
        cached = undefined;
      })());
    },
    status: () => Object.freeze({ closed, pending: !!pending, waiters }),
  };
}
