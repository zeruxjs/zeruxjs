/** Narrow a tool option to a nonblank, NUL-free string or throw TypeError.
 * Does not normalize the string, authorize a path or perform filesystem I/O.
 *
 * @param {unknown} value - Untrusted option to validate without coercion or normalization.
 * @param {string} name - Trusted option label included in validation errors; never supply a secret value.
 * @returns {void} No value; successful completion narrows value to string for TypeScript.
 * @throws {TypeError} When value is blank, not a string or contains a NUL character.
 */
export function nonemptyString(
  value: unknown,
  name: string
): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new TypeError(
      `${name} must be a nonempty string without NUL characters`
    );
  }
}
/** Validate up to 10,000 explicit string inputs without modifying the array.
 * Throws TypeError on an invalid item; compiler-discovered graphs remain unbounded
 * by this input-list limit and are owned by the compiler.
 *
 * @param {unknown} value - Candidate array; validated in place without mutation.
 * @param {string} name - Trusted option label used for array and item diagnostics.
 * @returns {void} No value; successful completion narrows value to string[].
 * @throws {TypeError} When the array exceeds 10,000 items or contains an invalid string.
 */
export function stringList(
  value: unknown,
  name: string
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 10000) {
    throw new TypeError(`${name} must be an array of at most 10000 strings`);
  }
  // item is checked without coercion so callers retain the original array values.
  for (const item of value) {
    nonemptyString(item, name);
  }
}
