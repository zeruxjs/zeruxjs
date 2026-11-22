/** Validate bounded identifier data before using it as a route or map key.
 * @param {unknown} value - Candidate release, page or fragment identifier.
 * @returns {string} Validated identifier without traversal or encoding syntax.
 */
export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new TypeError('Invalid documentation identifier');
  }
  return value;
}
/** Require an inert JSON object without getters or prototype-bearing instances.
 * @param {unknown} value - Runtime configuration candidate.
 * @returns {Record<string, unknown>} Plain own-data record.
 */
export function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError('Documentation requires plain data');
  }
  // Inspect descriptors before reading values so configuration cannot execute getters.
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value)
  )) {
    if (!('value' in descriptor)) {
      throw new TypeError('Documentation accessors are forbidden');
    }
  }
  return value as Record<string, unknown>;
}
/** Require a dense plain array without accessor entries or custom iterators.
 * @param {unknown} value - JSON-like list candidate.
 * @param {number} maximum - Inclusive item ceiling.
 * @returns {unknown[]} Validated inert entries.
 */
export function list(value: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Object.getOwnPropertySymbols(value).length
  ) {
    throw new TypeError('Invalid documentation list');
  }
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value)
  )) {
    if (
      !('value' in descriptor) ||
      (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
    ) {
      throw new TypeError(
        'Documentation list accessors/custom fields are forbidden'
      );
    }
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError('Sparse documentation list');
    }
  }
  return value;
}

/** Validate a nested documentation route without treating it as a filesystem path.
 * @param {unknown} value - Stable route slug, at most eight identifier segments and 256 characters.
 * @returns {string} Exact nonencoded relative route, never a traversal or absolute URL.
 */
export function pageSlug(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    value.split('/').length > 8
  ) {
    throw new TypeError('Invalid documentation page slug');
  }
  value.split('/').forEach(identifier);
  return value;
}
