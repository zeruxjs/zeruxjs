import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Starts with issue interface.
 */
export interface StartsWithIssue<
  TInput extends string,
  TRequirement extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'starts_with';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: `"${TRequirement}"`;
  /**
   * Private mismatch diagnostic that may include submitted content.
   */
  readonly received: `"${string}"`;
  /**
   * The start string.
   */
  readonly requirement: TRequirement;
}

/**
 * Starts with action interface.
 */
export interface StartsWithAction<
  TInput extends string,
  TRequirement extends string,
  TMessage extends
    | ErrorMessage<StartsWithIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<
  TInput,
  TInput,
  StartsWithIssue<TInput, TRequirement>
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'starts_with';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof startsWith;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: `"${TRequirement}"`;
  /**
   * The start string.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native case-sensitive string prefix matching without normalization, decoding or destination authorization. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {StartsWithAction<TInput, TRequirement, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function startsWith<
  TInput extends string,
  const TRequirement extends string,
>(requirement: TRequirement): StartsWithAction<TInput, TRequirement, undefined>;

/** Use native case-sensitive string prefix matching without normalization, decoding or destination authorization. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {StartsWithAction<TInput, TRequirement, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function startsWith<
  TInput extends string,
  const TRequirement extends string,
  const TMessage extends
    | ErrorMessage<StartsWithIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): StartsWithAction<TInput, TRequirement, TMessage>;

/** Use native case-sensitive string prefix matching without normalization, decoding or destination authorization. Construction captures trusted policy without evaluating candidate data.
 * @param {string} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<StartsWithIssue<string, string>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {StartsWithAction<string, string, ErrorMessage<StartsWithIssue<string, string>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function startsWith(
  requirement: string,
  message?: ErrorMessage<StartsWithIssue<string, string>>
): StartsWithAction<
  string,
  string,
  ErrorMessage<StartsWithIssue<string, string>> | undefined
> {
  return {
    kind: 'validation',
    type: 'starts_with',
    reference: startsWith,
    async: false,
    expects: `"${requirement}"`,
    requirement,
    message,
    /** Use native case-sensitive string prefix matching without normalization, decoding or destination authorization. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !dataset.value.startsWith(this.requirement)) {
        _addIssue(this, 'start', dataset, config, {
          received: `"${dataset.value.slice(0, this.requirement.length)}"`,
        });
      }
      return dataset;
    },
  };
}
