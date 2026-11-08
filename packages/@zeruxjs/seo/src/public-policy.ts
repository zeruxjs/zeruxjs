import { isIP } from "node:net";
import { safeUrl, escapeHtml } from "./escape.js";
export interface PublicSite {
  origin: string;
  basePath?: string;
  mediaOrigins?: readonly string[];
  locales?: Readonly<Record<string, string>>;
  trustedProxy?: {
    peers: readonly string[];
    internalOrigins: readonly string[];
  };
}
export interface CrawlerRequestContext {
  /** Direct socket peer supplied by the trusted host, never an HTTP header. */ peerAddress?: string;
}
export function plain(
  v: unknown,
  keys?: readonly string[],
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    throw new TypeError("Expected public configuration object");
  const names = Reflect.ownKeys(v);
  if (
    names.length > 1000 ||
    names.some(
      (k) =>
        typeof k !== "string" ||
        ["__proto__", "prototype", "constructor"].includes(k) ||
        (keys && !keys.includes(k)) ||
        !("value" in Object.getOwnPropertyDescriptor(v, k)!),
    )
  )
    throw new TypeError("Invalid public configuration fields");
}
export function absolute(v: unknown): URL {
  if (
    typeof v !== "string" ||
    !v ||
    v.length > 8192 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f\\?#]/.test(v) ||
    /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(v)
  )
    throw new TypeError("Invalid public URL");
  const u = new URL(safeUrl(v));
  if (u.search || u.hash || /%2f|%5c|%25/i.test(u.pathname))
    throw new TypeError("Query/fragment/encoded path denied");
  return u;
}
function origin(v: unknown) {
  const u = absolute(v);
  if (u.pathname !== "/") throw new TypeError("Expected an origin");
  return u.origin;
}
export function language(v: string) {
  if (v === "x-default") return v;
  return (
    Intl.getCanonicalLocales(v)[0] ??
    (() => {
      throw new TypeError("Invalid locale");
    })()
  );
}
export function publicPolicy(site: PublicSite) {
  plain(site, [
    "origin",
    "basePath",
    "mediaOrigins",
    "locales",
    "trustedProxy",
  ]);
  const root = origin(site.origin),
    basePath = site.basePath ?? "/";
  if (
    typeof basePath !== "string" ||
    !basePath.startsWith("/") ||
    basePath.includes("//") ||
    !basePath.endsWith("/") ||
    absolute(root + basePath).pathname !== basePath
  )
    throw new TypeError("Invalid public base path");
  const media = site.mediaOrigins ?? [root];
  if (!Array.isArray(media) || media.length > 32)
    throw new TypeError("Media origin limit");
  const mediaOrigins = media.map(origin),
    locales: Record<string, URL> = Object.create(null);
  if (site.locales !== undefined) {
    plain(site.locales);
    if (Object.keys(site.locales).length > 32)
      throw new RangeError("Locale limit");
    for (const [lang, href] of Object.entries(site.locales)) {
      const key = language(lang),
        url = absolute(href);
      if (Object.hasOwn(locales, key) || !url.pathname.endsWith("/"))
        throw new TypeError("Invalid locale prefix");
      locales[key] = url;
    }
  }
  const trusted = site.trustedProxy;
  if (trusted) {
    plain(trusted, ["peers", "internalOrigins"]);
    if (
      !Array.isArray(trusted.peers) ||
      trusted.peers.length > 32 ||
      trusted.peers.some((p) => typeof p !== "string" || !isIP(p)) ||
      !Array.isArray(trusted.internalOrigins) ||
      trusted.internalOrigins.length > 16
    )
      throw new TypeError("Invalid proxy policy");
  }
  const peers = [...(trusted?.peers ?? [])],
    internal = (trusted?.internalOrigins ?? []).map(origin);
  const page = (value: string, lang?: string) => {
    const url = absolute(value),
      prefix = lang ? locales[language(lang)] : new URL(root + basePath);
    if (
      !prefix ||
      url.origin !== prefix.origin ||
      !url.pathname.startsWith(prefix.pathname)
    )
      throw new TypeError("Public URL outside site");
    return url.href;
  };
  return {
    root,
    basePath,
    page,
    image(value: string) {
      const url = absolute(value);
      if (!mediaOrigins.includes(url.origin))
        throw new TypeError("Media origin denied");
      return url.href;
    },
    request(request: Request, context: CrawlerRequestContext = {}) {
      const url = new URL(request.url);
      const proxy =
        !!context.peerAddress &&
        peers.includes(context.peerAddress) &&
        internal.includes(url.origin);
      if (url.origin !== root && !proxy) return false;
      const host = request.headers.get("host");
      return (
        host === null ||
        host === (proxy ? url.host : new URL(root).host) ||
        (proxy && host === new URL(root).host)
      );
    },
  };
}
export interface HtmlSitemapItem {
  visibility: "public";
  loc: string;
  title: string;
}
/** Independent HTML list renderer, never a universal navigation/SPA fallback. */
export function renderHtmlSitemap(
  site: PublicSite,
  items: Iterable<HtmlSitemapItem>,
  options: { label?: string; maxEntries?: number; maxBytes?: number } = {},
): string {
  plain(options, ["label", "maxEntries", "maxBytes"]);
  const policy = publicPolicy(site),
    max = options.maxEntries ?? 1000,
    bytes = options.maxBytes ?? 1048576,
    label = options.label ?? "Sitemap";
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 5000 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 256 ||
    bytes > 2097152 ||
    typeof label !== "string" ||
    label.length > 128
  )
    throw new RangeError("Invalid HTML sitemap policy");
  let body = "",
    count = 0;
  for (const item of items) {
    if (++count > max) throw new RangeError("HTML sitemap entry limit");
    plain(item, ["visibility", "loc", "title"]);
    if (
      item.visibility !== "public" ||
      typeof item.title !== "string" ||
      !item.title ||
      item.title.length > 512
    )
      throw new TypeError("Public title required");
    body += `<li><a href="${escapeHtml(policy.page(item.loc))}">${escapeHtml(item.title)}</a></li>`;
    if (Buffer.byteLength(body) > bytes - 256)
      throw new RangeError("HTML sitemap byte limit");
  }
  const html = `<nav aria-label="${escapeHtml(label)}"><ul>${body}</ul></nav>`;
  if (Buffer.byteLength(html) > bytes)
    throw new RangeError("HTML sitemap byte limit");
  return html;
}
