import { UUID_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * UUID issue interface.
 */
export interface UuidIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'uuid';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /** Borrowed compatibility RegExp shared with public regex exports; hosts must not mutate it or treat a syntax match as authorization. */
  readonly requirement: RegExp;
}

/**
 * UUID action interface.
 */
export interface UuidAction<
  TInput extends string,
  TMessage extends ErrorMessage<UuidIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, UuidIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'uuid';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof uuid;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /** Borrowed compatibility RegExp shared with public regex exports; hosts must not mutate it or treat a syntax match as authorization. */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check five hyphenated hexadecimal groups; no UUID version/variant, randomness or ownership guarantee is inferred. This action neither establishes the input schema nor grants permissions.
 * @returns {UuidAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function uuid<TInput extends string>(): UuidAction<TInput, undefined>;

/** Check five hyphenated hexadecimal groups; no UUID version/variant, randomness or ownership guarantee is inferred. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {UuidAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function uuid<
  TInput extends string,
  const TMessage extends ErrorMessage<UuidIssue<TInput>> | undefined,
>(message: TMessage): UuidAction<TInput, TMessage>;

/** Check five hyphenated hexadecimal groups; no UUID version/variant, randomness or ownership guarantee is inferred. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<UuidIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {UuidAction<string, ErrorMessage<UuidIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function uuid(
  message?: ErrorMessage<UuidIssue<string>>
): UuidAction<string, ErrorMessage<UuidIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'uuid',
    reference: uuid,
    async: false,
    expects: null,
    requirement: UUID_REGEX,
    message,
    /** Check five hyphenated hexadecimal groups; no UUID version/variant, randomness or ownership guarantee is inferred. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'UUID', dataset, config);
      }
      return dataset;
    },
  };
}
