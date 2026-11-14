import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { ArrayInput, ArrayRequirement } from './types.js';

/**
 * Some item issue interface.
 */
export interface SomeItemIssue<
  TInput extends ArrayInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'some_item';
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
 * Some item action interface.
 */
export interface SomeItemAction<
  TInput extends ArrayInput,
  TMessage extends ErrorMessage<SomeItemIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, SomeItemIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'some_item';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof someItem;
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

/** Use native synchronous some, including false for an empty array and skipping sparse holes; callbacks are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {SomeItemAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function someItem<TInput extends ArrayInput>(
  requirement: ArrayRequirement<TInput>
): SomeItemAction<TInput, undefined>;

/** Use native synchronous some, including false for an empty array and skipping sparse holes; callbacks are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {SomeItemAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function someItem<
  TInput extends ArrayInput,
  const TMessage extends ErrorMessage<SomeItemIssue<TInput>> | undefined,
>(
  requirement: ArrayRequirement<TInput>,
  message: TMessage
): SomeItemAction<TInput, TMessage>;

/** Use native synchronous some, including false for an empty array and skipping sparse holes; callbacks are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<unknown[]>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<SomeItemIssue<unknown[]>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {SomeItemAction<unknown[], ErrorMessage<SomeItemIssue<unknown[]>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function someItem(
  requirement: ArrayRequirement<unknown[]>,
  message?: ErrorMessage<SomeItemIssue<unknown[]>>
): SomeItemAction<
  unknown[],
  ErrorMessage<SomeItemIssue<unknown[]>> | undefined
> {
  return {
    kind: 'validation',
    type: 'some_item',
    reference: someItem,
    async: false,
    expects: null,
    requirement,
    message,
    /** Use native synchronous some, including false for an empty array and skipping sparse holes; callbacks are not awaited. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !dataset.value.some(this.requirement)) {
        _addIssue(this, 'item', dataset, config);
      }
      return dataset;
    },
  };
}
