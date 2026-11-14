import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * To number issue interface.
 */
export interface ToNumberIssue<TInput> extends BaseIssue<TInput | number> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'to_number';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: null;
}

/**
 * To number action interface.
 */
export interface ToNumberAction<
  TInput,
  TMessage extends ErrorMessage<ToNumberIssue<TInput>> | undefined,
> extends BaseTransformation<TInput, number, ToNumberIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'to_number';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof toNumber;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native Number conversion and reject NaN/conversion failures; Infinity and native precision loss remain possible. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ToNumberAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toNumber<TInput>(): ToNumberAction<TInput, undefined>;

/** Use native Number conversion and reject NaN/conversion failures; Infinity and native precision loss remain possible. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToNumberAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toNumber<
  TInput,
  const TMessage extends ErrorMessage<ToNumberIssue<TInput>> | undefined,
>(message: TMessage): ToNumberAction<TInput, TMessage>;

/** Use native Number conversion and reject NaN/conversion failures; Infinity and native precision loss remain possible. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ErrorMessage<ToNumberIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToNumberAction<unknown, ErrorMessage<ToNumberIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function toNumber(
  message?: ErrorMessage<ToNumberIssue<unknown>>
): ToNumberAction<unknown, ErrorMessage<ToNumberIssue<unknown>> | undefined> {
  return {
    kind: 'transformation',
    type: 'to_number',
    reference: toNumber,
    async: false,
    message,
    /** Use native Number conversion and reject NaN/conversion failures; Infinity and native precision loss remain possible. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      try {
        dataset.value = Number(dataset.value);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        if (isNaN(dataset.value)) {
          _addIssue(this, 'number', dataset, config);
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.typed = false;
        }
      } catch {
        _addIssue(this, 'number', dataset, config);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      }
      return dataset as OutputDataset<number, ToNumberIssue<unknown>>;
    },
  };
}
