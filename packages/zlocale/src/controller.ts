import type { Catalog, I18n } from "./types.js";
import {
  canonicalLocale,
  defineCatalog,
  validateDomain,
} from "./validation.js";

/** A bounded loader such as createCatalogLoader; host code owns I/O and cancellation. */
export interface LocaleLoader {
  preload(keys: readonly string[]): Promise<readonly Catalog[]>;
}
/** Explicit application locale allowlist and domains needed before switching. */
export interface LocaleControllerOptions {
  supportedLocales: readonly string[];
  domains?: readonly string[];
}
/** Application-owned async switcher; never use it to mutate a shared server request locale. */
export interface LocaleController {
  switchLocale(locale: string): Promise<boolean>;
  cancel(): void;
  dispose(): void;
}

/** Create an explicit last-selection-wins locale switcher for browser applications or isolated hosts.
 * @param i18n Application-owned mutable translator.
 * @param loader Allowlisted bounded loader; no call occurs during construction.
 * @param options Supported locales and required domains (default: default).
 * @returns Disposable controller. switchLocale resolves true when applied, false when superseded/cancelled/disposed; current failures reject without changing the locale. No DOM, environment or request globals are read. Host loaders may perform I/O.
 */
export function createLocaleController(
  i18n: I18n,
  loader: LocaleLoader,
  options: LocaleControllerOptions,
): LocaleController {
  if (
    !Array.isArray(options.supportedLocales) ||
    !options.supportedLocales.length ||
    options.supportedLocales.length > 128
  )
    throw new RangeError("zlocale: invalid supported locales");
  const supported = new Set(options.supportedLocales.map(canonicalLocale));
  const domains = options.domains ?? ["default"];
  if (!Array.isArray(domains) || !domains.length || domains.length > 32)
    throw new RangeError("zlocale: invalid controller domains");
  const required = [...new Set(domains.map(validateDomain))];
  let selection = 0;
  let disposed = false;
  return Object.freeze({
    /** Load all required catalogs before applying the newest selected locale. @param locale Explicit supported locale. @returns Whether this selection applied. Failed or obsolete requests do not install catalogs. Host loaders may perform I/O. */
    async switchLocale(locale: string): Promise<boolean> {
      if (disposed) throw new Error("zlocale: locale controller disposed");
      // Invalid input does not supersede an already valid pending selection.
      const requested = canonicalLocale(locale);
      if (!supported.has(requested))
        throw new RangeError("zlocale: unsupported locale selection");
      const base = new Intl.Locale(requested).baseName;
      const keys = required.map((domain) => `${base}/${domain}`);
      const ticket = ++selection;
      try {
        const inputs = await loader.preload(keys);
        if (disposed || ticket !== selection) return false;
        if (!Array.isArray(inputs) || inputs.length !== keys.length)
          throw new TypeError("zlocale: incomplete locale selection");
        // Validate the entire returned set before touching the application registry.
        const catalogs = inputs.map((input) => defineCatalog(input));
        if (
          catalogs.some(
            (catalog, index) =>
              `${catalog.locale}/${catalog.domain}` !== keys[index],
          )
        )
          throw new TypeError("zlocale: unexpected locale selection catalog");
        i18n.registerCatalogs(catalogs, { replace: true });
        // A synchronous subscriber may supersede this operation during registration.
        if (disposed || ticket !== selection) return false;
        i18n.setLocale(requested);
        return true;
      } catch (error) {
        if (disposed || ticket !== selection) return false;
        throw error;
      }
    },
    /** Invalidate a pending selection without cancelling shared loader work. @returns Nothing. No globals or I/O. */
    cancel(): void {
      ++selection;
    },
    /** Invalidate pending selections and reject future switches; idempotent. @returns Nothing. Shared translators/loaders stay owned by the host. */
    dispose(): void {
      disposed = true;
      ++selection;
    },
  });
}
