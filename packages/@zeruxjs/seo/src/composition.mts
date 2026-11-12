import {
  escapeHtmlText,
  escapeHtmlAttribute,
  serializeJsonForScript,
  validateNavigationUrl,
} from '@zeruxjs/security/encoding';
import {
  createAsyncServerFilters,
  type AsyncServerFilters,
} from '@zeruxjs/hooks/actions';

export interface MetadataLayer {
  /** Authored title text or structured text/template/absolute policy; not generated from a path. */
  title?:
    | string
    | {
        /** Literal authored text; renderer script descriptors already contain independently encoded JSON. */
        text?: string;
        /** Exactly one literal%s title placeholder, or null to clear the inherited template. */
        template?: string | null;
        /** Skip inherited title template when true; a later title-text replacement resets it. */
        absolute?: boolean;
      };
  /** Authored description; undefined inherits and supported null clears. */
  description?: string | null;
  /** Validated public canonical URL, optional clearing/null; private contexts suppress it. */
  canonical?: string | null;
  /** Explicit crawler hints; private contexts force index/follow false, not access control. */
  robots?: {
    /** Authored indexing hint; private output always sets false. */
    index?: boolean;
    /** Authored link-following hint; private output always sets false. */
    follow?: boolean;
  };
  /** Structured supplied Open Graph fields; merged by property, arrays replace. */
  openGraph?: {
    /** Authored title text or structured text/template/absolute policy; not generated from a path. */
    title?: string | null;
    /** Authored description; undefined inherits and supported null clears. */
    description?: string | null;
    /** Supported explicit Open Graph website/article classification. */
    type?: 'website' | 'article';
    /** Optional authored site label; null clears it. */
    siteName?: string | null;
    /** Replacement array of validated media URLs; repeated URLs deduplicate. */
    images?: readonly string[] | null;
  };
  /** Structured supplied social-card fields; no account/content facts are discovered. */
  social?: {
    /** Authored title text or structured text/template/absolute policy; not generated from a path. */
    title?: string | null;
    /** Authored description; undefined inherits and supported null clears. */
    description?: string | null;
    /** Summary or summary_large_image; large image requires an actual configured image. */
    card?: 'summary' | 'summary_large_image';
    /** Optional authored@account label; bounded syntax is validated. */
    site?: string | null;
    /** Explicit validated social image; null suppresses graph-image fallback. */
    image?: string | null;
  };
  /** Declared canonical locale links; null clears map/entry and private contexts omit all. */
  alternates?: Readonly<Record<string, string | null>> | null;
  /** Supplied bounded inert objects only; no authors/reviews/dates are inferred. */
  jsonLd?: readonly Readonly<Record<string, unknown>>[] | null;
}
export interface MetadataSite {
  /** Explicit canonical HTTP(S) public prefix ending in slash, with no query/fragment. */
  publicBase: string;
  /** At most32 exact allowed media origins; no assets are fetched. */
  mediaOrigins?: readonly string[];
  /** At most32 explicit BCP47/x-default public prefixes; cross-origin translations require configuration. */
  locales?: Readonly<Record<string, string>>;
  /** Explicit canonical parameter and bounded maximum page; page counts are not guessed. */
  pagination?: {
    /** Bounded explicit canonical query parameter name. */
    parameter: string;
    /** Positive maximum page through10000. */
    maxPage: number;
  };
}
export interface MetadataContext {
  /** Factual route/public graph URL; strict prefix and query policy applies. */
  url: string;
  /** Explicit host-selected public/private context; not proof of underlying authorization. */
  visibility: 'public' | 'private';
  /** Explicit configured active locale; x-default is alternate-only. */
  locale?: string;
  /** Explicit bounded page, default one; later pages receive distinct canonical parameters. */
  page?: number;
}
export interface MetadataDocument {
  /** Resolved authored title after applying at most one selected template; no title is inferred from a path. */
  readonly title: string;
  /** Final optional authored description; no synthetic summary is generated. */
  readonly description?: string;
  /** Final validated canonical URL; absent for private documents or explicit clearing. */
  readonly canonical?: string;
  /** Final frozen crawler hints; private documents force both false without granting access control. */
  readonly robots: Readonly<{
    /** Authored indexing hint; private output always sets false. */
    index: boolean;
    /** Authored link-following hint; private output always sets false. */
    follow: boolean;
  }>;
  /** Final immutable public graph descriptor; private documents omit it. */
  readonly openGraph?: Readonly<{
    /** Resolved authored title after applying at most one selected template; no title is inferred from a path. */
    title?: string;
    /** Final optional authored description; no synthetic summary is generated. */
    description?: string;
    /** Supported explicit Open Graph website/article classification. */
    type: 'website' | 'article';
    /** Optional authored site label; null clears it. */
    siteName?: string;
    /** Explicit configured active locale; x-default is alternate-only. */
    locale?: string;
    /** Factual route/public graph URL; strict prefix and query policy applies. */
    url?: string;
    /** Final readonly deduplicated allowed media URLs. */
    images: readonly string[];
  }>;
  /** Final immutable public social descriptor; private documents omit it. */
  readonly social?: Readonly<{
    /** Resolved authored title after applying at most one selected template; no title is inferred from a path. */
    title?: string;
    /** Final optional authored description; no synthetic summary is generated. */
    description?: string;
    /** Summary or summary_large_image; large image requires an actual configured image. */
    card: 'summary' | 'summary_large_image';
    /** Optional authored@account label; bounded syntax is validated. */
    site?: string;
    /** Explicit validated social image; null suppresses graph-image fallback. */
    image?: string;
  }>;
  /** Immutable configured canonical locale links; private documents use an empty map. */
  readonly alternates: Readonly<Record<string, string>>;
  /** Readonly deduplicated supplied facts; private documents contain no JSON-LD. */
  readonly jsonLd: readonly Readonly<Record<string, unknown>>[];
}
export interface MetadataElement {
  /** Fixed title/meta/link/script renderer element kind. */
  readonly tag: 'title' | 'meta' | 'link' | 'script';
  /** Immutable fixed-name inert attributes; host renderers choose the correct destination sink. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Literal authored text; renderer script descriptors already contain independently encoded JSON. */
  readonly text?: string;
}
export type MetadataFilterMap = {
  'metadata:resolve': readonly [MetadataLayer, Readonly<MetadataContext>];
};
/** Create one explicit server-filter owner; host must dispose then await whenIdle after borrowing requests drain.
 * @returns {AsyncServerFilters<MetadataFilterMap>} Owned scoped server registry; dispose then await whenIdle after borrowers finish.
 */
