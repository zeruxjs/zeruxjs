import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { LengthInput } from './types.js';

/**
 * Empty issue interface.
 */
export interface EmptyIssue<
  TInput extends LengthInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'empty';
  /**
   * The expected input.
   */
  readonly expected: '0';
  /**
   * The received input.
   */
  readonly received: `${number}`;
}

/**
 * Empty action interface.
 */
export interface EmptyAction<
  TInput extends LengthInput,
  TMessage extends ErrorMessage<EmptyIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, EmptyIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'empty';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof empty;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: '0';
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject typed native lengths greater than zero; whitespace is not trimmed and this is not a nullish-value check. Construction captures trusted policy without evaluating candidate data.
 * @returns {EmptyAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function empty<TInput extends LengthInput>(): EmptyAction<
  TInput,
  undefined
>;

/** Reject typed native lengths greater than zero; whitespace is not trimmed and this is not a nullish-value check. Construction captures trusted policy without evaluating candidate data.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {EmptyAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function empty<
  TInput extends LengthInput,
  const TMessage extends ErrorMessage<EmptyIssue<TInput>> | undefined,
>(message: TMessage): EmptyAction<TInput, TMessage>;

/** Reject typed native lengths greater than zero; whitespace is not trimmed and this is not a nullish-value check. Construction captures trusted policy without evaluating candidate data.
 * @param {ErrorMessage<EmptyIssue<LengthInput>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {EmptyAction<LengthInput, ErrorMessage<EmptyIssue<LengthInput>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function empty(
  message?: ErrorMessage<EmptyIssue<LengthInput>>
): EmptyAction<LengthInput, ErrorMessage<EmptyIssue<LengthInput>> | undefined> {
  return {
    kind: 'validation',
    type: 'empty',
    reference: empty,
    async: false,
    expects: '0',
    message,
    /** Reject typed native lengths greater than zero; whitespace is not trimmed and this is not a nullish-value check. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.length > 0) {
        _addIssue(this, 'length', dataset, config, {
          received: `${dataset.value.length}`,
        });
      }
      return dataset;
    },
  };
}
