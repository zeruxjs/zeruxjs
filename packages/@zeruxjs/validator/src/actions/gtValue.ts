import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ValueInput } from './types.js';

/**
 * Greater than value issue type.
 */
export interface GtValueIssue<
  TInput extends ValueInput,
  TRequirement extends TInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'gt_value';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>${string}`;
  /**
   * The greater than value.
   */
  readonly requirement: TRequirement;
}

/**
 * Greater than value action type.
 */
export interface GtValueAction<
  TInput extends ValueInput,
  TRequirement extends TInput,
  TMessage extends ErrorMessage<GtValueIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, GtValueIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'gt_value';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof gtValue;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>${string}`;
  /**
   * The greater than value.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require the native exclusive > relation; Date/primitive coercion and invalid comparisons retain native semantics. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {GtValueAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function gtValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
>(requirement: TRequirement): GtValueAction<TInput, TRequirement, undefined>;

/** Require the native exclusive > relation; Date/primitive coercion and invalid comparisons retain native semantics. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {GtValueAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function gtValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
  const TMessage extends
    | ErrorMessage<GtValueIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): GtValueAction<TInput, TRequirement, TMessage>;

/** Require the native exclusive > relation; Date/primitive coercion and invalid comparisons retain native semantics. This action neither establishes the input schema nor grants permissions.
 * @param {ValueInput} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<GtValueIssue<ValueInput, ValueInput>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {GtValueAction<ValueInput, ValueInput, ErrorMessage<GtValueIssue<ValueInput, ValueInput>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function gtValue(
  requirement: ValueInput,
  message?: ErrorMessage<GtValueIssue<ValueInput, ValueInput>>
): GtValueAction<
  ValueInput,
  ValueInput,
  ErrorMessage<GtValueIssue<ValueInput, ValueInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'gt_value',
    reference: gtValue,
    async: false,
    expects: `>${
      requirement instanceof Date
        ? requirement.toJSON()
        : _stringify(requirement)
    }`,
    requirement,
    message,
    /** Require the native exclusive > relation; Date/primitive coercion and invalid comparisons retain native semantics. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !(dataset.value > this.requirement)) {
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
