import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Ends with issue interface.
 */
export interface EndsWithIssue<
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
  readonly type: 'ends_with';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: `"${TRequirement}"`;
  /**
   * Private mismatch diagnostic that may include submitted content.
   */
  readonly received: `"${string}"`;
  /**
   * The end string.
   */
  readonly requirement: TRequirement;
}

/**
 * Ends with action interface.
 */
export interface EndsWithAction<
  TInput extends string,
  TRequirement extends string,
  TMessage extends
    | ErrorMessage<EndsWithIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, EndsWithIssue<TInput, TRequirement>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'ends_with';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof endsWith;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: `"${TRequirement}"`;
  /**
   * The end string.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native case-sensitive string suffix matching without normalization or filename/host authorization. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {EndsWithAction<TInput, TRequirement, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function endsWith<
  TInput extends string,
  const TRequirement extends string,
>(requirement: TRequirement): EndsWithAction<TInput, TRequirement, undefined>;

/** Use native case-sensitive string suffix matching without normalization or filename/host authorization. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {EndsWithAction<TInput, TRequirement, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function endsWith<
  TInput extends string,
  const TRequirement extends string,
  const TMessage extends
    | ErrorMessage<EndsWithIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): EndsWithAction<TInput, TRequirement, TMessage>;

/** Use native case-sensitive string suffix matching without normalization or filename/host authorization. Construction captures trusted policy without evaluating candidate data.
 * @param {string} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<EndsWithIssue<string, string>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {EndsWithAction<string, string, ErrorMessage<EndsWithIssue<string, string>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function endsWith(
  requirement: string,
  message?: ErrorMessage<EndsWithIssue<string, string>>
): EndsWithAction<
  string,
  string,
  ErrorMessage<EndsWithIssue<string, string>> | undefined
> {
  return {
    kind: 'validation',
    type: 'ends_with',
    reference: endsWith,
    async: false,
    expects: `"${requirement}"`,
    requirement,
    message,
    /** Use native case-sensitive string suffix matching without normalization or filename/host authorization. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !dataset.value.endsWith(this.requirement)) {
        _addIssue(this, 'end', dataset, config, {
          received: `"${dataset.value.slice(-this.requirement.length)}"`,
        });
      }
      return dataset;
    },
  };
}