export const createMetadataHooks = () =>
  createAsyncServerFilters<MetadataFilterMap>({
    maxHandlers: 64,
    maxDepth: 8,
    maxPending: 32,
  });
/** Private provenance markers for composed immutable documents; forged/spread objects cannot enter serializers. */
const documents = new WeakSet<object>();
/** Throw fixed structured-input rejection without reflecting content values.
 * @returns {never} Always throws a fixed structured-input rejection.
 */
const invalid = (): never => {
  throw new TypeError('Invalid structured metadata');
};
/** Require a bounded plain own-data record; unknown/prototype-sensitive keys and accessors reject without invoking them.
 * @param {unknown} v - Untrusted structured metadata/configuration candidate.
 * @param {readonly string[]} keys - Optional exact allowed own-key list.
 * @returns {void} Completes only for a supported record; malformed inputs throw.
 */
function record(
  v: unknown,
  keys?: readonly string[]
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  ) {
    invalid();
  }
  /** Own field names validated through descriptors before values are read. */
  const names = Reflect.ownKeys(v as object);
  if (names.length > 10000) {
    throw new RangeError('Metadata complexity limit');
  }
  if (
    names.some(
      (k) =>
        typeof k !== 'string' ||
        ['__proto__', 'prototype', 'constructor'].includes(k) ||
        (keys && !keys.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(v, k)!)
    )
  ) {
    invalid();
  }
}
/** Validate bounded ordinary JSON metadata before cloning/evaluation-free serialization. Dense plain arrays, finite values and noncyclic own descriptors are required.
 * @param {unknown} value - Unknown ordinary-data candidate, not executable source modules.
 * @returns {void} Completes only within explicit node/depth/UTF-8 limits; this is not a hostile-proxy sandbox.
 */
