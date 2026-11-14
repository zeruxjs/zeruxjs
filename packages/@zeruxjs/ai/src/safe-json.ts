/**
 * Copy inert JSON using descriptor reads and bounded traversal before serialization.
 * @param {unknown} input - Untrusted plain data; accessors/classes/cycles are denied.
 * @param {number} maxBytes - UTF-8 serialized ceiling from 1 through 64 MiB.
 * @returns {unknown} Detached JSON value with no callable or accessor properties.
 * @throws {TypeError} On invalid budget, non-JSON data, depth over 32 or over 10000 nodes.
 * @throws {RangeError} When conservative traversal or exact serialized size exceeds budget.
 */
export function snapshotAiJson(input: unknown, maxBytes: number): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864) {
    throw new TypeError('Invalid JSON budget');
  }
  let remaining = maxBytes,
    nodes = 0;
  /** Ancestor identities detect cycles while allowing repeated noncyclic references. */
  const seen = new Set<object>();
  /**
   * Snapshot one node while charging conservative bytes before traversing children.
   * @param {unknown} v - Current untrusted value, inspected without calling its getters.
   * @param {number} depth - Root-relative nesting, starting at zero.
   * @returns {unknown} Detached scalar, array or null-prototype intermediate object.
   */
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 32 || ++nodes > 10000) {
      throw new TypeError('Tool JSON complexity exceeded');
    }
    if (v === null || typeof v === 'boolean') {
      remaining -= 5;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      remaining -= 24;
    } else if (typeof v === 'string') {
      remaining -= Buffer.byteLength(v) + 2;
    } else if (
      v &&
      typeof v === 'object' &&
      !seen.has(v) &&
      (Array.isArray(v) ||
        Object.getPrototypeOf(v) === Object.prototype ||
        Object.getPrototypeOf(v) === null)
    ) {
      seen.add(v);
      /** Enumerate own keys only; descriptors below distinguish values from accessors. */
      const keys = Object.keys(v);
      if (keys.length > 10000) {
        throw new TypeError('Tool JSON complexity exceeded');
      }
      /** Define properties explicitly so special names cannot mutate prototypes. */
      const out: any = Array.isArray(v) ? [] : Object.create(null);
      // Every own enumerable field is charged before its value is recursively copied.
      for (const key of keys) {
        /** Descriptor access avoids executing a getter while checking untrusted input. */
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !('value' in d)) {
          throw new TypeError('Tool JSON accessors denied');
        }
        remaining -= Buffer.byteLength(key) + 4;
        if (remaining < 0) {
          throw new RangeError('Tool JSON budget exceeded');
        }
        Object.defineProperty(out, key, {
          value: visit(d.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      seen.delete(v);
      return out;
    } else {
      throw new TypeError('Tool JSON required');
    }
    if (remaining < 0) {
      throw new RangeError('Tool JSON budget exceeded');
    }
    return v;
  };
  /** The bounded intermediate contains only inert values, safe for serialization. */
  const copied = visit(input, 0);
  /** Exact encoded size is checked as well as the conservative traversal charge. */
  const encoded = JSON.stringify(copied);
  if (Buffer.byteLength(encoded) > maxBytes) {
    throw new RangeError('Tool JSON budget exceeded');
  }
  return JSON.parse(encoded);
}
