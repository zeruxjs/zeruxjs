import type { BaseIssue } from '../../types/index.js';

/**
 * Array issue interface.
 */
export interface ArrayIssue extends BaseIssue<unknown> {
  /**
   * The issue kind.
   */
  readonly kind: 'schema';
  /**
   * The issue type.
   */
  readonly type: 'array';
  /**
   * The expected property.
   */
  readonly expected: 'Array';
}
