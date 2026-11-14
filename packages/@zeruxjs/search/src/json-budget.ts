import { SearchLimitError } from './types.js';
/** Validate bounded inert JSON before measuring bytes. Reject cycles, nonplain containers, accessors, sparse arrays and nonfinite numbers; no serialization hook is intentionally evaluated.
 * @param {unknown} value - Untrusted document or configuration value; only plain JSON containers are accepted.
 * @param {number} max - Maximum serialized UTF-8 byte length; exceeding it throws SearchLimitError.
 * @returns {number} Exact serialized UTF-8 byte length after depth, node and shape checks.
 */
export function jsonBytes(value: unknown, max: number): number {
  let nodes = 0,
    bytes = 0;
  /** UTF-8 accounting shared by traversal and the final exact serialization check. */
  const encoder = new TextEncoder();
  /** Ancestor identities; deleting on unwind permits repeated noncyclic values. */
  const seen = new Set<object>();
  /** Charge a string before further traversal so oversized values fail early.
   * @param {string} s - Literal key or string value whose UTF-8 bytes consume the budget.
   * @returns {void} Updates accounting; throws when the byte ceiling is exceeded.
   */
  const charge = (s: string) => {
    bytes += encoder.encode(s).byteLength;
    if (bytes > max) {
      throw new SearchLimitError('DOCUMENT_LIMIT');
    }
  };
  /** Validate own data descriptors without calling accessors or inherited serialization hooks.
   * @param {unknown} v - Current candidate JSON node.
   * @param {number} depth - Current nesting depth, capped at 16.
   * @returns {void} Completes only after this subtree satisfies the node, depth and shape limits.
   */
  const walk = (v: unknown, depth: number) => {
    if (++nodes > 20000 || depth > 16) {
      throw new SearchLimitError('DOCUMENT_LIMIT');
    }
    if (v === null || typeof v === 'boolean') {
      return;
    }
    if (typeof v === 'string') {
      charge(v);
      return;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      return;
    }
    if (
      !v ||
      typeof v !== 'object' ||
      seen.has(v) ||
      (Array.isArray(v) && Object.getPrototypeOf(v) !== Array.prototype) ||
      (!Array.isArray(v) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    ) {
      throw new TypeError('Search documents require inert JSON');
    }
    if (
      Array.isArray(v) &&
      (v.length > 10000 ||
        Array.from({ length: v.length }, (_, i) => !Object.hasOwn(v, i)).some(
          Boolean
        ))
    ) {
      throw new TypeError('Dense bounded JSON arrays required');
    }
    // Only plain containers reach traversal: inherited serializers must stay inert.
    seen.add(v);
    // Inspect descriptors instead of reading properties, so accessors never run.
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') {
        continue;
      }
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        throw new TypeError('Invalid document key');
      }
      /** Own descriptor checked before reading its value; getters are never evaluated. */
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!('value' in d)) {
        throw new TypeError('Document accessors forbidden');
      }
      charge(key);
      walk(d.value, depth + 1);
    }
    seen.delete(v);
  };
  walk(value, 0);
  /** Exact serialized UTF-8 size after inert-container validation succeeds. */
  const size = encoder.encode(JSON.stringify(value)).byteLength;
  if (size > max) {
    throw new SearchLimitError('DOCUMENT_LIMIT');
  }
  return size;
}
