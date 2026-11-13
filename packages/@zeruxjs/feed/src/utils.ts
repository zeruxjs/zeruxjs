import type {
  FeedOptions,
  FeedItem,
  FeedAuthor,
  FeedAttachment,
  FeedCategory,
} from './types.js';
/**
 * Encode XML text/attribute contexts without claiming HTML sanitization or script encoding.
 *
 * @param {string} value - Authored text; direct calls coerce to string and strip disallowed XML controls.
 * @returns {string} Text with XML delimiters/whitespace encoded; separate normalization validates Unicode, and decoded HTML remains untrusted.
 */
export const escapeXml = (value: string): string =>
  String(value)
    // eslint-disable-next-line no-control-regex -- Strip unsupported XML controls on direct calls; generator normalization rejects them.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\t/g, '&#x9;')
    .replace(/\r/g, '&#xD;')
    .replace(/\n/g, '&#xA;');
/** Require only declared own data properties on a normal/null-prototype record. This rejects accessors but does not sandbox application Proxy traps.
 * @param {unknown} v - Candidate private record/value or already detached normalization node; never executable source.
 * @param {readonly string[]} keys - Explicit server-owned field allowlist; user input cannot extend the schema.
 * @returns {void} Narrows the record on success; unsupported keys/prototypes/descriptors throw before serialization.
 * @throws {TypeError} When prototype, keys or own data descriptors violate the declared record schema.
 */
function record(
  v: unknown,
  keys: readonly string[]
): asserts v is Record<string, any> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).some(
      (k) =>
        typeof k !== 'string' ||
        !keys.includes(k) ||
        !('value' in Object.getOwnPropertyDescriptor(v, k)!)
    )
  ) {
    throw new TypeError('Invalid feed fields');
  }
}
/** Check a string budget and XML-compatible Unicode without interpreting its content as markup.
 * @param {unknown} v - Candidate private record/value or already detached normalization node; never executable source.
 * @param {number} max - Finite UTF-16 string or collection ceiling; text defaults to 4096 code units.
 * @param {boolean} empty - Default false; true permits empty body/summary strings without weakening Unicode validation.
 * @returns {void} String satisfies its UTF-16 code-unit/empty/Unicode policy; invalid input throws.
 * @throws {TypeError} When type, empty policy, UTF-16 length or XML-compatible Unicode checks fail.
 */
function text(v: unknown, max = 4096, empty = false): asserts v is string {
  if (
    typeof v !== 'string' ||
    (!empty && !v) ||
    v.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      v
    )
  ) {
    throw new TypeError('Invalid feed text');
  }
}
/** Require a dense plain array with only indexed data values and its length property.
 * @template T
 * @param {readonly T[]} value - Explicit authored value; context-specific validation does not authenticate a URL or person.
 * @param {number} max - Finite UTF-16 string or collection ceiling; text defaults to 4096 code units.
 * @returns {void} Collection satisfies the finite cardinality/descriptor policy; sparse/accessor/extended arrays reject.
 * @throws {TypeError | RangeError} When density, own data descriptors, plain-array shape or the count ceiling fails.
 */
function array<T>(value: readonly T[], max: number): void {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new RangeError('Feed collection limit');
  }
  // Check every indexed own data descriptor so holes/accessors cannot bypass the collection bound.
  for (let i = 0; i < value.length; i++) {
    if (
      !('value' in (Object.getOwnPropertyDescriptor(value, String(i)) ?? {}))
    ) {
      throw new TypeError('Feed accessors/sparse arrays denied');
    }
  }
}
/** Canonicalize only credential-free absolute HTTP(S) URLs; this never fetches or grants access.
 * @param {string} value - Explicit authored value; context-specific validation does not authenticate a URL or person.
 * @returns {string} Canonical URL href; whitespace, backslashes, unsupported schemes and credentials reject.
 * @throws {TypeError} When text, absolute HTTP(S) syntax or credential/whitespace policy fails.
 */
