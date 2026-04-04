import type { BaseIssue } from '../../types/index.js';

/**
 * Custom issue interface.
 */
export interface CustomIssue extends BaseIssue<unknown> {
  /**
   * The issue kind.
   */
  readonly kind: 'schema';
  /**
   * The issue type.
   */
  readonly type: 'custom';
  /**
   * The expected property.
   */
  readonly expected: 'unknown';
}
