import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _getGraphemeCount } from '../utils/index.js';

/**
 * Not graphemes issue interface.
 */
export interface NotGraphemesIssue<
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
  readonly type: 'not_graphemes';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `!${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The not required graphemes.
   */
  readonly requirement: TRequirement;
}

/**
 * Not graphemes action interface.
 */
export interface NotGraphemesAction<
  TInput extends string,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<NotGraphemesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<
  TInput,
  TInput,
  NotGraphemesIssue<TInput, TRequirement>
> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'not_graphemes';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof notGraphemes;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `!${TRequirement}`;
  /**
   * The not required graphemes.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject the exact configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {NotGraphemesAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notGraphemes<
  TInput extends string,
  const TRequirement extends number,
>(
  requirement: TRequirement
): NotGraphemesAction<TInput, TRequirement, undefined>;

/** Reject the exact configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotGraphemesAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notGraphemes<
  TInput extends string,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<NotGraphemesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): NotGraphemesAction<TInput, TRequirement, TMessage>;

/** Reject the exact configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<NotGraphemesIssue<string, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotGraphemesAction<string, number, ErrorMessage<NotGraphemesIssue<string, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function notGraphemes(
  requirement: number,
  message?: ErrorMessage<NotGraphemesIssue<string, number>>
): NotGraphemesAction<
  string,
  number,
  ErrorMessage<NotGraphemesIssue<string, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'not_graphemes',
    reference: notGraphemes,
    async: false,
    expects: `!${requirement}`,
    requirement,
    message,
    /** Reject the exact configured count of native default-locale Intl grapheme segments; ICU/runtime coverage determines segmentation. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Measured native segment or own-key count; diagnostic output uses this captured value rather than recomputing it. */
        const count = _getGraphemeCount(dataset.value);
        if (count === this.requirement) {
          _addIssue(this, 'graphemes', dataset, config, {
            received: `${count}`,
          });
        }
      }
      return dataset;
    },
  };
}
