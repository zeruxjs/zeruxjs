import type { BaseIssue } from '../../types/index.js';

/**
 * Object issue interface.
 */
export interface ObjectIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw issues retain private candidate input.
   */
  readonly kind: 'schema';
  /**
   * Stable structural discriminator for issue consumers.
   */
  readonly type: 'object';
  /**
   * Private type/key diagnostic; never proof of permission or sanitized output.
   */
  readonly expected: 'Object' | `"${string}"`;
}
