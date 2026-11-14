import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ContentInput, ContentRequirement } from './types.js';

/**
 * Includes issue interface.
 */
export interface IncludesIssue<
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
  readonly type: 'includes';
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expected: string;
  /**
   * The content to be included.
   */
  readonly requirement: TRequirement;
}

/**
 * Includes action interface.
 */
export interface IncludesAction<
  TInput extends ContentInput,
  TRequirement extends ContentRequirement<TInput>,
  TMessage extends
    | ErrorMessage<IncludesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, IncludesIssue<TInput, TRequirement>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'includes';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof includes;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: string;
  /**
   * The content to be included.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Use native string substring or array SameValueZero membership; nested objects compare by identity. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @returns {IncludesAction<TInput, TRequirement, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function includes<
  TInput extends ContentInput,
  const TRequirement extends ContentRequirement<TInput>,
>(requirement: TRequirement): IncludesAction<TInput, TRequirement, undefined>;

/** Use native string substring or array SameValueZero membership; nested objects compare by identity. Construction captures trusted policy without evaluating candidate data.
 * @param {TRequirement} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {IncludesAction<TInput, TRequirement, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function includes<
  TInput extends ContentInput,
  const TRequirement extends ContentRequirement<TInput>,
  const TMessage extends
    | ErrorMessage<IncludesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): IncludesAction<TInput, TRequirement, TMessage>;

/** Use native string substring or array SameValueZero membership; nested objects compare by identity. Construction captures trusted policy without evaluating candidate data.
 * @param {ContentRequirement<ContentInput>} requirement - Explicit substring/member list or trusted synchronous predicate; no source string is evaluated as a callback.
 * @param {ErrorMessage<IncludesIssue<ContentInput, ContentRequirement<ContentInput>>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {IncludesAction<ContentInput, ContentRequirement<ContentInput>, ErrorMessage<IncludesIssue<ContentInput, ContentRequirement<ContentInput>>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function includes(
  requirement: ContentRequirement<ContentInput>,
  message?: ErrorMessage<
    IncludesIssue<ContentInput, ContentRequirement<ContentInput>>
  >
): IncludesAction<
  ContentInput,
  ContentRequirement<ContentInput>,
  | ErrorMessage<IncludesIssue<ContentInput, ContentRequirement<ContentInput>>>
  | undefined
> {
  /** Captured private requirement diagnostic; it is neither escaped HTML nor proof of authorization. */
  const expects = _stringify(requirement);
  return {
    kind: 'validation',
    type: 'includes',
    reference: includes,
    async: false,
    expects,
    requirement,
    message,
    /** Use native string substring or array SameValueZero membership; nested objects compare by identity. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      if (dataset.typed && !dataset.value.includes(this.requirement)) {
        _addIssue(this, 'content', dataset, config, {
          received: `!${expects}`,
        });
      }
      return dataset;
    },
  };
}
