import { syncCallback } from '../utils/_run.js';
import type { BaseValidation } from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { RawCheckContext, RawCheckIssue } from './types/rawCheck.js';

/**
 * Raw check action interface.
 */
export interface RawCheckAction<TInput> extends BaseValidation<
  TInput,
  TInput,
  RawCheckIssue<TInput>
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'raw_check';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof rawCheck;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
}

/** Invoke a trusted synchronous callback with the private dataset/config and addIssue closure; native async callbacks and thenables reject. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(context: RawCheckContext<TInput>) => void} action - Explicit trusted raw callback with private parse context; do not retain its context or invoke addIssue after settlement.
 * @returns {RawCheckAction<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function rawCheck<TInput>(
  action: (context: RawCheckContext<TInput>) => void
): RawCheckAction<TInput> {
  return {
    kind: 'validation',
    type: 'raw_check',
    reference: rawCheck,
    async: false,
    expects: null,
    /** Invoke a trusted synchronous callback with the private dataset/config and addIssue closure; native async callbacks and thenables reject. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      syncCallback(action, {
        dataset,
        config,
        addIssue: (info) =>
          _addIssue(this, info?.label ?? 'input', dataset, config, info),
      });
      return dataset;
    },
  };
}
