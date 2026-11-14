import type { CacheHelper, CacheValue } from '@zeruxjs/cache';
import {
  cachePolicy,
  cacheKey,
  cacheBulk,
  cacheValue,
  cacheSetOptions,
} from '@zeruxjs/cache/policy';
import type {
  ValkeyClient,
  ValkeyHelperOptions,
  ValkeyOperation,
  ValkeyOperationRecord,
  ValkeyRequestOptions,
  ValkeySetOptions,
} from './types.js';
/** Fixed internal diagnostics; causes stay private and issued writes can remain uncertain. */
export class ValkeyCacheError extends Error {
  /** Public code/message/uncertainty only; native causes remain non-enumerable/private. */
  readonly details: { code: string; message: string; writeOutcome?: 'unknown' };
  /** Construct fixed internal diagnostics; host-defined codes still require host redaction.
   * @param {string} code - Fixed internal classification; never a request value.
   * @param {unknown} cause - Optional private native failure.
   * @param {boolean} write - Mark an issued write as uncertain, default false.
   */
  constructor(
    readonly code: string,
    cause?: unknown,
    write = false
  ) {
    super(`Valkey cache error (${code})`);
    this.name = 'ValkeyCacheError';
    this.details = {
      code,
      message: this.message,
      ...(write ? { writeOutcome: 'unknown' as const } : {}),
    };
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Create fixed internal diagnostics with optional private cause and unknown-write marker.
 * @param {string} code - Fixed classification, never a request value.
 * @param {unknown} cause - Optional private error.
 * @param {boolean} write - Whether a native write may have committed, default false.
 * @returns {ValkeyCacheError} Redacted internal error; no automatic retry is implied. */
export const fail = (code: string, cause?: unknown, write = false) =>
  new ValkeyCacheError(code, cause, write);
/** Validate one bounded integer before native dispatch.
 * @param {unknown} value - Candidate input validated before use.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {number} Original validated integer.
 */
export function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw fail('VALKEY_INVALID_LIMIT');
  }
  return value;
}
/** Reject unknown keys, exotic objects and accessors without invoking them.
 * @param {unknown} value - Candidate input validated before use.
 * @param {readonly string[]} allowed - Explicit permitted own option names.
 * @returns {void} Narrows to a plain own-data record or throws.
 */
export function keys(
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
    throw fail('VALKEY_INVALID_OPTIONS');
  }
}
/** Explicit helper-only options separated from native connection configuration. */
export const helperKeys = [
  'ownClient',
  'allowFlushDb',
  'commandTimeoutMs',
  'shutdownTimeoutMs',
  'maxPendingCommands',
  'maxScanPages',
  'valueLimits',
  'onOperation',
];
/** Resolve bounded helper settings without native option passthrough.
 * @param {ValkeyHelperOptions} raw - Optional helper configuration; omitted settings use bounded defaults.
 * @returns {object} Copied scoped limits and optional fixed-label hook.
 */
