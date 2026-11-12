import type { BaseSchema, SuccessDataset } from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Unknown schema interface.
 */
export interface UnknownSchema extends BaseSchema<unknown, unknown, never> {
  /**
   * Fixed permissive schema discriminator; root input budgets still apply.
   */
  readonly type: 'unknown';
  /**
   * Authored constructor reference; no source code is loaded from data.
   */
  readonly reference: typeof unknown;
  /**
   * Diagnostic metadata only; this schema adds no input-type refinement.
   */
  readonly expects: 'unknown';
}

/**
 * Accept a bounded value with unknown typing while preserving its borrowed runtime identity. No input value is executed or deep-cloned.
 *
 * @returns {UnknownSchema} Inert permissive schema; acceptance is not authorization or privacy isolation.
 */
// @__NO_SIDE_EFFECTS__
export function unknown(): UnknownSchema {
  return {
    kind: 'schema',
    type: 'unknown',
    reference: unknown,
    expects: 'unknown',
    async: false,
    /** Adapt explicit validation to the same root budgets and cleanup.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Establish the declared permissive type without invoking or cloning its value.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private bounded input dataset.
     * @returns {SuccessDataset<unknown>} Same dataset with its type flag established; direct internal dispatch is not a standalone safety boundary.
     */
    '~run'(dataset) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.typed = true;
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as SuccessDataset<unknown>;
    },
  };
}
