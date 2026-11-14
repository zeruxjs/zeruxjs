import type { BaseIssue } from '../../types/index.js';
import type { ArrayInput, ArrayRequirementAsync } from '../types.js';

/**
 * Check items issue interface.
 */
export interface CheckItemsIssue<TInput extends ArrayInput> extends BaseIssue<
  TInput[number]
> {
  /**
   * Fixed private action issue category.
   */
  readonly kind: 'validation';
  /**
   * Stable action discriminator for structured issue consumers.
   */
  readonly type: 'check_items';
  /**
   * Private expectation for the declared refinement, not proof of complete validation.
   */
  readonly expected: null;
  /**
   * Borrowed trusted predicate reference retained for private diagnostics; no function source is evaluated.
   */
  readonly requirement: ArrayRequirementAsync<TInput>;
}
