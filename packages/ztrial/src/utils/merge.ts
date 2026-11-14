/** Compare supported trusted test values recursively with prototype/cycle tracking and native Date/RegExp/Map/Set/view semantics; this is not a schema validator for hostile objects.
 * @param {unknown} a - Trusted first assertion value; property access may execute its own getters.
 * @param {unknown} b - Trusted second assertion value.
 * @param {WeakMap<object, object>} seen - Per-comparison cycle identity state; callers normally omit it.
 * @returns {boolean} Whether the supported recursive comparison matches; no serialization or code evaluation is performed.
 */
export function deepEqual(
  a: unknown,
  b: unknown,
  seen = new WeakMap<object, object>()
): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || !a || typeof b !== 'object' || !b) {
    return false;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    return false;
  }
  if (seen.has(a)) {
    return seen.get(a) === b;
  }
  seen.set(a, b);
  if (a instanceof Date && b instanceof Date) {
    return Object.is(a.getTime(), b.getTime());
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }
  if (a instanceof Map && b instanceof Map) {
    return (
      a.size === b.size &&
      [...a.entries()].every(([k, v]) =>
        [...b.entries()].some(
          ([bk, bv]) => deepEqual(k, bk, seen) && deepEqual(v, bv, seen)
        )
      )
    );
  }
  if (a instanceof Set && b instanceof Set) {
    return (
      a.size === b.size &&
      [...a].every((v) => [...b].some((w) => deepEqual(v, w, seen)))
    );
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    return (
      a.byteLength === b.byteLength &&
      new Uint8Array(a.buffer, a.byteOffset, a.byteLength).every(
        (v, i) => v === new Uint8Array(b.buffer, b.byteOffset, b.byteLength)[i]
      )
    );
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  /** First trusted object’s complete own string/symbol key inventory. */
  const ka = Reflect.ownKeys(a);
  /** Second trusted object’s complete own string/symbol key inventory. */
  const kb = Reflect.ownKeys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        kb.includes(k) &&
        deepEqual(
          (a as Record<PropertyKey, unknown>)[k],
          (b as Record<PropertyKey, unknown>)[k],
          seen
        )
    )
  );
}
