import type {
  Catalog,
  CatalogLimits,
  Message,
  PluralCategory,
} from "./types.js";

/** Validate a positive bounded configuration integer. @param value Input. @param fallback Default. @param max Hard maximum. @returns Validated integer. No globals. */
export function bounded(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max)
    throw new RangeError("zlocale: invalid resource limit");
  return result;
}
/** Canonicalize a bounded BCP-47 locale. @param locale Locale string. @returns Canonical tag. Uses host Intl data only. */
export function canonicalLocale(locale: string): string {
  if (typeof locale !== "string" || locale.length < 1 || locale.length > 128)
    throw new TypeError("zlocale: invalid locale");
  return Intl.getCanonicalLocales(locale)[0]!;
}
/** Validate a text domain. @param domain Developer-selected domain. @returns Domain. No globals. */
export function validateDomain(domain: string): string {
  if (
    typeof domain !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(domain)
  )
    throw new TypeError("zlocale: invalid domain");
  return domain;
}
/** Read own data properties without invoking getters. @param value JSON-shaped object. @returns Own entries. No globals. */
export function dataEntries(value: unknown): [string, unknown][] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("zlocale: expected a plain data object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.values(descriptors).some((d) => !Object.hasOwn(d, "value"))
  )
    throw new TypeError(
      "zlocale: accessors and symbol properties are unsupported",
    );
  return Object.entries(descriptors)
    .filter(([, d]) => d.enumerable)
    .map(([key, d]) => [key, d.value]);
}
/** Validate and defensively copy a catalog atomically. @param input Plain catalog data. @param limits Optional bounds. @returns Deeply frozen catalog. Uses TextEncoder and Intl, no I/O. */
export function defineCatalog(
  input: unknown,
  limits: CatalogLimits = {},
): Catalog {
  const properties = new Map(dataEntries(input));
  if (
    [...properties.keys()].some(
      (k) => !["locale", "domain", "messages"].includes(k),
    )
  )
    throw new TypeError("zlocale: unknown catalog property");
  const locale = new Intl.Locale(
      canonicalLocale(properties.get("locale") as string),
    ).baseName,
    domain = validateDomain(properties.get("domain") as string);
  const maxMessages = bounded(limits.maxMessages, 20_000, 200_000),
    maxLength = bounded(limits.maxStringLength, 16_384, 1_000_000),
    maxBytes = bounded(limits.maxBytes, 4 * 1024 * 1024, 64 * 1024 * 1024);
  const entries = dataEntries(properties.get("messages"));
  if (entries.length > maxMessages)
    throw new RangeError("zlocale: catalog message limit exceeded");
  const encoder = new TextEncoder();
  let bytes = encoder.encode(locale + domain).length;
  const text = (value: unknown): string => {
    if (typeof value !== "string" || value.length > maxLength)
      throw new TypeError("zlocale: invalid or oversized catalog string");
    bytes += encoder.encode(value).length;
    if (bytes > maxBytes)
      throw new RangeError("zlocale: catalog byte limit exceeded");
    return value;
  };
  const messages: Record<string, Message> = Object.create(null);
  const categories = new Set(["zero", "one", "two", "few", "many", "other"]);
  for (const [key, value] of entries) {
    text(key);
    if (typeof value === "string") {
      messages[key] = text(value);
      continue;
    }
    const forms: Partial<Record<PluralCategory, string>> = Object.create(null);
    for (const [category, translation] of dataEntries(value)) {
      if (!categories.has(category))
        throw new TypeError("zlocale: unsupported plural category");
      forms[category as PluralCategory] = text(translation);
    }
    if (typeof forms.other !== "string")
      throw new TypeError("zlocale: plural message requires other");
    messages[key] = Object.freeze(forms) as Message;
  }
  return Object.freeze({ locale, domain, messages: Object.freeze(messages) });
}
