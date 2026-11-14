import { IPV4_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * IPv4 issue interface.
 */
export interface Ipv4Issue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'ipv4';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The IPv4 regex.
   */
  readonly requirement: RegExp;
}

/**
 * IPv4 action interface.
 */
export interface Ipv4Action<
  TInput extends string,
  TMessage extends ErrorMessage<Ipv4Issue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, Ipv4Issue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'ipv4';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof ipv4;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The IPv4 regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check the compatibility IPv4 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. This action neither establishes the input schema nor grants permissions.
 * @returns {Ipv4Action<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function ipv4<TInput extends string>(): Ipv4Action<TInput, undefined>;

/** Check the compatibility IPv4 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Ipv4Action<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function ipv4<
  TInput extends string,
  const TMessage extends ErrorMessage<Ipv4Issue<TInput>> | undefined,
>(message: TMessage): Ipv4Action<TInput, TMessage>;

/** Check the compatibility IPv4 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<Ipv4Issue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Ipv4Action<string, ErrorMessage<Ipv4Issue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function ipv4(
  message?: ErrorMessage<Ipv4Issue<string>>
): Ipv4Action<string, ErrorMessage<Ipv4Issue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'ipv4',
    reference: ipv4,
    async: false,
    expects: null,
    requirement: IPV4_REGEX,
    message,
    /** Check the compatibility IPv4 text pattern only; private/loopback addresses are not denied and no egress/DNS policy is enforced. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'IPv4', dataset, config);
      }
      return dataset;
    },
  };
}