export function safeFeedUrl(value: string): string {
  text(value, 8192);
  // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
  if (/[\x00-\x20\x7f\\]/.test(value)) {
    throw new TypeError('Invalid feed URL');
  }
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new TypeError('Invalid feed URL');
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    throw new TypeError('Invalid feed URL');
  }
  return u.href;
}
/** Normalize only valid Date or supported ISO calendar/RFC3339 input into UTC without rollover.
 * @param {string | Date} value - Explicit authored value; context-specific validation does not authenticate a URL or person.
 * @returns {string | undefined} UTC ISO timestamp or undefined for absent facts; never substitutes generation time.
 * @throws {TypeError} When authored input is invalid, ambiguous, rolls over or lies outside supported years.
 */
export function date(value?: string | Date): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let d: Date;
  if (value instanceof Date) {
    d = new Date(Date.prototype.getTime.call(value));
  } else {
    if (
      typeof value !== 'string' ||
      value.length > 64 ||
      !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d))?$/.test(
        value
      )
    ) {
      throw new TypeError('Invalid feed date');
    }
    /** Explicit calendar year used to reject impossible dates before native parsing can roll them forward. */
    const year = Number(value.slice(0, 4));
    /** One-based calendar month checked against the explicit month-day table. */
    const month = Number(value.slice(5, 7));
    /** Explicit calendar day checked before constructing the native Date. */
    const day = Number(value.slice(8, 10));
    /** Gregorian month lengths with the actual leap-year rule; no generation-time date facts. */
    const days = [
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
    /** Maximum valid day for the selected Gregorian month. */
    const maxDay = days[month - 1];
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      maxDay === undefined ||
      day > maxDay ||
      (value.length > 10 &&
        (Number(value.slice(11, 13)) > 23 ||
          Number(value.slice(14, 16)) > 59 ||
          Number(value.slice(17, 19)) > 59))
    ) {
      throw new TypeError('Invalid feed date');
    }
    d = new Date(value);
  }
  if (
    !Number.isFinite(d.getTime()) ||
    d.getUTCFullYear() < 0 ||
    d.getUTCFullYear() > 9999
  ) {
    throw new TypeError('Invalid feed date');
  }
  return d.toISOString();
}
/** Canonicalize the explicit bounded BCP 47 language through native Intl.
 * @param {string} value - Explicit authored value; context-specific validation does not authenticate a URL or person.
 * @returns {string} Canonical locale tag; invalid syntax rejects instead of inventing language metadata.
 * @throws {TypeError | RangeError} When bounded string or native BCP 47 syntax validation fails.
 */
function language(value: string) {
  text(value, 64);
  return (
    Intl.getCanonicalLocales(value)[0] ??
    (() => {
      throw new TypeError('Invalid feed language');
    })()
  );
}
/** Select structured authors or wrap the compatible single name without validating or cloning records.
 * @param {{ author?: string; authors?: FeedAuthor[]; }} item - Explicit item/helper projection; no remote resource ownership or mutation is acquired.
 * @param {string} item.author - Compatible single authored name; ignored when structured authors exist.
 * @param {FeedAuthor[]} item.authors - Borrowed ordered structured author records; this selector does not validate them.
 * @returns {FeedAuthor[]} Borrowed structured list or a legacy wrapper; generators validate before calling this low-level helper.
 */
export function authors(item: {
  /** Compatible single author name; structured author selection takes precedence in this helper. */
  author?: string;
  /** Explicit ordered structured authors, borrowed by the selection helper. */
  authors?: FeedAuthor[];
}): FeedAuthor[] {
  return item.authors ?? (item.author ? [{ name: item.author }] : []);
}
/** Select structured attachments or wrap the compatible enclosure without fetching its URL.
 * @param {FeedItem} item - Explicit item/helper projection; no remote resource ownership or mutation is acquired.
 * @returns {FeedAttachment[]} Borrowed structured list or legacy wrapper; independent metadata validation stays with normalization.
 */
