import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { ArrayInput, ArrayRequirement } from './types.js';

/**
 * Every item issue interface.
 */
export interface EveryItemIssue<
  TInput extends ArrayInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'every_item';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: null;
  /**
   * The validation function.
   */
  readonly requirement: ArrayRequirement<TInput>;
}

/**
 * Every item action interface.
 */
export interface EveryItemAction<
  TInput extends ArrayInput,
  TMessage extends ErrorMessage<EveryItemIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, EveryItemIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'every_item';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof everyItem;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The validation function.
   */
  readonly requirement: ArrayRequirement<TInput>;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native synchronous every, including true for an empty array and skipping sparse holes; callbacks are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {EveryItemAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function everyItem<TInput extends ArrayInput>(
  requirement: ArrayRequirement<TInput>
): EveryItemAction<TInput, undefined>;

/** Use native synchronous every, including true for an empty array and skipping sparse holes; callbacks are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {EveryItemAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function everyItem<
  TInput extends ArrayInput,
  const TMessage extends ErrorMessage<EveryItemIssue<TInput>> | undefined,
>(
  requirement: ArrayRequirement<TInput>,
  message: TMessage
): EveryItemAction<TInput, TMessage>;

/** Use native synchronous every, including true for an empty array and skipping sparse holes; callbacks are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<unknown[]>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<EveryItemIssue<unknown[]>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {EveryItemAction<unknown[], ErrorMessage<EveryItemIssue<unknown[]>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function everyItem(
  requirement: ArrayRequirement<unknown[]>,
  message?: ErrorMessage<EveryItemIssue<unknown[]>>
): EveryItemAction<
  unknown[],
  ErrorMessage<EveryItemIssue<unknown[]>> | undefined
> {
  return {
    kind: 'validation',
    type: 'every_item',
    reference: everyItem,
    async: false,
    expects: null,
    requirement,
    message,
    /** Use native synchronous every, including true for an empty array and skipping sparse holes; callbacks are not awaited. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !dataset.value.every(this.requirement)) {
        _addIssue(this, 'item', dataset, config);
      }
      return dataset;
    },
  };
}
