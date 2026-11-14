import { DOMAIN_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Domain issue interface.
 *
 * @beta
 */
export interface DomainIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'domain';
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
 * Domain action interface.
 *
 * @beta
 */
export interface DomainAction<
  TInput extends string,
  TMessage extends ErrorMessage<DomainIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, DomainIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'domain';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof domain;
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

/** Check the existing ASCII domain-label pattern, excluding punycode labels; no DNS lookup or ownership proof occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {DomainAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function domain<TInput extends string>(): DomainAction<
  TInput,
  undefined
>;

/** Check the existing ASCII domain-label pattern, excluding punycode labels; no DNS lookup or ownership proof occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {DomainAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function domain<
  TInput extends string,
  const TMessage extends ErrorMessage<DomainIssue<TInput>> | undefined,
>(message: TMessage): DomainAction<TInput, TMessage>;

/** Check the existing ASCII domain-label pattern, excluding punycode labels; no DNS lookup or ownership proof occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<DomainIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {DomainAction<string, ErrorMessage<DomainIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function domain(
  message?: ErrorMessage<DomainIssue<string>>
): DomainAction<string, ErrorMessage<DomainIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'domain',
    reference: domain,
    expects: null,
    async: false,
    requirement: DOMAIN_REGEX,
    message,
    /** Check the existing ASCII domain-label pattern, excluding punycode labels; no DNS lookup or ownership proof occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'domain', dataset, config);
      }
      return dataset;
    },
  };
}
