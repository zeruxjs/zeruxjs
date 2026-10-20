/** Browser-safe public API. Node async hooks exist only in zlocale/node. */
export { createI18n } from "./core.js";
export { defineCatalog, canonicalLocale } from "./validation.js";
export { createCatalogLoader } from "./loader.js";
export { escapeHtml, interpolate, sprintf } from "./text.js";
export type {
  Catalog,
  CatalogLimits,
  I18n,
  I18nOptions,
  Message,
  PluralCategory,
  Translator,
} from "./types.js";
export type { CatalogLoaders } from "./loader.js";
export { serializeCatalogs, parseCatalogs } from "./snapshot.js";
export type { CatalogSnapshot, SnapshotOptions } from "./snapshot.js";