function inert(value: unknown) {
  let nodes = 0,
    bytes = 0;
  /** Ancestor identities for bounded inert metadata traversal; cycles reject before serialization. */
  const active = new Set<object>();
  /** Shared UTF-8 accounting helper; character limits do not replace byte ceilings. */
  const encoder = new TextEncoder();
  /** Validate finite inert JSON/array descriptors without invoking getters or serialization callbacks.
   * @param {unknown} v - Candidate JSON subtree.
   * @param {number} depth - Current nested depth capped at16.
   * @returns {void} Completes after bounded inert descriptor traversal.
   */
  const walk = (v: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 16) {
      throw new RangeError('Metadata complexity limit');
    }
    if (v === null || v === undefined || typeof v === 'boolean') {
      return;
    }
    if (typeof v === 'string') {
      if (v.length > 262144) {
        throw new RangeError('Metadata byte limit');
      }
      bytes += encoder.encode(v).byteLength;
      if (bytes > 262144) {
        throw new RangeError('Metadata byte limit');
      }
      return;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return;
    }
    if (!v || typeof v !== 'object' || active.has(v)) {
      invalid();
    }
    active.add(v);
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) {
        invalid();
      }
      if (v.length > 1024 || Reflect.ownKeys(v).length !== v.length + 1) {
        invalid();
      }
      // Inspect dense array descriptors before reading values; custom accessors/iterators never discover metadata.
      for (let i = 0; i < v.length; i++) {
        /** Own data descriptor inspected before recursive value traversal. */
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !('value' in d)) {
          invalid();
        }
        walk(d!.value, depth + 1);
      }
    } else {
      record(v);
      // Charge own key bytes and recurse only through validated inert data descriptors.
      for (const [k, d] of Object.entries(
        Object.getOwnPropertyDescriptors(v)
      )) {
        if (k.length > 262144) {
          throw new RangeError('Metadata byte limit');
        }
        bytes += encoder.encode(k).byteLength;
        if (bytes > 262144) {
          throw new RangeError('Metadata byte limit');
        }
        walk(d.value, depth + 1);
      }
    }
    active.delete(v);
  };
  walk(value, 0);
  if (encoder.encode(JSON.stringify(value) ?? '').byteLength > 262144) {
    throw new RangeError('Metadata byte limit');
  }
}
/** Deep-freeze already validated ordinary request-local data before exposing it to a renderer.
 * @param {T} v - Validated cloned document or route context; no untrusted accessors remain.
 * @returns {T} Same value with its object graph frozen.
 */
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    // Freeze the already validated independent graph before renderer exposure.
    for (const x of Object.values(v)) {
      freeze(x);
    }
    Object.freeze(v);
  }
  return v;
}
/** Validate bounded literal metadata text without evaluating markup or manufacturing content.
 * @param {unknown} v - Candidate string; disallowed controls reject.
 * @param {number} max - Maximum UTF-16 length; defaults4096.
 * @returns {void} Completes only for a supported literal string.
 */
function text(v: unknown, max = 4096): asserts v is string {
  if (
    typeof v !== 'string' ||
    v.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)
  ) {
    invalid();
  }
}
/** Normalize one declared BCP47 locale or explicit alternate-only x-default marker.
 * @param {string} v - Authored locale key; aliases are normalized before duplicate checks.
 * @returns {string} Canonical locale label; invalid/ambiguous values throw.
 */
function locale(v: string) {
  if (v === 'x-default') {
    return v;
  }
  try {
    /** Canonical locale candidates; exactly one configured locale is required. */
    const tags = Intl.getCanonicalLocales(v);
    if (tags.length !== 1) {
      invalid();
    }
    return tags[0];
  } catch {
    return invalid();
  }
}
/** Validate one bounded inert authored metadata layer with explicit supported fields and clear/inherit semantics.
 * @param {unknown} v - Unknown layer; functions/classes/accessors/unsafe prototype keys reject.
 * @returns {void} Completes only for a supported metadata layer.
 */
