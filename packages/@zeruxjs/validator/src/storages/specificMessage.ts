import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  BaseTransformationAsync,
  BaseValidation,
  BaseValidationAsync,
  ErrorMessage,
  InferIssue,
} from '../types/index.js';

/**
 * Reference type.
 */
type Reference = (
  ...args: any[]
) =>
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | BaseValidation<unknown, unknown, BaseIssue<unknown>>
  | BaseValidationAsync<unknown, unknown, BaseIssue<unknown>>
  | BaseTransformation<unknown, unknown, BaseIssue<unknown>>
  | BaseTransformationAsync<unknown, unknown, BaseIssue<unknown>>;

/** Legacy module-global exact-language registry, shared by all callers; configure trusted static messages at bootstrap, never per-tenant request data. */
let store: Map<
  Reference,
  Map<string | undefined, ErrorMessage<BaseIssue<unknown>>>
>;

/**
 * Sets a specific error message. Replaces only the exact key and retains values until explicitly deleted or the module is unloaded.
 * No cardinality cap, automatic expiry or request/tenant isolation is provided.
 *
 * @param {TReference} reference - Exact trusted constructor identity used by the failing schema/action; never invoked by this registry.
 * @param {ErrorMessage<InferIssue<ReturnType<TReference>>>} message - Borrowed literal or trusted callback; callbacks receive private issue data and are invoked only on validation failure.
 * @param {string} lang - Optional exact language key; undefined is its own key, with no implicit locale fallback.
 * @returns {void} Completes the synchronous exact-key registry mutation.
 */
export function setSpecificMessage<const TReference extends Reference>(
  reference: TReference,
  message: ErrorMessage<InferIssue<ReturnType<TReference>>>,
  lang?: string
): void {
  if (!store) {
    store = new Map();
  }
  if (!store.get(reference)) {
    store.set(reference, new Map());
  }
  store.get(reference)!.set(lang, message);
}

/**
 * Returns a specific error message.
 *
 * @param {TReference} reference - Exact trusted constructor identity used by the failing schema/action; never invoked by this registry.
 * @param {string} lang - Optional exact language key; undefined is its own key, with no implicit locale fallback.
 *
 * @returns {ErrorMessage<InferIssue<ReturnType<TReference>>> | undefined} Borrowed exact-key entry or undefined; this getter neither invokes callbacks nor redacts their content.
 */
// @__NO_SIDE_EFFECTS__
export function getSpecificMessage<const TReference extends Reference>(
  reference: TReference,
  lang?: string
): ErrorMessage<InferIssue<ReturnType<TReference>>> | undefined {
  return store?.get(reference)?.get(lang);
}

/**
 * Deletes a specific error message. Missing entries are harmless; callbacks and borrowed resources are never disposed.
 * Specific registries retain their constructor bucket even after its last language entry is removed.
 *
 * @param {Reference} reference - Exact constructor identity whose language entry is removed; constructor is not invoked.
 * @param {string} lang - Optional exact language key; undefined is its own key, with no implicit locale fallback.
 * @returns {void} Completes the synchronous exact-key registry mutation.
 */
export function deleteSpecificMessage(
  reference: Reference,
  lang?: string
): void {
  store?.get(reference)?.delete(lang);
}
