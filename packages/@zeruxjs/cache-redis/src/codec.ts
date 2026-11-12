import { redisError } from './policy.js';
import type { CacheValue } from '@zeruxjs/cache';

/** Validate plain JSON descriptors within fixed depth/node/byte ceilings.
 * @param {unknown} value - Candidate inert data; getters/toJSON never execute.
 * @returns {void} Rejects invalid data before networking. */
const validateJson = (value: unknown) => {
  let nodes = 0,
    bytes = 0;
  /** Ancestor set rejecting cycles while allowing repeated acyclic values. */
  const seen = new WeakSet<object>();
  /** Traverse one own JSON node without invoking accessors.
   * @param {unknown} input - Candidate node.
   * @param {number} depth - Root-zero depth, maximum 32.
   * @returns {void} Accounts at most 100000 nodes and 1 MiB. */
  const walk = (input: unknown, depth: number) => {
    if (depth > 32 || ++nodes > 100000) {
      throw redisError('REDIS_JSON_LIMIT');
    }
    if (
      input === null ||
      typeof input === 'boolean' ||
      (typeof input === 'number' && Number.isFinite(input))
    ) {
      bytes += JSON.stringify(input).length;
      if (bytes > 1048576) {
        throw redisError('REDIS_JSON_LIMIT');
      }
      return;
    }
    if (typeof input === 'string') {
      bytes += Buffer.byteLength(input) + 2;
      if (bytes > 1048576) {
        throw redisError('REDIS_JSON_LIMIT');
      }
      return;
    }
    if (
      !input ||
      typeof input !== 'object' ||
      seen.has(input) ||
      (!Array.isArray(input) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) ||
      Object.hasOwn(input, 'toJSON')
    ) {
      throw redisError('REDIS_INVALID_JSON');
    }
    seen.add(input);
    bytes += 2;
    if (Array.isArray(input) && input.length > 100000) {
      throw redisError('REDIS_JSON_LIMIT');
    }
    /** Own object keys or every required dense array index. */
    const keys = Array.isArray(input)
      ? Array.from({ length: input.length }, (_, i) => String(i))
      : Object.keys(input);
    // Traverse only own data descriptors within fixed JSON budgets.
    for (const key of keys) {
      if (!Array.isArray(input)) {
        bytes += Buffer.byteLength(key) + 3;
      }
      if (bytes > 1048576) {
        throw redisError('REDIS_JSON_LIMIT');
      }
      /** Own data descriptor; sparse slots/accessors reject. */
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (!property || !('value' in property)) {
        throw redisError('REDIS_INVALID_JSON');
      }
      walk(property.value, depth + 1);
    }
    seen.delete(input);
  };
  walk(value, 0);
};
/** Serialize bounded JSON, preserving native scalar counter precision rules.
 * @param {CacheValue} value - Plain JSON input.
 * @returns {string} Complete encoded body, at most 1 MiB. */
export const serialize = (value: CacheValue): string => {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  ) {
    throw redisError('REDIS_COUNTER_RANGE');
  }
  validateJson(value);
  /** Complete JSON body measured exactly after bounded traversal. */
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result) > 1048576) {
    throw redisError('REDIS_JSON_LIMIT');
  }
  return result;
};
/** Parse stored JSON as data, rejecting invalid or unsafe scalar counter values.
 * @param {string} encoded - Stored UTF-8 JSON string, maximum 1 MiB.
 * @returns {CacheValue} Validated plain data; no source evaluation. */
export const deserialize = (encoded: string): CacheValue => {
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 1048576) {
    throw redisError('REDIS_JSON_LIMIT');
  }
  let parsed: CacheValue;
  try {
    parsed = JSON.parse(encoded) as CacheValue;
  } catch (cause) {
    throw redisError('REDIS_INVALID_JSON', cause);
  }
  validateJson(parsed);
  // Native counters and plain numeric cache values share the same representation.
  if (
    typeof parsed === 'number' &&
    Number.isInteger(parsed) &&
    !Number.isSafeInteger(parsed)
  ) {
    throw redisError('REDIS_COUNTER_RANGE');
  }
  return parsed;
};
/** Round a positive TTL to Redis EX integer seconds.
 * @param {number|undefined} seconds - Optional finite positive lifetime.
 * @returns {number|undefined} Native-safe TTL or undefined for no expiry. */
export const expiration = (seconds?: number): number | undefined => {
  if (seconds === undefined) {
    return undefined;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError('Cache TTL must be positive and finite');
  }
  /** Rounded integer lifetime checked against Redis EX range. */
  const result = Math.ceil(seconds);
  if (!Number.isSafeInteger(result) || result > 2147483647) {
    throw new RangeError('Cache TTL exceeds Redis EX range');
  }
  return result;
};
/** Validate a nonnegative safe-integer native counter delta.
 * @param {number} amount - Requested increment/decrement magnitude.
 * @returns {number} Original validated amount. */
export const counterAmount = (amount: number): number => {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError('Counter amount must be a non-negative safe integer');
  }
  return amount;
};

/** Escape SCAN glob metacharacters; callers additionally verify literal prefixes.
 * @param {string} prefix - Trusted namespace text.
 * @returns {string} Escaped prefix followed by colon and wildcard. */
export const prefixGlob = (prefix: string): string =>
  prefix.replace(/[\\*?[\]]/g, '\\$&') + ':*';