function layer(v: unknown): asserts v is MetadataLayer {
  inert(v);
  record(v, [
    'title',
    'description',
    'canonical',
    'robots',
    'openGraph',
    'social',
    'alternates',
    'jsonLd',
  ]);
  if (v.title !== undefined) {
    if (typeof v.title === 'string') {
      text(v.title, 512);
    } else {
      record(v.title, ['text', 'template', 'absolute']);
      if (v.title.text !== undefined) {
        text(v.title.text, 512);
      }
      if (v.title.template !== undefined && v.title.template !== null) {
        text(v.title.template, 512);
        if (v.title.template.split('%s').length !== 2) {
          invalid();
        }
      }
      if (
        v.title.absolute !== undefined &&
        typeof v.title.absolute !== 'boolean'
      ) {
        invalid();
      }
    }
  }
  // Validate optional supplied scalar fields while retaining explicit clear/inherit semantics.
  for (const k of ['description', 'canonical'] as const) {
    if (v[k] !== undefined && v[k] !== null) {
      text(v[k]);
    }
  }
  if (v.robots !== undefined) {
    record(v.robots, ['index', 'follow']);
    if (Object.values(v.robots).some((x) => typeof x !== 'boolean')) {
      invalid();
    }
  }
  // Validate each supported structured graph/card object with its exact allowed fields.
  for (const key of ['openGraph', 'social'] as const) {
    /** Authored Open Graph/social object or final graph descriptor; no facts are inferred from a URL. */
    const g = v[key];
    if (g === undefined) {
      continue;
    }
    record(
      g,
      key === 'openGraph'
        ? ['title', 'description', 'type', 'siteName', 'images']
        : ['title', 'description', 'card', 'site', 'image']
    );
    // Only supplied nonnull literal fields receive text validation; no facts are manufactured.
    for (const k of ['title', 'description', 'siteName', 'site', 'image']) {
      if (g[k] !== undefined && g[k] !== null) {
        text(g[k]);
      }
    }
    if (g.type !== undefined && !['website', 'article'].includes(g.type)) {
      invalid();
    }
    if (
      g.card !== undefined &&
      !['summary', 'summary_large_image'].includes(g.card)
    ) {
      invalid();
    }
    if (
      g.images !== undefined &&
      g.images !== null &&
      (!Array.isArray(g.images) ||
        g.images.length > 8 ||
        g.images.some((x: unknown) => typeof x !== 'string'))
    ) {
      invalid();
    }
  }
  if (v.alternates !== undefined && v.alternates !== null) {
    record(v.alternates);
    if (Object.keys(v.alternates).length > 32) {
      invalid();
    }
    /** Canonical alternate-label detector; duplicate aliases reject within a layer. */
    const locales = new Set<string>();
    // Reject canonical-locale alias collisions before resolving any public alternate.
    for (const [key, url] of Object.entries(v.alternates)) {
      /** Canonical BCP47/x-default key used for exact configuration matching. */
      const normalized = locale(key);
      if (locales.has(normalized)) {
        invalid();
      }
      locales.add(normalized);
      if (url !== null) {
        text(url);
      }
    }
  }
  if (v.jsonLd !== undefined && v.jsonLd !== null) {
    if (!Array.isArray(v.jsonLd) || v.jsonLd.length > 8) {
      invalid();
    }
    // Require each supplied JSON-LD record to be an inert plain object, not a callback.
    for (const item of v.jsonLd) {
      record(item);
    }
    if (new TextEncoder().encode(JSON.stringify(v.jsonLd)).byteLength > 65536) {
      throw new RangeError('JSON-LD byte limit');
    }
  }
}
/** Merge validated layers outer-to-inner without mutating caller data. Undefined inherits, supported null clears, objects merge by field and arrays replace.
 * @param {readonly MetadataLayer[]} layers - From one through32 authored layout-to-route layers.
 * @returns {MetadataLayer} Independent merged title/template/scalar/graph/social/alternate/JSON-LD policy.
 */
function merge(layers: readonly MetadataLayer[]): MetadataLayer {
  inert(layers);
  if (!Array.isArray(layers) || !layers.length || layers.length > 32) {
    invalid();
  }
  /** Independent merged/document candidate; publication follows complete validation. */
  const result: MetadataLayer = {};
  let title: {
    /** Literal authored text; renderer script descriptors already contain independently encoded JSON. */
    text?: string;
    /** Exactly one literal%s title placeholder, or null to clear the inherited template. */
    template?: string | null;
    /** Skip inherited title template when true; a later title-text replacement resets it. */
    absolute?: boolean;
  } = {};
  // Apply outer-to-inner precedence deterministically using independent layer clones.
  for (let i = 0; i < layers.length; i++) {
    /** One bounded authored metadata layer, validated before any clone or merge. */
    const input = layers[i];
    layer(input);
    /** Independent layer clone; source objects are never mutated. */
    const next = structuredClone(input);
    /** Select defined own values so undefined inherits while explicit null can clear supported fields.
     * @param {object} v - Validated independent structured layer object.
     * @returns {Record<string, unknown>} Own defined values only; null remains explicit.
     */
    const defined = (v: object) =>
      Object.fromEntries(
        Object.entries(v).filter(([, value]) => value !== undefined)
      );
    if (next.title !== undefined) {
      if (typeof next.title === 'string') {
        title = { ...title, text: next.title, absolute: false };
      } else {
        if (next.title.text !== undefined) {
          title = { ...title, absolute: false };
        }
        title = { ...title, ...defined(next.title) };
      }
    }
    // Defined scalar/array values replace; explicit null preserves its documented clearing meaning.
    for (const key of ['description', 'canonical', 'jsonLd'] as const) {
      if (next[key] !== undefined) {
        (result as any)[key] = next[key];
      }
    }
    // Merge structured objects by defined fields rather than mutating inherited source objects.
    for (const key of ['robots', 'openGraph', 'social'] as const) {
      if (next[key] !== undefined) {
        (result as any)[key] = { ...result[key], ...defined(next[key]!) };
      }
    }
    if (next.alternates !== undefined) {
      if (next.alternates === null) {
        result.alternates = {};
      } else {
        /** Independent alternate map; normalized null entries remove inherited values. */
        const alts = { ...result.alternates };
        // Normalize override keys and apply explicit entry deletion without changing the source layer.
        for (const [key, url] of Object.entries(next.alternates)) {
          /** Canonical BCP47/x-default key used for exact configuration matching. */
          const normalized = locale(key);
          if (url === null) {
            delete alts[normalized];
          } else {
            alts[normalized] = url;
          }
        }
        result.alternates = alts;
      }
    }
  }
  result.title = title;
  return result;
}
/** Validate public site/route/locale/media/page settings independently of layer content. Host headers never select canonical policy.
 * @param {MetadataSite} site - Trusted explicit public prefix/locale/media/pagination settings.
 * @param {MetadataContext} context - Host-supplied factual route visibility/locale/page context.
 * @returns {object} Captured canonical/media validators and resolved public route/prefix state; no URL is fetched.
 */
