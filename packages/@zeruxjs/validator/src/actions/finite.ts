import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Finite issue interface.
 */
export interface FiniteIssue<TInput extends number> extends BaseIssue<TInput> {
  /**
   * Validation refinement issue category; the primitive schema owns input typing.
   */
  readonly kind: 'validation';
  /**
   * Stable finite-refinement discriminator used by structured private issues.
   */
  readonly type: 'finite';
  /**
   * No separate expected literal; the native finite predicate defines the requirement.
   */
  readonly expected: null;
  /**
   * Private numeric diagnostic representation, not a public response field.
   */
  readonly received: `${number}`;
  /**
   * Borrowed native Number.isFinite predicate; it does not coerce strings or invoke input code.
   */
  readonly requirement: (input: number) => boolean;
}

/**
 * Finite action interface.
 */
export interface FiniteAction<
  TInput extends number,
  TMessage extends ErrorMessage<FiniteIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, FiniteIssue<TInput>> {
  /**
   * Fixed finite action discriminator; compose after a compatible numeric schema.
   */
  readonly type: 'finite';
  /**
   * Authored constructor reference; no runtime provider or module discovery.
   */
  readonly reference: typeof finite;
  /**
   * No separate expected literal; the native finite predicate defines the requirement.
   */
  readonly expects: null;
  /**
   * Borrowed native Number.isFinite predicate; it does not coerce strings or invoke input code.
   */
  readonly requirement: (input: number) => boolean;
  /**
   * Optional trusted private diagnostic text/callback, not public HTML or source code.
   */
  readonly message: TMessage;
}

/**
 * Refine typed numeric input using Number.isFinite without coercion. Unlike the base number schema, this explicitly rejects infinite values.
 *
 * @returns {FiniteAction<TInput, undefined>} Inert refinement action; actual validation starts only in an explicit parse.
 */
export function finite<TInput extends number>(): FiniteAction<
  TInput,
  undefined
>;

/**
 * Refine typed numeric input using Number.isFinite without coercion. Unlike the base number schema, this explicitly rejects infinite values.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {FiniteAction<TInput, TMessage>} Inert action retaining the borrowed diagnostic policy.
 */
export function finite<
  TInput extends number,
  const TMessage extends ErrorMessage<FiniteIssue<TInput>> | undefined,
>(message: TMessage): FiniteAction<TInput, TMessage>;

/** Build an inert native finite-number refinement.
 * @param {ErrorMessage<FiniteIssue<number>>} message - Optional trusted private diagnostic text/callback.
 * @returns {FiniteAction<number, ErrorMessage<FiniteIssue<number>> | undefined>} Native finite check embedded in the schema action contract, not an immediate Boolean predicate.
 */
// @__NO_SIDE_EFFECTS__
export function finite(
  message?: ErrorMessage<FiniteIssue<number>>
): FiniteAction<number, ErrorMessage<FiniteIssue<number>> | undefined> {
  return {
    kind: 'validation',
    type: 'finite',
    reference: finite,
    async: false,
    expects: null,
    requirement: Number.isFinite,
    message,
    /** Refine only already-typed input without coercing or re-running an upstream schema.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private dataset and typed flag.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Root issue budget and private message policy.
     * @returns {unknown} Same dataset with a private refinement issue only when the typed finite check fails.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'finite', dataset, config);
      }
      return dataset;
    },
  };
}
