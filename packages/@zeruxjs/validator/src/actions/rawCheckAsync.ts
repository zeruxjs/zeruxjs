import type { BaseValidationAsync, MaybePromise } from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { RawCheckContext, RawCheckIssue } from './types/rawCheck.js';

/**
 * Raw check action async interface.
 */
export interface RawCheckActionAsync<TInput> extends BaseValidationAsync<
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
  readonly reference: typeof rawCheckAsync;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
}

/** Await a trusted raw callback with the private dataset/config and addIssue closure; never retain this parse-owned context after return. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(context: RawCheckContext<TInput>) => MaybePromise<void>} action - Explicit trusted raw callback with private parse context; do not retain its context or invoke addIssue after settlement.
 * @returns {RawCheckActionAsync<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function rawCheckAsync<TInput>(
  action: (context: RawCheckContext<TInput>) => MaybePromise<void>
): RawCheckActionAsync<TInput> {
  return {
    kind: 'validation',
    type: 'raw_check',
    reference: rawCheckAsync,
    async: true,
    expects: null,
    /** Await a trusted raw callback with the private dataset/config and addIssue closure; never retain this parse-owned context after return. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset, config) {
      await action({
        dataset,
        config,
        addIssue: (info) =>
          _addIssue(this, info?.label ?? 'input', dataset, config, info),
      });
      return dataset;
    },
  };
}