function sitePolicy(site: MetadataSite, context: MetadataContext) {
  inert(site);
  inert(context);
  record(site, ['publicBase', 'mediaOrigins', 'locales', 'pagination']);
  record(context, ['url', 'visibility', 'locale', 'page']);
  /** Strict HTTP(S) navigation parser; it does not fetch URLs or authorize outbound egress.
   * @param {string} v - Bounded authored absolute HTTP(S) location.
   * @returns {URL} Validated native URL without fetching it.
   */
  const absolute = (v: string) => {
    text(v);
    return new URL(validateNavigationUrl(v));
  };
  /** Configured canonical slash-terminated public prefix with no query/fragment. */
  const base = absolute(site.publicBase);
  if (base.search || base.hash || !base.pathname.endsWith('/')) {
    invalid();
  }
  /** Explicit canonical locale-prefix map; no host/header-derived locale discovery. */
  const bases: Record<string, URL> = Object.create(null);
  if (site.locales !== undefined) {
    record(site.locales);
    if (Object.keys(site.locales).length > 32) {
      invalid();
    }
    // Capture exact configured locale origins/prefixes; cross-origin translations require explicit entries.
    for (const [key, url] of Object.entries(site.locales)) {
      /** Canonical BCP47/x-default key used for exact configuration matching. */
      const normalized = locale(key);
      if (Object.hasOwn(bases, normalized)) {
        invalid();
      }
      /** Configured locale/public prefix used to reject cross-origin and path escapes. */
      const b = absolute(url);
      if (b.search || b.hash || !b.pathname.endsWith('/')) {
        invalid();
      }
      bases[normalized] = b;
    }
  }
  /** Bounded exact allowed media origins; default is the configured public origin. */
  const mediaOrigins = site.mediaOrigins ?? [base.origin];
  if (
    !Array.isArray(mediaOrigins) ||
    mediaOrigins.length > 32 ||
    mediaOrigins.some((origin) => absolute(origin).origin !== origin)
  ) {
    invalid();
  }
  if (context.visibility !== 'public' && context.visibility !== 'private') {
    invalid();
  }
  /** Explicit configured route locale; x-default is alternate-only, not an active locale. */
  const activeLocale =
    context.locale === undefined ? undefined : locale(context.locale);
  if (activeLocale === 'x-default') {
    invalid();
  }
  if (activeLocale && !Object.hasOwn(bases, activeLocale)) {
    invalid();
  }
  /** Enforce exact origin and lexical public-prefix policy without accepting encoded separators.
   * @param {URL} url - Candidate public page URL.
   * @param {URL} b - Selected explicit origin/path prefix.
   * @returns {void} Completes only for the configured origin/prefix; encoded separators reject.
   */
  const within = (url: URL, b: URL) => {
    if (
      url.origin !== b.origin ||
      !url.pathname.startsWith(b.pathname) ||
      /%2f|%5c/i.test(url.pathname)
    ) {
      invalid();
    }
  };
  /** Effective explicit route locale prefix, or the base public prefix. */
  const selected = activeLocale ? bases[activeLocale] : base;
  /** Validated factual route URL; it cannot carry arbitrary query/fragment secrets. */
  const route = absolute(context.url);
  within(route, selected);
  if (route.search || route.hash) {
    invalid();
  }
  /** Explicit bounded page identity, default one; no content/page counts are guessed. */
  const page = context.page ?? 1;
  /** Optional declared canonical query parameter and finite page ceiling. */
  const pagination = site.pagination;
  if (pagination !== undefined) {
    record(pagination, ['parameter', 'maxPage']);
    if (
      typeof pagination.parameter !== 'string' ||
      !/^[a-z][a-z0-9_]{0,31}$/.test(pagination.parameter) ||
      !Number.isSafeInteger(pagination.maxPage) ||
      pagination.maxPage < 1 ||
      pagination.maxPage > 10000
    ) {
      invalid();
    }
  }
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > (pagination?.maxPage ?? 1)
  ) {
    invalid();
  }
  /** Validated effective public canonical value/policy; private output never exposes it.
   * @param {string} value - Authored canonical/alternate URL.
   * @param {URL} b - Optional explicit configured prefix; defaults to the selected route prefix.
   * @returns {string} Validated page-specific canonical URL with only declared pagination.
   */
  const canonical = (value: string, b = selected) => {
    /** Parsed candidate canonical/media URL checked against captured site policy. */
    const url = absolute(value);
    within(url, b);
    if (url.hash) {
      invalid();
    }
    // Only the single declared matching page parameter may survive canonical validation.
    for (const [key, v] of url.searchParams) {
      if (
        !pagination ||
        key !== pagination.parameter ||
        v !== String(page) ||
        url.searchParams.getAll(key).length !== 1
      ) {
        invalid();
      }
    }
    if (pagination) {
      url.searchParams.delete(pagination.parameter);
      if (page > 1) {
        url.searchParams.set(pagination.parameter, String(page));
      }
    }
    return url.href;
  };
  /** Explicit selected validated media value/policy; no remote URL is fetched.
   * @param {string} value - Authored absolute media URL.
   * @returns {string} Validated allowlisted media URL, with no fetch.
   */
  const image = (value: string) => {
    /** Parsed candidate canonical/media URL checked against captured site policy. */
    const url = absolute(value);
    if (url.hash || !mediaOrigins.includes(url.origin)) {
      invalid();
    }
    return url.href;
  };
  return { canonical, image, route, bases, activeLocale };
}
/** Apply validated site policy to a merged layer, including private discovery suppression after all transformations. No author/review/date or permission facts are synthesized.
 * @param {MetadataSite} site - Trusted explicit public settings.
 * @param {MetadataLayer} value - Validated merged authored layer.
 * @param {MetadataContext} context - Host-owned factual route visibility/locale/page state.
 * @returns {MetadataDocument} Immutable provenance-marked request-local document with deterministic merge output.
 */
