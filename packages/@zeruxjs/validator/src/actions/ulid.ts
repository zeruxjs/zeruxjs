import { ULID_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ULID issue interface.
 */
export interface UlidIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'ulid';
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
 * ULID action interface.
 */
export interface UlidAction<
  TInput extends string,
  TMessage extends ErrorMessage<UlidIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, UlidIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'ulid';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof ulid;
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

/** Check the retained 26-character ULID alphabet pattern without decoding timestamp/range or proving uniqueness. This action neither establishes the input schema nor grants permissions.
 * @returns {UlidAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function ulid<TInput extends string>(): UlidAction<TInput, undefined>;

/** Check the retained 26-character ULID alphabet pattern without decoding timestamp/range or proving uniqueness. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {UlidAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function ulid<
  TInput extends string,
  const TMessage extends ErrorMessage<UlidIssue<TInput>> | undefined,
>(message: TMessage): UlidAction<TInput, TMessage>;

/** Check the retained 26-character ULID alphabet pattern without decoding timestamp/range or proving uniqueness. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<UlidIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {UlidAction<string, ErrorMessage<UlidIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function ulid(
  message?: ErrorMessage<UlidIssue<string>>
): UlidAction<string, ErrorMessage<UlidIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'ulid',
    reference: ulid,
    async: false,
    expects: null,
    requirement: ULID_REGEX,
    message,
    /** Check the retained 26-character ULID alphabet pattern without decoding timestamp/range or proving uniqueness. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'ULID', dataset, config);
      }
      return dataset;
    },
  };
}
