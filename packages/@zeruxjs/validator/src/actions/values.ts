import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _joinExpects, _stringify } from '../utils/index.js';
import type { ValueInput } from './types.js';

/**
 * Values issue type.
 */
export interface ValuesIssue<
  TInput extends ValueInput,
  TRequirement extends readonly TInput[],
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'values';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: string;
  /**
   * The required values.
   */
  readonly requirement: TRequirement;
}

/**
 * Values action type.
 */
export interface ValuesAction<
  TInput extends ValueInput,
  TRequirement extends readonly TInput[],
  TMessage extends ErrorMessage<ValuesIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, ValuesIssue<TInput, TRequirement>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'values';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof values;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: string;
  /**
   * The required values.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Accept a member using the retained <= and >= relational comparisons; this is not strict identity or native includes. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {ValuesAction<TInput, TRequirement, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function values<
  TInput extends ValueInput,
  const TRequirement extends readonly TInput[],
>(requirement: TRequirement): ValuesAction<TInput, TRequirement, undefined>;

/** Accept a member using the retained <= and >= relational comparisons; this is not strict identity or native includes. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ValuesAction<TInput, TRequirement, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function values<
  TInput extends ValueInput,
  const TRequirement extends readonly TInput[],
  const TMessage extends
    | ErrorMessage<ValuesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): ValuesAction<TInput, TRequirement, TMessage>;

/** Accept a member using the retained <= and >= relational comparisons; this is not strict identity or native includes. Construction captures trusted policy without evaluating candidate data.
 * @param {readonly ValueInput[]} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<ValuesIssue<ValueInput, readonly ValueInput[]>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ValuesAction<ValueInput, readonly ValueInput[], ErrorMessage<ValuesIssue<ValueInput, readonly ValueInput[]>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function values(
  requirement: readonly ValueInput[],
  message?: ErrorMessage<ValuesIssue<ValueInput, readonly ValueInput[]>>
): ValuesAction<
  ValueInput,
  readonly ValueInput[],
  ErrorMessage<ValuesIssue<ValueInput, readonly ValueInput[]>> | undefined
> {
  return {
    kind: 'validation',
    type: 'values',
    reference: values,
    async: false,
    expects: `${_joinExpects(
      requirement.map((value) =>
        value instanceof Date ? value.toJSON() : _stringify(value)
      ),
      '|'
    )}`,
    requirement,
    message,
    /** Accept a member using the retained <= and >= relational comparisons; this is not strict identity or native includes. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (
        dataset.typed &&
        !this.requirement.some(
          (value) => value <= dataset.value && value >= dataset.value
        )
      ) {
        _addIssue(this, 'value', dataset, config, {
          received:
            dataset.value instanceof Date
              ? dataset.value.toJSON()
              : _stringify(dataset.value),
        });
      }
      return dataset;
    },
  };
}
