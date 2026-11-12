import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { LengthInput } from './types.js';

/**
 * Non empty issue interface.
 */
export interface NonEmptyIssue<
  TInput extends LengthInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'non_empty';
  /**
   * The expected input.
   */
  readonly expected: '!0';
  /**
   * The received input.
   */
  readonly received: '0';
}

/**
 * Non empty action interface.
 */
export interface NonEmptyAction<
  TInput extends LengthInput,
  TMessage extends ErrorMessage<NonEmptyIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, NonEmptyIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'non_empty';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof nonEmpty;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: '!0';
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject exactly zero native length; whitespace remains content and values are not coerced. Construction captures trusted policy without evaluating candidate data.
 * @returns {NonEmptyAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function nonEmpty<TInput extends LengthInput>(): NonEmptyAction<
  TInput,
  undefined
>;

/** Reject exactly zero native length; whitespace remains content and values are not coerced. Construction captures trusted policy without evaluating candidate data.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {NonEmptyAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function nonEmpty<
  TInput extends LengthInput,
  const TMessage extends ErrorMessage<NonEmptyIssue<TInput>> | undefined,
>(message: TMessage): NonEmptyAction<TInput, TMessage>;

/** Reject exactly zero native length; whitespace remains content and values are not coerced. Construction captures trusted policy without evaluating candidate data.
 * @param {ErrorMessage<NonEmptyIssue<LengthInput>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {NonEmptyAction<LengthInput, ErrorMessage<NonEmptyIssue<LengthInput>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function nonEmpty(
  message?: ErrorMessage<NonEmptyIssue<LengthInput>>
): NonEmptyAction<
  LengthInput,
  ErrorMessage<NonEmptyIssue<LengthInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'non_empty',
    reference: nonEmpty,
    async: false,
    expects: '!0',
    message,
    /** Reject exactly zero native length; whitespace remains content and values are not coerced. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.length === 0) {
        _addIssue(this, 'length', dataset, config, {
          received: '0',
        });
      }
      return dataset;
    },
  };
}
