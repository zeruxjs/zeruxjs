/** Check own-property membership and exclude the three reserved prototype-related names; this is a key filter, not value validation.
 * @param {object} object - Borrowed object to inspect; no getters are intentionally invoked by the own-key test.
 * @param {string} key - Literal candidate property name; it is not expanded into a nested path.
 * @returns {boolean} Whether the own literal key is eligible for copying by structural schemas.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _isValidObjectKey(object: object, key: string): boolean {
  return (
    Object.hasOwn(object, key) &&
    key !== '__proto__' &&
    key !== 'prototype' &&
    key !== 'constructor'
  );
}
