import type { BaseIssue } from '../../types/index.js';

/**
 * Object with rest issue interface.
 */
export interface ObjectWithRestIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw issues retain private candidate input.
   */
  readonly kind: 'schema';
  /**
   * Stable structural discriminator for issue consumers.
   */
  readonly type: 'object_with_rest';
  /**
   * Private type/key diagnostic; never proof of permission or sanitized output.
   */
  readonly expected: 'Object' | `"${string}"`;
}
