import type { BaseIssue } from '../../types/index.js';

/**
 * Array issue interface.
 */
export interface ArrayIssue extends BaseIssue<unknown> {
  /**
   * Fixed structural validation category; raw input and diagnostics remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable discriminator for issue code consumers.
   */
  readonly type: 'array';
  /**
   * Private diagnostic expectation, never proof of permission or safe rendered content.
   */
  readonly expected: 'Array';
}
