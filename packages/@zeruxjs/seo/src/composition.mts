import {
  escapeHtmlText,
  escapeHtmlAttribute,
  serializeJsonForScript,
  validateNavigationUrl,
} from "@zeruxjs/security/encoding";
import {
  createAsyncServerFilters,
  type AsyncServerFilters,
} from "@zeruxjs/hooks/actions";

export interface MetadataLayer {
  title?:
    | string
    | { text?: string; template?: string | null; absolute?: boolean };
  description?: string | null;
  canonical?: string | null;
  robots?: { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string | null;
    description?: string | null;
    type?: "website" | "article";
    siteName?: string | null;
    images?: readonly string[] | null;
  };
  social?: {
    title?: string | null;
    description?: string | null;
    card?: "summary" | "summary_large_image";
    site?: string | null;
    image?: string | null;
  };
  alternates?: Readonly<Record<string, string | null>> | null;
  jsonLd?: readonly Readonly<Record<string, unknown>>[] | null;
}
export interface MetadataSite {
  publicBase: string;
  mediaOrigins?: readonly string[];
  locales?: Readonly<Record<string, string>>;
  pagination?: { parameter: string; maxPage: number };
}
export interface MetadataContext {
  url: string;
  visibility: "public" | "private";
  locale?: string;
  page?: number;
}
export interface MetadataDocument {
  readonly title: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly robots: Readonly<{ index: boolean; follow: boolean }>;
  readonly openGraph?: Readonly<{
    title?: string;
    description?: string;
    type: "website" | "article";
    siteName?: string;
    locale?: string;
    url?: string;
    images: readonly string[];
  }>;
  readonly social?: Readonly<{
    title?: string;
    description?: string;
    card: "summary" | "summary_large_image";
    site?: string;
    image?: string;
  }>;
  readonly alternates: Readonly<Record<string, string>>;
  readonly jsonLd: readonly Readonly<Record<string, unknown>>[];
}
export interface MetadataElement {
  readonly tag: "title" | "meta" | "link" | "script";
  readonly attributes: Readonly<Record<string, string>>;
  readonly text?: string;
}
export type MetadataFilterMap = {
  "metadata:resolve": readonly [MetadataLayer, Readonly<MetadataContext>];
};
export const createMetadataHooks = () =>
  createAsyncServerFilters<MetadataFilterMap>({
    maxHandlers: 64,
    maxDepth: 8,
    maxPending: 32,
  });
