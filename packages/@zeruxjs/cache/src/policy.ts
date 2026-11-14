import type {
  CacheCapabilities,
  CachePolicy,
  CacheSetOptions,
  CacheValue,
} from './types.js';
import { createCacheError } from './utils.js';
/** Create a fixed policy error without echoing raw keys or cached values.
 * @param {string} code - Package-authored policy failure category.
 * @returns {ReturnType<typeof createCacheError>} Compatible public cache failure. */
const fail = (code: string) =>
  createCacheError({
    code,
    message:
      code === 'INVALID_TTL'
        ? 'ttlSeconds must be positive and finite'
        : code.toLowerCase().replaceAll('_', ' '),
  });
/** Only declared capability names accepted for strict requirements; missing metadata remains unknown. */
export const capabilityNames = [
  'conditionalWrites',
  'counters',
  'namespaceClear',
  'bulkAtomicity',
] as const;
/** Validate finite resource/ownership requirements without starting a provider.
 * @param {CachePolicy} raw - Optional host-owned policy; defaults are explicit per budget.
 * @returns {EffectivePolicy} Effective defaults; unsupported keys/limits/capability names reject.
 */
export function cachePolicy(raw: CachePolicy = {}) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some(
      (k) =>
        ![
          'maxBulk',
          'maxPendingProducers',
          'maxKeyBytes',
          'maxValueBytes',
          'maxDepth',
          'requireCapabilities',
          'ownHelper',
        ].includes(k)
    )
  ) {
    throw fail('INVALID_CACHE_POLICY');
  }
  /** Resolve one finite positive integer budget with an explicit hard ceiling.
   * @param {unknown} v - Candidate configured value.
   * @param {number} n - Default when omitted.
   * @param {number} max - Inclusive hard ceiling.
   * @returns {number} Validated effective budget. */
  const limit = (v: unknown, n: number, max: number) => {
    /** Resolved budget checked before policy publication. */
    const x = v === undefined ? n : v;
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 1 || x > max) {
      throw fail('INVALID_CACHE_LIMIT');
    }
    return x;
  };
  if (raw.ownHelper !== undefined && typeof raw.ownHelper !== 'boolean') {
    throw fail('INVALID_CACHE_POLICY');
  }
  if (
    raw.requireCapabilities !== undefined &&
    (!Array.isArray(raw.requireCapabilities) ||
      raw.requireCapabilities.length > 4 ||
      raw.requireCapabilities.some((k) => !capabilityNames.includes(k)))
  ) {
    throw fail('INVALID_CACHE_CAPABILITY');
  }
  return {
    maxBulk: limit(raw.maxBulk, 1000, 10000),
    maxPendingProducers: limit(raw.maxPendingProducers, 64, 1024),
    maxKeyBytes: limit(raw.maxKeyBytes, 1024, 65536),
    maxValueBytes: limit(raw.maxValueBytes, 1048576, 16777216),
    maxDepth: limit(raw.maxDepth, 32, 64),
    ownHelper: raw.ownHelper ?? true,
    requireCapabilities: raw.requireCapabilities ?? [],
  };
}
export type EffectivePolicy = ReturnType<typeof cachePolicy>;
/** Snapshot only the known declarations without inventing atomicity from absent metadata.
 * @param {CacheCapabilities | undefined} raw - Optional provider declaration, treated as metadata not independent certification.
 * @returns {Readonly<CacheCapabilities>} Frozen known capability/ownership vocabulary; absent values remain unknown.
 */
export function cacheCapabilities(
  raw: CacheCapabilities | undefined
): Readonly<CacheCapabilities> {
  if (
    raw !== undefined &&
    (!raw || typeof raw !== 'object' || Array.isArray(raw))
  ) {
    throw fail('INVALID_CACHE_CAPABILITY');
  }
  /** Detached capability record; every known capability defaults explicitly to unknown. */
  const result: CacheCapabilities = {};
  // Snapshot only known capability names; absent declarations remain unknown.
  for (const name of capabilityNames) {
    /** Declared capability value checked against the supported three-state vocabulary. */
    const value = raw?.[name] ?? 'unknown';
    if (!['supported', 'unsupported', 'unknown'].includes(value)) {
      throw fail('INVALID_CACHE_CAPABILITY');
    }
    result[name] = value;
  }
  /** Helper backend ownership declaration, separate from manager wrapper ownership. */
  const ownership = raw?.ownership ?? 'unknown';
  if (!['owned', 'borrowed', 'unknown'].includes(ownership)) {
    throw fail('INVALID_CACHE_CAPABILITY');
  }
  result.ownership = ownership;
  return Object.freeze(result);
}
/** Validate a nonempty logical or prefixed key against its UTF-8 budget.
 * @param {unknown} key - Untrusted candidate cache key.
 * @param {EffectivePolicy} policy - Validated effective key limits.
 * @returns {string} Accepted spelling; host must keep secrets out of keys.
 */
