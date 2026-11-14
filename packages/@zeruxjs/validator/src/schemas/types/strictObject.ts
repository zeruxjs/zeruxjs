import type { BaseIssue } from '../../types/index.js';

/**
 * Strict object issue interface.
 */
export interface StrictObjectIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw issues retain private candidate input.
   */
  readonly kind: 'schema';
  /**
   * Stable structural discriminator for issue consumers.
   */
  readonly type: 'strict_object';
  /**
   * Private type/key diagnostic; never proof of permission or sanitized output.
   */
  readonly expected: 'Object' | `"${string}"` | 'never';
}
