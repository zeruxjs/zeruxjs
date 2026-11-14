import type { BaseIssue } from '../../types/index.js';

/**
 * Tuple with rest issue interface.
 */
export interface TupleWithRestIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; raw issues retain private candidate input.
   */
  readonly kind: 'schema';
  /**
   * Stable structural discriminator for issue consumers.
   */
  readonly type: 'tuple_with_rest';
  /**
   * Private type/key diagnostic; never proof of permission or sanitized output.
   */
  readonly expected: 'Array';
}
