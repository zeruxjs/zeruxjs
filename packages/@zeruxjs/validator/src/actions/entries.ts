import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { EntriesInput } from './types.js';

/**
 * Entries issue interface.
 *
 * @beta
 */
export interface EntriesIssue<
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
  readonly type: 'entries';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The required entries.
   */
  readonly requirement: TRequirement;
}

/**
 * Entries action interface.
 *
 * @beta
 */
export interface EntriesAction<
  TInput extends EntriesInput,
  TRequirement extends number,
  TMessage extends ErrorMessage<EntriesIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, EntriesIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'entries';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof entries;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `${TRequirement}`;
  /**
   * The required entries.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require an exact count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {EntriesAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function entries<
  TInput extends EntriesInput,
  const TRequirement extends number,
>(requirement: TRequirement): EntriesAction<TInput, TRequirement, undefined>;

/** Require an exact count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {EntriesAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function entries<
  TInput extends EntriesInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<EntriesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): EntriesAction<TInput, TRequirement, TMessage>;

/** Require an exact count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<EntriesIssue<EntriesInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {EntriesAction<EntriesInput, number, ErrorMessage<EntriesIssue<EntriesInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function entries(
  requirement: number,
  message?: ErrorMessage<EntriesIssue<EntriesInput, number>>
): EntriesAction<
  EntriesInput,
  number,
  ErrorMessage<EntriesIssue<EntriesInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'entries',
    reference: entries,
    async: false,
    expects: `${requirement}`,
    requirement,
    message,
    /** Require an exact count of own enumerable string keys via Object.keys; symbols and inherited keys do not contribute. Untyped datasets are left for the owning schema to reject.
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
      if (dataset.typed && count !== this.requirement) {
        _addIssue(this, 'entries', dataset, config, {
          received: `${count}`,
        });
      }
      return dataset;
    },
  };
}