export function cacheKey(key: unknown, policy: EffectivePolicy) {
  if (
    typeof key !== 'string' ||
    !key.length ||
    Buffer.byteLength(key) > policy.maxKeyBytes
  ) {
    throw fail('INVALID_KEY');
  }
  return key;
}
/** Validate TTL and mutually exclusive conditional flags without treating void writes as lock acquisition.
 * @param {CacheSetOptions} options - Optional write intent; native condition semantics remain provider-owned.
 * @returns {CacheSetOptions} Compatible options; invalid TTL/conditions reject.
 */
export function cacheSetOptions(options: CacheSetOptions = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail('INVALID_CACHE_OPTIONS');
  }
  // Validate both conditional flags before resolving incompatible combinations.
  for (const flag of ['ifAbsent', 'ifPresent'] as const) {
    if (options[flag] !== undefined && typeof options[flag] !== 'boolean') {
      throw fail('INVALID_CACHE_CONDITION');
    }
  }
  if (options.ifAbsent && options.ifPresent) {
    throw fail('CONFLICTING_CACHE_CONDITIONS');
  }
  if (
    options.ttlSeconds !== undefined &&
    (typeof options.ttlSeconds !== 'number' ||
      !Number.isFinite(options.ttlSeconds) ||
      options.ttlSeconds <= 0 ||
      !Number.isFinite(options.ttlSeconds * 1000))
  ) {
    throw fail('INVALID_TTL');
  }
  return options;
}
/** Bound traversal before serialization and reject cycles/accessors/non-JSON data without invoking toJSON.
 * @param {CacheValue} value - Candidate inert JSON value.
 * @param {EffectivePolicy} policy - Validated depth/byte limits; traversal also caps nodes.
 * @returns {CacheValue} Detached bounded JSON copy; no executable payload is evaluated.
 */
export function cacheValue(
  value: CacheValue,
  policy: EffectivePolicy
): CacheValue {
  let bytes = 0,
    nodes = 0;
  /** Current ancestor identities used to reject cycles without rejecting repeated acyclic values. */
  const seen = new WeakSet<object>();
  /** Account for one JSON node under depth/node/byte budgets before recursive traversal.
   * @param {unknown} input - Current unknown candidate node.
   * @param {number} depth - Current nesting depth, bounded by policy.
   * @returns {void} Unsupported data or exhausted limits throw before serialization.
   */
  function visit(input: unknown, depth: number): void {
    if (++nodes > 100000 || depth > policy.maxDepth) {
      throw fail('CACHE_VALUE_DEPTH_LIMIT');
    }
    if (input === null || typeof input === 'boolean') {
      bytes += 5;
    } else if (typeof input === 'number') {
      if (!Number.isFinite(input)) {
        throw fail('INVALID_CACHE_VALUE');
      }
      bytes += String(input).length;
    } else if (typeof input === 'string') {
      bytes += Buffer.byteLength(input);
    } else if (input && typeof input === 'object') {
      if (
        seen.has(input) ||
        (!Array.isArray(input) &&
          ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
      ) {
        throw fail('INVALID_CACHE_VALUE');
      }
      if (Object.hasOwn(input, 'toJSON')) {
        throw fail('INVALID_CACHE_VALUE');
      }
      seen.add(input);
      bytes += 2;
      // Visit own data descriptors with bounded depth/node/byte accounting; never invoke getters.
      for (const key of Object.keys(input)) {
        bytes += Buffer.byteLength(key) + 4;
        /** Own data descriptor read before traversing a value; getters/toJSON never run. */
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor)) {
          throw fail('INVALID_CACHE_VALUE');
        }
        visit(descriptor.value, depth + 1);
      }
      seen.delete(input);
    } else {
      throw fail('INVALID_CACHE_VALUE');
    }
    if (bytes > policy.maxValueBytes) {
      throw fail('CACHE_VALUE_BYTE_LIMIT');
    }
  }
  visit(value, 0);
  /** Serialized candidate measured again before returning a detached JSON copy. */
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > policy.maxValueBytes) {
    throw fail('CACHE_VALUE_BYTE_LIMIT');
  }
  return JSON.parse(text) as CacheValue;
}
/** Validate array-shaped bulk requests against the effective finite count limit.
 * @param {unknown} value - Candidate key/items array.
 * @param {EffectivePolicy} policy - Validated effective count policy.
 * @returns {void} Invalid/unbounded bulk input rejects before provider dispatch.
 */
export function cacheBulk(value: unknown, policy: EffectivePolicy): void {
  if (!Array.isArray(value) || value.length > policy.maxBulk) {
    throw fail('CACHE_BULK_LIMIT');
  }
}
