/**
 * Merge dataset type.
 */
type MergeDataset =
  | {
      /** Borrowed merged value on success; absent on conflict. */
      value: unknown; /** True marks incompatible outputs; absent on success and never a private input payload. */
      issue?: undefined;
    }
  | {
      /** Borrowed merged value on success; absent on conflict. */
      value?: undefined; /** True marks incompatible outputs; absent on success and never a private input payload. */
      issue: true;
    };

/**
 * Recursively merge compatible trusted branch outputs by mutating the first value. This legacy helper has no independent cycle/depth budget or rollback; callbacks must produce compatible finite graphs.
 *
 * @param {unknown} value1 - First trusted branch result; object/array contents may be mutated even if a later conflict rejects the merge.
 * @param {unknown} value2 - Second trusted result; native Date equality uses numeric coercion and host getters remain trusted code.
 *
 * @returns {MergeDataset} First result with compatible values merged, or a conflict marker; this does not sanitize keys, authorize values or deep-clone inputs.
 *
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _merge(value1: unknown, value2: unknown): MergeDataset {
  // Continue if data type of values match
  if (typeof value1 === typeof value2) {
    // Return first value if both are equal
    if (
      value1 === value2 ||
      (value1 instanceof Date && value2 instanceof Date && +value1 === +value2)
    ) {
      return { value: value1 };
    }

    // Return deeply merged object
    if (
      value1 &&
      value2 &&
      value1.constructor === Object &&
      value2.constructor === Object
    ) {
      // Deeply merge entries of `value2` into `value1`
      for (const key in value2) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        if (key in value1) {
          /** Recursive child merge result; failure returns immediately without undoing previously merged siblings. */
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          const dataset = _merge(value1[key], value2[key]);

          // If dataset has issue, return it
          if (dataset.issue) {
            return dataset;
          }

          // Otherwise, replace merged entry
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          value1[key] = dataset.value;

          // Otherwise, just add entry
        } else {
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          value1[key] = value2[key];
        }
      }

      // Return deeply merged object
      return { value: value1 };
    }

    // Return deeply merged array
    if (Array.isArray(value1) && Array.isArray(value2)) {
      // Continue if arrays have same length
      if (value1.length === value2.length) {
        // Merge item of `value2` into `value1`
        for (let index = 0; index < value1.length; index++) {
          /** Recursive child merge result; failure returns immediately without undoing previously merged siblings. */
          const dataset = _merge(value1[index], value2[index]);

          // If dataset has issue, return it
          if (dataset.issue) {
            return dataset;
          }

          // Otherwise, replace merged items
          value1[index] = dataset.value;
        }

        // Return deeply merged array
        return { value: value1 };
      }
    }
  }

  // Otherwise, return that values can't be merged
  return { issue: true };
}
