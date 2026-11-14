import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { EntriesInput } from './types.js';

/**
 * Min entries issue interface.
 *
 * @beta
 */
export interface MinEntriesIssue<
  TInput extends EntriesInput,
  TRequirement extends number,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'min_entries';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The minimum entries.
   */
  readonly requirement: TRequirement;
}

/**
 * Min entries action interface.
 *
 * @beta
 */
export interface MinEntriesAction<
  TInput extends EntriesInput,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MinEntriesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<
  TInput,
  TInput,
  MinEntriesIssue<TInput, TRequirement>
> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'min_entries';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof minEntries;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>=${TRequirement}`;
  /**
   * The minimum entries.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require at least the configured count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {MinEntriesAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function minEntries<
  TInput extends EntriesInput,
  const TRequirement extends number,
>(requirement: TRequirement): MinEntriesAction<TInput, TRequirement, undefined>;

/** Require at least the configured count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinEntriesAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function minEntries<
  TInput extends EntriesInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MinEntriesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MinEntriesAction<TInput, TRequirement, TMessage>;

/** Require at least the configured count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<MinEntriesIssue<EntriesInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinEntriesAction<EntriesInput, number, ErrorMessage<MinEntriesIssue<EntriesInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function minEntries(
  requirement: number,
  message?: ErrorMessage<MinEntriesIssue<EntriesInput, number>>
): MinEntriesAction<
  EntriesInput,
  number,
  ErrorMessage<MinEntriesIssue<EntriesInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'min_entries',
    reference: minEntries,
    async: false,
    expects: `>=${requirement}`,
    requirement,
    message,
    /** Require at least the configured count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (!dataset.typed) {
        return dataset;
      }
      /** Measured native segment or own-key count; diagnostic output uses this captured value rather than recomputing it. */
      const count = Object.keys(dataset.value).length;
      if (dataset.typed && count < this.requirement) {
        _addIssue(this, 'entries', dataset, config, {
          received: `${count}`,
        });
      }
      return dataset;
    },
  };
}
