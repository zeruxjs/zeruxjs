/** Standard CLDR cardinal categories; native Intl determines the matching category. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
/** A plain translation or a category map with a mandatory catch-all. */
export type Message =
  | string
  | (Readonly<Partial<Record<PluralCategory, string>>> & {
      readonly other: string;
    });
/** Immutable, JSON-serializable locale/domain data. Context keys use U+0004. */
export interface Catalog {
  /** Explicit canonical locale/base-locale identity; does not grant authorization. */
  readonly locale: string;
  /** Explicit exact text domain; domains never fall back into each other. */
  readonly domain: string;
  /** Immutable inert translation map or extracted occurrence list according to this record. */
  readonly messages: Readonly<Record<string, Message>>;
}
/** Validation limits apply before catalogs enter caches or translator registries. */
export interface CatalogLimits {
  /** Explicit bounded occurrence/diagnostic or catalog message capacity. */
  maxMessages?: number;
  /** Bounded source/translation code units before registry installation. */
  maxStringLength?: number;
  /** Explicit bounded UTF-8 source/retained/wire budget for this owner. */
  maxBytes?: number;
}
/** Per-instance runtime settings. No environment or request globals are read. */
export interface I18nOptions {
  /** Explicit canonical locale/base-locale identity; does not grant authorization. */
  locale?: string;
  /** Explicit exact text domain; domains never fall back into each other. */
  domain?: string;
  /** Explicit ordered fallback locales; lookup expands parents without I/O. */
  fallbackLocales?: readonly string[];
  /** Explicit validated public catalog snapshots; exclude private tenant data. */
  catalogs?: readonly Catalog[];
  /** Bounded explicit catalog count in this owner or transfer batch. */
  maxCatalogs?: number;
  /** Per-owner native Intl formatter LRU capacity. */
  formatterCacheSize?: number;
  /** Explicit default native date formatting zone, UTC when omitted. */
  timeZone?: string;
  /** Explicit per-catalog message/string/UTF-8 copy limits. */
  limits?: CatalogLimits;
}
/** Locale-fixed synchronous translator. Methods never load files or perform network I/O. */
export interface Translator {
  getLocale(): string;
  __(text: string, domain?: string): string;
  _x(text: string, context: string, domain?: string): string;
  _n(single: string, plural: string, count: number, domain?: string): string;
  _nx(
    single: string,
    plural: string,
    count: number,
    context: string,
    domain?: string
  ): string;
  hasTranslation(text: string, context?: string, domain?: string): boolean;
  isRTL(): boolean;
  formatNumber(
    value: number | bigint,
    options?: Intl.NumberFormatOptions
  ): string;
  formatDateTime(
    value: Date | number,
    options?: Intl.DateTimeFormatOptions
  ): string;
  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions
  ): string;
  formatList(
    values: readonly string[],
    options?: Intl.ListFormatOptions
  ): string;
}
/** Mutable application owner; use locale-fixed views on a shared server. */
export interface I18n extends Translator {
  setLocale(locale: string): void;
  forLocale(locale: string): Translator;
  registerCatalogs(
    catalogs: readonly Catalog[],
    options?: { replace?: boolean }
  ): void;
  removeCatalog(locale: string, domain?: string): boolean;
  getCatalog(locale: string, domain?: string): Catalog | undefined;
  subscribe(listener: () => void): () => void;
}
