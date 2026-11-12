import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * To string issue interface.
 */
export interface ToStringIssue<TInput> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'to_string';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: null;
}

/**
 * To string action interface.
 */
export interface ToStringAction<
  TInput,
  TMessage extends ErrorMessage<ToStringIssue<TInput>> | undefined,
> extends BaseTransformation<TInput, string, ToStringIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'to_string';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof toString;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native String conversion, reporting conversion failures as private issues; text is never HTML/script escaped. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ToStringAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toString<TInput>(): ToStringAction<TInput, undefined>;

/** Use native String conversion, reporting conversion failures as private issues; text is never HTML/script escaped. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToStringAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toString<
  TInput,
  const TMessage extends ErrorMessage<ToStringIssue<TInput>> | undefined,
>(message: TMessage): ToStringAction<TInput, TMessage>;

/** Use native String conversion, reporting conversion failures as private issues; text is never HTML/script escaped. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ErrorMessage<ToStringIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToStringAction<unknown, ErrorMessage<ToStringIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function toString(
  message?: ErrorMessage<ToStringIssue<unknown>>
): ToStringAction<unknown, ErrorMessage<ToStringIssue<unknown>> | undefined> {
  return {
    kind: 'transformation',
    type: 'to_string',
    reference: toString,
    async: false,
    message,
    /** Use native String conversion, reporting conversion failures as private issues; text is never HTML/script escaped. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      try {
        dataset.value = String(dataset.value);
      } catch {
        _addIssue(this, 'string', dataset, config);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      }
      return dataset as OutputDataset<string, ToStringIssue<unknown>>;
    },
  };
}
