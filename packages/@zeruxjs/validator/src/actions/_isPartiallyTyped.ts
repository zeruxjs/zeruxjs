import type { BaseIssue, OutputDataset } from '../types/index.js';
import type { Paths } from './types/partialCheck.js';

/**
 * Checks if a dataset is partially typed.
 *
 * @param {OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current value/issues; no validation or value projection occurs.
 * @param {Paths} paths - Borrowed declared prefixes; the dollar wildcard matches array path segments only.
 *
 * @returns {boolean} Whether current issue paths permit refinement; not a completeness or authorization proof.
 *
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _isPartiallyTyped(
  dataset: OutputDataset<unknown, BaseIssue<unknown>>,
  paths: Paths
): boolean {
  // If issues exist, check if a specified path matches path of a schema issue
  if (dataset.issues) {
    // Every selected prefix must be disjoint from the relevant existing failure paths.
    for (const path of paths) {
      // Inspect private issue segments without reading candidate values or invoking getters.
      for (const issue of dataset.issues) {
        // Hint: We also mark the data as untyped if there are validation
        // issues, since the data could potentially be untyped if a pipeline
        // contains a transformation action.

        // Create typed variable
        let typed = false;

        // Calculate bound of match check
        /** Shared available prefix length; absent issue paths produce zero iterations and prevent unsafe path access. */
        const bound = Math.min(path.length, issue.path?.length ?? 0);

        // Mark data as typed if any path items of same index do not match
        for (let index = 0; index < bound; index++) {
          if (
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            path[index] !== issue.path[index].key &&
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            (path[index] !== '$' || issue.path[index].type !== 'array')
          ) {
            typed = true;
            break;
          }
        }

        // Return false if untyped
        if (!typed) {
          return false;
        }
      }
    }
  }

  // Return true if typed
  return true;
}
