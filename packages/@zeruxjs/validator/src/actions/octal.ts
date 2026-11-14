import { OCTAL_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Octal issue interface.
 */
export interface OctalIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'octal';
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
 * Octal action interface.
 */
export interface OctalAction<
  TInput extends string,
  TMessage extends ErrorMessage<OctalIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, OctalIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'octal';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof octal;
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

/** Check octal digits with the retained optional lowercase 0o prefix; no numeric conversion occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {OctalAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function octal<TInput extends string>(): OctalAction<TInput, undefined>;

/** Check octal digits with the retained optional lowercase 0o prefix; no numeric conversion occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {OctalAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function octal<
  TInput extends string,
  const TMessage extends ErrorMessage<OctalIssue<TInput>> | undefined,
>(message: TMessage): OctalAction<TInput, TMessage>;

/** Check octal digits with the retained optional lowercase 0o prefix; no numeric conversion occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<OctalIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {OctalAction<string, ErrorMessage<OctalIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function octal(
  message?: ErrorMessage<OctalIssue<string>>
): OctalAction<string, ErrorMessage<OctalIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'octal',
    reference: octal,
    async: false,
    expects: null,
    requirement: OCTAL_REGEX,
    message,
    /** Check octal digits with the retained optional lowercase 0o prefix; no numeric conversion occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'octal', dataset, config);
      }
      return dataset;
    },
  };
}