const documents = new WeakSet<object>();
const invalid = (): never => {
  throw new TypeError("Invalid structured metadata");
};
function record(
  v: unknown,
  keys?: readonly string[],
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    invalid();
  const names = Reflect.ownKeys(v as object);
  if (names.length > 10000) throw new RangeError("Metadata complexity limit");
  if (
    names.some(
      (k) =>
        typeof k !== "string" ||
        ["__proto__", "prototype", "constructor"].includes(k) ||
        (keys && !keys.includes(k)) ||
        !("value" in Object.getOwnPropertyDescriptor(v, k)!),
    )
  )
    invalid();
}
function inert(value: unknown) {
  let nodes = 0,
    bytes = 0;
  const active = new Set<object>(),
    encoder = new TextEncoder();
  const walk = (v: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 16)
      throw new RangeError("Metadata complexity limit");
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "string") {
      if (v.length > 262144) throw new RangeError("Metadata byte limit");
      bytes += encoder.encode(v).byteLength;
      if (bytes > 262144) throw new RangeError("Metadata byte limit");
      return;
    }
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (!v || typeof v !== "object" || active.has(v)) invalid();
    active.add(v);
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) invalid();
      if (v.length > 1024 || Reflect.ownKeys(v).length !== v.length + 1)
        invalid();
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !("value" in d)) invalid();
        walk(d!.value, depth + 1);
      }
    } else {
      record(v);
      for (const [k, d] of Object.entries(
        Object.getOwnPropertyDescriptors(v),
      )) {
        if (k.length > 262144) throw new RangeError("Metadata byte limit");
        bytes += encoder.encode(k).byteLength;
        if (bytes > 262144) throw new RangeError("Metadata byte limit");
        walk(d.value, depth + 1);
      }
    }
    active.delete(v);
  };
  walk(value, 0);
  if (encoder.encode(JSON.stringify(value) ?? "").byteLength > 262144)
    throw new RangeError("Metadata byte limit");
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
function text(v: unknown, max = 4096): asserts v is string {
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)
  )
    invalid();
}
function locale(v: string) {
  if (v === "x-default") return v;
  try {
    const tags = Intl.getCanonicalLocales(v);
    if (tags.length !== 1) invalid();
    return tags[0];
  } catch {
    return invalid();
  }
}
function layer(v: unknown): asserts v is MetadataLayer {
  inert(v);
  record(v, [
    "title",
    "description",
    "canonical",
    "robots",
    "openGraph",
    "social",
    "alternates",
    "jsonLd",
  ]);
  if (v.title !== undefined) {
    if (typeof v.title === "string") text(v.title, 512);
    else {
      record(v.title, ["text", "template", "absolute"]);
      if (v.title.text !== undefined) text(v.title.text, 512);
      if (v.title.template !== undefined && v.title.template !== null) {
        text(v.title.template, 512);
        if (v.title.template.split("%s").length !== 2) invalid();
      }
      if (
        v.title.absolute !== undefined &&
        typeof v.title.absolute !== "boolean"
      )
        invalid();
    }
  }
  for (const k of ["description", "canonical"] as const)
    if (v[k] !== undefined && v[k] !== null) text(v[k]);
  if (v.robots !== undefined) {
    record(v.robots, ["index", "follow"]);
    if (Object.values(v.robots).some((x) => typeof x !== "boolean")) invalid();
  }
  for (const key of ["openGraph", "social"] as const) {
    const g = v[key];
    if (g === undefined) continue;
    record(
      g,
      key === "openGraph"
        ? ["title", "description", "type", "siteName", "images"]
        : ["title", "description", "card", "site", "image"],
    );
    for (const k of ["title", "description", "siteName", "site", "image"])
      if (g[k] !== undefined && g[k] !== null) text(g[k]);
    if (g.type !== undefined && !["website", "article"].includes(g.type))
      invalid();
    if (
      g.card !== undefined &&
      !["summary", "summary_large_image"].includes(g.card)
    )
      invalid();
    if (
      g.images !== undefined &&
      g.images !== null &&
      (!Array.isArray(g.images) ||
        g.images.length > 8 ||
        g.images.some((x: unknown) => typeof x !== "string"))
    )
      invalid();
  }
  if (v.alternates !== undefined && v.alternates !== null) {
    record(v.alternates);
    if (Object.keys(v.alternates).length > 32) invalid();
    const locales = new Set<string>();
    for (const [key, url] of Object.entries(v.alternates)) {
      const normalized = locale(key);
      if (locales.has(normalized)) invalid();
      locales.add(normalized);
      if (url !== null) text(url);
    }
  }
  if (v.jsonLd !== undefined && v.jsonLd !== null) {
    if (!Array.isArray(v.jsonLd) || v.jsonLd.length > 8) invalid();
    for (const item of v.jsonLd) record(item);
    if (new TextEncoder().encode(JSON.stringify(v.jsonLd)).byteLength > 65536)
      throw new RangeError("JSON-LD byte limit");
  }
}
function merge(layers: readonly MetadataLayer[]): MetadataLayer {
  inert(layers);
  if (!Array.isArray(layers) || !layers.length || layers.length > 32) invalid();
  let result: MetadataLayer = {},
    title: { text?: string; template?: string | null; absolute?: boolean } = {};
  for (let i = 0; i < layers.length; i++) {
    const input = layers[i];
    layer(input);
    const next = structuredClone(input);
    const defined = (v: object) =>
      Object.fromEntries(
        Object.entries(v).filter(([, value]) => value !== undefined),
      );
    if (next.title !== undefined) {
      if (typeof next.title === "string")
        title = { ...title, text: next.title, absolute: false };
      else {
        if (next.title.text !== undefined)
          title = { ...title, absolute: false };
        title = { ...title, ...defined(next.title) };
      }
    }
    for (const key of ["description", "canonical", "jsonLd"] as const)
      if (next[key] !== undefined) (result as any)[key] = next[key];
    for (const key of ["robots", "openGraph", "social"] as const)
      if (next[key] !== undefined)
        (result as any)[key] = { ...result[key], ...defined(next[key]!) };
    if (next.alternates !== undefined) {
      if (next.alternates === null) result.alternates = {};
      else {
        const alts = { ...result.alternates };
        for (const [key, url] of Object.entries(next.alternates)) {
          const normalized = locale(key);
          if (url === null) delete alts[normalized];
          else alts[normalized] = url;
        }
        result.alternates = alts;
      }
    }
  }
  result.title = title;
  return result;
}
function sitePolicy(site: MetadataSite, context: MetadataContext) {
  inert(site);
  inert(context);
  record(site, ["publicBase", "mediaOrigins", "locales", "pagination"]);
  record(context, ["url", "visibility", "locale", "page"]);
  const absolute = (v: string) => {
    text(v);
    return new URL(validateNavigationUrl(v));
  };
  const base = absolute(site.publicBase);
  if (base.search || base.hash || !base.pathname.endsWith("/")) invalid();
  const bases: Record<string, URL> = Object.create(null);
  if (site.locales !== undefined) {
    record(site.locales);
    if (Object.keys(site.locales).length > 32) invalid();
    for (const [key, url] of Object.entries(site.locales)) {
      const normalized = locale(key);
      if (Object.hasOwn(bases, normalized)) invalid();
      const b = absolute(url);
      if (b.search || b.hash || !b.pathname.endsWith("/")) invalid();
      bases[normalized] = b;
    }
  }
  const mediaOrigins = site.mediaOrigins ?? [base.origin];
  if (
    !Array.isArray(mediaOrigins) ||
    mediaOrigins.length > 32 ||
    mediaOrigins.some((origin) => absolute(origin).origin !== origin)
  )
    invalid();
  if (context.visibility !== "public" && context.visibility !== "private")
    invalid();
  const activeLocale =
    context.locale === undefined ? undefined : locale(context.locale);
  if (activeLocale === "x-default") invalid();
  if (activeLocale && !Object.hasOwn(bases, activeLocale)) invalid();
  const within = (url: URL, b: URL) => {
    if (
      url.origin !== b.origin ||
      !url.pathname.startsWith(b.pathname) ||
      /%2f|%5c/i.test(url.pathname)
    )
      invalid();
  };
  const selected = activeLocale ? bases[activeLocale] : base;
  const route = absolute(context.url);
  within(route, selected);
  if (route.search || route.hash) invalid();
  let page = context.page ?? 1;
  const pagination = site.pagination;
  if (pagination !== undefined) {
    record(pagination, ["parameter", "maxPage"]);
    if (
      typeof pagination.parameter !== "string" ||
      !/^[a-z][a-z0-9_]{0,31}$/.test(pagination.parameter) ||
      !Number.isSafeInteger(pagination.maxPage) ||
      pagination.maxPage < 1 ||
      pagination.maxPage > 10000
    )
      invalid();
  }
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > (pagination?.maxPage ?? 1)
  )
    invalid();
  const canonical = (value: string, b = selected) => {
    const url = absolute(value);
    within(url, b);
    if (url.hash) invalid();
    for (const [key, v] of url.searchParams) {
      if (
        !pagination ||
        key !== pagination.parameter ||
        v !== String(page) ||
        url.searchParams.getAll(key).length !== 1
      )
        invalid();
    }
    if (pagination) {
      url.searchParams.delete(pagination.parameter);
      if (page > 1) url.searchParams.set(pagination.parameter, String(page));
    }
    return url.href;
  };
  const image = (value: string) => {
    const url = absolute(value);
    if (url.hash || !mediaOrigins.includes(url.origin)) invalid();
    return url.href;
  };
  return { canonical, image, route, bases, activeLocale };
}
function compose(
  site: MetadataSite,
  value: MetadataLayer,
  context: MetadataContext,
): MetadataDocument {
  layer(value);
  const p = sitePolicy(site, context),
    title = value.title as Exclude<MetadataLayer["title"], string | undefined>;
  if (!title?.text) invalid();
  const resolvedTitle =
    title.absolute || !title.template
      ? title.text
      : title.template.replace("%s", () => title.text!);
  text(resolvedTitle, 1024);
  const publicPage = context.visibility === "public",
    checkedCanonical =
      value.canonical !== null
        ? p.canonical(value.canonical ?? p.route.href)
        : undefined,
    canonical = publicPage ? checkedCanonical : undefined;
  const description = value.description ?? undefined,
    alternates: Record<string, string> = Object.create(null);
  for (const [lang, url] of Object.entries(value.alternates ?? {})) {
    if (!Object.hasOwn(p.bases, lang) || url === null) invalid();
    const checked = p.canonical(url!, p.bases[lang]);
    if (publicPage) alternates[lang] = checked;
  }
  const g = value.openGraph ?? {},
    s = value.social ?? {};
  const images = [...new Set((g.images ?? []).map(p.image))];
  const image =
    s.image === null
      ? undefined
      : s.image !== undefined
        ? p.image(s.image)
        : images[0];
  const card = s.card ?? (image ? "summary_large_image" : "summary");
  if (card === "summary_large_image" && !image) invalid();
  if (
    s.site !== undefined &&
    s.site !== null &&
    !/^@[A-Za-z0-9_]{1,15}$/.test(s.site)
  )
    invalid();
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
            type: g.type ?? "website",
            siteName: g.siteName ?? undefined,
            locale:
              p.activeLocale && /^[a-z]{2,3}-[A-Z]{2}$/.test(p.activeLocale)
                ? p.activeLocale.replace(/-/g, "_")
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
            (value.jsonLd ?? []).map((item) => [JSON.stringify(item), item]),
          ).values(),
        ]
      : [],
  };
  // Only inert values survive; no author/review/date or schema facts are synthesized.
  const result = freeze(JSON.parse(JSON.stringify(data)) as MetadataDocument);
  documents.add(result);
  return result;
}
/** Layouts first, route/manual overrides last. No mutation of source layers. */
export function composeMetadata(
  site: MetadataSite,
  layers: readonly MetadataLayer[],
  context: MetadataContext,
): MetadataDocument {
  return compose(site, merge(layers), context);
}
/** Borrowed application/request-scoped filter registry; errors/cancellation propagate before any output. */
export async function resolveMetadata(
  site: MetadataSite,
  layers: readonly MetadataLayer[],
  context: MetadataContext,
  options: {
    hooks?: AsyncServerFilters<MetadataFilterMap>;
    signal?: AbortSignal;
  } = {},
): Promise<MetadataDocument> {
  record(options, ["hooks", "signal"]);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    invalid();
  options.signal?.throwIfAborted();
  sitePolicy(site, context);
  const settings = structuredClone(site),
    route = freeze(structuredClone(context));
  const merged = merge(layers),
    changed = options.hooks
      ? await options.hooks.apply("metadata:resolve", merged, [route], {
          signal: options.signal,
        })
      : merged;
  options.signal?.throwIfAborted();
  return composeMetadata(settings, [changed], route);
}
/** Structured values for an authored renderer; callbacks/HTML are never accepted here. */
export function metadataElements(
  document: MetadataDocument,
): readonly MetadataElement[] {
  if (!document || !documents.has(document)) invalid();
  const elements: MetadataElement[] = [];
  const add = (
    tag: MetadataElement["tag"],
    attributes: Record<string, string>,
    text?: string,
  ) =>
    elements.push({ tag, attributes, ...(text !== undefined ? { text } : {}) });
  const meta = (name: string, value: string | undefined, property = false) => {
    if (value !== undefined && value !== "")
      add("meta", { [property ? "property" : "name"]: name, content: value });
  };
  add("title", {}, document.title);
  meta("description", document.description);
  meta(
    "robots",
    `${document.robots.index ? "index" : "noindex"}, ${document.robots.follow ? "follow" : "nofollow"}`,
  );
  if (document.canonical)
    add("link", { rel: "canonical", href: document.canonical });
  for (const [lang, url] of Object.entries(document.alternates).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  ))
    add("link", { rel: "alternate", hreflang: lang, href: url });
  const g = document.openGraph;
  if (g) {
    meta("og:title", g.title, true);
    meta("og:description", g.description, true);
    meta("og:type", g.type, true);
    meta("og:site_name", g.siteName, true);
    meta("og:locale", g.locale, true);
    meta("og:url", g.url, true);
    for (const image of g.images) meta("og:image", image, true);
  }
  const s = document.social;
  if (s) {
    meta("twitter:title", s.title);
    meta("twitter:description", s.description);
    meta("twitter:card", s.card);
    meta("twitter:site", s.site);
    meta("twitter:image", s.image);
  }
  for (const data of document.jsonLd)
    add(
      "script",
      { type: "application/ld+json" },
      serializeJsonForScript(data),
    );
  return freeze(elements);
}
/** Optional HTML sink using security-owned context encoders. Host CSP remains authoritative. */
export function renderMetadata(
  document: MetadataDocument,
  options: { nonce?: string } = {},
): string {
  record(options, ["nonce"]);
  if (
    options.nonce !== undefined &&
    (typeof options.nonce !== "string" ||
      !/^[A-Za-z0-9+/_-]{22,86}={0,2}$/.test(options.nonce))
  )
    invalid();
  return metadataElements(document)
    .map((element) => {
      const attributes = {
        ...element.attributes,
        ...(element.tag === "script" && options.nonce
          ? { nonce: options.nonce }
          : {}),
      };
      const attrs = Object.entries(attributes)
        .map(([k, v]) => ` ${k}="${escapeHtmlAttribute(v)}"`)
        .join("");
      return element.tag === "meta" || element.tag === "link"
        ? `<${element.tag}${attrs}>`
        : `<${element.tag}${attrs}>${element.tag === "script" ? (element.text ?? "") : escapeHtmlText(element.text ?? "")}</${element.tag}>`;
    })
    .join("\n");
}
