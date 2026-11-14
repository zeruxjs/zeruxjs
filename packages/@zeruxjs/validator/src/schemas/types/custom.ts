import type { BaseIssue } from '../../types/index.js';

/**
 * Custom issue interface.
 */
export interface CustomIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema failure category; rejected candidates remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable custom-predicate discriminator for issue consumers.
   */
  readonly type: 'custom';
  /**
   * Generic private diagnostic; host type assertions do not supply a synthesized runtime expectation.
   */
  readonly expected: 'unknown';
}