function compose(
  site: MetadataSite,
  value: MetadataLayer,
  context: MetadataContext
): MetadataDocument {
  layer(value);
  /** Captured validated site/route/locale/media policy for this composition. */
  const p = sitePolicy(site, context);
  /** Merged authored title text/template/absolute policy; title facts are never inferred from paths. */
  const title = value.title as Exclude<
    MetadataLayer['title'],
    string | undefined
  >;
  if (!title?.text) {
    invalid();
  }
  /** Final literal title after applying the nearest template once via a replacement callback. */
  const resolvedTitle =
    title.absolute || !title.template
      ? title.text
      : title.template.replace('%s', () => title.text!);
  text(resolvedTitle, 1024);
  /** Explicit host visibility flag; metadata cannot authenticate whether the host selected content correctly. */
  const publicPage = context.visibility === 'public';
  /** Canonical validated even when private policy will omit it, avoiding validation bypass. */
  const checkedCanonical =
    value.canonical !== null
      ? p.canonical(value.canonical ?? p.route.href)
      : undefined;
  /** Validated effective public canonical value/policy; private output never exposes it. */
  const canonical = publicPage ? checkedCanonical : undefined;
  /** Final supplied description or absence; no summary is invented. */
  const description = value.description ?? undefined;
  /** Independent final canonical locale links; private contexts retain an empty map. */
  const alternates: Record<string, string> = Object.create(null);
  // Validate alternate prefix/pagination even when private output will suppress discovery links.
  for (const [lang, url] of Object.entries(value.alternates ?? {})) {
    if (!Object.hasOwn(p.bases, lang) || url === null) {
      invalid();
    }
    /** Configured-prefix/pagination-validated alternate URL before public visibility projection. */
    const checked = p.canonical(url!, p.bases[lang]);
    if (publicPage) {
      alternates[lang] = checked;
    }
  }
  /** Authored Open Graph/social object or final graph descriptor; no facts are inferred from a URL. */
  const g = value.openGraph ?? {};
  /** Final authored social-card layer with explicit null/fallback semantics. */
  const s = value.social ?? {};
  /** Validated deduplicated graph image URLs; arrays replace rather than append. */
  const images = [...new Set((g.images ?? []).map(p.image))];
  /** Explicit selected validated media value/policy; no remote URL is fetched. */
  const image = (() => {
    if (s.image === null) {
      return undefined;
    }
    if (s.image !== undefined) {
      return p.image(s.image);
    }
    return images[0];
  })();
  /** Explicit social card or image-aware fallback; large-image requires an actual image. */
  const card = s.card ?? (image ? 'summary_large_image' : 'summary');
  if (card === 'summary_large_image' && !image) {
    invalid();
  }
  if (
    s.site !== undefined &&
    s.site !== null &&
    !/^@[A-Za-z0-9_]{1,15}$/.test(s.site)
  ) {
    invalid();
  }
  /** Structured facts selected before final freeze/provenance marking. */
  const data: MetadataDocument = {
    title: resolvedTitle,
    ...(description ? { description } : {}),
    ...(canonical ? { canonical } : {}),
    robots: {
      index: publicPage ? (value.robots?.index ?? true) : false,
      follow: publicPage ? (value.robots?.follow ?? true) : false,
    },
    ...(publicPage
      ? {
          openGraph: {
            title: g.title === null ? undefined : (g.title ?? resolvedTitle),
            description:
              g.description === null
                ? undefined
                : (g.description ?? description),
            type: g.type ?? 'website',
            siteName: g.siteName ?? undefined,
            locale:
              p.activeLocale && /^[a-z]{2,3}-[A-Z]{2}$/.test(p.activeLocale)
                ? p.activeLocale.replace(/-/g, '_')
                : undefined,
            url: canonical,
            images,
          },
          social: {
            title: s.title === null ? undefined : (s.title ?? resolvedTitle),
            description:
              s.description === null
                ? undefined
                : (s.description ?? description),
            card,
            site: s.site ?? undefined,
            image,
          },
        }
      : {}),
    alternates,
    jsonLd: publicPage
      ? [
          ...new Map(
            (value.jsonLd ?? []).map((item) => [JSON.stringify(item), item])
          ).values(),
        ]
      : [],
  };
  // Only inert values survive; no author/review/date or schema facts are synthesized.
  /** Independent merged/document candidate; publication follows complete validation. */
  const result = freeze(JSON.parse(JSON.stringify(data)) as MetadataDocument);
  documents.add(result);
  return result;
}
/** Compose validated layouts first and route/manual overrides last. Private contexts force noindex/nofollow and remove discovery/social/JSON-LD output.
 * @param {MetadataSite} site - Trusted explicit public site settings.
 * @param {readonly MetadataLayer[]} layers - Bounded ordered authored layers; source data is not mutated.
 * @param {MetadataContext} context - Host-verified visibility and factual route/locale/page context.
 * @returns {MetadataDocument} Immutable structured facts for explicit renderer consumption; metadata is not authorization.
 */
