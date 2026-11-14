import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ContentInput, ContentRequirement } from './types.js';

/**
 * Excludes issue interface.
 */
export interface ExcludesIssue<
  TInput extends ContentInput,
  TRequirement extends ContentRequirement<TInput>,
> extends BaseIssue<TInput> {
  /**
   * Fixed refinement category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'excludes';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: string;
  /**
   * The content to be excluded.
   */
  readonly requirement: TRequirement;
}

/**
 * Excludes action interface.
 */
export interface ExcludesAction<
  TInput extends ContentInput,
  TRequirement extends ContentRequirement<TInput>,
  TMessage extends
    | ErrorMessage<ExcludesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, ExcludesIssue<TInput, TRequirement>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'excludes';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof excludes;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: string;
  /**
   * The content to be excluded.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject native string substring or array SameValueZero membership without cloning the requirement. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {ExcludesAction<TInput, TRequirement, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function excludes<
  TInput extends ContentInput,
  const TRequirement extends ContentRequirement<TInput>,
>(requirement: TRequirement): ExcludesAction<TInput, TRequirement, undefined>;

/** Reject native string substring or array SameValueZero membership without cloning the requirement. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ExcludesAction<TInput, TRequirement, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function excludes<
  TInput extends ContentInput,
  const TRequirement extends ContentRequirement<TInput>,
  const TMessage extends
    | ErrorMessage<ExcludesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): ExcludesAction<TInput, TRequirement, TMessage>;

/** Reject native string substring or array SameValueZero membership without cloning the requirement. Construction captures trusted policy without evaluating candidate data.
 * @param {ContentRequirement<ContentInput>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<ExcludesIssue<ContentInput, ContentRequirement<ContentInput>>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {ExcludesAction<ContentInput, ContentRequirement<ContentInput>, ErrorMessage<ExcludesIssue<ContentInput, ContentRequirement<ContentInput>>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function excludes(
  requirement: ContentRequirement<ContentInput>,
  message?: ErrorMessage<
    ExcludesIssue<ContentInput, ContentRequirement<ContentInput>>
  >
): ExcludesAction<
  ContentInput,
  ContentRequirement<ContentInput>,
  | ErrorMessage<ExcludesIssue<ContentInput, ContentRequirement<ContentInput>>>
  | undefined
> {
  /** Captured private forbidden-member diagnostic; borrowed requirement identity is retained. */
  const received = _stringify(requirement);
  return {
    kind: 'validation',
    type: 'excludes',
    reference: excludes,
    async: false,
    expects: `!${received}`,
    requirement,
    message,
    /** Reject native string substring or array SameValueZero membership without cloning the requirement. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      if (dataset.typed && dataset.value.includes(this.requirement)) {
        _addIssue(this, 'content', dataset, config, { received });
      }
      return dataset;
    },
  };
}
