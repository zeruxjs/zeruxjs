import { isIP } from 'node:net';
import { safeUrl, escapeHtml } from './escape.js';
export interface PublicSite {
  /** Explicit canonical public HTTP(S) origin; never derived from request headers. */
  origin: string;
  /** Explicit slash-terminated public mount prefix; defaults to root. */
  basePath?: string;
  /** Bounded exact public-media origin allowlist. */
  mediaOrigins?: readonly string[];
  /** Explicit locale-to-public-prefix mapping; canonical alias duplicates reject. */
  locales?: Readonly<Record<string, string>>;
  /** Optional exact host-verified direct-peer/internal-origin admission policy. */
  trustedProxy?: {
    /** At most32 trusted direct socket IP literals; never caller header values. */
    peers: readonly string[];
    /** At most16 configured internal HTTP(S) origins, requiring an exact direct peer. */
    internalOrigins: readonly string[];
  };
}
export interface CrawlerRequestContext {
  /** Direct socket peer supplied by the trusted host, never an HTTP header. */ peerAddress?: string;
}
/** Require a bounded plain own-data record before public configuration traversal. Reject unknown/prototype-sensitive keys and accessors without invoking them.
 * @param {unknown} v - Untrusted configuration/data candidate.
 * @param {readonly string[]} keys - Optional exact supported own-key names.
 * @returns {void} Completes only for a supported plain record; malformed inputs throw.
 */
export function plain(
  v: unknown,
  keys?: readonly string[]
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) {
    throw new TypeError('Expected public configuration object');
  }
  /** Bounded own field names inspected through descriptors before any value is read. */
  const names = Reflect.ownKeys(v);
  if (
    names.length > 1000 ||
    names.some(
      (k) =>
        typeof k !== 'string' ||
        ['__proto__', 'prototype', 'constructor'].includes(k) ||
        (keys && !keys.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(v, k)!)
    )
  ) {
    throw new TypeError('Invalid public configuration fields');
  }
}
/** Validate a strict public HTTP(S) URL without credentials, queries, fragments, encoded separators or traversal ambiguity. This is not outbound DNS/egress authorization.
 * @param {unknown} v - Authored absolute public URL capped at8192 characters.
 * @returns {URL} Validated native URL; no URL is fetched.
 */
export function absolute(v: unknown): URL {
  if (
    typeof v !== 'string' ||
    !v ||
    v.length > 8192 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f\\?#]/.test(v) ||
    /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(v)
  ) {
    throw new TypeError('Invalid public URL');
  }
  /** Validated absolute HTTP(S) candidate; strict public policy excludes query/fragment/ambiguous path forms. */
  const u = new URL(safeUrl(v));
  if (u.search || u.hash || /%2f|%5c|%25/i.test(u.pathname)) {
    throw new TypeError('Query/fragment/encoded path denied');
  }
  return u;
}
/** Require an exact canonical root origin, not a public path prefix.
 * @param {unknown} v - Authored public/media/internal origin.
 * @returns {string} Normalized exact HTTP(S) origin.
 */
function origin(v: unknown) {
  /** Validated absolute HTTP(S) candidate; strict public policy excludes query/fragment/ambiguous path forms. */
  const u = absolute(v);
  if (u.pathname !== '/') {
    throw new TypeError('Expected an origin');
  }
  return u.origin;
}
/** Normalize one declared BCP47 locale or explicit alternate-only x-default label.
 * @param {string} v - Authored locale key; aliases normalize before duplicate checks.
 * @returns {string} Canonical locale label; invalid syntax throws.
 */
export function language(v: string) {
  if (v === 'x-default') {
    return v;
  }
  return (
    Intl.getCanonicalLocales(v)[0] ??
    (() => {
      throw new TypeError('Invalid locale');
    })()
  );
}
/** Capture explicit public URL/locale/media/proxy policy. Host/forwarded headers never derive public origins, and URL validation never authenticates a tenant.
 * @param {PublicSite} site - Trusted explicit public settings; private content selection remains host-owned.
 * @returns {object} Inert page/image/request policy helpers with no listener or network resource.
 */
