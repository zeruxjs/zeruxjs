import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Input type
 */
type Input = number | bigint;

/**
 * Multiple of issue interface.
 */
export interface MultipleOfIssue<
  TInput extends Input,
  TRequirement extends Input,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'multiple_of';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `%${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${TInput}`;
  /**
   * Explicit native divisor; number/bigint kinds must match and bigint zero retains native RangeError behavior.
   */
  readonly requirement: TRequirement;
}

/**
 * Multiple of action interface.
 */
export interface MultipleOfAction<
  TInput extends Input,
  TRequirement extends Input,
  TMessage extends
    | ErrorMessage<MultipleOfIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<
  TInput,
  TInput,
  MultipleOfIssue<TInput, TRequirement>
> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'multiple_of';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof multipleOf;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `%${TRequirement}`;
  /**
   * Explicit native divisor; number/bigint kinds must match and bigint zero retains native RangeError behavior.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native remainder with explicit number/bigint zero checks. Number/bigint kinds must be compatible; bigint zero throws and floating-point arithmetic is not decimal rounding. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @returns {MultipleOfAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function multipleOf<
  TInput extends number,
  const TRequirement extends number,
>(requirement: TRequirement): MultipleOfAction<TInput, TRequirement, undefined>;

/** Use native remainder with explicit number/bigint zero checks. Number/bigint kinds must be compatible; bigint zero throws and floating-point arithmetic is not decimal rounding. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @returns {MultipleOfAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function multipleOf<
  TInput extends bigint,
  const TRequirement extends bigint,
>(requirement: TRequirement): MultipleOfAction<TInput, TRequirement, undefined>;

/** Use native remainder with explicit number/bigint zero checks. Number/bigint kinds must be compatible; bigint zero throws and floating-point arithmetic is not decimal rounding. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MultipleOfAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function multipleOf<
  TInput extends number,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MultipleOfIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MultipleOfAction<TInput, TRequirement, TMessage>;

/** Use native remainder with explicit number/bigint zero checks. Number/bigint kinds must be compatible; bigint zero throws and floating-point arithmetic is not decimal rounding. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MultipleOfAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function multipleOf<
  TInput extends bigint,
  const TRequirement extends bigint,
  const TMessage extends
    | ErrorMessage<MultipleOfIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MultipleOfAction<TInput, TRequirement, TMessage>;

/** Use native remainder with explicit number/bigint zero checks. Number/bigint kinds must be compatible; bigint zero throws and floating-point arithmetic is not decimal rounding. This action neither establishes the input schema nor grants permissions.
 * @param {Input} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {ErrorMessage<MultipleOfIssue<Input, Input>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MultipleOfAction<Input, Input, ErrorMessage<MultipleOfIssue<Input, Input>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function multipleOf(
  requirement: Input,
  message?: ErrorMessage<MultipleOfIssue<Input, Input>>
): MultipleOfAction<
  Input,
  Input,
  ErrorMessage<MultipleOfIssue<Input, Input>> | undefined
> {
  return {
    kind: 'validation',
    type: 'multiple_of',
    reference: multipleOf,
    async: false,
    expects: `%${requirement}`,
    requirement,
    message,
    /** Use native remainder with explicit number/bigint zero checks. Number/bigint kinds must be compatible; bigint zero throws and floating-point arithmetic is not decimal rounding. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Compute native arithmetic once; getters/coercion must not be replayed by separate zero checks. */
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        const remainder = dataset.value % this.requirement;
        // Preserve both primitive zero results without loose equality or number/bigint conversion.
        if (remainder !== 0 && remainder !== 0n) {
          _addIssue(this, 'multiple', dataset, config);
        }
      }
      return dataset;
    },
  };
}
