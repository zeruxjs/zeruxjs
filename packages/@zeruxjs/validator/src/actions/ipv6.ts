import { IPV6_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * IPv6 issue interface.
 */
export interface Ipv6Issue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'ipv6';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The IPv6 regex.
   */
  readonly requirement: RegExp;
}

/**
 * IPv6 action interface.
 */
export interface Ipv6Action<
  TInput extends string,
  TMessage extends ErrorMessage<Ipv6Issue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, Ipv6Issue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'ipv6';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof ipv6;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The IPv6 regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check the compatibility IPv6 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. This action neither establishes the input schema nor grants permissions.
 * @returns {Ipv6Action<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function ipv6<TInput extends string>(): Ipv6Action<TInput, undefined>;

/** Check the compatibility IPv6 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Ipv6Action<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function ipv6<
  TInput extends string,
  const TMessage extends ErrorMessage<Ipv6Issue<TInput>> | undefined,
>(message: TMessage): Ipv6Action<TInput, TMessage>;

/** Check the compatibility IPv6 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<Ipv6Issue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Ipv6Action<string, ErrorMessage<Ipv6Issue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function ipv6(
  message?: ErrorMessage<Ipv6Issue<string>>
): Ipv6Action<string, ErrorMessage<Ipv6Issue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'ipv6',
    reference: ipv6,
    async: false,
    expects: null,
    requirement: IPV6_REGEX,
    message,
    /** Check the compatibility IPv6 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'IPv6', dataset, config);
      }
      return dataset;
    },
  };
}
