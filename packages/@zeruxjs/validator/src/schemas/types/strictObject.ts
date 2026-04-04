import type { BaseIssue } from '../../types/index.js';

/**
 * Strict object issue interface.
 */
export interface StrictObjectIssue extends BaseIssue<unknown> {
  /**
   * The issue kind.
   */
  readonly kind: 'schema';
  /**
   * The issue type.
   */
  readonly type: 'strict_object';
  /**
   * The expected property.
   */
  readonly expected: 'Object' | `"${string}"` | 'never';
}
