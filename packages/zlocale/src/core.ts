import type {
  Catalog,
  I18n,
  I18nOptions,
  Message,
  Translator,
} from './types.js';
import {
  bounded,
  canonicalLocale,
  dataEntries,
  defineCatalog,
  validateDomain,
} from './validation.js';
import { Lru } from './cache.js';

/** Create an isolated synchronous translator/registry; importing this module initializes nothing.
 * @param {I18nOptions} options - Explicit owner policy; limits and native formatting choices are validated before use.
 * @returns {I18n} Application-owned i18n instance. Uses native Intl/TextEncoder only, no I/O or request globals.
 */
export function createI18n(options: I18nOptions = {}): I18n {
  let locale = canonicalLocale(options.locale ?? 'en');
  /** Fixed validated default domain; lookup never crosses domains implicitly. */
  const domain = validateDomain(options.domain ?? 'default');
  if (
    options.fallbackLocales !== undefined &&
    (!Array.isArray(options.fallbackLocales) ||
      options.fallbackLocales.length > 8)
  ) {
    throw new RangeError('zlocale: too many fallback locales');
  }
  /** Canonical explicit fallback locales, bounded before request-time lookup. */
  const fallbacks = (options.fallbackLocales ?? ['en']).map(canonicalLocale);
  /** Owner registry capacity, validated independently of any catalog content. */
  const maxCatalogs = bounded(options.maxCatalogs, 64, 1024);
  /** Per-owner bounded Intl formatter LRU; no process-global cache is created. */
  const formatters = new Lru<string, unknown>(
    bounded(options.formatterCacheSize, 64, 512)
  );
  /** Explicit default formatting zone validated before serving requests. */
  const timeZone = options.timeZone ?? 'UTC';
  // Validate configured timezone before any requests are served.
  new Intl.DateTimeFormat(locale, { timeZone });
  let catalogs = new Map<string, Catalog>();
  /** Bounded synchronous application subscribers; each owns its unsubscribe function. */
  const listeners = new Set<() => void>();
  let notifying = false,
    pending = false;
  /** Notify subscribers after a committed update; contain reentrant loops and notify every listener.
   * @returns {void} Nothing. Subscriber failures propagate together after other subscribers run. No globals.
   */
  const emit = () => {
    pending = true;
    if (notifying) {
      return;
    }
    notifying = true;
    /** Private subscriber failures collected after committed updates while other listeners still run. */
    const errors: unknown[] = [];
    try {
      let cycles = 0;
      while (pending) {
        if (++cycles > 100) {
          throw new Error('zlocale: subscriber update loop');
        }
        pending = false;
        for (const listener of [...listeners]) {
          if (listeners.has(listener)) {
            try {
              listener();
            } catch (error) {
              errors.push(error);
            }
          }
        }
      }
      if (errors.length) {
        throw new AggregateError(errors, 'zlocale: subscriber failure');
      }
    } finally {
      notifying = false;
      pending = false;
    }
  };
  /** Compose only validated locale/domain identities for local registry lookup.
   * @param {string} language - Canonical base locale.
   * @param {string} textDomain - Validated exact domain.
   * @returns {string} Local registry identity, never a filename/URL to fetch.
   */
  const catalogKey = (language: string, textDomain: string) =>
    language + '/' + textDomain;
  /** Build bounded parent/fallback lookup order.
   * @param {string} language - Canonical locale selected by the host, never a file or URL to load.
   * @returns {string[]} Unique base locale chain. No globals.
   */
  const chainFor = (language: string) => {
    /** New local lookup/options collection; caller-owned inputs are not mutated. */
    const result = new Set<string>();
    for (const requested of [language, ...fallbacks]) {
      let base = new Intl.Locale(requested).baseName;
      while (base) {
        result.add(base);
        /** Parent-locale truncation boundary; lookup preserves explicit fallback order. */
        const index = base.lastIndexOf('-');
        if (index < 0) {
          break;
        }
        base = base.slice(0, index);
      }
    }
    return [...result];
  };
  /** Validate JSON-like Intl options before stable cache-key creation.
   * @param {object} input - Inert JSON-shaped candidate validated before any registry/cache mutation.
   * @returns {Record<string, string | number | boolean>} Scalar own-property copy. No globals.
   */
  const cleanOptions = (input: object) => {
    /** Own scalar options inspected before stable formatter cache key creation. */
    const entries = dataEntries(input);
    if (entries.length > 32) {
      throw new RangeError('zlocale: too many formatting options');
    }
    /** New local lookup/options collection; caller-owned inputs are not mutated. */
    const result: Record<string, string | number | boolean> =
      Object.create(null);
    for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      if (value === undefined) {
        continue;
      }
      if (
        key.length > 64 ||
        !(
          (typeof value === 'string' && value.length <= 256) ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          typeof value === 'boolean'
        )
      ) {
        throw new TypeError('zlocale: invalid formatting option');
      }
      result[key] = value;
    }
    return result;
  };
  /** Reuse a bounded formatter.
   * @param {string} kind - Fixed internal formatter namespace.
   * @param {string} language - Canonical locale selected by the host, never a file or URL to load.
   * @param {object} settings - Own bounded scalar native options used consistently for caching and construction.
   * @param {() => T} create - Trusted native formatter constructor callback; invoked only on a local cache miss.
   * @returns {T} Cached/new formatter. No globals.
   */
  const formatter = <T>(
    kind: string,
    language: string,
    settings: object,
    create: () => T
  ): T => {
    /** Validated catalog/context/formatter identity used only in this owner's maps. */
    const key = JSON.stringify([kind, language, settings]);
    /** Existing bounded formatter instance; native options were validated at construction. */
    const cached = formatters.get(key);
    if (cached !== undefined) {
      return cached as T;
    }
    /** Fresh native formatter created only on a cache miss. */
    const value = create();
    formatters.set(key, value);
    return value;
  };
  /** Create a locale-fixed translator over shared immutable catalogs.
   * @param {string} language - Canonical locale selected by the host, never a file or URL to load.
   * @returns {Translator} Fixed translator. No I/O or mutable process-wide locale.
   */
  const forLocale = (language: string): Translator => {
    /** Fixed canonical locale captured by this view; shared setLocale never changes it. */
    const canonical = canonicalLocale(language);
    /** Deduplicated requested-parent-fallback lookup order captured for this fixed view. */
    const chain = chainFor(canonical);
    /** Use native cardinal rules for the catalog locale that actually supplied the message.
     * @param {string} language - Matched catalog locale.
     * @param {number} count - Already validated finite plural count.
     * @returns {Intl.LDMLPluralRule} Native cardinal category for this catalog.
     */
    const plural = (language: string, count: number) =>
      formatter(
        'plural',
        language,
        {},
        () => new Intl.PluralRules(language)
      ).select(count);
    /** Look up inert text through fixed locale/domain bounds without any loading.
     * @param {string} text - Bounded source singular key.
     * @param {string | undefined} context - Optional bounded disambiguation text.
     * @param {string} textDomain - Exact validated domain, defaulting to this owner.
     * @param {number} count - Optional validated finite plural count.
     * @returns {string | undefined} Installed inert translation or explicit absence.
     */
    const lookup = (
      text: string,
      context: string | undefined,
      textDomain = domain,
      count?: number
    ): string | undefined => {
      if (
        typeof text !== 'string' ||
        text.length > 16_384 ||
        (context !== undefined &&
          (typeof context !== 'string' || context.length > 16_384))
      ) {
        throw new TypeError('zlocale: invalid message/context');
      }
      validateDomain(textDomain);
      /** Validated catalog/context/formatter identity used only in this owner's maps. */
      const key = context === undefined ? text : context + '\u0004' + text;
      for (const candidate of chain) {
        /** Immutable registered message from one exact candidate locale/domain. */
        const entry = catalogs.get(catalogKey(candidate, textDomain))?.messages[
          key
        ];
        if (entry === undefined) {
          continue;
        }
        if (typeof entry === 'string') {
          return entry;
        }
        return (
          entry[count === undefined ? 'other' : plural(candidate, count)] ??
          entry.other
        );
      }
      return undefined;
    };
    /** Require a finite native count before plural rule evaluation.
     * @param {number} count - Caller plural count.
     * @returns {number} Validated finite count without coercion.
     */
    const countValue = (count: number) => {
      if (typeof count !== 'number' || !Number.isFinite(count)) {
        throw new TypeError('zlocale: count must be finite');
      }
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
        textDomain?: string
      ) => {
        countValue(count);
        if (typeof multiple !== 'string' || multiple.length > 16_384) {
          throw new TypeError('zlocale: invalid plural source');
        }
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
        textDomain?: string
      ) => {
        countValue(count);
        if (typeof multiple !== 'string' || multiple.length > 16_384) {
          throw new TypeError('zlocale: invalid plural source');
        }
        return (
          lookup(single, context, textDomain, count) ??
          (count === 1 ? single : multiple)
        );
      },
      hasTranslation: (text: string, context?: string, textDomain?: string) =>
        lookup(text, context, textDomain) !== undefined,
      isRTL: () => {
        /** Native locale direction metadata; fallback text does not select document direction. */
        const info = new Intl.Locale(canonical) as Intl.Locale & {
          getTextInfo?: () => { direction: string };
          textInfo?: { direction: string };
        };
        /** Native direction when exposed, otherwise an explicit maximized-script fallback is used. */
        const direction =
          info.getTextInfo?.().direction ?? info.textInfo?.direction;
        return direction
          ? direction === 'rtl'
          : [
              'Arab',
              'Hebr',
              'Thaa',
              'Nkoo',
              'Syrc',
              'Adlm',
              'Rohg',
              'Samr',
              'Mand',
            ].includes(info.maximize().script ?? '');
      },
      formatNumber: (
        value: number | bigint,
        settings: Intl.NumberFormatOptions = {}
      ) => {
        if (
          typeof value !== 'bigint' &&
          (typeof value !== 'number' || !Number.isFinite(value))
        ) {
          throw new TypeError('zlocale: number must be finite or bigint');
        }
        /** Own bounded scalar native options used consistently by cache and formatter. */
        const clean = cleanOptions(settings);
        return formatter(
          'number',
          canonical,
          clean,
          () => new Intl.NumberFormat(canonical, clean)
        ).format(value);
      },
      formatDateTime: (
        value: Date | number,
        settings: Intl.DateTimeFormatOptions = {}
      ) => {
        /** Native date milliseconds validated before formatting. */
        const timestamp = value instanceof Date ? value.getTime() : value;
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
          throw new TypeError('zlocale: invalid date');
        }
        /** Own bounded scalar native options used consistently by cache and formatter. */
        const clean = { timeZone, ...cleanOptions(settings) };
        return formatter(
          'date',
          canonical,
          clean,
          () => new Intl.DateTimeFormat(canonical, clean)
        ).format(timestamp);
      },
      formatRelativeTime: (
        value: number,
        unit: Intl.RelativeTimeFormatUnit,
        settings: Intl.RelativeTimeFormatOptions = {}
      ) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new TypeError('zlocale: relative time must be finite');
        }
        /** Own bounded scalar native options used consistently by cache and formatter. */
        const clean = cleanOptions(settings);
        return formatter(
          'relative',
          canonical,
          clean,
          () => new Intl.RelativeTimeFormat(canonical, clean)
        ).format(value, unit);
      },
      formatList: (
        values: readonly string[],
        settings: Intl.ListFormatOptions = {}
      ) => {
        if (
          !Array.isArray(values) ||
          values.length > 1000 ||
          values.some(
            (value) => typeof value !== 'string' || value.length > 16_384
          )
        ) {
          throw new TypeError('zlocale: invalid list');
        }
        /** Own bounded scalar native options used consistently by cache and formatter. */
        const clean = cleanOptions(settings);
        return formatter(
          'list',
          canonical,
          clean,
          () => new Intl.ListFormat(canonical, clean)
        ).format(values);
      },
    });
  };
  let current = forLocale(locale);
  /** Validate the whole batch before committing an immutable registry generation.
   * @param {readonly Catalog[]} inputs - Explicit public catalog data.
   * @param {{replace?: boolean}} settings - Explicit replacement policy.
   * @param {boolean} settings.replace - Permit replacement of an existing exact locale/domain identity.
   * @returns {void} Commits before notifying; subscriber failures do not roll back persistence in this registry.
   */
  const registerCatalogs = (
    inputs: readonly Catalog[],
    settings: { replace?: boolean } = {}
  ) => {
    if (!Array.isArray(inputs) || inputs.length > maxCatalogs) {
      throw new RangeError('zlocale: invalid catalog batch');
    }
    // Validate/copy the entire batch before mutating the live registry.
    /** Entire defensively copied catalog batch; validation precedes registry mutation. */
    const prepared = inputs.map((input) =>
      defineCatalog(input, options.limits)
    );
    /** Candidate registry map committed only after duplicate/capacity checks. */
    const next = new Map(catalogs);
    /** Batch-local identities rejecting duplicate catalogs before commit. */
    const seen = new Set<string>();
    for (const catalog of prepared) {
      /** Validated catalog/context/formatter identity used only in this owner's maps. */
      const key = catalogKey(catalog.locale, catalog.domain);
      if (seen.has(key) || (next.has(key) && !settings.replace)) {
        throw new Error('zlocale: duplicate catalog; use replace explicitly');
      }
      seen.add(key);
      next.set(key, catalog);
    }
    if (next.size > maxCatalogs) {
      throw new RangeError('zlocale: registry catalog limit exceeded');
    }
    if (!inputs.length) {
      return;
    }
    catalogs = next;
    emit();
  };
  if (options.catalogs) {
    registerCatalogs(options.catalogs);
  }
  // Dynamic methods delegate to the current view. Fixed request views never use this mutable pointer.
  /** Application-locale delegations; request-fixed views never read this mutable pointer. */
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
      /** Canonical new application locale; identical selections do not notify. */
      const normalized = canonicalLocale(next);
      if (locale === normalized) {
        return;
      }
      /** Fixed candidate translator constructed before replacing the application pointer. */
      const view = forLocale(normalized);
      locale = normalized;
      current = view;
      emit();
    },
    getCatalog(language: string, textDomain = domain) {
      return catalogs.get(
        catalogKey(
          new Intl.Locale(canonicalLocale(language)).baseName,
          validateDomain(textDomain)
        )
      );
    },
    removeCatalog(language: string, textDomain = domain) {
      /** Whether an exact installed catalog existed; only actual removal notifies. */
      const removed = catalogs.delete(
        catalogKey(
          new Intl.Locale(canonicalLocale(language)).baseName,
          validateDomain(textDomain)
        )
      );
      if (removed) {
        emit();
      }
      return removed;
    },
    subscribe(listener: () => void) {
      if (typeof listener !== 'function') {
        throw new TypeError('zlocale: subscriber must be a function');
      }
      if (listeners.size >= 1000) {
        throw new RangeError('zlocale: subscriber limit exceeded');
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