export function attachments(item: FeedItem): FeedAttachment[] {
  return item.attachments ?? (item.enclosure ? [item.enclosure] : []);
}
/** Append structured categories after compatible ordered tags without deduplication or validation.
 * @param {{ tags?: string[]; categories?: FeedCategory[]; }} item - Explicit item/helper projection; no remote resource ownership or mutation is acquired.
 * @param {string[]} item.tags - Compatible ordered terms, mapped to new term-only records.
 * @param {FeedCategory[]} item.categories - Borrowed structured records appended after tags.
 * @returns {FeedCategory[]} New outer array; existing structured category records remain borrowed until normalization.
 */
export function categories(item: {
  /** Compatible ordered category terms; normalization applies separate string/count budgets. */
  tags?: string[];
  /** Ordered structured category records; helper selection does not validate or clone them. */
  categories?: FeedCategory[];
}): FeedCategory[] {
  return [
    ...(item.tags ?? []).map((term) => ({ term })),
    ...(item.categories ?? []),
  ];
}
/** Validate and clone a finite author list, canonicalizing explicit URL facts without remote lookup.
 * @param {FeedAuthor[] | undefined} values - Optional ordered author records, at most 32, with no inferred inheritance facts.
 * @returns {FeedAuthor[] | undefined} Validated cloned records or undefined for absent authors; no inferred person facts.
 * @throws {TypeError | RangeError} When a person record, mailbox, URL or author count violates normalization.
 */
function normalizeAuthors(
  values: FeedAuthor[] | undefined
): FeedAuthor[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  array(values, 32);
  return values.map((v) => {
    record(v, ['name', 'url', 'email', 'avatar']);
    text(v.name, 512);
    if (v.email !== undefined) {
      text(v.email, 254);
      if (!/^[^\s@<>,;]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(v.email)) {
        throw new TypeError('Invalid author email');
      }
    }
    return {
      ...v,
      ...(v.url !== undefined ? { url: safeFeedUrl(v.url) } : {}),
      ...(v.avatar !== undefined ? { avatar: safeFeedUrl(v.avatar) } : {}),
    };
  });
}
/** Validate ordered tags/categories and replace only this candidate object's structured categories with clones.
 * @param {{ tags?: string[]; categories?: FeedCategory[]; }} input - Detached candidate taxonomy object; direct callers own any mutation of its categories field.
 * @param {string[]} input.tags - Ordered terms checked against the count/string budgets.
 * @param {FeedCategory[]} input.categories - Structured records replaced with validated clones on this candidate.
 * @returns {void} Candidate taxonomy normalized; callers pass detached candidates to preserve source records.
 * @throws {TypeError | RangeError} When term/label/URL/count/record validation fails.
 */
function normalizeCategories(input: {
  /** Compatible ordered category terms; normalization applies separate string/count budgets. */
  tags?: string[];
  /** Ordered structured category records; helper selection does not validate or clone them. */
  categories?: FeedCategory[];
}) {
  if (input.tags !== undefined) {
    array(input.tags, 100);
    input.tags.forEach((v) => text(v, 512));
  }
  if (input.categories !== undefined) {
    array(input.categories, 100);
    input.categories = input.categories.map((v) => {
      record(v, ['term', 'scheme', 'label']);
      text(v.term, 512);
      if (v.label !== undefined) {
        text(v.label, 512);
      }
      return {
        ...v,
        ...(v.scheme !== undefined ? { scheme: safeFeedUrl(v.scheme) } : {}),
      };
    });
  }
}
/** Validate one inert enclosure record, its byte/duration budgets and literal MIME syntax.
 * @param {FeedAttachment} v - Candidate private record/value or already detached normalization node; never executable source.
 * @returns {FeedAttachment} Cloned metadata with canonical HTTP(S) URL; no file is opened or fetched.
 * @throws {TypeError | RangeError} When URL/MIME/text syntax or byte/duration metadata is invalid.
 */
