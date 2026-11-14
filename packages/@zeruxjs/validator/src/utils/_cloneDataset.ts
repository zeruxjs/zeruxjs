import type { BaseIssue, OutputDataset } from '../types/index.js';

/**
 * Creates a shallow copy of a dataset.
 *
 * Hint: The `value` is copied by reference, but the `issues` array is cloned
 * to avoid reusing mutable dataset state across multiple runs. Mutating a
 * returned object or array value can therefore affect later cache hits that
 * reuse the same cached output.
 *
 * @param {OutputDataset<TValue, TIssue>} dataset - Borrowed cached/internal dataset whose value and issue objects retain identity.
 *
 * @returns {OutputDataset<TValue, TIssue>} New dataset wrapper and issue array only; nested issues and output values are not deep-cloned.
 */
// @__NO_SIDE_EFFECTS__
export function _cloneDataset<TValue, TIssue extends BaseIssue<unknown>>(
  dataset: OutputDataset<TValue, TIssue>
): OutputDataset<TValue, TIssue> {
  // Hint: We assign the known dataset properties directly instead of using the
  // spread operator for better runtime performance.
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return {
    typed: dataset.typed,
    value: dataset.value,
    issues: dataset.issues && [...dataset.issues],
  };
}
