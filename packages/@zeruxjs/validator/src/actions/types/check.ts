import type { BaseIssue, MaybePromise } from '../../types/index.js';

/**
 * Check issue interface.
 */
export interface CheckIssue<TInput> extends BaseIssue<TInput> {
  /**
   * Fixed private action issue category.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'check';
  /**
   * Private diagnostic expectation; no authorization or safe HTML is implied.
   */
  readonly expected: null;
  /**
   * Borrowed trusted predicate reference retained for private diagnostics; no function source is evaluated.
   */
  readonly requirement: (input: TInput) => MaybePromise<boolean>;
}