function attachment(v: FeedAttachment): FeedAttachment {
  record(v, ['url', 'type', 'length', 'title', 'duration']);
  if (!Number.isSafeInteger(v.length) || v.length < 0) {
    throw new RangeError('Invalid enclosure length');
  }
  if (
    typeof v.type !== 'string' ||
    !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(v.type) ||
    v.type.length > 128
  ) {
    throw new TypeError('Invalid attachment MIME');
  }
  if (v.title !== undefined) {
    text(v.title, 512);
  }
  if (
    v.duration !== undefined &&
    (typeof v.duration !== 'number' ||
      !Number.isFinite(v.duration) ||
      v.duration < 0 ||
      v.duration > 315360000)
  ) {
    throw new RangeError('Invalid duration');
  }
  return { ...v, url: safeFeedUrl(v.url) };
}
/** Stage a detached bounded publication candidate before serialization, preserving authored order and exact logical identity.
 * @param {FeedOptions} options - Content-owned public feed facts and explicit normalization/output policy; no request identity inferred.
 * @returns {FeedOptions} Mutable validated clone with canonical dates/URLs/languages and explicit budgets; invalid input never partially updates a registry.
 * @throws {TypeError | RangeError} When a staged record, identity, date, metadata or finite policy budget is invalid.
 */
export function normalizeFeed(options: FeedOptions): FeedOptions {
  record(options, [
    'title',
    'description',
    'siteUrl',
    'feedUrl',
    'id',
    'language',
    'copyright',
    'image',
    'updated',
    'items',
    'authors',
    'tags',
    'categories',
    'strict',
    'maxItems',
    'maxBytes',
  ]);
  /** Validated direct-generator cardinality ceiling; excess items reject instead of truncating. */
  const maxItems = options.maxItems ?? 10000;
  /** Validated returned UTF-8 byte ceiling, separate from input/cardinality/heap costs. */
  const maxBytes = options.maxBytes ?? 8388608;
  if (
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 10000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 256 ||
    maxBytes > 67108864
  ) {
    throw new RangeError('Feed policy limit');
  }
  if (options.strict !== undefined && typeof options.strict !== 'boolean') {
    throw new TypeError('Invalid strict mode');
  }
  text(options.title);
  text(options.description, 65536);
  array(options.items, maxItems);
  /** Detached candidate publication; no source registry is mutated before validation completes. */
  const normalized: FeedOptions = {
    ...options,
    siteUrl: safeFeedUrl(options.siteUrl),
    items: [],
    maxItems,
    maxBytes,
  };
  // Canonicalize only the two declared feed discovery/media URL fields, without fetching either.
  for (const key of ['feedUrl', 'image'] as const) {
    if (options[key] !== undefined) {
      normalized[key] = safeFeedUrl(options[key]!);
    }
  }
  if (options.id !== undefined) {
    text(options.id, 2048);
  }
  if (options.copyright !== undefined) {
    text(options.copyright, 4096);
  }
  if (options.language !== undefined) {
    normalized.language = language(options.language);
  }
  if (options.updated !== undefined) {
    normalized.updated = date(options.updated);
  }
  normalized.authors = normalizeAuthors(options.authors);
  normalizeCategories(normalized);
  /** Case-sensitive logical item identity set; duplicate public IDs reject before output. */
  const ids = new Set<string>();
  let bytes = 0;
  // Stage each bounded item and reject duplicate identities before returning a normalized candidate.
  for (let n = 0; n < options.items.length; n++) {
    /** Original selected item record; own data properties are checked before cloning. */
    const item = options.items[n];
    record(item, [
      'id',
      'atomId',
      'title',
      'url',
      'description',
      'contentText',
      'contentHtml',
      'date',
      'updated',
      'author',
      'authors',
      'tags',
      'categories',
      'image',
      'enclosure',
      'attachments',
      'language',
    ]);
    text(item.id, 2048);
    text(item.title);
    if (ids.has(item.id)) {
      throw new TypeError('Duplicate feed item ID');
    }
    ids.add(item.id);
    /** Detached validated item candidate; all nested normalization writes remain private to this candidate. */
    const v: FeedItem = { ...item, url: safeFeedUrl(item.url) };
    // Validate each present summary/plain/HTML field without treating HTML as executable or sanitized.
    for (const key of ['description', 'contentText', 'contentHtml'] as const) {
      if (item[key] !== undefined) {
        text(item[key], 1048576, true);
      }
    }
    if (item.atomId !== undefined) {
      text(item.atomId, 2048);
    }
    if (item.date !== undefined) {
      v.date = date(item.date);
    }
    if (item.updated !== undefined) {
      v.updated = date(item.updated);
    }
    if (item.image !== undefined) {
      v.image = safeFeedUrl(item.image);
    }
    if (item.language !== undefined) {
      v.language = language(item.language);
    }
    if (item.author !== undefined) {
      text(item.author, 512);
      if (item.authors !== undefined) {
        throw new TypeError('Use author or authors');
      }
    }
    v.authors = normalizeAuthors(item.authors);
    normalizeCategories(v);
    if (item.enclosure !== undefined && item.attachments !== undefined) {
      throw new TypeError('Use enclosure or attachments');
    }
    if (item.enclosure !== undefined) {
      v.enclosure = attachment(item.enclosure);
    }
    if (item.attachments !== undefined) {
      array(item.attachments, 16);
      v.attachments = item.attachments.map(attachment);
    }
    bytes += Buffer.byteLength(JSON.stringify(v));
    if (bytes > 16777216) {
      throw new RangeError('Feed input byte limit');
    }
    normalized.items.push(v);
  }
  return normalized;
}
/** Validate through the same staged normalization as generators without retaining its returned clone.
 * @param {FeedOptions} options - Content-owned public feed facts and explicit normalization/output policy; no request identity inferred.
 * @returns {void} Content and budgets satisfy normalization; format-specific Atom/RSS rules remain with their generators.
 * @throws {TypeError | RangeError} When the same staged generator normalization rejects public input.
 */
