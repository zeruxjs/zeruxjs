import type { BaseIssue, OutputDataset } from '../types/index.js';

/** Collect existing failed union branch issues in source order without cloning or redacting them.
 * @param {OutputDataset<unknown, BaseIssue<unknown>>[] | undefined} datasets - Failed branch datasets whose issues are present by the union collector invariant; undefined means no branches.
 * @returns {[ BaseIssue<unknown>, ...BaseIssue<unknown>[] ] | undefined} Borrowed first issue array extended with later issues, or undefined; parent paths and input values remain private.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _subIssues(
  datasets: OutputDataset<unknown, BaseIssue<unknown>>[] | undefined
): [BaseIssue<unknown>, ...BaseIssue<unknown>[]] | undefined {
  let issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]] | undefined;
  if (datasets) {
    // Retain source branch order and the original private issue object identities.
    for (const dataset of datasets) {
      if (issues) {
        // Hint: According to the implementation of `union` and `unionAsync`,
        // `dataset.issues` can never be `undefined`.
        issues.push(...dataset.issues!);
      } else {
        issues = dataset.issues;
      }
    }
  }
  return issues;
}