export function composeMetadata(
  site: MetadataSite,
  layers: readonly MetadataLayer[],
  context: MetadataContext
): MetadataDocument {
  return compose(site, merge(layers), context);
}
/** Apply borrowed scoped server filters before final validation/serialization; hook errors/cancellation propagate and private policy is reapplied.
 * @param {MetadataSite} site - Trusted site settings cloned before asynchronous hooks.
 * @param {readonly MetadataLayer[]} layers - Bounded ordered authored layers merged before hooks.
 * @param {MetadataContext} context - Host route context cloned/frozen before hooks.
 * @param {{
    hooks?: AsyncServerFilters<MetadataFilterMap>;
    signal?: AbortSignal;
  }} options - Optional borrowed filter registry and cooperative cancellation.
 * @param {AsyncServerFilters<MetadataFilterMap>} options.hooks - Borrowed scoped host filter registry.
 * @param {AbortSignal} options.signal - Optional caller cooperative cancellation.
 * @returns {Promise<MetadataDocument>} Revalidated immutable document; no global registry or silent bypass fallback is created.
 */
export async function resolveMetadata(
  site: MetadataSite,
  layers: readonly MetadataLayer[],
  context: MetadataContext,
  options: {
    hooks?: AsyncServerFilters<MetadataFilterMap>;
    signal?: AbortSignal;
  } = {}
): Promise<MetadataDocument> {
  record(options, ['hooks', 'signal']);
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    invalid();
  }
  options.signal?.throwIfAborted();
  sitePolicy(site, context);
  /** Independent site-policy clone retained before awaiting trusted hooks. */
  const settings = structuredClone(site);
  /** Validated factual route URL; it cannot carry arbitrary query/fragment secrets. */
  const route = freeze(structuredClone(context));
  /** Validated deterministic outer-layout-to-route structured layer merge. */
  const merged = merge(layers);
  /** Trusted scoped-filter output; revalidated and private policy reapplied before serialization. */
  const changed = options.hooks
    ? await options.hooks.apply('metadata:resolve', merged, [route], {
        signal: options.signal,
      })
    : merged;
  options.signal?.throwIfAborted();
  return composeMetadata(settings, [changed], route);
}
/** Return fixed immutable renderer descriptors for an actual composed document; forged/spread objects or executable callbacks are not accepted.
 * @param {MetadataDocument} document - Provenance-marked immutable composition result.
 * @returns {readonly MetadataElement[]} Singleton title/meta/link descriptors plus intentional repeated images/alternates/JSON-LD scripts.
 */