export function validate(options: FeedOptions): void {
  normalizeFeed(options);
}
/** Choose the maximum known normalized feed/item update fact, retaining the legacy deterministic epoch fallback.
 * @param {FeedOptions} options - Content-owned public feed facts and explicit normalization/output policy; no request identity inferred.
 * @returns {string} UTC maximum timestamp or 1970 epoch when no authored date exists; fallback is not a real modification fact.
 * @throws {TypeError | RangeError} When publication normalization rejects input before selecting known dates.
 */
export function updated(options: FeedOptions): string {
  options = normalizeFeed(options);
  /** Known canonical UTC feed/item facts; lexical order matches chronological order after normalization. */
  const dates = [
    date(options.updated),
    ...options.items.map((i) => date(i.updated ?? i.date)),
  ].filter((v): v is string => !!v);
  return dates.sort().at(-1) ?? new Date(0).toISOString();
}
/** Enforce only the returned UTF-8 payload ceiling after serialization; this is not a markup validator or total-heap budget.
 * @param {string} body - Already serialized representation; raw HTML inside it still requires host/reader sanitization.
 * @param {FeedOptions} options - Content-owned public feed facts and explicit normalization/output policy; no request identity inferred.
 * @returns {string} Original body unchanged when within the explicit/default byte policy.
 * @throws {RangeError} When the output policy or serialized UTF-8 byte length exceeds its allowed range.
 */
export function finishFeed(body: string, options: FeedOptions) {
  if (
    !Number.isSafeInteger(options.maxBytes ?? 8388608) ||
    (options.maxBytes ?? 8388608) < 256 ||
    (options.maxBytes ?? 8388608) > 67108864
  ) {
    throw new RangeError('Feed output policy limit');
  }
  if (Buffer.byteLength(body) > (options.maxBytes ?? 8388608)) {
    throw new RangeError('Feed output byte limit');
  }
  return body;
}
/** Accept the narrow supported absolute Atom IRI schemes without rewriting the authored identity.
 * @param {string} value - Explicit authored value; context-specific validation does not authenticate a URL or person.
 * @returns {string} Original HTTP(S), urn or tag identity; credentials/control whitespace reject.
 * @throws {TypeError} When the authored identity is not a permitted credential-free absolute IRI.
 */
export function atomId(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Atom ID must be an absolute HTTP(S), urn or tag IRI');
  }
  if (
    !['http:', 'https:', 'urn:', 'tag:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x20\x7f]/.test(value)
  ) {
    throw new TypeError('Invalid Atom ID');
  }
  return value;
}
