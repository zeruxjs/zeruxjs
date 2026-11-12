/** Fixed-code public failure; private native causes are deliberately non-enumerable. */
export class MemcacheQError extends Error {
  /** Create a fixed public error with a private optional cause.
   * @param {string} code - Fixed library error category; never include a private server reply.
   * @param {unknown} cause - Optional private non-enumerable transport cause; redact before host logging.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`MemcacheQ error (${code})`);
    this.name = 'MemcacheQError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Create a fixed-code public error while retaining private cause out of enumerable diagnostics.
 * @param {string} code - Fixed library error category; never include a private server reply.
 * @param {unknown} cause - Optional private non-enumerable transport cause; redact before host logging.
 * @returns {MemcacheQError} Validated fixed-code/request result; native unknown outcomes remain explicit.
 */
export const invalid = (code: string, cause?: unknown) =>
  new MemcacheQError(code, cause);
/** Require a plain own-data object with only explicitly allowlisted fields; reject getters before reading option values.
 * @param {unknown} value - Untrusted plain data/options to validate without evaluating source modules.
 * @param {readonly string[]} allowed - Explicit finite allowed own option names.
 * @returns {void} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
 */
export function optionKeys(
  value: unknown,
  allowed: readonly string[]
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d)
    )
  ) {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
}
/** Require a safe integer within the inclusive caller-declared range.
 * @param {unknown} value - Untrusted plain data/options to validate without evaluating source modules.
 * @param {number} min - Inclusive safe integer minimum.
 * @param {number} max - Inclusive byte/integer ceiling; final UTF-8 JSON bytes are checked separately.
 * @returns {number} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
 */
export function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
  return value;
}
/** Snapshot inert plain JSON with bounded nesting/nodes/characters and final UTF-8 byte validation. Never invoke custom serialization or execute incoming code.
 * @param {unknown} value - Untrusted plain data/options to validate without evaluating source modules.
 * @param {number} max - Inclusive byte/integer ceiling; final UTF-8 JSON bytes are checked separately.
 * @returns {Record<string,unknown>} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
 */
export function copyData(value: unknown, max: number): Record<string, unknown> {
  let count = 0,
    characters = 0;
  /** Active traversal ancestor set; removed on return so shared noncyclic objects remain valid. */
  const seen = new Set<object>();
  /** Traverse one inert JSON value, tracking only active ancestors to reject cycles while permitting shared subobjects.
   * @param {unknown} item - Untrusted scalar/container at the current bounded traversal depth.
   * @param {number} depth - Current nesting depth; maximum16 and8192 visited values.
   * @returns {unknown} Validated inert value or explicit lifecycle/transport result; failures never expose raw payloads.
   */
  function visit(item: unknown, depth: number): any {
    if (++count > 8192 || depth > 16) {
      throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
    }
    if (typeof item === 'string') {
      characters += item.length;
      if (characters > max) {
        throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
      }
      return item;
    }
    if (
      item === null ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    ) {
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
      throw invalid('MEMCACHEQ_INVALID_PAYLOAD');
    }
    /** Own enumerable JSON keys checked for sparse/extended arrays and unsafe names. */
    const keys = Object.keys(item);
    if (
      keys.length > 8192 ||
      (Array.isArray(item) &&
        (item.length > 8192 ||
          keys.length !== item.length ||
          keys.some((key, i) => key !== String(i))))
    ) {
      throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
    }
    seen.add(item);
    /** New inert copied value; never a borrowed mutable payload reference. */
    const out: any = Array.isArray(item) ? [] : {};
    // Visit only own keys under the validated node/depth/byte ceilings.
    for (const key of keys) {
      /** Own property descriptor inspected without invoking untrusted getters. */
      const d = Object.getOwnPropertyDescriptor(item, key)!;
      if (
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        !('value' in d)
      ) {
        throw invalid('MEMCACHEQ_INVALID_PAYLOAD');
      }
      characters += key.length;
      if (characters > max) {
        throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
      }
      out[key] = visit(d.value, depth + 1);
    }
    seen.delete(item);
    return out;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('MEMCACHEQ_INVALID_PAYLOAD');
  }
  /** New inert copied value; never a borrowed mutable payload reference. */
  const out = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(out)) > max) {
    throw invalid('MEMCACHEQ_PAYLOAD_LIMIT');
  }
  return out;
}
