import type { BaseIssue } from '../../types/index.js';

/**
 * Union issue interface.
 */
export interface UnionIssue<
  TSubIssue extends BaseIssue<unknown>,
> extends BaseIssue<unknown> {
  /**
   * Fixed structural validation category; raw input and diagnostics remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable discriminator for issue code consumers.
   */
  readonly type: 'union';
  /**
   * Private diagnostic expectation, never proof of permission or safe rendered content.
   */
  readonly expected: string;
  /**
   * Borrowed failed-branch issue records; may retain submitted values and original paths.
   */
  readonly issues?: [TSubIssue, ...TSubIssue[]];
}
