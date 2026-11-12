import type {
  BaseIssue,
  BaseTransformation,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * To date issue interface.
 */
export interface ToDateIssue<TInput> extends BaseIssue<TInput | Date> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'transformation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'to_date';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: null;
}

/**
 * To date action interface.
 */
export interface ToDateAction<
  TInput,
  TMessage extends ErrorMessage<ToDateIssue<TInput>> | undefined,
> extends BaseTransformation<TInput, Date, ToDateIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'to_date';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof toDate;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Construct a native Date and reject Invalid Date/conversion failures; this is not strict ISO parsing or explicit timezone policy. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ToDateAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toDate<TInput>(): ToDateAction<TInput, undefined>;

/** Construct a native Date and reject Invalid Date/conversion failures; this is not strict ISO parsing or explicit timezone policy. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToDateAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
export function toDate<
  TInput,
  const TMessage extends ErrorMessage<ToDateIssue<TInput>> | undefined,
>(message: TMessage): ToDateAction<TInput, TMessage>;

/** Construct a native Date and reject Invalid Date/conversion failures; this is not strict ISO parsing or explicit timezone policy. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ErrorMessage<ToDateIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ToDateAction<unknown, ErrorMessage<ToDateIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function toDate(
  message?: ErrorMessage<ToDateIssue<unknown>>
): ToDateAction<unknown, ErrorMessage<ToDateIssue<unknown>> | undefined> {
  return {
    kind: 'transformation',
    type: 'to_date',
    reference: toDate,
    async: false,
    message,
    /** Construct a native Date and reject Invalid Date/conversion failures; this is not strict ISO parsing or explicit timezone policy. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      try {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.value = new Date(dataset.value);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        if (isNaN(dataset.value)) {
          _addIssue(this, 'date', dataset, config, {
            received: '"Invalid Date"',
          });
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.typed = false;
        }
      } catch {
        _addIssue(this, 'date', dataset, config);
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      }
      return dataset as OutputDataset<Date, ToDateIssue<unknown>>;
    },
  };
}
