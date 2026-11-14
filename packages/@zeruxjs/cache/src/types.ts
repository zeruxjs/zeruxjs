/** Cache-owned contracts for inert JSON data, explicit provider capabilities and scoped lifecycle policy. */

export type MaybePromise<T> = T | Promise<T>;
export type CachePrimitive = string | number | boolean | null;
export type CacheValue =
  | CachePrimitive
  | CacheValue[]
  | { [key: string]: CacheValue };

export type CacheCapability = 'supported' | 'unsupported' | 'unknown';
export interface CacheCapabilities {
  /** Provider-declared support, unsupported or unknown; void writes do not report conditional acquisition. */
  conditionalWrites?: CacheCapability;
  /** Declared native integer counter support; value/range/zero semantics remain provider-specific. */
  counters?: CacheCapability;
  /** Declared namespace-only clear support; unsupported scope must never fall back to global deletion. */
  namespaceClear?: CacheCapability;
  /** Overall multi-key atomicity declaration; ordinary bulk methods are not transactions. */
  bulkAtomicity?: CacheCapability;
  /** Provider backend ownership, separate from manager wrapper ownHelper policy. */
  ownership?: 'owned' | 'borrowed' | 'unknown';
}
export interface CachePolicy {
  /** Bulk item cap, default 1000 and maximum 10000. */
  maxBulk?: number;
  /** Actual pending miss-job cap, default 64 and maximum 1024. */
  maxPendingProducers?: number;
  /** Logical and prefixed key UTF-8 cap, default 1024 and maximum 65536. */
  maxKeyBytes?: number;
  /** JSON UTF-8 ceiling, default 1MiB and maximum 16MiB. */
  maxValueBytes?: number;
  /** JSON nesting cap, default 32 and maximum 64; traversal also caps nodes. */
  maxDepth?: number;
  /** Explicit strict required guarantees; unknown and unsupported both fail construction. */
  requireCapabilities?: Array<
    'conditionalWrites' | 'counters' | 'namespaceClear' | 'bulkAtomicity'
  >;
  /** Whether manager closes its wrapper, default true; borrowed shared helpers require false. */
  ownHelper?: boolean;
}
export interface CacheProducerContext {
  /** Cooperative owned production or caller waiter signal; cancellation is not forced native settlement. */
  readonly signal: AbortSignal;
  /** Optional absolute server-time deadline; not a distributed lease. */
  readonly deadline?: number;
}
export interface CacheRememberOptions extends CacheSetOptions {
  /** Cooperative owned production or caller waiter signal; cancellation is not forced native settlement. */
  signal?: AbortSignal;
  /** Optional absolute server-time deadline; not a distributed lease. */
  deadline?: number;
  /** Optional wait/producer timeout, supported 1–600000ms. */
  timeoutMs?: number;
}

export interface CacheSetOptions {
  /** Optional positive finite lifetime seconds; precision/expiry enforcement is provider-owned. */
  ttlSeconds?: number;
  /** Atomic adapter-level conditional write, where supported. */
  ifAbsent?: boolean;
  /** Explicit update-only intent; mutually exclusive with ifAbsent and void on a conditional miss. */
  ifPresent?: boolean;
}

