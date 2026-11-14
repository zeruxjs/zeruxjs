/** Fixed producer bounds, shared by direct enqueue, bulk, workers and scheduler templates. */
export const QUEUE_JOB_LIMITS = Object.freeze({
  maxBytes: 65536,
  maxDepth: 32,
  maxNodes: 8192,
  maxBulk: 256,
  maxBulkBytes: 1048576,
});
/** Snapshot bounded plain JSON before native enqueue/processing without executing getters, custom serializers or source code. This validates data, not secrets or tenant authorization.
 * @param {unknown} value - Unknown payload; must be a plain object at the root.
 * @param {number} maxBytes - Internal caller-selected UTF-8 ceiling, default fixed 64 KiB; task paths use 8 KiB.
 * @param {number} maxDepth - Internal caller-selected nesting ceiling, default fixed 32.
 * @returns {Record<string,unknown>} Independent JSON snapshot bounded by actual UTF-8 bytes and 8192 visited values.
 */
export function copyJobPayload(
  value: unknown,
  maxBytes: number = QUEUE_JOB_LIMITS.maxBytes,
  maxDepth: number = QUEUE_JOB_LIMITS.maxDepth
): Record<string, unknown> {
  let nodes = 0,
    characters = 0;
  /** Current recursive ancestor set rejecting cycles without retaining caller objects. */
  const seen = new Set<object>();
  /** Copy one plain JSON node while enforcing early complexity and character budgets.
   * @param {unknown} item - Untrusted nested value.
   * @param {number} depth - Current recursion depth, starting at zero.
   * @returns {unknown} Plain independent JSON value or an explicit shape/budget failure.
   */
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > QUEUE_JOB_LIMITS.maxNodes || depth > maxDepth) {
      throw new RangeError('Queue payload nesting/node limit exceeded');
    }
    if (typeof item === 'string') {
      characters += item.length;
      if (characters > maxBytes) {
        throw new RangeError(
          maxBytes === 8192
            ? 'Scheduled task data exceeds 8 KiB'
            : 'Queue payload byte limit exceeded'
        );
      }
      return item;
    }
    if (item === null || typeof item === 'boolean') {
      return item;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      return item;
    }
    if (
      !item ||
      typeof item !== 'object' ||
      seen.has(item) ||
      ![Object.prototype, null, Array.prototype].includes(
        Object.getPrototypeOf(item)
      )
    ) {
      throw new TypeError('Queue payload must be plain JSON');
    }
    /** Bounded ordered own keys; sparse/extended arrays reject before recursion. */
    const keys = Object.keys(item);
    if (
      keys.length > QUEUE_JOB_LIMITS.maxNodes ||
      (Array.isArray(item) &&
        (item.length > QUEUE_JOB_LIMITS.maxNodes ||
          keys.length !== item.length ||
          keys.some((key, index) => key !== String(index))))
    ) {
      throw new RangeError('Queue payload collection limit exceeded');
    }
    seen.add(item);
    /** Independent plain JSON node; accessors/prototype-sensitive properties never execute. */
    const result: any = Array.isArray(item) ? [] : {};
    // Read only bounded own data descriptors; never invoke getters or toJSON.
    for (const key of keys) {
      /** Own property descriptor validated as data before reading its value. */
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !('value' in descriptor)
      ) {
        throw new TypeError('Unsafe queue payload property');
      }
      characters += key.length;
      if (characters > maxBytes) {
        throw new RangeError(
          maxBytes === 8192
            ? 'Scheduled task data exceeds 8 KiB'
            : 'Queue payload byte limit exceeded'
        );
      }
      result[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
    return result;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Queue payload must be an object');
  }
  /** Complete independent root checked for exact serialized UTF-8 byte budget. */
  const copy = visit(value, 0) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(copy)) > maxBytes) {
    throw new RangeError(
      maxBytes === 8192
        ? 'Scheduled task data exceeds 8 KiB'
        : 'Queue payload byte limit exceeded'
    );
  }
  return copy;
}
