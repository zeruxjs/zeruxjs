import type { BaseIssue } from '../../types/index.js';

/**
 * Object issue interface.
 */
export interface ObjectIssue extends BaseIssue<unknown> {
  /**
   * The issue kind.
   */
  readonly kind: 'schema';
  /**
   * The issue type.
   */
  readonly type: 'object';
  /**
   * The expected property.
   */
  readonly expected: 'Object' | `"${string}"`;
}
