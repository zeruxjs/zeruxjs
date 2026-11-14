import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _getWordCount } from '../utils/index.js';

/**
 * Min words issue interface.
 */
export interface MinWordsIssue<
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
  readonly type: 'min_words';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The minimum words.
   */
  readonly requirement: TRequirement;
}

/**
 * Min words action interface.
 */
export interface MinWordsAction<
  TInput extends string,
  TLocales extends Intl.LocalesArgument,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MinWordsIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MinWordsIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'min_words';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof minWords;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>=${TRequirement}`;
  /**
   * The locales to be used.
   */
  readonly locales: TLocales;
  /**
   * The minimum words.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require at least the configured count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. This action neither establishes the input schema nor grants permissions.
 * @param {TLocales} locales - Explicit bounded locale configuration; exact locale-array identity is retained and invalid Intl settings may throw.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {MinWordsAction<TInput, TLocales, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minWords<
  TInput extends string,
  TLocales extends Intl.LocalesArgument,
  const TRequirement extends number,
>(
  locales: TLocales,
  requirement: TRequirement
): MinWordsAction<TInput, TLocales, TRequirement, undefined>;

/** Require at least the configured count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. This action neither establishes the input schema nor grants permissions.
 * @param {TLocales} locales - Explicit bounded locale configuration; exact locale-array identity is retained and invalid Intl settings may throw.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinWordsAction<TInput, TLocales, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minWords<
  TInput extends string,
  TLocales extends Intl.LocalesArgument,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MinWordsIssue<TInput, TRequirement>>
    | undefined,
>(
  locales: TLocales,
  requirement: TRequirement,
  message: TMessage
): MinWordsAction<TInput, TLocales, TRequirement, TMessage>;

/** Require at least the configured count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. This action neither establishes the input schema nor grants permissions.
 * @param {Intl.LocalesArgument} locales - Explicit bounded locale configuration; exact locale-array identity is retained and invalid Intl settings may throw.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<MinWordsIssue<string, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinWordsAction<string, Intl.LocalesArgument, number, ErrorMessage<MinWordsIssue<string, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function minWords(
  locales: Intl.LocalesArgument,
  requirement: number,
  message?: ErrorMessage<MinWordsIssue<string, number>>
): MinWordsAction<
  string,
  Intl.LocalesArgument,
  number,
  ErrorMessage<MinWordsIssue<string, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'min_words',
    reference: minWords,
    async: false,
    expects: `>=${requirement}`,
    locales,
    requirement,
    message,
    /** Require at least the configured count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Measured native segment or own-key count; diagnostic output uses this captured value rather than recomputing it. */
        const count = _getWordCount(this.locales, dataset.value);
        if (count < this.requirement) {
          _addIssue(this, 'words', dataset, config, {
            received: `${count}`,
          });
        }
      }
      return dataset;
    },
  };
}
