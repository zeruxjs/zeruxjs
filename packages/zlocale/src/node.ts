import { AsyncLocalStorage } from "node:async_hooks";
import type { I18n, Translator } from "./types.js";
/** Scope locale-fixed translators to Node asynchronous request chains.
 * @param i18n Shared catalog owner, preloaded during application startup.
 * @returns Request context facade. Uses its own AsyncLocalStorage, never a process-wide locale.
 */
export function createRequestI18n(i18n: I18n) {
  const storage = new AsyncLocalStorage<Translator>();
  let disposed = false;
  return Object.freeze({
    /** Release the context on host teardown. @returns Nothing. Existing request contexts become unavailable; later use throws. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      storage.disable();
    },
    /** Wrap the actual downstream request handler. @param locale Validated application-supported locale. @param callback Handler. @returns Handler result (including its promise). No I/O is performed by zlocale. */
    run<T>(locale: string, callback: () => T): T {
      if (disposed) throw new Error("zlocale: request context disposed");
      if (typeof callback !== "function")
        throw new TypeError("zlocale: handler required");
      return storage.run(i18n.forLocale(locale), callback);
    },
    /** Read the current fixed translator. @returns Request translator. @throws Outside run. Reads this instance's async context only. */
    current(): Translator {
      if (disposed) throw new Error("zlocale: request context disposed");
      const translator = storage.getStore();
      if (!translator) throw new Error("zlocale: no active request locale");
      return translator;
    },
  });
}
