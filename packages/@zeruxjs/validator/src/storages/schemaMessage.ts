import type { BaseIssue, ErrorMessage } from '../types/index.js';

/** Legacy module-global exact-language registry, shared by all callers; configure trusted static messages at bootstrap, never per-tenant request data. */
let store: Map<string | undefined, ErrorMessage<BaseIssue<unknown>>>;

/**
 * Sets a schema error message. Replaces only the exact key and retains values until explicitly deleted or the module is unloaded.
 * No cardinality cap, automatic expiry or request/tenant isolation is provided.
 *
 * @param {ErrorMessage<BaseIssue<unknown>>} message - Borrowed literal or trusted callback; callbacks receive private issue data and may throw.
 * @param {string} lang - Optional exact language key; undefined is its own key, with no implicit locale fallback.
 * @returns {void} Completes the synchronous exact-key registry mutation.
 */
export function setSchemaMessage(
  message: ErrorMessage<BaseIssue<unknown>>,
  lang?: string
): void {
  if (!store) {
    store = new Map();
  }
  store.set(lang, message);
}

/**
 * Returns a schema error message.
 *
 * @param {string} lang - Optional exact language key; undefined is its own key, with no implicit locale fallback.
 *
 * @returns {ErrorMessage<BaseIssue<unknown>> | undefined} Borrowed exact-key entry or undefined; this getter neither invokes callbacks nor redacts their content.
 */
// @__NO_SIDE_EFFECTS__
export function getSchemaMessage(
  lang?: string
): ErrorMessage<BaseIssue<unknown>> | undefined {
  return store?.get(lang);
}

/**
 * Deletes a schema error message. Missing entries are harmless; this never invokes a callback.
 *
 * @param {string} lang - Optional exact language key; undefined is its own key, with no implicit locale fallback.
 * @returns {void} Completes the synchronous exact-key registry mutation.
 */
export function deleteSchemaMessage(lang?: string): void {
  store?.delete(lang);
}