export interface CacheHelper {
  /** Optional frozen provider declarations; absent metadata never proves a guarantee. */
  readonly capabilities?: Readonly<CacheCapabilities>;
  /** Read one scoped cache value; absence stays distinct from JSON null.
   * @param {string} key - Logical unprefixed key validated before dispatch.
   * @returns {MaybePromise<CacheValue|undefined>} Detached bounded data or undefined; provider failures remain explicit.
   */
  get(key: string): MaybePromise<CacheValue | undefined>;
  /** Write a bounded JSON value with explicit TTL/condition semantics. A void return never proves conditional acquisition.
   * @param {string} key - Logical cache key, never a secret.
   * @param {CacheValue} value - Inert bounded JSON data copied before storage.
   * @param {CacheSetOptions} options - Optional TTL and exclusive ifAbsent/ifPresent flags.
   * @returns {MaybePromise<void>} Provider completion only; multi-key/distributed transaction guarantees are not invented.
   */
  set(
    key: string,
    value: CacheValue,
    options?: CacheSetOptions
  ): MaybePromise<void>;
  /** Delete one exact scoped key.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing deletion.
   */
  delete(key: string): MaybePromise<boolean>;
  /** Check exact scoped key presence with provider-owned expiry semantics.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Current provider presence; not authorization or a lock.
   */
  has(key: string): MaybePromise<boolean>;
  /** Clear the owning scope; unprefixed helpers/managers can request global clear under provider policy.
   * @returns {MaybePromise<void>} Scoped provider completion; unsupported namespace clearing fails closed.
   */
  clear(): MaybePromise<void>;
  /** Delete only entries beneath the exact namespace separator boundary.
   * @param {string} prefix - Validated host namespace; tenant binding must already be verified.
   * @returns {MaybePromise<void>} Namespace-only removal; no global clear fallback.
   */
  clearPrefix?(prefix: string): MaybePromise<void>;
  /** Read a bounded key batch and retain logical result keys, including prototype-shaped spellings as own data fields.
   * @param {string[]} keys - Bounded logical keys.
   * @returns {MaybePromise<Record<string, CacheValue|undefined>>} Detached bounded values; no multi-read snapshot guarantee.
   */
  getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>>;
  /** Validate/copy a bounded write batch without claiming whole-batch atomicity.
   * @param {Record<string, CacheValue>} values - Explicit logical key/value record.
   * @param {CacheSetOptions} options - Optional shared TTL/conditions.
   * @returns {MaybePromise<void>} Provider completion; partial backend writes can occur.
   */
  setMany(
    values: Record<string, CacheValue>,
    options?: CacheSetOptions
  ): MaybePromise<void>;
  /** Delete a bounded explicit key batch with provider-reported count.
   * @param {string[]} keys - Bounded logical key list.
   * @returns {MaybePromise<number>} Reported deletion count; not a transaction across keys.
   */
  deleteMany(keys: string[]): MaybePromise<number>;
  /** Apply a nonnegative integer increment using declared provider counter semantics.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; native mutation may precede a precision-result rejection.
   */
  increment(key: string, amount?: number): MaybePromise<number>;
  /** Apply a nonnegative integer decrement without normalizing backend-specific zero behavior.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; memory/Redis signed and Memcached clamped behavior remain distinct.
   */
  decrement(key: string, amount?: number): MaybePromise<number>;
  /** Refresh an existing key lifetime under explicit positive TTL validation.
   * @param {string} key - Logical key.
   * @param {number} ttlSeconds - Positive finite lifetime seconds.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing key was touched.
   */
  touch(key: string, ttlSeconds: number): MaybePromise<boolean>;
  /** Stop new work and release only resources owned by this facade/helper. Manager close drains native work/producers; memory helper close clears its local map.
   * @returns {MaybePromise<void>} Cleanup completion, not forced cancellation of arbitrary host promises.
   */
  close?(): MaybePromise<void>;
  /** Expose the privileged native helper handle to trusted host code only.
   * @returns {unknown} Escape hatch bypassing facade safety/namespace guarantees if used directly.
   */
  native?(): unknown;
}

export interface CacheHelperFactory {
  (options: Record<string, unknown>): MaybePromise<CacheHelper>;
}

export interface CacheManagerConfig {
  /** Explicit trusted adapter package/label, never caller-controlled executable configuration. */
  helper: string;
  /** Optional finite manager resource/capability/ownership policy. */
  policy?: CachePolicy;
  /** Explicit private host adapter configuration; do not send credentials to browsers. */
  options?: Record<string, unknown>;
  /** Application-owned verified namespace; compatible prefix:key spelling is not collision-proof tenant encoding. */
  prefix?: string;
  /** Optional positive finite default TTL for writes without a per-call lifetime. */
  defaultTtlSeconds?: number;
}