export function publicPolicy(site: PublicSite) {
  plain(site, [
    'origin',
    'basePath',
    'mediaOrigins',
    'locales',
    'trustedProxy',
  ]);
  /** Captured configured canonical public origin, never derived from Host/forwarding headers. */
  const root = origin(site.origin);
  /** Explicit mounted slash-terminated public prefix, default root. */
  const basePath = site.basePath ?? '/';
  if (
    typeof basePath !== 'string' ||
    !basePath.startsWith('/') ||
    basePath.includes('//') ||
    !basePath.endsWith('/') ||
    absolute(root + basePath).pathname !== basePath
  ) {
    throw new TypeError('Invalid public base path');
  }
  /** Explicit bounded allowed media origins or the public origin default. */
  const media = site.mediaOrigins ?? [root];
  if (!Array.isArray(media) || media.length > 32) {
    throw new TypeError('Media origin limit');
  }
  /** Canonical exact media-origin allowlist; no asset URL is fetched. */
  const mediaOrigins = media.map(origin);
  /** Captured canonical locale prefixes with no prototype-inherited keys. */
  const locales: Record<string, URL> = Object.create(null);
  if (site.locales !== undefined) {
    plain(site.locales);
    if (Object.keys(site.locales).length > 32) {
      throw new RangeError('Locale limit');
    }
    // Capture each explicit canonical locale prefix; aliases cannot silently overwrite another.
    for (const [lang, href] of Object.entries(site.locales)) {
      /** Canonical BCP47/x-default label; duplicate aliases reject. */
      const key = language(lang);
      /** Parsed candidate request/page/media URL checked against captured policy. */
      const url = absolute(href);
      if (Object.hasOwn(locales, key) || !url.pathname.endsWith('/')) {
        throw new TypeError('Invalid locale prefix');
      }
      locales[key] = url;
    }
  }
  /** Optional explicit direct-peer/internal-origin host policy; request headers cannot grant trust. */
  const trusted = site.trustedProxy;
  if (trusted) {
    plain(trusted, ['peers', 'internalOrigins']);
    if (
      !Array.isArray(trusted.peers) ||
      trusted.peers.length > 32 ||
      trusted.peers.some((p) => typeof p !== 'string' || !isIP(p)) ||
      !Array.isArray(trusted.internalOrigins) ||
      trusted.internalOrigins.length > 16
    ) {
      throw new TypeError('Invalid proxy policy');
    }
  }
  /** Copied exact trusted direct-socket IPs; no wildcard/CIDR/header discovery. */
  const peers = [...(trusted?.peers ?? [])];
  /** Captured exact internal request origins accepted only together with a trusted direct peer. */
  const internal = (trusted?.internalOrigins ?? []).map(origin);
  /** Strict public URL validator; a visibility flag is still not proof of content authorization.
   * @param {string} value - Authored absolute page URL under the captured public prefix.
   * @param {string} lang - Optional explicitly configured locale prefix key.
   * @returns {string} Canonical accepted public URL; no content authorization is inferred.
   */
  const page = (value: string, lang?: string) => {
    /** Parsed candidate request/page/media URL checked against captured policy. */
    const url = absolute(value);
    /** Selected explicit public/locale prefix; cross-origin/path escapes reject. */
    const prefix = lang ? locales[language(lang)] : new URL(root + basePath);
    if (
      !prefix ||
      url.origin !== prefix.origin ||
      !url.pathname.startsWith(prefix.pathname)
    ) {
      throw new TypeError('Public URL outside site');
    }
    return url.href;
  };
  return {
    root,
    basePath,
    page,
    /** Validate an absolute public media URL against the captured exact origin allowlist.
     * @param {string} value - Authored media location; query/signed/private URL forms are excluded.
     * @returns {string} Canonical public media URL; no remote fetch occurs.
     */
    image(value: string) {
      /** Parsed candidate request/page/media URL checked against captured policy. */
      const url = absolute(value);
      if (!mediaOrigins.includes(url.origin)) {
        throw new TypeError('Media origin denied');
      }
      return url.href;
    },
    /** Admit only configured public origin/Host or an exact host-verified proxy-peer/internal-origin pair. Forwarding headers never select public URLs.
     * @param {Request} request - Borrowed Fetch request carrying its actual URL/optional Host.
     * @param {CrawlerRequestContext} context - Optional trusted direct socket peer; never populate it from a request header.
     * @returns {boolean} Whether the explicit origin/direct-peer policy admits this request; not user authorization.
     */
    request(request: Request, context: CrawlerRequestContext = {}) {
      /** Parsed candidate request/page/media URL checked against captured policy. */
      const url = new URL(request.url);
      /** Both exact direct peer and configured internal origin must match; forwarded values remain ignored. */
      const proxy =
        !!context.peerAddress &&
        peers.includes(context.peerAddress) &&
        internal.includes(url.origin);
      if (url.origin !== root && !proxy) {
        return false;
      }
      /** Optional explicit Host header checked against configured public/internal origins. */
      const host = request.headers.get('host');
      return (
        host === null ||
        host === (proxy ? url.host : new URL(root).host) ||
        (proxy && host === new URL(root).host)
      );
    },
  };
}
export interface HtmlSitemapItem {
  /** Explicit public declaration; the host still proves the selected content is authorized for discovery. */
  visibility: 'public';
  /** Strict absolute query/fragment-free public location under the configured prefix. */
  loc: string;
  /** Required meaningful authored link label, at most512 characters. */
  title: string;
}
/** Render a separate bounded escaped navigation list with explicit public flags and authored labels. No XML, SPA fallback, label synthesis or authorization is inferred.
 * @param {PublicSite} site - Trusted captured public prefix/origin policy.
 * @param {Iterable<HtmlSitemapItem>} items - Bounded authored public URL/title iterable; invalid input aborts the whole output.
 * @param {{ label?: string; maxEntries?: number; maxBytes?: number }} options - Optional explicit navigation label and finite count/byte ceilings.
 * @param {string} options.label - Authored accessible navigation label; defaults Sitemap.
 * @param {number} options.maxEntries - Item cap, default1000 and maximum5000.
 * @param {number} options.maxBytes - UTF-8 output cap, default1 MiB and maximum2 MiB.
 * @returns {string} Complete escaped HTML navigation after final byte validation; body validation/budget failures close a return-capable iterator.
 */
