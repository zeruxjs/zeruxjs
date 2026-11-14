import { AsyncLocalStorage } from 'node:async_hooks';
import type { I18n, Translator } from './types.js';
/** Scope locale-fixed translators to Node asynchronous request chains.
 * @param {I18n} i18n - Borrowed shared catalog owner, preloaded during application startup.
 * @returns {object} Owned request facade with its own AsyncLocalStorage, never a process-wide mutable locale.
 */
export function createRequestI18n(i18n: I18n) {
  /** Owned async context storage; each run pins a locale-fixed view of borrowed catalogs. */
  const storage = new AsyncLocalStorage<Translator>();
  let disposed = false;
  return Object.freeze({
    /** Release the context on host teardown after admitted requests finish.
     * @returns {void} Disables this storage instance; later facade use throws. */
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      storage.disable();
    },
    /** Wrap the actual downstream request handler in one locale-fixed async context.
     * @param {string} locale - Host-validated supported locale.
     * @param {() => T} callback - Trusted downstream handler; keep its result pending for its request lifetime.
     * @returns {T} Original handler result, including its promise; no catalog I/O starts here. */
    run<T>(locale: string, callback: () => T): T {
      if (disposed) {
        throw new Error('zlocale: request context disposed');
      }
      if (typeof callback !== 'function') {
        throw new TypeError('zlocale: handler required');
      }
      return storage.run(i18n.forLocale(locale), callback);
    },
    /** Read only this instance's active locale-fixed context.
     * @returns {Translator} Borrowed request translator, or throws outside run/after disposal. */
    current(): Translator {
      if (disposed) {
        throw new Error('zlocale: request context disposed');
      }
      /** Missing context is an explicit misuse, never a global-locale fallback. */
      const translator = storage.getStore();
      if (!translator) {
        throw new Error('zlocale: no active request locale');
      }
      return translator;
    },
  });
}