export interface CacheManager {
  /** Optional frozen provider declarations; absent metadata never proves a guarantee. */
  readonly capabilities?: Readonly<CacheCapabilities>;
  /** Explicit trusted adapter package/label, never caller-controlled executable configuration. */
  readonly helper: string;
  /** Application-owned verified namespace; compatible prefix:key spelling is not collision-proof tenant encoding. */
  readonly prefix?: string;
  /** Optional positive finite default TTL for writes without a per-call lifetime. */
  readonly defaultTtlSeconds?: number;
  /** Read one scoped cache value; absence stays distinct from JSON null.
   * @param {string} key - Logical unprefixed key validated before dispatch.
   * @returns {MaybePromise<CacheValue|undefined>} Detached bounded data or undefined; provider failures remain explicit.
   */
  get(key: string): MaybePromise<CacheValue | undefined>;
  /** Write a bounded JSON value with explicit TTL/condition semantics. A void return never proves conditional acquisition.
   * @param {string} key - Logical cache key, never a secret.
   * @param {CacheValue} value - Inert bounded JSON data copied before storage.
   * @param {CacheSetOptions} options - Optional TTL and exclusive ifAbsent/ifPresent flags.
   * @returns {MaybePromise<void>} Provider completion only; multi-key/distributed transaction guarantees are not invented.
   */
  set(
    key: string,
    value: CacheValue,
    options?: CacheSetOptions
  ): MaybePromise<void>;
  /** Delete one exact scoped key.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing deletion.
   */
  delete(key: string): MaybePromise<boolean>;
  /** Check exact scoped key presence with provider-owned expiry semantics.
   * @param {string} key - Logical key under the owning namespace.
   * @returns {MaybePromise<boolean>} Current provider presence; not authorization or a lock.
   */
  has(key: string): MaybePromise<boolean>;
  /** Clear the owning scope; unprefixed helpers/managers can request global clear under provider policy.
   * @returns {MaybePromise<void>} Scoped provider completion; unsupported namespace clearing fails closed.
   */
  clear(): MaybePromise<void>;
  /** Read a bounded key batch and retain logical result keys, including prototype-shaped spellings as own data fields.
   * @param {string[]} keys - Bounded logical keys.
   * @returns {MaybePromise<Record<string, CacheValue|undefined>>} Detached bounded values; no multi-read snapshot guarantee.
   */
  getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>>;
  /** Validate/copy a bounded write batch without claiming whole-batch atomicity.
   * @param {Record<string, CacheValue>} values - Explicit logical key/value record.
   * @param {CacheSetOptions} options - Optional shared TTL/conditions.
   * @returns {MaybePromise<void>} Provider completion; partial backend writes can occur.
   */
  setMany(
    values: Record<string, CacheValue>,
    options?: CacheSetOptions
  ): MaybePromise<void>;
  /** Delete a bounded explicit key batch with provider-reported count.
   * @param {string[]} keys - Bounded logical key list.
   * @returns {MaybePromise<number>} Reported deletion count; not a transaction across keys.
   */
  deleteMany(keys: string[]): MaybePromise<number>;
  /** Apply a nonnegative integer increment using declared provider counter semantics.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; native mutation may precede a precision-result rejection.
   */
  increment(key: string, amount?: number): MaybePromise<number>;
  /** Apply a nonnegative integer decrement without normalizing backend-specific zero behavior.
   * @param {string} key - Logical counter key.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {MaybePromise<number>} Safe integer result; memory/Redis signed and Memcached clamped behavior remain distinct.
   */
  decrement(key: string, amount?: number): MaybePromise<number>;
  /** Refresh an existing key lifetime under explicit positive TTL validation.
   * @param {string} key - Logical key.
   * @param {number} ttlSeconds - Positive finite lifetime seconds.
   * @returns {MaybePromise<boolean>} Whether the provider reports an existing key was touched.
   */
  touch(key: string, ttlSeconds: number): MaybePromise<boolean>;
  /** Stop new work and release only resources owned by this facade/helper. Manager close drains native work/producers; memory helper close clears its local map.
   * @returns {MaybePromise<void>} Cleanup completion, not forced cancellation of arbitrary host promises.
   */
  close(): MaybePromise<void>;
  /** Expose the privileged native helper handle to trusted host code only.
   * @returns {unknown} Escape hatch bypassing facade safety/namespace guarantees if used directly.
   */
  native(): unknown;
  /** Coalesce one process-local miss job per manager/key with finite actual-settlement ownership. Waiter cancellation only detaches that subscriber.
   * @param {string} key - Logical key whose first admitted producer policy governs shared work.
   * @param {(context: CacheProducerContext) => MaybePromise<CacheValue>} producer - Trusted cooperative callback receiving signal/deadline.
   * @param {CacheRememberOptions} options - Optional first-job TTL/conditions and waiter cancellation/deadline settings.
   * @returns {Promise<CacheValue>} Produced/read value; failed/cancelled late work never writes the cache automatically.
   */
  remember(
    key: string,
    producer: (context: CacheProducerContext) => MaybePromise<CacheValue>,
    options?: CacheRememberOptions
  ): Promise<CacheValue>;
}

export interface CacheErrorShape {
  /** Stable public cache failure category. */
  code: string;
  /** Explicit public error text; callers must not include private values. */
  message: string;
  /** Optional caller-supplied diagnostic shape; not automatically redacted. */
  details?: Record<string, unknown>;
}
