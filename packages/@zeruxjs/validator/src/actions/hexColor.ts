import { HEX_COLOR_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Hex color issue interface.
 */
export interface HexColorIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'hex_color';
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
 * Hex color action interface.
 */
export interface HexColorAction<
  TInput extends string,
  TMessage extends ErrorMessage<HexColorIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, HexColorIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'hex_color';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof hexColor;
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

/** Check hash-prefixed three/four/six/eight hexadecimal color digits; no CSS parsing or contrast validation occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {HexColorAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function hexColor<TInput extends string>(): HexColorAction<
  TInput,
  undefined
>;

/** Check hash-prefixed three/four/six/eight hexadecimal color digits; no CSS parsing or contrast validation occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {HexColorAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function hexColor<
  TInput extends string,
  const TMessage extends ErrorMessage<HexColorIssue<TInput>> | undefined,
>(message: TMessage): HexColorAction<TInput, TMessage>;

/** Check hash-prefixed three/four/six/eight hexadecimal color digits; no CSS parsing or contrast validation occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<HexColorIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {HexColorAction<string, ErrorMessage<HexColorIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function hexColor(
  message?: ErrorMessage<HexColorIssue<string>>
): HexColorAction<string, ErrorMessage<HexColorIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'hex_color',
    reference: hexColor,
    async: false,
    expects: null,
    requirement: HEX_COLOR_REGEX,
    message,
    /** Check hash-prefixed three/four/six/eight hexadecimal color digits; no CSS parsing or contrast validation occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'hex color', dataset, config);
      }
      return dataset;
    },
  };
}
