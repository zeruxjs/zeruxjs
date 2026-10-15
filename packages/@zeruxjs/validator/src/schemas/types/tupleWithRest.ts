import type { BaseIssue } from '../../types/index.js';

/**
 * Tuple with rest issue interface.
 */
export interface TupleWithRestIssue extends BaseIssue<unknown> {
  /**
   * The issue kind.
   */
  readonly kind: 'schema';
  /**
   * The issue type.
   */
  readonly type: 'tuple_with_rest';
  /**
   * The expected property.
   */
  readonly expected: 'Array';
}
