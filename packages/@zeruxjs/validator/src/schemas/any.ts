import type { BaseSchema, SuccessDataset } from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Any schema interface.
 */
export interface AnySchema extends BaseSchema<any, any, never> {
  /**
   * Fixed permissive schema discriminator; root input budgets still apply.
   */
  readonly type: 'any';
  /**
   * Authored constructor reference; no source code is loaded from data.
   */
  readonly reference: typeof any;
  /**
   * Diagnostic metadata only; this schema adds no input-type refinement.
   */
  readonly expects: 'any';
}

/**
 * Accept a bounded value with any typing while preserving its borrowed runtime identity. Root graph/accessor/cycle checks still run.
 *
 * Hint: This schema function exists only for completeness and is not
 * recommended in practice. Instead, `unknown` should be used to accept
 * unknown data.
 *
 * @returns {AnySchema} Inert permissive schema; root execution limits remain authoritative.
 */
// @__NO_SIDE_EFFECTS__
export function any(): AnySchema {
  return {
    kind: 'schema',
    type: 'any',
    reference: any,
    expects: 'any',
    async: false,
    /** Adapt explicit validation to the same root budgets and cleanup.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Establish the declared permissive type without invoking or cloning its value.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private bounded input dataset.
     * @returns {SuccessDataset<any>} Same dataset with its type flag established; direct internal dispatch is not a standalone safety boundary.
     */
    '~run'(dataset) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.typed = true;
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as SuccessDataset<any>;
    },
  };
}
