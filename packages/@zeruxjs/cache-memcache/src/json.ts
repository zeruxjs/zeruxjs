import type { CacheValue } from '@zeruxjs/cache';
import { memcacheError } from './errors.js';
/** Encode inert JSON with exact UTF-8/depth/node budgets before networking.
 * @param {CacheValue} value - Plain JSON candidate; accessors and exotic objects reject.
 * @param {number} maxBytes - Maximum serialized UTF-8 bytes.
 * @param {number} maxDepth - Maximum root-zero nesting depth.
 * @returns {Buffer} Complete validated JSON bytes.
 */
export function encodeJson(
  value: CacheValue,
  maxBytes: number,
  maxDepth: number
): Buffer {
  /** Bounded serialized fragments joined only after full validation. */
  const parts: string[] = [];

  /** Ancestor set rejecting cycles while permitting repeated acyclic values. */
  const seen = new WeakSet<object>();
  let size = 0,
    nodes = 0;

  /** Account exact UTF-8 output before retaining a fragment.
   * @param {string} part - Already encoded JSON fragment.
   * @returns {void} Appends locally or throws at the byte ceiling. */
  const append = (part: string) => {
    size += Buffer.byteLength(part);
    if (size > maxBytes) {
      throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
    }
    parts.push(part);
  };

  /** Encode one bounded JSON string, including escapes.
   * @param {string} value - Own data value or object key.
   * @returns {string} JSON string literal; no code evaluation. */
  const text = (value: string) => {
    if (Buffer.byteLength(value) > maxBytes) {
      throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
    }
    return JSON.stringify(value);
  };

  /** Traverse plain JSON descriptors without invoking getters or toJSON.
   * @param {unknown} input - Untrusted candidate node.
   * @param {number} depth - Root-zero nesting depth.
   * @returns {void} Appends valid fragments or rejects before networking. */
  const visit = (input: unknown, depth: number) => {
    if (depth > maxDepth || ++nodes > 100000) {
      throw memcacheError('MEMCACHE_DEPTH_LIMIT');
    }
    if (input === null || typeof input === 'boolean') {
      append(String(input));
      return;
    }
    if (typeof input === 'string') {
      append(text(input));
      return;
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      append(JSON.stringify(input));
      return;
    }
    if (
      !input ||
      typeof input !== 'object' ||
      seen.has(input) ||
      (!Array.isArray(input) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    ) {
      throw memcacheError('MEMCACHE_INVALID_JSON');
    }
    seen.add(input);

    /** Whether this validated object must serialize as a dense array. */
    const array = Array.isArray(input);
    if (Object.hasOwn(input, 'toJSON')) {
      throw memcacheError('MEMCACHE_INVALID_JSON');
    }
    if (array && input.length > 100000) {
      throw memcacheError('MEMCACHE_DEPTH_LIMIT');
    }
    append(array ? '[' : '{');

    /** Own JSON property names or every required dense array index. */
    const keys = array
      ? Array.from({ length: input.length }, (_, index) => String(index))
      : Object.keys(input);
    if (keys.length > 100000) {
      throw memcacheError('MEMCACHE_DEPTH_LIMIT');
    }
    let first = true;
    // Read own data descriptors; sparse slots and accessors reject without invoking code.
    for (const key of keys) {
      /** Own data descriptor; accessors and sparse array slots reject. */
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (!property || !('value' in property)) {
        throw memcacheError('MEMCACHE_INVALID_JSON');
      }
      if (!first) {
        append(',');
      }
      first = false;
      if (!array) {
        append(text(key));
        append(':');
      }
      visit(property.value, depth + 1);
    }
    append(array ? ']' : '}');
    seen.delete(input);
  };
  visit(value, 0);
  return Buffer.from(parts.join(''));
}
/** Decode strict UTF-8 JSON and revalidate its bounded data shape.
 * @param {Buffer} value - Retrieved bytes, never executed as source.
 * @param {number} maxBytes - Maximum JSON body bytes.
 * @param {number} maxDepth - Maximum root-zero nesting depth.
 * @returns {CacheValue} Validated data; parser causes remain private.
 */
export function decodeJson(
  value: Buffer,
  maxBytes: number,
  maxDepth: number
): CacheValue {
  if (value.length > maxBytes) {
    throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
  }
  let parsed: CacheValue;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(value)
    ) as CacheValue;
  } catch (cause) {
    throw memcacheError('MEMCACHE_INVALID_JSON', cause);
  }
  encodeJson(parsed, maxBytes, maxDepth);
  return parsed;
}
