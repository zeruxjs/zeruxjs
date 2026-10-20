import type {
  Catalog,
  I18n,
  I18nOptions,
  Message,
  Translator,
} from "./types.js";
import {
  bounded,
  canonicalLocale,
  dataEntries,
  defineCatalog,
  validateDomain,
} from "./validation.js";
import { Lru } from "./cache.js";

/** Create an isolated synchronous translator/registry; importing this module initializes nothing.
 * @param options Locale, validated catalogs, limits and formatter settings.
 * @returns Application-owned i18n instance. Uses native Intl/TextEncoder only, no I/O or request globals.
 */
export function createI18n(options: I18nOptions = {}): I18n {
  let locale = canonicalLocale(options.locale ?? "en");
  const domain = validateDomain(options.domain ?? "default");
  if (
    options.fallbackLocales !== undefined &&
    (!Array.isArray(options.fallbackLocales) ||
      options.fallbackLocales.length > 8)
  )
    throw new RangeError("zlocale: too many fallback locales");
  const fallbacks = (options.fallbackLocales ?? ["en"]).map(canonicalLocale);
  const maxCatalogs = bounded(options.maxCatalogs, 64, 1024),
    formatters = new Lru<string, unknown>(
      bounded(options.formatterCacheSize, 64, 512),
    );
  const timeZone = options.timeZone ?? "UTC";
  // Validate configured timezone before any requests are served.
  new Intl.DateTimeFormat(locale, { timeZone });
  let catalogs = new Map<string, Catalog>();
  const listeners = new Set<() => void>();
  let notifying = false,
    pending = false;
  /** Notify subscribers after a committed update; contain reentrant loops and notify every listener.
   * @returns Nothing. Subscriber failures propagate together after other subscribers run. No globals.
   */
  const emit = () => {
    pending = true;
    if (notifying) return;
    notifying = true;
    const errors: unknown[] = [];
    try {
      let cycles = 0;
      while (pending) {
        if (++cycles > 100) throw new Error("zlocale: subscriber update loop");
        pending = false;
        for (const listener of [...listeners])
          if (listeners.has(listener))
            try {
              listener();
            } catch (error) {
              errors.push(error);
            }
      }
      if (errors.length)
        throw new AggregateError(errors, "zlocale: subscriber failure");
    } finally {
      notifying = false;
      pending = false;
    }
  };
  const catalogKey = (language: string, textDomain: string) =>
    language + "/" + textDomain;
  /** Build bounded parent/fallback lookup order. @param language Canonical locale. @returns Unique base locale chain. No globals. */
  const chainFor = (language: string) => {
    const result = new Set<string>();
    for (const requested of [language, ...fallbacks]) {
      let base = new Intl.Locale(requested).baseName;
      while (base) {
        result.add(base);
        const index = base.lastIndexOf("-");
        if (index < 0) break;
        base = base.slice(0, index);
      }
    }
    return [...result];
  };
  /** Validate JSON-like Intl options before stable cache-key creation. @param input Native Intl options. @returns Scalar own-property copy. No globals. */
  const cleanOptions = (input: object) => {
    const entries = dataEntries(input);
    if (entries.length > 32)
      throw new RangeError("zlocale: too many formatting options");
    const result: Record<string, string | number | boolean> =
      Object.create(null);
    for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      if (value === undefined) continue;
      if (
        key.length > 64 ||
        !(
          (typeof value === "string" && value.length <= 256) ||
          (typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "boolean"
        )
      )
        throw new TypeError("zlocale: invalid formatting option");
      result[key] = value;
    }
    return result;
  };
  /** Reuse a bounded formatter. @param kind Formatter namespace. @param language Canonical locale. @param settings Validated options. @param create Constructor callback. @returns Cached/new formatter. No globals. */
  const formatter = <T>(
    kind: string,
    language: string,
    settings: object,
    create: () => T,
  ): T => {
    const key = JSON.stringify([kind, language, settings]);
    const cached = formatters.get(key);
    if (cached !== undefined) return cached as T;
    const value = create();
    formatters.set(key, value);
    return value;
  };
  /** Create a locale-fixed translator over shared immutable catalogs. @param language Requested locale. @returns Fixed translator. No I/O or mutable process-wide locale. */
  const forLocale = (language: string): Translator => {
    const canonical = canonicalLocale(language),
      chain = chainFor(canonical);
    const plural = (language: string, count: number) =>
      formatter(
        "plural",
        language,
        {},
        () => new Intl.PluralRules(language),
      ).select(count);
    const lookup = (
      text: string,
      context: string | undefined,
      textDomain = domain,
      count?: number,
    ): string | undefined => {
      if (
        typeof text !== "string" ||
        text.length > 16_384 ||
        (context !== undefined &&
          (typeof context !== "string" || context.length > 16_384))
      )
        throw new TypeError("zlocale: invalid message/context");
      validateDomain(textDomain);
      const key = context === undefined ? text : context + "\u0004" + text;
      for (const candidate of chain) {
        const entry = catalogs.get(catalogKey(candidate, textDomain))?.messages[
          key
        ];
        if (entry === undefined) continue;
        if (typeof entry === "string") return entry;
        return (
          entry[count === undefined ? "other" : plural(candidate, count)] ??
          entry.other
        );
      }
      return undefined;
    };
    const countValue = (count: number) => {
      if (typeof count !== "number" || !Number.isFinite(count))
        throw new TypeError("zlocale: count must be finite");
      return count;
    };
    return Object.freeze({
      getLocale: () => canonical,
      __: (text: string, textDomain?: string) =>
        lookup(text, undefined, textDomain) ?? text,
      _x: (text: string, context: string, textDomain?: string) =>
        lookup(text, context, textDomain) ?? text,
      _n: (
        single: string,
        multiple: string,
        count: number,
        textDomain?: string,
      ) => {
        countValue(count);
        if (typeof multiple !== "string" || multiple.length > 16_384)
          throw new TypeError("zlocale: invalid plural source");
        return (
          lookup(single, undefined, textDomain, count) ??
          (count === 1 ? single : multiple)
        );
      },
      _nx: (
        single: string,
        multiple: string,
        count: number,
        context: string,
        textDomain?: string,
      ) => {
        countValue(count);
        if (typeof multiple !== "string" || multiple.length > 16_384)
          throw new TypeError("zlocale: invalid plural source");
        return (
          lookup(single, context, textDomain, count) ??
          (count === 1 ? single : multiple)
        );
      },
      hasTranslation: (text: string, context?: string, textDomain?: string) =>
        lookup(text, context, textDomain) !== undefined,
      isRTL: () => {
        const info = new Intl.Locale(canonical) as Intl.Locale & {
          getTextInfo?: () => { direction: string };
          textInfo?: { direction: string };
        };
        const direction =
          info.getTextInfo?.().direction ?? info.textInfo?.direction;
        return direction
          ? direction === "rtl"
          : [
              "Arab",
              "Hebr",
              "Thaa",
              "Nkoo",
              "Syrc",
              "Adlm",
              "Rohg",
              "Samr",
              "Mand",
            ].includes(info.maximize().script ?? "");
      },
      formatNumber: (
        value: number | bigint,
        settings: Intl.NumberFormatOptions = {},
      ) => {
        if (
          typeof value !== "bigint" &&
          (typeof value !== "number" || !Number.isFinite(value))
        )
          throw new TypeError("zlocale: number must be finite or bigint");
        const clean = cleanOptions(settings);
        return formatter(
          "number",
          canonical,
          clean,
          () => new Intl.NumberFormat(canonical, clean),
        ).format(value);
      },
      formatDateTime: (
        value: Date | number,
        settings: Intl.DateTimeFormatOptions = {},
      ) => {
        const timestamp = value instanceof Date ? value.getTime() : value;
        if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
          throw new TypeError("zlocale: invalid date");
        const clean = { timeZone, ...cleanOptions(settings) };
        return formatter(
          "date",
          canonical,
          clean,
          () => new Intl.DateTimeFormat(canonical, clean),
        ).format(timestamp);
      },
      formatRelativeTime: (
        value: number,
        unit: Intl.RelativeTimeFormatUnit,
        settings: Intl.RelativeTimeFormatOptions = {},
      ) => {
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new TypeError("zlocale: relative time must be finite");
        const clean = cleanOptions(settings);
        return formatter(
          "relative",
          canonical,
          clean,
          () => new Intl.RelativeTimeFormat(canonical, clean),
        ).format(value, unit);
      },
      formatList: (
        values: readonly string[],
        settings: Intl.ListFormatOptions = {},
      ) => {
        if (
          !Array.isArray(values) ||
          values.length > 1000 ||
          values.some(
            (value) => typeof value !== "string" || value.length > 16_384,
          )
        )
          throw new TypeError("zlocale: invalid list");
        const clean = cleanOptions(settings);
        return formatter(
          "list",
          canonical,
          clean,
          () => new Intl.ListFormat(canonical, clean),
        ).format(values);
      },
    });
  };
  let current = forLocale(locale);
  const registerCatalogs = (
    inputs: readonly Catalog[],
    settings: { replace?: boolean } = {},
  ) => {
    if (!Array.isArray(inputs) || inputs.length > maxCatalogs)
      throw new RangeError("zlocale: invalid catalog batch");
    // Validate/copy the entire batch before mutating the live registry.
    const prepared = inputs.map((input) =>
        defineCatalog(input, options.limits),
      ),
      next = new Map(catalogs),
      seen = new Set<string>();
    for (const catalog of prepared) {
      const key = catalogKey(catalog.locale, catalog.domain);
      if (seen.has(key) || (next.has(key) && !settings.replace))
        throw new Error("zlocale: duplicate catalog; use replace explicitly");
      seen.add(key);
      next.set(key, catalog);
    }
    if (next.size > maxCatalogs)
      throw new RangeError("zlocale: registry catalog limit exceeded");
    if (!inputs.length) return;
    catalogs = next;
    emit();
  };
  if (options.catalogs) registerCatalogs(options.catalogs);
  // Dynamic methods delegate to the current view. Fixed request views never use this mutable pointer.
  const dynamic: Translator = {
    getLocale: () => current.getLocale(),
    __: (...args) => current.__(...args),
    _x: (...args) => current._x(...args),
    _n: (...args) => current._n(...args),
    _nx: (...args) => current._nx(...args),
    hasTranslation: (...args) => current.hasTranslation(...args),
    isRTL: () => current.isRTL(),
    formatNumber: (...args) => current.formatNumber(...args),
    formatDateTime: (...args) => current.formatDateTime(...args),
    formatRelativeTime: (...args) => current.formatRelativeTime(...args),
    formatList: (...args) => current.formatList(...args),
  };
  return Object.freeze({
    ...dynamic,
    forLocale,
    registerCatalogs,
    setLocale(next: string) {
      const normalized = canonicalLocale(next);
      if (locale === normalized) return;
      const view = forLocale(normalized);
      locale = normalized;
      current = view;
      emit();
    },
    getCatalog(language: string, textDomain = domain) {
      return catalogs.get(
        catalogKey(
          new Intl.Locale(canonicalLocale(language)).baseName,
          validateDomain(textDomain),
        ),
      );
    },
    removeCatalog(language: string, textDomain = domain) {
      const removed = catalogs.delete(
        catalogKey(
          new Intl.Locale(canonicalLocale(language)).baseName,
          validateDomain(textDomain),
        ),
      );
      if (removed) emit();
      return removed;
    },
    subscribe(listener: () => void) {
      if (typeof listener !== "function")
        throw new TypeError("zlocale: subscriber must be a function");
      if (listeners.size >= 1000)
        throw new RangeError("zlocale: subscriber limit exceeded");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
