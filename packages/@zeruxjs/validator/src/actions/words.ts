import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _getWordCount } from '../utils/index.js';

/**
 * Words issue interface.
 */
export interface WordsIssue<
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
  readonly type: 'words';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The required words.
   */
  readonly requirement: TRequirement;
}

/**
 * Words action interface.
 */
export interface WordsAction<
  TInput extends string,
  TLocales extends Intl.LocalesArgument,
  TRequirement extends number,
  TMessage extends ErrorMessage<WordsIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, WordsIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'words';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof words;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `${TRequirement}`;
  /**
   * The locales to be used.
   */
  readonly locales: TLocales;
  /**
   * The required words.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require an exact count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. This action neither establishes the input schema nor grants permissions.
 * @param {TLocales} locales - Explicit bounded locale configuration; exact locale-array identity is retained and invalid Intl settings may throw.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {WordsAction<TInput, TLocales, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function words<
  TInput extends string,
  const TLocales extends Intl.LocalesArgument,
  const TRequirement extends number,
>(
  locales: TLocales,
  requirement: TRequirement
): WordsAction<TInput, TLocales, TRequirement, undefined>;

/** Require an exact count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. This action neither establishes the input schema nor grants permissions.
 * @param {TLocales} locales - Explicit bounded locale configuration; exact locale-array identity is retained and invalid Intl settings may throw.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {WordsAction<TInput, TLocales, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function words<
  TInput extends string,
  const TLocales extends Intl.LocalesArgument,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<WordsIssue<TInput, TRequirement>>
    | undefined,
>(
  locales: TLocales,
  requirement: TRequirement,
  message: TMessage
): WordsAction<TInput, TLocales, TRequirement, TMessage>;

/** Require an exact count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. This action neither establishes the input schema nor grants permissions.
 * @param {Intl.LocalesArgument} locales - Explicit bounded locale configuration; exact locale-array identity is retained and invalid Intl settings may throw.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<WordsIssue<string, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {WordsAction<string, Intl.LocalesArgument, number, ErrorMessage<WordsIssue<string, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function words(
  locales: Intl.LocalesArgument,
  requirement: number,
  message?: ErrorMessage<WordsIssue<string, number>>
): WordsAction<
  string,
  Intl.LocalesArgument,
  number,
  ErrorMessage<WordsIssue<string, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'words',
    reference: words,
    async: false,
    expects: `${requirement}`,
    locales,
    requirement,
    message,
    /** Require an exact count of native locale-specific word-like Intl segments; locale configuration must remain bounded because the legacy segmenter cache has no eviction. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Measured native segment or own-key count; diagnostic output uses this captured value rather than recomputing it. */
        const count = _getWordCount(this.locales, dataset.value);
        if (count !== this.requirement) {
          _addIssue(this, 'words', dataset, config, {
            received: `${count}`,
          });
        }
      }
      return dataset;
    },
  };
}
