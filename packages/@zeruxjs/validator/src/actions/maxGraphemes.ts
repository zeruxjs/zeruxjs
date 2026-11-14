import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _getGraphemeCount } from '../utils/index.js';

/**
 * Max graphemes issue interface.
 */
export interface MaxGraphemesIssue<
  TInput extends string,
  TRequirement extends number,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'max_graphemes';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `<=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The maximum graphemes.
   */
  readonly requirement: TRequirement;
}

/**
 * Max graphemes action interface.
 */
export interface MaxGraphemesAction<
  TInput extends string,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MaxGraphemesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<
  TInput,
  TInput,
  MaxGraphemesIssue<TInput, TRequirement>
> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'max_graphemes';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof maxGraphemes;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `<=${TRequirement}`;
  /**
   * The maximum graphemes.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require at most the configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {MaxGraphemesAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxGraphemes<
  TInput extends string,
  const TRequirement extends number,
>(
  requirement: TRequirement
): MaxGraphemesAction<TInput, TRequirement, undefined>;

/** Require at most the configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxGraphemesAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxGraphemes<
  TInput extends string,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MaxGraphemesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MaxGraphemesAction<TInput, TRequirement, TMessage>;

/** Require at most the configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<MaxGraphemesIssue<string, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxGraphemesAction<string, number, ErrorMessage<MaxGraphemesIssue<string, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function maxGraphemes(
  requirement: number,
  message?: ErrorMessage<MaxGraphemesIssue<string, number>>
): MaxGraphemesAction<
  string,
  number,
  ErrorMessage<MaxGraphemesIssue<string, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'max_graphemes',
    reference: maxGraphemes,
    async: false,
    expects: `<=${requirement}`,
    requirement,
    message,
    /** Require at most the configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Measured native segment or own-key count; diagnostic output uses this captured value rather than recomputing it. */
        const count = _getGraphemeCount(dataset.value);
        if (count > this.requirement) {
          _addIssue(this, 'graphemes', dataset, config, {
            received: `${count}`,
          });
        }
      }
      return dataset;
    },
  };
}
