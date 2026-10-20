/** Standard CLDR cardinal categories; native Intl determines the matching category. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
/** A plain translation or a category map with a mandatory catch-all. */
export type Message =
  | string
  | (Readonly<Partial<Record<PluralCategory, string>>> & {
      readonly other: string;
    });
/** Immutable, JSON-serializable locale/domain data. Context keys use U+0004. */
export interface Catalog {
  readonly locale: string;
  readonly domain: string;
  readonly messages: Readonly<Record<string, Message>>;
}
/** Validation limits apply before catalogs enter caches or translator registries. */
export interface CatalogLimits {
  maxMessages?: number;
  maxStringLength?: number;
  maxBytes?: number;
}
/** Per-instance runtime settings. No environment or request globals are read. */
export interface I18nOptions {
  locale?: string;
  domain?: string;
  fallbackLocales?: readonly string[];
  catalogs?: readonly Catalog[];
  maxCatalogs?: number;
  formatterCacheSize?: number;
  timeZone?: string;
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
    domain?: string,
  ): string;
  hasTranslation(text: string, context?: string, domain?: string): boolean;
  isRTL(): boolean;
  formatNumber(
    value: number | bigint,
    options?: Intl.NumberFormatOptions,
  ): string;
  formatDateTime(
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ): string;
  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string;
  formatList(
    values: readonly string[],
    options?: Intl.ListFormatOptions,
  ): string;
}
/** Mutable application owner; use locale-fixed views on a shared server. */
export interface I18n extends Translator {
  setLocale(locale: string): void;
  forLocale(locale: string): Translator;
  registerCatalogs(
    catalogs: readonly Catalog[],
    options?: { replace?: boolean },
  ): void;
  removeCatalog(locale: string, domain?: string): boolean;
  getCatalog(locale: string, domain?: string): Catalog | undefined;
  subscribe(listener: () => void): () => void;
}
