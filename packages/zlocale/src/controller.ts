import type { Catalog, I18n } from './types.js';
import {
  canonicalLocale,
  defineCatalog,
  validateDomain,
} from './validation.js';

/** A bounded loader such as createCatalogLoader; host code owns I/O and cancellation. */
export interface LocaleLoader {
  preload(
    keys: readonly string[],
    options?: {
      /** Borrowed cooperative lifetime; cancellation does not force trusted callbacks to settle. */
      signal?: AbortSignal;
    }
  ): Promise<readonly Catalog[]>;
}
/** Explicit application locale allowlist and domains needed before switching. */
export interface LocaleControllerOptions {
  /** Explicit canonical application locale allowlist; not request-selected filenames. */
  supportedLocales: readonly string[];
  /** Exact required domain set loaded before changing application locale. */
  domains?: readonly string[];
}
/** Application-owned async switcher; never use it to mutate a shared server request locale. */
export interface LocaleController {
  switchLocale(locale: string): Promise<boolean>;
  cancel(): void;
  dispose(): void;
}

/** Create an explicit last-selection-wins locale switcher for browser applications or isolated hosts.
 * @param {I18n} i18n - Borrowed catalog/locale owner; request or UI lifecycle remains explicit.
 * @param {LocaleLoader} loader - Borrowed allowlisted cooperative loader; no call occurs during controller construction.
 * @param {LocaleControllerOptions} options - Explicit owner policy; limits and native formatting choices are validated before use.
 * @returns {LocaleController} Disposable controller. switchLocale resolves true when applied, false when superseded/cancelled/disposed; current failures reject without changing the locale. No DOM, environment or request globals are read. Host loaders may perform I/O.
 */
export function createLocaleController(
  i18n: I18n,
  loader: LocaleLoader,
  options: LocaleControllerOptions
): LocaleController {
  if (
    !Array.isArray(options.supportedLocales) ||
    !options.supportedLocales.length ||
    options.supportedLocales.length > 128
  ) {
    throw new RangeError('zlocale: invalid supported locales');
  }
  /** Canonical explicit locale allowlist; requests cannot load arbitrary locale paths. */
  const supported = new Set(options.supportedLocales.map(canonicalLocale));
  /** Fixed required domains for this application locale selection. */
  const domains = options.domains ?? ['default'];
  if (!Array.isArray(domains) || !domains.length || domains.length > 32) {
    throw new RangeError('zlocale: invalid controller domains');
  }
  /** Deduplicated validated domain set whose catalogs must all be present. */
  const required = [...new Set(domains.map(validateDomain))];
  let selection = 0;
  let disposed = false;
  let active: AbortController | undefined;
  return Object.freeze({
    /** Load all required catalogs before applying the newest selected locale.
     * @param {string} locale - Explicit bounded BCP-47 locale validated through native Intl.
     * @returns {Promise<boolean>} Whether this selection applied. Failed or obsolete requests do not install catalogs. Host loaders may perform I/O.
     */
    async switchLocale(locale: string): Promise<boolean> {
      if (disposed) {
        throw new Error('zlocale: locale controller disposed');
      }
      // Invalid input does not supersede an already valid pending selection.
      /** Canonical validated selection; invalid input cannot supersede current work. */
      const requested = canonicalLocale(locale);
      if (!supported.has(requested)) {
        throw new RangeError('zlocale: unsupported locale selection');
      }
      /** Selected locale base name used by the explicit loader key format. */
      const base = new Intl.Locale(requested).baseName;
      /** Exact locale/domain keys derived only from fixed supported choices. */
      const keys = required.map((domain) => `${base}/${domain}`);
      /** Monotonic selection fence preventing obsolete completions from changing locale. */
      const ticket = ++selection;
      /** Previous owned waiter cancellation; shared loader producer ownership remains separate. */
      const previous = active;
      /** Owned selection signal, replaced/disposed cooperatively. */
      const controller = new AbortController();
      active = controller;
      try {
        // Attach the new waiter before cancelling the old one, including same-locale replacement.
        /** Attach the new shared-loader waiter before aborting the previous selection. */
        const loading = loader.preload(keys, { signal: controller.signal });
        previous?.abort();
        /** Actually settled loader results validated together before registry changes. */
        const inputs = await loading;
        if (disposed || ticket !== selection) {
          return false;
        }
        if (!Array.isArray(inputs) || inputs.length !== keys.length) {
          throw new TypeError('zlocale: incomplete locale selection');
        }
        // Validate the entire returned set before touching the application registry.
        /** Defensively validated complete catalog batch for this selection. */
        const catalogs = inputs.map((input) => defineCatalog(input));
        if (
          catalogs.some(
            (catalog, index) =>
              `${catalog.locale}/${catalog.domain}` !== keys[index]
          )
        ) {
          throw new TypeError('zlocale: unexpected locale selection catalog');
        }
        i18n.registerCatalogs(catalogs, { replace: true });
        // A synchronous subscriber may supersede this operation during registration.
        if (disposed || ticket !== selection) {
          return false;
        }
        i18n.setLocale(requested);
        return true;
      } catch (error) {
        previous?.abort();
        if (disposed || ticket !== selection) {
          return false;
        }
        throw error;
      } finally {
        if (active === controller) {
          active = undefined;
        }
      }
    },
    /** Cancel this selection without aborting other shared-loader waiters.
     * @returns {void} Nothing. No globals or I/O.
     */
    cancel(): void {
      ++selection;
      active?.abort();
    },
    /** Invalidate pending selections and reject future switches; idempotent.
     * @returns {void} Nothing. Shared translators/loaders stay owned by the host.
     */
    dispose(): void {
      disposed = true;
      ++selection;
      active?.abort();
    },
  });
}