export function renderHtmlSitemap(
  site: PublicSite,
  items: Iterable<HtmlSitemapItem>,
  options: { label?: string; maxEntries?: number; maxBytes?: number } = {}
): string {
  plain(options, ['label', 'maxEntries', 'maxBytes']);
  /** Captured public origin/prefix/media/locale/proxy policy, independent of rendering data. */
  const policy = publicPolicy(site);
  /** Finite authored HTML sitemap item cap, default1000 and maximum5000. */
  const max = options.maxEntries ?? 1000;
  /** Complete rendered HTML UTF-8 ceiling, default1 MiB and maximum2 MiB. */
  const bytes = options.maxBytes ?? 1048576;
  /** Authored navigation label; meaningful text is never guessed from a slug. */
  const label = options.label ?? 'Sitemap';
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 5000 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 256 ||
    bytes > 2097152 ||
    typeof label !== 'string' ||
    label.length > 128
  ) {
    throw new RangeError('Invalid HTML sitemap policy');
  }
  let body = '',
    count = 0;
  // Require authored public labels and charge every record before retaining HTML output.
  for (const item of items) {
    if (++count > max) {
      throw new RangeError('HTML sitemap entry limit');
    }
    plain(item, ['visibility', 'loc', 'title']);
    if (
      item.visibility !== 'public' ||
      typeof item.title !== 'string' ||
      !item.title ||
      item.title.length > 512
    ) {
      throw new TypeError('Public title required');
    }
    body += `<li><a href="${escapeHtml(policy.page(item.loc))}">${escapeHtml(item.title)}</a></li>`;
    if (Buffer.byteLength(body) > bytes - 256) {
      throw new RangeError('HTML sitemap byte limit');
    }
  }
  /** Complete escaped navigation HTML checked against its final byte ceiling. */
  const html = `<nav aria-label="${escapeHtml(label)}"><ul>${body}</ul></nav>`;
  if (Buffer.byteLength(html) > bytes) {
    throw new RangeError('HTML sitemap byte limit');
  }
  return html;
}