export function helperPolicy(raw: ValkeyHelperOptions = {}) {
  keys(raw, helperKeys);
  // Reject nonboolean ownership/global-flush flags before accepting native work.
  for (const flag of ['ownClient', 'allowFlushDb'] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') {
      throw fail('VALKEY_INVALID_OPTIONS');
    }
  }
  if (raw.onOperation !== undefined && typeof raw.onOperation !== 'function') {
    throw fail('VALKEY_INVALID_OPTIONS');
  }
  if (raw.valueLimits !== undefined) {
    keys(raw.valueLimits, [
      'maxBulk',
      'maxKeyBytes',
      'maxValueBytes',
      'maxDepth',
    ]);
  }
  return {
    ownClient: raw.ownClient ?? false,
    allowFlushDb: raw.allowFlushDb ?? false,
    commandTimeoutMs: integer(raw.commandTimeoutMs ?? 3000, 1, 120000),
    shutdownTimeoutMs: integer(raw.shutdownTimeoutMs ?? 5000, 1, 120000),
    maxPendingCommands: integer(raw.maxPendingCommands ?? 64, 1, 1024),
    maxScanPages: integer(raw.maxScanPages ?? 10000, 1, 100000),
    value: cachePolicy(raw.valueLimits),
    onOperation: raw.onOperation,
  };
}
/** Scoped native-work owner with caller deadlines separate from actual cleanup. */
export class ValkeyCacheHelper implements CacheHelper {
  /** Supported/unsupported operation snapshot; native ownership is explicit. */
  readonly capabilities;
  /** Validated immutable-by-ownership wrapper budgets and hook reference. */
  readonly #policy;
  /** Actual native operations retain capacity until settlement. */
  readonly #work = new Set<Promise<unknown>>();
  /** Cancellation scopes stop waiting/follow-on submissions, not native work. */
  readonly #controllers = new Set<AbortController>();
  /** Permanent lifecycle fence. */
  #closed = false;
  /** Shared close observation receipt, potentially rejected at deadline. */
  #closing?: Promise<void>;
  /** Actual cleanup barrier, independent from the caller shutdown deadline. */
  #settled?: Promise<void>;
  /** At most four retained asynchronous hook observations. */
  #hookPending = 0;
  /** Fixed-label count of observations dropped at hook capacity. */
  #hookDropped = 0;
  /** Fixed-label count of isolated host hook failures. */
  #hookErrors = 0;
  /** Native error event count without raw message collection. */
  #backendErrors = 0;
  /** Count native errors without logging their private cause.
   * @returns {void} Updates only a local counter.
   */
  readonly #onError = () => {
    this.#backendErrors++;
  };
  /** Validate safe native policy and register the removable owned error listener.
   * @param {ValkeyClient} client - Configured safe native client, borrowed unless ownClient true.
   * @param {ValkeyHelperOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   */
  constructor(
    private readonly client: ValkeyClient,
    options: ValkeyHelperOptions = {}
  ) {
    this.#policy = helperPolicy(options);
    if (
      !client ||
      [
        'get',
        'set',
        'del',
        'exists',
        'incrby',
        'decrby',
        'expire',
        'scan',
        'flushdb',
        'quit',
        'disconnect',
        'on',
        'off',
      ].some((key) => typeof (client as any)[key] !== 'function')
    ) {
      throw fail('VALKEY_INVALID_CLIENT');
    }
    /** Whether the injected client exposes a real master inventory. */
    const cluster = typeof client.nodes === 'function';
    /** Injected native policy inspected before accepting the client wrapper. */
    const native = cluster ? client.options?.redisOptions : client.options;
    if (
      !native ||
      native.enableOfflineQueue !== false ||
      native.autoResendUnfulfilledCommands !== false ||
      native.maxRetriesPerRequest !== 0 ||
      native.keyPrefix ||
      (native.reconnectOnError !== null &&
        native.reconnectOnError !== undefined) ||
      (cluster &&
        (client.options?.enableOfflineQueue !== false ||
          client.options?.maxRedirections !== 0 ||
          client.options?.scaleReads !== 'master'))
    ) {
      throw fail('VALKEY_UNSAFE_CLIENT_POLICY');
    }
    client.on('error', this.#onError);
    this.capabilities = Object.freeze({
      conditionalWrites: 'supported' as const,
      counters: 'supported' as const,
      namespaceClear: 'supported' as const,
      bulkAtomicity: 'unsupported' as const,
      ownership: this.#policy.ownClient
        ? ('owned' as const)
        : ('borrowed' as const),
    });
  }
  /** Publish at most four asynchronous fixed-label observations; isolate hook failures.
   * @param {ValkeyOperationRecord} record - Fixed operation/outcome/duration metadata only.
   * @returns {void} No key/body/credential enters the record.
   */
  #emit(record: ValkeyOperationRecord) {
    /** Optional fixed-label host callback, capped independently from commands. */
    const hook = this.#policy.onOperation;
    if (!hook) {
      return;
    }
    if (this.#hookPending >= 4) {
      this.#hookDropped++;
      return;
    }
    this.#hookPending++;
    try {
      void Promise.resolve(hook(Object.freeze(record)))
        .catch(() => {
          this.#hookErrors++;
        })
        .finally(() => {
          this.#hookPending--;
        });
    } catch {
      this.#hookPending--;
      this.#hookErrors++;
    }
  }
  /** Bound caller waiting while retaining actual work and forbidding automatic replay.
   * @param {ValkeyOperation} operation - Fixed allowlisted operation label.
   * @param {(check: () => void) => Promise<T>} execute - One native-work callback with a fence before subsequent submissions.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<T>} Scoped result or redacted uncertain/error outcome.
   */
  async #run<T>(
    operation: ValkeyOperation,
    execute: (check: () => void) => Promise<T>,
    options: ValkeyRequestOptions = {}
  ): Promise<T> {
    keys(options, ['signal', 'deadline']);
    if (
      (options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)) ||
      (options.deadline !== undefined &&
        (!Number.isSafeInteger(options.deadline) ||
          options.deadline < 0 ||
          options.deadline > Date.now() + 120000))
    ) {
      throw fail('VALKEY_INVALID_REQUEST');
    }
    if (this.#closed) {
      throw fail('VALKEY_CLOSED');
    }
    if (this.#work.size >= this.#policy.maxPendingCommands) {
      this.#emit({
        operation,
        durationMs: 0,
        outcome: 'overload',
        code: 'VALKEY_OVERLOAD',
      });
      throw fail('VALKEY_OVERLOAD');
    }
    if (options.signal?.aborted) {
      throw fail('VALKEY_CANCELLED');
    }
    if (options.deadline !== undefined && options.deadline <= Date.now()) {
      throw fail('VALKEY_DEADLINE');
    }
    /** Whether an issued operation can leave an uncertain mutation. */
    const write = !['get', 'getMany', 'has'].includes(operation);
    /** Monotonic command start used only for fixed-label duration. */
    const start = performance.now();
    /** Earliest caller/configured wall-clock cutoff, not native cancellation. */
    const deadline = Math.min(
      Date.now() + this.#policy.commandTimeoutMs,
      options.deadline ?? Infinity
    );
    /** Wrapper-owned cancellation scope; native commands can continue after abort. */
    const controller = new AbortController();
    /** Detach the caller wait without replaying or cancelling arbitrary native promises.

 * @returns {void} Aborts only this wrapper scope. */
    const abort = () => controller.abort();
    let expired = false,
      issued = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    options.signal?.addEventListener('abort', abort, { once: true });
    this.#controllers.add(controller);
    /** Fence subsequent submissions after shutdown, caller cancellation or deadline.

 * @returns {void} Throws before further native commands; issued writes can remain unknown. */
    const check = () => {
      if (this.#closed || controller.signal.aborted || Date.now() >= deadline) {
        let code = 'VALKEY_CANCELLED';
        if (this.#closed) {
          code = 'VALKEY_CLOSED';
        } else if (expired || Date.now() >= deadline) {
          code = 'VALKEY_DEADLINE';
        }
        throw fail(code, undefined, issued && write);
      }
    };
    /** Actual native work retained through settlement even after the caller stops waiting. */
    const work = Promise.resolve().then(() => {
      check();
      issued = true;
      return execute(check);
    });
    this.#work.add(work);
    void work
      .finally(() => {
        this.#work.delete(work);
        this.#controllers.delete(controller);
      })
      .catch(() => {});
    let cancelled = () => {};
    /** Caller-facing deadline/cancellation promise, separate from native settlement. */
    const stopped = new Promise<never>((_, reject) => {
      cancelled = () => {
        let code = 'VALKEY_CANCELLED';
        if (this.#closed) {
          code = 'VALKEY_CLOSED';
        } else if (expired) {
          code = 'VALKEY_DEADLINE';
        }
        reject(fail(code, undefined, issued && write));
      };
      controller.signal.addEventListener('abort', cancelled, { once: true });
      timer = setTimeout(
        () => {
          expired = true;
          controller.abort();
        },
        Math.max(1, deadline - Date.now())
      );
      if (controller.signal.aborted) {
        cancelled();
      }
    });
    try {
      /** Scoped operation result returned only after the post-operation fence passes. */
      const value = await Promise.race([work, stopped]);
      check();
      this.#emit({
        operation,
        durationMs: performance.now() - start,
        outcome: 'ok',
      });
      return value;
    } catch (cause) {
      /** Fixed public wrapper error; native causes remain private. */
      const error =
        cause instanceof ValkeyCacheError
          ? cause
          : fail('VALKEY_BACKEND_ERROR', cause, issued && write);
      // Only fixed labels cross the diagnostic boundary.
      let outcome: ValkeyOperationRecord['outcome'] = 'error';
      if (error.code === 'VALKEY_DEADLINE') {
        outcome = 'deadline';
      } else if (['VALKEY_CANCELLED', 'VALKEY_CLOSED'].includes(error.code)) {
        outcome = 'cancelled';
      }
      this.#emit({
        operation,
        durationMs: performance.now() - start,
        outcome,
        code: error.code,
        ...(error.details.writeOutcome
          ? { writeOutcome: 'unknown' as const }
          : {}),
      });
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', cancelled);
    }
  }
  /** Reuse the shared cache key contract and translate its diagnostics.
   * @param {string} value - Candidate input validated before use.
   * @returns {string} Validated original key.
   */
  #key(value: string) {
    try {
      return cacheKey(value, this.#policy.value);
    } catch (cause) {
      throw fail('VALKEY_INVALID_KEY', cause);
    }
  }
  /** Validate and copy every key before dispatch.
   * @param {string[]} value - Candidate input validated before use.
   * @returns {string[]} Detached bounded key inventory.
   */
  #bulk(value: string[]) {
    try {
      cacheBulk(value, this.#policy.value);
      return value.map((key) => this.#key(key));
    } catch (cause) {
      throw cause instanceof ValkeyCacheError
        ? cause
        : fail('VALKEY_BULK_LIMIT', cause);
    }
  }
  /** Clone inert bounded JSON and reject unsafe integers at every numeric node.
   * @param {CacheValue} value - Candidate input validated before use.
   * @returns {string} Encoded plain JSON, never evaluated as source.
   */
  #encode(value: CacheValue) {
    try {
      /** Bounded plain JSON copy produced by the shared cache policy. */
      const copy = cacheValue(value, this.#policy.value);
      return JSON.stringify(copy, (_key, v) => {
        if (
          typeof v === 'number' &&
          Number.isInteger(v) &&
          !Number.isSafeInteger(v)
        ) {
          throw fail('VALKEY_NUMBER_RANGE');
        }
        return v;
      });
    } catch (cause) {
      throw cause instanceof ValkeyCacheError
        ? cause
        : fail('VALKEY_INVALID_VALUE', cause);
    }
  }
  /** Decode and independently revalidate stored JSON.
   * @param {unknown} value - Candidate input validated before use.
   * @returns {CacheValue|undefined} Detached bounded data; only native null means absence.
   */
  #decode(value: unknown): CacheValue | undefined {
    if (value === null) {
      return;
    }
    if (
      typeof value !== 'string' ||
      Buffer.byteLength(value) > this.#policy.value.maxValueBytes
    ) {
      throw fail('VALKEY_INVALID_RESULT');
    }
    try {
      /** Parsed JSON data revalidated before returning a detached result. */
      const parsed = JSON.parse(value) as CacheValue;
      return JSON.parse(this.#encode(parsed)) as CacheValue;
    } catch (cause) {
      throw cause instanceof ValkeyCacheError
        ? cause
        : fail('VALKEY_INVALID_VALUE', cause);
    }
  }
  /** Preserve decimal native replies until safe-integer validation.
   * @param {unknown} value - Candidate input validated before use.
   * @param {boolean} write - Mark an issued write as uncertain, default false.
   * @returns {number} Safe integer; failure after write can be uncertain.
   */
  #count(value: unknown, write = false) {
    if (typeof value === 'string' && /^-?\d{1,20}$/.test(value)) {
      value = Number(value);
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw fail('VALKEY_NUMBER_RANGE', undefined, write);
    }
    return value;
  }
  /** Require exactly zero or one for native presence/touch/delete replies.
   * @param {unknown} value - Candidate input validated before use.
   * @param {boolean} write - Mark an issued write as uncertain, default false.
   * @returns {boolean} Native binary status.
   */
  #binary(value: unknown, write = false) {
    /** Native integer reply validated before interpreting binary presence. */
    const count = this.#count(value, write);
    if (count !== 0 && count !== 1) {
      throw fail('VALKEY_INVALID_RESULT', undefined, write);
    }
    return count === 1;
  }
  /** Validate and round positive Redis-compatible EX seconds.
   * @param {unknown} seconds - Required positive lifetime seconds.
   * @returns {number} Safe integer at most 2147483647.
   */
  #ttl(seconds: unknown) {
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      !Number.isSafeInteger(Math.ceil(seconds)) ||
      Math.ceil(seconds) > 2147483647
    ) {
      throw fail('VALKEY_INVALID_TTL');
    }
    return Math.ceil(seconds);
  }
  /** Snapshot validated write flags before asynchronous dispatch.
   * @param {ValkeySetOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {ValkeySetOptions} Own option copy without conflicting conditions.
   */
  #setOptions(options: ValkeySetOptions) {
    keys(options, [
      'ttlSeconds',
      'ifAbsent',
      'ifPresent',
      'signal',
      'deadline',
    ]);
    try {
      cacheSetOptions(options);
    } catch (cause) {
      throw fail('VALKEY_INVALID_CONDITION', cause);
    }
    return { ...options };
  }
  /** Translate validated TTL and native NX/XX conditions.
   * @param {ValkeySetOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Array<string|number>} Fixed allowlisted native arguments.
   */
  #args(options: ValkeySetOptions): (string | number)[] {
    return [
      ...(options.ttlSeconds === undefined
        ? []
        : ['EX', this.#ttl(options.ttlSeconds)]),
      ...(options.ifAbsent ? ['NX'] : []),
      ...(options.ifPresent ? ['XX'] : []),
    ];
  }
  /** Read and revalidate one exact key.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<CacheValue|undefined>} Detached JSON or absence.
   */
  get(key: string, options: ValkeyRequestOptions = {}) {
    key = this.#key(key);
    return this.#run(
      'get',
      async () => this.#decode(await this.client.get(key)),
      options
    );
  }
  /** Encode before dispatch and preserve native conditional void semantics.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {CacheValue} value - Candidate input validated before use.
   * @param {ValkeySetOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<void>} Completion is not proof of conditional acquisition.
   */
  set(key: string, value: CacheValue, options: ValkeySetOptions = {}) {
    key = this.#key(key);
    options = this.#setOptions(options);
    /** Prepared encoded JSON values; preparation completes before native writes. */
    const encoded = this.#encode(value);
    /** Validated EX/NX/XX native command arguments. */
    const args = this.#args(options);
    return this.#run(
      'set',
      async () => {
        /** Native reply checked for expected shape before exposure. */
        const result = await this.client.set(key, encoded, ...args);
        if (result !== null && result !== 'OK') {
          throw fail('VALKEY_INVALID_RESULT', undefined, true);
        }
      },
      { signal: options.signal, deadline: options.deadline }
    );
  }
  /** Delete one exact validated key.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<boolean>} Native deletion status.
   */
  delete(key: string, options: ValkeyRequestOptions = {}) {
    key = this.#key(key);
    return this.#run(
      'delete',
      async () => this.#binary(await this.client.del(key), true),
      options
    );
  }
  /** Check one exact key without granting authorization.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<boolean>} Native presence status.
   */
  has(key: string, options: ValkeyRequestOptions = {}) {
    key = this.#key(key);
    return this.#run(
      'has',
      async () => this.#binary(await this.client.exists(key)),
      options
    );
  }
  /** Increment a native signed integer without replay.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {number} amount - Nonnegative safe delta, default one.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<number>} Safe result; range failure after mutation is uncertain.
   */
  increment(key: string, amount = 1, options: ValkeyRequestOptions = {}) {
    key = this.#key(key);
    integer(amount, 0, Number.MAX_SAFE_INTEGER);
    return this.#run(
      'increment',
      async () => this.#count(await this.client.incrby(key, amount), true),
      options
    );
  }
  /** Decrement native integer data without replay.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {number} amount - Nonnegative safe delta, default one.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<number>} Safe result; no rollback is implied on failure.
   */
  decrement(key: string, amount = 1, options: ValkeyRequestOptions = {}) {
    key = this.#key(key);
    integer(amount, 0, Number.MAX_SAFE_INTEGER);
    return this.#run(
      'decrement',
      async () => this.#count(await this.client.decrby(key, amount), true),
      options
    );
  }
  /** Set one existing item lifetime.
   * @param {string} key - Exact logical or manager-prefixed key.
   * @param {number} seconds - Required positive lifetime seconds.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<boolean>} Native touch result.
   */
  touch(key: string, seconds: number, options: ValkeyRequestOptions = {}) {
    key = this.#key(key);
    /** Validated rounded native EX lifetime. */
    const ttl = this.#ttl(seconds);
    return this.#run(
      'touch',
      async () => this.#binary(await this.client.expire(key, ttl), true),
      options
    );
  }
  /** Read prevalidated keys sequentially within one admitted scope.
   * @param {string[]} keys - Bounded key list copied before dispatch.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<Record<string,CacheValue|undefined>>} Own-key result map, not a snapshot.
   */
  getMany(keys: string[], options: ValkeyRequestOptions = {}) {
    keys = this.#bulk(keys);
    return this.#run(
      'getMany',
      async (check) => {
        /** Native reply checked for expected shape before exposure. */
        const result: Record<string, CacheValue | undefined> =
          Object.create(null);
        // Read each validated key sequentially with a cancellation fence between commands.
        for (const key of keys) {
          check();
          result[key] = this.#decode(await this.client.get(key));
        }
        return result;
      },
      options
    );
  }
  /** Prepare every body before sequential per-key writes.
   * @param {Record<string, CacheValue>} values - Own JSON entries prepared before any native write.
   * @param {ValkeySetOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<void>} Partial failure is explicit; no bulk transaction.
   */
  setMany(values: Record<string, CacheValue>, options: ValkeySetOptions = {}) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw fail('VALKEY_INVALID_VALUE');
    }
    /** Complete validated own-key inventory before bulk preparation. */
    const names = this.#bulk(Object.keys(values));
    options = this.#setOptions(options);
    /** Validated EX/NX/XX native command arguments. */
    const args = this.#args(options);
    /** Prepared encoded JSON values; preparation completes before native writes. */
    const encoded = names.map((key) => {
      /** Own bulk data descriptor; getters cannot run during encoding. */
      const d = Object.getOwnPropertyDescriptor(values, key)!;
      if (!('value' in d)) {
        throw fail('VALKEY_INVALID_VALUE');
      }
      return [key, this.#encode(d.value)] as const;
    });
    return this.#run(
      'setMany',
      async (check) => {
        // Write only after every body was prepared; partial failure is not rolled back.
        for (const [key, value] of encoded) {
          check();
          /** Native reply checked for expected shape before exposure. */
          const result = await this.client.set(key, value, ...args);
          if (result !== null && result !== 'OK') {
            throw fail('VALKEY_INVALID_RESULT', undefined, true);
          }
        }
      },
      { signal: options.signal, deadline: options.deadline }
    );
  }
  /** Delete sequentially with a cancellation fence between keys.
   * @param {string[]} keys - Bounded key list copied before dispatch.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<number>} Native confirmed deletion count.
   */
  deleteMany(keys: string[], options: ValkeyRequestOptions = {}) {
    keys = this.#bulk(keys);
    return this.#run(
      'deleteMany',
      async (check) => {
        let total = 0;
        // Count native-confirmed deletions while fencing subsequent submissions.
        for (const key of keys) {
          check();
          total += this.#binary(await this.client.del(key), true) ? 1 : 0;
        }
        return total;
      },
      options
    );
  }
  /** Reject global flush unless explicitly allowed on standalone only.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<void>} Native flush completion; Cluster always rejects.
   */
  clear(options: ValkeyRequestOptions = {}) {
    if (!this.#policy.allowFlushDb || typeof this.client.nodes === 'function') {
      return Promise.reject(fail('VALKEY_GLOBAL_CLEAR_DISABLED'));
    }
    return this.#run(
      'clear',
      async () => {
        await this.client.flushdb();
      },
      options
    );
  }
  /** Sweep every bounded current master and filter literal namespaces.
   * @param {string} prefix - Literal namespace; glob escaping does not replace the final prefix check.
   * @param {ValkeyRequestOptions} options - Optional scoped configuration or per-request cancellation/write controls.
   * @returns {Promise<void>} Non-snapshot clear; concurrent writers can survive.
   */
  clearPrefix(prefix: string, options: ValkeyRequestOptions = {}) {
    prefix = this.#key(prefix);
    return this.#run(
      'clearPrefix',
      async (check) => {
        /** Current actual primary inventory, bounded to 128 entries. */
        const nodes =
          typeof this.client.nodes === 'function'
            ? this.client.nodes('master')
            : [this.client];
        if (!Array.isArray(nodes) || !nodes.length || nodes.length > 128) {
          throw fail('VALKEY_INVALID_RESULT');
        }
        /** Escaped SCAN glob; returned keys still require a literal-prefix check. */
        const match = prefix.replace(/[\\*?[\]]/g, '\\$&') + ':*';
        let pages = 0;
        // Sweep every bounded current master, never a single arbitrary Cluster node.
        for (const node of [...nodes]) {
          let cursor = '0';
          // Advance one master cursor with a global page cap across the sweep.
          do {
            check();
            if (++pages > this.#policy.maxScanPages) {
              throw fail('VALKEY_SCAN_LIMIT');
            }
            /** Native reply checked for expected shape before exposure. */
            const result = await node.scan(
              cursor,
              'MATCH',
              match,
              'COUNT',
              100
            );
            if (
              !Array.isArray(result) ||
              result.length !== 2 ||
              typeof result[0] !== 'string' ||
              !/^\d{1,20}$/.test(result[0]) ||
              !Array.isArray(result[1]) ||
              result[1].length > 10000
            ) {
              throw fail('VALKEY_INVALID_RESULT');
            }
            cursor = result[0];
            // Verify each native key and its literal namespace before routed deletion.
            for (const key of result[1]) {
              check();
              this.#key(key);
              if (key.startsWith(prefix + ':')) {
                await this.client.del(key);
              }
            }
          } while (cursor !== '0');
        }
      },
      options
    );
  }
  /** Expose a privileged native escape hatch to trusted host code.
   * @returns {ValkeyClient} Handle bypassing wrapper guarantees.
   */
  native() {
    if (this.#closed) {
      throw fail('VALKEY_CLOSED');
    }
    return this.client;
  }
  /** Read local fixed-label counters without request data.
   * @returns {object} Current wrapper ownership and hook totals.
   */
  getDiagnostics() {
    return {
      closed: this.#closed,
      pending: this.#work.size,
      hookPending: this.#hookPending,
      hookDropped: this.#hookDropped,
      hookErrors: this.#hookErrors,
      backendErrors: this.#backendErrors,
    };
  }
  /** Fence callers and begin actual drain with an observation deadline.
   * @returns {Promise<void>} May reject at the shutdown deadline; actual cleanup can continue.
   */
  close(): Promise<void> {
    if (this.#closing) {
      return this.#closing;
    }
    this.#closed = true;
    // Abort caller waits while retaining actual native work for cleanup.
    for (const controller of this.#controllers) {
      controller.abort();
    }
    this.#settled = Promise.allSettled([...this.#work]).then(async () => {
      try {
        if (this.#policy.ownClient) {
          await this.client.quit();
        }
      } catch (cause) {
        try {
          if (this.#policy.ownClient) {
            this.client.disconnect(false);
          }
        } catch {
          /* Preserve original close failure privately. */
        }
        throw fail('VALKEY_CLOSE_FAILED', cause);
      } finally {
        this.client.off('error', this.#onError);
      }
    });
    this.#closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.#settled,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              try {
                if (this.#policy.ownClient) {
                  this.client.disconnect(false);
                }
                reject(fail('VALKEY_SHUTDOWN_DEADLINE'));
              } catch (cause) {
                reject(fail('VALKEY_CLOSE_FAILED', cause));
              }
            }, this.#policy.shutdownTimeoutMs);
          }),
        ]);
      } catch (cause) {
        throw cause instanceof ValkeyCacheError
          ? cause
          : fail('VALKEY_CLOSE_FAILED', cause);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    })();
    return this.#closing;
  }
  /** Observe actual work and owned-client cleanup after close begins.
   * @returns {Promise<void>} Rejects before close; can stay pending for uncooperative borrowed work.
   */
  whenClosed() {
    if (!this.#closed) {
      return Promise.reject(fail('VALKEY_NOT_CLOSED'));
    }
    return this.#settled!;
  }
}
/** Wrap an explicitly configured safe native client; borrow ownership by default.
 * @param {ValkeyClient} client - Native client whose replay/offline options are verified.
 * @param {ValkeyHelperOptions} options - Optional scoped budgets and explicit ownership.
 * @returns {ValkeyCacheHelper} Closeable wrapper with a separate actual-settlement barrier. */
export const createValkeyCacheHelper = (
  client: ValkeyClient,
  options: ValkeyHelperOptions = {}
) => new ValkeyCacheHelper(client, options);
