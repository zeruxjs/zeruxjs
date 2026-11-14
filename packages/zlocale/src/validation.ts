import { validateMessagePlaceholders } from './placeholders.js';
import type {
  Catalog,
  CatalogLimits,
  Message,
  PluralCategory,
} from './types.js';

/** Validate a positive bounded configuration integer.
 * @param {number | undefined} value - Inert candidate or configured scalar inspected without code evaluation.
 * @param {number} fallback - Trusted default used only when the configured value is undefined.
 * @param {number} max - Hard supported upper bound independent of caller preference.
 * @returns {number} Validated integer. No globals.
 */
export function bounded(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  /** Validated configured integer, defaulted only when undefined. */
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) {
    throw new RangeError('zlocale: invalid resource limit');
  }
  return result;
}
/** Canonicalize a bounded BCP-47 locale.
 * @param {string} locale - Explicit bounded BCP-47 locale validated through native Intl.
 * @returns {string} Canonical tag. Uses host Intl data only.
 */
export function canonicalLocale(locale: string): string {
  if (typeof locale !== 'string' || locale.length < 1 || locale.length > 128) {
    throw new TypeError('zlocale: invalid locale');
  }
  return Intl.getCanonicalLocales(locale)[0]!;
}
/** Validate a text domain.
 * @param {string} domain - Developer-selected bounded exact text domain.
 * @returns {string} Domain. No globals.
 */
export function validateDomain(domain: string): string {
  if (
    typeof domain !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(domain)
  ) {
    throw new TypeError('zlocale: invalid domain');
  }
  return domain;
}
/** Read own data properties without invoking getters.
 * @param {unknown} value - Inert candidate or configured scalar inspected without code evaluation.
 * @returns {[string, unknown][]} Own entries. No globals.
 */
export function dataEntries(value: unknown): [string, unknown][] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError('zlocale: expected a plain data object');
  }
  /** Own data descriptors inspected before values can enter translation registries. */
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.values(descriptors).some((d) => !Object.hasOwn(d, 'value'))
  ) {
    throw new TypeError(
      'zlocale: accessors and symbol properties are unsupported'
    );
  }
  return Object.entries(descriptors)
    .filter(([, d]) => d.enumerable)
    .map(([key, d]) => [key, d.value]);
}
/** Validate and defensively copy a catalog atomically.
 * @param {unknown} input - Inert JSON-shaped candidate validated before any registry/cache mutation.
 * @param {CatalogLimits} limits - Explicit catalog copy/string/message/byte budgets.
 * @returns {Catalog} Deeply frozen catalog. Uses TextEncoder and Intl, no I/O.
 */
export function defineCatalog(
  input: unknown,
  limits: CatalogLimits = {}
): Catalog {
  /** Own catalog envelope fields checked against the explicit JSON-shaped contract. */
  const properties = new Map(dataEntries(input));
  if (
    [...properties.keys()].some(
      (k) => !['locale', 'domain', 'messages'].includes(k)
    )
  ) {
    throw new TypeError('zlocale: unknown catalog property');
  }
  /** Canonical base locale; Unicode extensions do not create extra catalog identities. */
  const locale = new Intl.Locale(
    canonicalLocale(properties.get('locale') as string)
  ).baseName;
  /** Validated exact text domain, never converted into a request-selected path. */
  const domain = validateDomain(properties.get('domain') as string);
  /** Explicit bounded per-catalog message capacity. */
  const maxMessages = bounded(limits.maxMessages, 20_000, 200_000);
  /** Explicit bounded source/translation code-unit length. */
  const maxLength = bounded(limits.maxStringLength, 16_384, 1_000_000);
  /** Explicit bounded UTF-8 catalog text budget. */
  const maxBytes = bounded(limits.maxBytes, 4 * 1024 * 1024, 64 * 1024 * 1024);
  /** Own source message entries validated before installing anything. */
  const entries = dataEntries(properties.get('messages'));
  if (entries.length > maxMessages) {
    throw new RangeError('zlocale: catalog message limit exceeded');
  }
  /** Native UTF-8 counter used while copying bounded catalog text. */
  const encoder = new TextEncoder();
  let bytes = encoder.encode(locale + domain).length;
  /** Validate one source/value string and account its bytes before copying.
   * @param {unknown} value - Inert source/translation candidate.
   * @returns {string} Validated unchanged text; it is never interpreted as HTML or code.
   */
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > maxLength) {
      throw new TypeError('zlocale: invalid or oversized catalog string');
    }
    bytes += encoder.encode(value).length;
    if (bytes > maxBytes) {
      throw new RangeError('zlocale: catalog byte limit exceeded');
    }
    return value;
  };
  /** Prototype-free copied translation map frozen before registry use. */
  const messages: Record<string, Message> = Object.create(null);
  /** Only supported native cardinal categories are accepted. */
  const categories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
  for (const [key, value] of entries) {
    text(key);
    if (typeof value === 'string') {
      validateMessagePlaceholders(key.split('\u0004').at(-1)!, value);
      messages[key] = text(value);
      continue;
    }
    /** One copied plural record; mandatory other preserves deterministic fallback. */
    const forms: Partial<Record<PluralCategory, string>> = Object.create(null);
    for (const [category, translation] of dataEntries(value)) {
      if (!categories.has(category)) {
        throw new TypeError('zlocale: unsupported plural category');
      }
      /** Validated inert plural text checked against source placeholder identities. */
      const translated = text(translation);
      validateMessagePlaceholders(key.split('\u0004').at(-1)!, translated);
      forms[category as PluralCategory] = translated;
    }
    if (typeof forms.other !== 'string') {
      throw new TypeError('zlocale: plural message requires other');
    }
    messages[key] = Object.freeze(forms) as Message;
  }
  return Object.freeze({ locale, domain, messages: Object.freeze(messages) });
}