export function metadataElements(
  document: MetadataDocument
): readonly MetadataElement[] {
  if (!document || !documents.has(document)) {
    invalid();
  }
  /** Fixed structured renderer descriptors; arbitrary callbacks or raw head HTML are unsupported. */
  const elements: MetadataElement[] = [];
  /** Append one fixed renderer descriptor without changing the composed source document.
   * @param {MetadataElement['tag']} tag - Fixed descriptor element kind.
   * @param {Record<string, string>} attributes - Explicit inert fixed-name attribute values.
   * @param {string} text - Optional supplied literal text or already script-safe JSON.
   * @returns {number} Descriptor count after appending one fixed element.
   */
  const add = (
    tag: MetadataElement['tag'],
    attributes: Record<string, string>,
    text?: string
  ) =>
    elements.push({ tag, attributes, ...(text !== undefined ? { text } : {}) });
  /** Append one singleton fixed name/property descriptor only when supplied text is present.
   * @param {string} name - Fixed singleton metadata key.
   * @param {string | undefined} value - Optional supplied text; undefined/empty omits the tag.
   * @param {boolean} property - Select property syntax for graph metadata; defaults false.
   * @returns {void} Appends at most one fixed encoded descriptor.
   */
  const meta = (name: string, value: string | undefined, property = false) => {
    if (value !== undefined && value !== '') {
      add('meta', { [property ? 'property' : 'name']: name, content: value });
    }
  };
  add('title', {}, document.title);
  meta('description', document.description);
  meta(
    'robots',
    `${document.robots.index ? 'index' : 'noindex'}, ${document.robots.follow ? 'follow' : 'nofollow'}`
  );
  if (document.canonical) {
    add('link', { rel: 'canonical', href: document.canonical });
  }
  // Serialize configured alternates in deterministic UTF-16 key order.
  for (const [lang, url] of Object.entries(document.alternates).sort(
    ([a], [b]) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    }
  )) {
    add('link', { rel: 'alternate', hreflang: lang, href: url });
  }
  /** Authored Open Graph/social object or final graph descriptor; no facts are inferred from a URL. */
  const g = document.openGraph;
  if (g) {
    meta('og:title', g.title, true);
    meta('og:description', g.description, true);
    meta('og:type', g.type, true);
    meta('og:site_name', g.siteName, true);
    meta('og:locale', g.locale, true);
    meta('og:url', g.url, true);
    // Repeated graph-image tags are intentional for distinct validated media URLs.
    for (const image of g.images) {
      meta('og:image', image, true);
    }
  }
  /** Final authored social-card layer with explicit null/fallback semantics. */
  const s = document.social;
  if (s) {
    meta('twitter:title', s.title);
    meta('twitter:description', s.description);
    meta('twitter:card', s.card);
    meta('twitter:site', s.site);
    meta('twitter:image', s.image);
  }
  // Use script-specific JSON escaping independently of ordinary HTML text encoding.
  for (const data of document.jsonLd) {
    add(
      'script',
      { type: 'application/ld+json' },
      serializeJsonForScript(data)
    );
  }
  return freeze(elements);
}
/** Serialize structured descriptors with independent HTML text/attribute and script JSON boundaries. Host CSP remains authoritative and a nonce is never authorization.
 * @param {MetadataDocument} document - Actual immutable composed metadata document.
 * @param {{ nonce?: string }} options - Optional trusted response-owned script nonce.
 * @param {string} options.nonce - Optional trusted response-owned CSP nonce.
 * @returns {string} Encoded head HTML; script-safe JSON is not incorrectly HTML-escaped.
 */
export function renderMetadata(
  document: MetadataDocument,
  options: { nonce?: string } = {}
): string {
  record(options, ['nonce']);
  if (
    options.nonce !== undefined &&
    (typeof options.nonce !== 'string' ||
      !/^[A-Za-z0-9+/_-]{22,86}={0,2}$/.test(options.nonce))
  ) {
    invalid();
  }
  return metadataElements(document)
    .map((element) => {
      /** Per-element fixed attributes plus an explicit trusted script nonce when provided. */
      const attributes = {
        ...element.attributes,
        ...(element.tag === 'script' && options.nonce
          ? { nonce: options.nonce }
          : {}),
      };
      /** HTML-attribute-encoded representation; script text uses its own independent encoding. */
      const attrs = Object.entries(attributes)
        .map(([k, v]) => ` ${k}="${escapeHtmlAttribute(v)}"`)
        .join('');
      return element.tag === 'meta' || element.tag === 'link'
        ? `<${element.tag}${attrs}>`
        : `<${element.tag}${attrs}>${element.tag === 'script' ? (element.text ?? '') : escapeHtmlText(element.text ?? '')}</${element.tag}>`;
    })
    .join('\n');
}
