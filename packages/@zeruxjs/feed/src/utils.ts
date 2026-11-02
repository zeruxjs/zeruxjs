import type {
  FeedOptions,
  FeedItem,
  FeedAuthor,
  FeedAttachment,
  FeedCategory,
} from "./types.js";
// XML 1.0 text/attribute escaping; this is not an HTML sanitizer or script encoder.
export const escapeXml = (value: string): string =>
  String(value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\t/g, "&#x9;")
    .replace(/\r/g, "&#xD;")
    .replace(/\n/g, "&#xA;");
function record(
  v: unknown,
  keys: readonly string[],
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).some(
      (k) =>
        typeof k !== "string" ||
        !keys.includes(k) ||
        !("value" in Object.getOwnPropertyDescriptor(v, k)!),
    )
  )
    throw new TypeError("Invalid feed fields");
}
function text(v: unknown, max = 4096, empty = false): asserts v is string {
  if (
    typeof v !== "string" ||
    (!empty && !v) ||
    v.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      v,
    )
  )
    throw new TypeError("Invalid feed text");
}
function array<T>(value: readonly T[], max: number): void {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new RangeError("Feed collection limit");
  for (let i = 0; i < value.length; i++)
    if (!("value" in (Object.getOwnPropertyDescriptor(value, String(i)) ?? {})))
      throw new TypeError("Feed accessors/sparse arrays denied");
}
export function safeFeedUrl(value: string): string {
  text(value, 8192);
  if (/[\x00-\x20\x7f\\]/.test(value)) throw new TypeError("Invalid feed URL");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new TypeError("Invalid feed URL");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new TypeError("Invalid feed URL");
  return u.href;
}
export function date(value?: string | Date): string | undefined {
  if (value === undefined) return undefined;
  let d: Date;
  if (value instanceof Date) d = new Date(Date.prototype.getTime.call(value));
  else {
    if (
      typeof value !== "string" ||
      value.length > 64 ||
      !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d))?$/.test(
        value,
      )
    )
      throw new TypeError("Invalid feed date");
    const year = Number(value.slice(0, 4)),
      month = Number(value.slice(5, 7)),
      day = Number(value.slice(8, 10)),
      days = [
        31,
        year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ];
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > days[month - 1] ||
      (value.length > 10 &&
        (Number(value.slice(11, 13)) > 23 ||
          Number(value.slice(14, 16)) > 59 ||
          Number(value.slice(17, 19)) > 59))
    )
      throw new TypeError("Invalid feed date");
    d = new Date(value);
  }
  if (
    !Number.isFinite(d.getTime()) ||
    d.getUTCFullYear() < 0 ||
    d.getUTCFullYear() > 9999
  )
    throw new TypeError("Invalid feed date");
  return d.toISOString();
}
function language(value: string) {
  text(value, 64);
  return (
    Intl.getCanonicalLocales(value)[0] ??
    (() => {
      throw new TypeError("Invalid feed language");
    })()
  );
}
export function authors(item: {
  author?: string;
  authors?: FeedAuthor[];
}): FeedAuthor[] {
  return item.authors ?? (item.author ? [{ name: item.author }] : []);
}
export function attachments(item: FeedItem): FeedAttachment[] {
  return item.attachments ?? (item.enclosure ? [item.enclosure] : []);
}
export function categories(item: {
  tags?: string[];
  categories?: FeedCategory[];
}): FeedCategory[] {
  return [
    ...(item.tags ?? []).map((term) => ({ term })),
    ...(item.categories ?? []),
  ];
}
function normalizeAuthors(
  values: FeedAuthor[] | undefined,
): FeedAuthor[] | undefined {
  if (values === undefined) return undefined;
  array(values, 32);
  return values.map((v) => {
    record(v, ["name", "url", "email", "avatar"]);
    text(v.name, 512);
    if (v.email !== undefined) {
      text(v.email, 254);
      if (!/^[^\s@<>,;]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(v.email))
        throw new TypeError("Invalid author email");
    }
    return {
      ...v,
      ...(v.url !== undefined ? { url: safeFeedUrl(v.url) } : {}),
      ...(v.avatar !== undefined ? { avatar: safeFeedUrl(v.avatar) } : {}),
    };
  });
}
function normalizeCategories(input: {
  tags?: string[];
  categories?: FeedCategory[];
}) {
  if (input.tags !== undefined) {
    array(input.tags, 100);
    input.tags.forEach((v) => text(v, 512));
  }
  if (input.categories !== undefined) {
    array(input.categories, 100);
    input.categories = input.categories.map((v) => {
      record(v, ["term", "scheme", "label"]);
      text(v.term, 512);
      if (v.label !== undefined) text(v.label, 512);
      return {
        ...v,
        ...(v.scheme !== undefined ? { scheme: safeFeedUrl(v.scheme) } : {}),
      };
    });
  }
}
function attachment(v: FeedAttachment): FeedAttachment {
  record(v, ["url", "type", "length", "title", "duration"]);
  if (!Number.isSafeInteger(v.length) || v.length < 0)
    throw new RangeError("Invalid enclosure length");
  if (
    typeof v.type !== "string" ||
    !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(v.type) ||
    v.type.length > 128
  )
    throw new TypeError("Invalid attachment MIME");
  if (v.title !== undefined) text(v.title, 512);
  if (
    v.duration !== undefined &&
    (typeof v.duration !== "number" ||
      !Number.isFinite(v.duration) ||
      v.duration < 0 ||
      v.duration > 315360000)
  )
    throw new RangeError("Invalid duration");
  return { ...v, url: safeFeedUrl(v.url) };
}
export function normalizeFeed(options: FeedOptions): FeedOptions {
  record(options, [
    "title",
    "description",
    "siteUrl",
    "feedUrl",
    "id",
    "language",
    "copyright",
    "image",
    "updated",
    "items",
    "authors",
    "tags",
    "categories",
    "strict",
    "maxItems",
    "maxBytes",
  ]);
  const maxItems = options.maxItems ?? 10000,
    maxBytes = options.maxBytes ?? 8388608;
  if (
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 10000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 256 ||
    maxBytes > 67108864
  )
    throw new RangeError("Feed policy limit");
  if (options.strict !== undefined && typeof options.strict !== "boolean")
    throw new TypeError("Invalid strict mode");
  text(options.title);
  text(options.description, 65536);
  array(options.items, maxItems);
  const normalized: FeedOptions = {
    ...options,
    siteUrl: safeFeedUrl(options.siteUrl),
    items: [],
    maxItems,
    maxBytes,
  };
  for (const key of ["feedUrl", "image"] as const)
    if (options[key] !== undefined)
      normalized[key] = safeFeedUrl(options[key]!);
  if (options.id !== undefined) text(options.id, 2048);
  if (options.copyright !== undefined) text(options.copyright, 4096);
  if (options.language !== undefined)
    normalized.language = language(options.language);
  if (options.updated !== undefined) normalized.updated = date(options.updated);
  normalized.authors = normalizeAuthors(options.authors);
  normalizeCategories(normalized);
  const ids = new Set<string>();
  let bytes = 0;
  for (let n = 0; n < options.items.length; n++) {
    const item = options.items[n];
    record(item, [
      "id",
      "atomId",
      "title",
      "url",
      "description",
      "contentText",
      "contentHtml",
      "date",
      "updated",
      "author",
      "authors",
      "tags",
      "categories",
      "image",
      "enclosure",
      "attachments",
      "language",
    ]);
    text(item.id, 2048);
    text(item.title);
    if (ids.has(item.id)) throw new TypeError("Duplicate feed item ID");
    ids.add(item.id);
    const v: FeedItem = { ...item, url: safeFeedUrl(item.url) };
    for (const key of ["description", "contentText", "contentHtml"] as const)
      if (item[key] !== undefined) text(item[key], 1048576, true);
    if (item.atomId !== undefined) text(item.atomId, 2048);
    if (item.date !== undefined) v.date = date(item.date);
    if (item.updated !== undefined) v.updated = date(item.updated);
    if (item.image !== undefined) v.image = safeFeedUrl(item.image);
    if (item.language !== undefined) v.language = language(item.language);
    if (item.author !== undefined) {
      text(item.author, 512);
      if (item.authors !== undefined)
        throw new TypeError("Use author or authors");
    }
    v.authors = normalizeAuthors(item.authors);
    normalizeCategories(v);
    if (item.enclosure !== undefined && item.attachments !== undefined)
      throw new TypeError("Use enclosure or attachments");
    if (item.enclosure !== undefined) v.enclosure = attachment(item.enclosure);
    if (item.attachments !== undefined) {
      array(item.attachments, 16);
      v.attachments = item.attachments.map(attachment);
    }
    bytes += Buffer.byteLength(JSON.stringify(v));
    if (bytes > 16777216) throw new RangeError("Feed input byte limit");
    normalized.items.push(v);
  }
  return normalized;
}
export function validate(options: FeedOptions): void {
  normalizeFeed(options);
}
export function updated(options: FeedOptions): string {
  options = normalizeFeed(options);
  const dates = [
    date(options.updated),
    ...options.items.map((i) => date(i.updated ?? i.date)),
  ].filter((v): v is string => !!v);
  return dates.sort().at(-1) ?? new Date(0).toISOString();
}
export function finishFeed(body: string, options: FeedOptions) {
  if (
    !Number.isSafeInteger(options.maxBytes ?? 8388608) ||
    (options.maxBytes ?? 8388608) < 256 ||
    (options.maxBytes ?? 8388608) > 67108864
  )
    throw new RangeError("Feed output policy limit");
  if (Buffer.byteLength(body) > (options.maxBytes ?? 8388608))
    throw new RangeError("Feed output byte limit");
  return body;
}
export function atomId(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Atom ID must be an absolute HTTP(S), urn or tag IRI");
  }
  if (
    !["http:", "https:", "urn:", "tag:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    /[\x00-\x20\x7f]/.test(value)
  )
    throw new TypeError("Invalid Atom ID");
  return value;
}
