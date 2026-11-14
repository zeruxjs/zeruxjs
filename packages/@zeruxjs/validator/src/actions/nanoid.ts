import { NANO_ID_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Nano ID issue interface.
 */
export interface NanoIdIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'nanoid';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: string;
  /** Borrowed compatibility RegExp shared with public regex exports; hosts must not mutate it or treat a syntax match as authorization. */
  readonly requirement: RegExp;
}

/**
 * Nano ID issue type.
 *
 * @deprecated Use `NanoIdIssue` instead.
 */
export type NanoIDIssue<TInput extends string> = NanoIdIssue<TInput>;

/**
 * Nano ID action interface.
 */
export interface NanoIdAction<
  TInput extends string,
  TMessage extends ErrorMessage<NanoIdIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, NanoIdIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'nanoid';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof nanoid;
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

/**
 * Nano ID action type.
 *
 * @deprecated Use `NanoIdAction` instead.
 */
export type NanoIDAction<
  TInput extends string,
  TMessage extends ErrorMessage<NanoIdIssue<TInput>> | undefined,
> = NanoIdAction<TInput, TMessage>;

/** Check the retained nonempty Nano-ID-shaped alphabet; generation length, entropy, uniqueness and ownership are not established. This action neither establishes the input schema nor grants permissions.
 * @returns {NanoIdAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function nanoid<TInput extends string>(): NanoIdAction<
  TInput,
  undefined
>;

/** Check the retained nonempty Nano-ID-shaped alphabet; generation length, entropy, uniqueness and ownership are not established. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NanoIdAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function nanoid<
  TInput extends string,
  const TMessage extends ErrorMessage<NanoIdIssue<TInput>> | undefined,
>(message: TMessage): NanoIdAction<TInput, TMessage>;

/** Check the retained nonempty Nano-ID-shaped alphabet; generation length, entropy, uniqueness and ownership are not established. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<NanoIdIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NanoIdAction<string, ErrorMessage<NanoIdIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function nanoid(
  message?: ErrorMessage<NanoIdIssue<string>>
): NanoIdAction<string, ErrorMessage<NanoIdIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'nanoid',
    reference: nanoid,
    async: false,
    expects: null,
    requirement: NANO_ID_REGEX,
    message,
    /** Check the retained nonempty Nano-ID-shaped alphabet; generation length, entropy, uniqueness and ownership are not established. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'Nano ID', dataset, config);
      }
      return dataset;
    },
  };
}
