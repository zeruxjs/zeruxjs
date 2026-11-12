import type {
  AtomicRateLimitClaim,
  AtomicRateLimitDecision,
  RateLimitRequest,
} from '@zeruxjs/security';
import { fixedWindowScript } from './limiter-script.js';
import type { CacheHelper, CacheSetOptions, CacheValue } from '@zeruxjs/cache';
import {
  serialize,
  deserialize,
  expiration,
  counterAmount,
  prefixGlob,
} from './codec.js';
import type { RedisCacheClient } from './types.js';
import {
  redisPolicy,
  redisError,
  RedisCacheError,
  redisKey,
  redisBulk,
} from './policy.js';
import type {
  RedisCachePolicy,
  RedisOperation,
  RedisOperationRecord,
  RedisRequestOptions,
} from './policy.js';
export interface RedisHelperConfig extends RedisCachePolicy {
  /** Default false; true permits a destructive global operation where supported. */
  allowFlushDb?: boolean;
  /** Default false for injection; true owns native close/destroy. */
  ownClient?: boolean;
  /** Actual injected Cluster behavior; disables cross-slot multi-key commands. */
  cluster?: boolean;
}
export interface RedisSetOptions extends CacheSetOptions, RedisRequestOptions {}
/** Wait for every issued sibling before exposing batch failure or releasing capacity.
 * @param {Promise<T>[]} promises - Already-issued native sibling promises; every one must settle.
 * @returns {Promise<T[]>} Ordered values or one/private aggregate error after all settlement.
 */
async function settle<T>(promises: Promise<T>[]): Promise<T[]> {
  /** Every issued sibling outcome is retained until all native commands settle. */
  const results = await Promise.allSettled(promises);
  /** Rejected sibling causes, preserved privately without releasing capacity early. */
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason);
  if (errors.length) {
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(errors, 'Redis batch failed');
  }
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}
/** One scoped cache wrapper. Deadlines do not cancel or replay native writes. */
export class RedisCacheHelper implements CacheHelper {
  /** Validated supported/unsupported capability snapshot; ownership describes the native connection. */
  readonly capabilities;
  /** Resolved scoped budgets and optional diagnostic callback. */
  readonly #policy;
  /** Native work retains admission slots until its actual settlement. */
  readonly #active = new Set<Promise<unknown>>();
  /** Wrapper-owned cancellation scopes; native commands may outlive caller waits. */
  readonly #controllers = new Set<AbortController>();
  /** Permanent fence rejecting future helper calls. */
  #closed = false;
  /** One idempotent shutdown receipt shared by every close caller. */
  #closing?: Promise<void>;
  /** Outstanding host hook promises, capped independently from native commands. */
  #hookPending = 0;
  /** Path-free count of isolated host hook failures. */
  #hookErrors = 0;
  /** Path-free count of observations dropped at hook capacity. */
  #hookDropped = 0;
  /** Native error-event count without copying native messages. */
  #backendErrors = 0;
  /** Count native error events without logging keys, credentials or causes.
   * @returns {void} Updates only the local diagnostic counter.
   */
  readonly #onError = () => {
    this.#backendErrors++;
  };
  /** Snapshot wrapper policy and attach only removable error listeners.
   * @param {RedisCacheClient} client - Configured native structural client; borrowed by default.
   * @param {RedisHelperConfig} config - Wrapper policy and explicit native ownership, copied on construction.
   */
  constructor(
    private readonly client: RedisCacheClient,
    private readonly config: RedisHelperConfig = {}
  ) {
    this.#policy = redisPolicy(config);
    this.config = { ...config };
    // Reject nonboolean ownership/global-flush/Cluster flags before native work.
    for (const flag of ['ownClient', 'allowFlushDb', 'cluster'] as const) {
      if (config[flag] !== undefined && typeof config[flag] !== 'boolean') {
        throw redisError('REDIS_INVALID_OPTIONS');
      }
    }
    if (
      !client ||
      [
        'get',
        'set',
        'del',
        'exists',
        'mGet',
        'mSet',
        'incrBy',
        'decrBy',
        'expire',
        'scanIterator',
      ].some(
        (key) =>
          typeof (client as unknown as Record<string, unknown>)[key] !==
          'function'
      )
    ) {
      throw redisError('REDIS_INVALID_CLIENT');
    }
    if (client.off) {
      client.on?.('error', this.#onError);
    }
    this.capabilities = Object.freeze({
      conditionalWrites: 'supported' as const,
      counters: 'supported' as const,
      namespaceClear: 'supported' as const,
      bulkAtomicity: 'unsupported' as const,
      ownership: config.ownClient ? ('owned' as const) : ('borrowed' as const),
    });
  }
  /** Publish fixed-label records without blocking work or growing an unbounded hook queue.
   * @param {RedisOperationRecord} record - Value-free frozen diagnostic payload.
   * @returns {void} Throws/rejections/drop counts are isolated from operation outcome.
   */
  #emit(record: RedisOperationRecord) {
    /** Optional host callback for fixed-label diagnostics only. */
    const hook = this.#policy.onOperation;
    if (!hook) {
      return;
    }
    if (this.#hookPending >= 16) {
      this.#hookDropped++;
      return;
    }
    try {
      /** Host hook result; asynchronous observation has a separate bounded counter. */
      const pending = hook(Object.freeze(record));
      if (pending && typeof pending.then === 'function') {
        this.#hookPending++;
        void Promise.resolve(pending)
          .catch(() => {
            this.#hookErrors++;
          })
          .finally(() => {
            this.#hookPending--;
          });
      }
    } catch {
      this.#hookErrors++;
    }
  }
  /** Bound caller waiting while retaining capacity until actual native settlement.
   * @param {RedisOperation} operation - Fixed diagnostic operation name.
   * @param {(check: () => void) => Promise<T>} execute - One bounded native-work callback with a follow-on dispatch fence.
   * @param {RedisRequestOptions} options - Optional cancellation/deadline; wrapper timeout still applies.
   * @returns {Promise<T>} Scoped result or redacted failure; timed-out writes are not replayed.
   */
  async #run<T>(
    operation: RedisOperation,
    execute: (check: () => void) => Promise<T>,
    options: RedisRequestOptions = {}
  ): Promise<T> {
    if (this.#closed) {
      throw redisError('REDIS_CACHE_CLOSED');
    }
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)) ||
      (options.deadline !== undefined &&
        (!Number.isSafeInteger(options.deadline) || options.deadline < 0))
    ) {
      throw redisError('REDIS_INVALID_REQUEST');
    }
    options = { ...options };
    /** Monotonic command start for path-free duration measurement. */
    const start = performance.now();
    /** Whether cancellation/failure can leave an unknown backend mutation. */
    const write = !['get', 'has', 'getMany'].includes(operation);
    /** Wrapper-owned cancellation for this accepted work; it does not cancel native JavaScript. */
    const controller = new AbortController();
    let timedOut = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    /** Detach one caller by aborting only this wrapper scope.

 * @returns {void} Does not replay or roll back native work. */
    const abort = () => controller.abort();
    /** Earliest caller/configured wall-clock cutoff. */
    const deadline = Math.min(
      Date.now() + this.#policy.commandTimeoutMs,
      options.deadline ?? Infinity
    );
    if (options.signal?.aborted || deadline <= Date.now()) {
      throw redisError(
        deadline <= Date.now()
          ? 'REDIS_COMMAND_DEADLINE'
          : 'REDIS_COMMAND_CANCELLED'
      );
    }
    if (this.#active.size >= this.#policy.maxPendingCommands) {
      this.#emit({
        operation,
        durationMs: 0,
        outcome: 'overload',
        code: 'REDIS_COMMAND_OVERLOAD',
      });
      throw redisError('REDIS_COMMAND_OVERLOAD');
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    this.#controllers.add(controller);
    /** Fence follow-on native submissions after shutdown, cancellation or deadline.

 * @returns {void} Throws fixed diagnostics; issued writes may remain unknown. */
    const check = () => {
      if (this.#closed || controller.signal.aborted || Date.now() >= deadline) {
        let code = 'REDIS_COMMAND_CANCELLED';
        if (this.#closed) {
          code = 'REDIS_CACHE_CLOSED';
        } else if (timedOut || Date.now() >= deadline) {
          code = 'REDIS_COMMAND_DEADLINE';
        }
        throw redisError(code, undefined, write);
      }
    };
    /** Actual accepted native work retained through settlement, even after caller timeout. */
    const work = Promise.resolve().then(() => {
      check();
      return execute(check);
    });
    this.#active.add(work);
    void work
      .finally(() => {
        this.#active.delete(work);
        this.#controllers.delete(controller);
      })
      .catch(() => {});
    let cancel = () => {};
    /** Caller-facing cancellation/deadline promise; not native completion. */
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => {
        let code = 'REDIS_COMMAND_CANCELLED';
        if (this.#closed) {
          code = 'REDIS_CACHE_CLOSED';
        } else if (timedOut) {
          code = 'REDIS_COMMAND_DEADLINE';
        }
        reject(redisError(code, undefined, write));
      };
      controller.signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.max(1, deadline - Date.now())
      );
      if (controller.signal.aborted) {
        cancel();
      }
    });
    try {
      /** Validated operation result, returned only after the scope fence passes. */
      const result = await Promise.race([work, stopped]);
      check();
      this.#emit({
        operation,
        durationMs: performance.now() - start,
        outcome: 'ok',
      });
      return result;
    } catch (cause) {
      /** Fixed public wrapper codes allowed through without native detail. */
      const known = [
        'REDIS_CACHE_CLOSED',
        'REDIS_COMMAND_DEADLINE',
        'REDIS_COMMAND_CANCELLED',
        'REDIS_COUNTER_RANGE',
        'REDIS_INVALID_RESULT',
        'REDIS_INVALID_JSON',
        'REDIS_JSON_LIMIT',
        'REDIS_SCAN_LIMIT',
        'REDIS_INVALID_KEY',
        'REDIS_CLUSTER_MASTERS_UNAVAILABLE',
        'REDIS_INVALID_LIMITER_RESULT',
      ];
      /** Sanitized public error retaining its raw cause privately. */
      const error =
        cause instanceof RedisCacheError && known.includes(cause.code)
          ? cause
          : redisError('REDIS_BACKEND_ERROR', cause, write);
      // Diagnostic classification never includes backend text or caller values.
      let outcome: RedisOperationRecord['outcome'] = 'error';
      if (error.code === 'REDIS_COMMAND_DEADLINE') {
        outcome = 'deadline';
      } else if (
        ['REDIS_COMMAND_CANCELLED', 'REDIS_CACHE_CLOSED'].includes(error.code)
      ) {
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
      controller.signal.removeEventListener('abort', cancel);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  /** Read path/value-free local ownership and hook counters.
   * @returns {Readonly<{closed:boolean,pending:number,hookPending:number,hookErrors:number,hookDropped:number,backendErrors:number}>} Frozen current counters; not distributed telemetry.
   */
  getDiagnostics() {
    return Object.freeze({
      closed: this.#closed,
      pending: this.#active.size,
      hookPending: this.#hookPending,
      hookErrors: this.#hookErrors,
      hookDropped: this.#hookDropped,
      backendErrors: this.#backendErrors,
    });
  }
  /** Read and independently validate one stored JSON string.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @param {RedisRequestOptions} options - Optional cancellation/deadline; wrapper timeout still applies.
   * @returns {Promise<CacheValue|undefined>} Bounded JSON or absence only for native null.
   */
  async get(
    key: string,
    options: RedisRequestOptions = {}
  ): Promise<CacheValue | undefined> {
    redisKey(key);
    return this.#run(
      'get',
      async () => {
        /** Native stored string; only null denotes a cache miss. */
        const value = await this.client.get(key);
        if (value === null) {
          return undefined;
        }
        if (typeof value !== 'string') {
          throw redisError('REDIS_INVALID_RESULT');
        }
        return deserialize(value);
      },
      options
    );
  }
  /** Validate/encode a write before dispatch; conditions use native NX/XX.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @param {CacheValue} value - Plain JSON payload or native counter result, validated before exposure.
   * @param {RedisSetOptions} opts - Optional TTL and mutually exclusive native condition flags.
   * @returns {Promise<void>} Void completion does not report condition success.
   */
  async set(
    key: string,
    value: CacheValue,
    opts: RedisSetOptions = {}
  ): Promise<void> {
    redisKey(key);
    this.#conditions(opts);
    opts = { ...opts };
    /** Validated Redis EX lifetime, independent of condition flags. */
    const expiry = expiration(opts.ttlSeconds);
    /** Complete bounded JSON body encoded before submission. */
    const body = serialize(value);
    return this.#run(
      'set',
      async () => {
        await this.client.set(key, body, {
          ...(expiry === undefined ? {} : { EX: expiry }),
          ...(opts.ifAbsent ? { NX: true } : {}),
          ...(opts.ifPresent ? { XX: true } : {}),
        });
      },
      opts
    );
  }
  /** Delete an exact validated key.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @returns {Promise<boolean>} Whether native DEL reports a removed item.
   */
  async delete(key: string) {
    redisKey(key);
    return this.#run('delete', async () => (await this.client.del(key)) > 0);
  }
  /** Check one exact validated key.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @returns {Promise<boolean>} Native existence at observation time, not authorization.
   */
  async has(key: string) {
    redisKey(key);
    return this.#run('has', async () => (await this.client.exists(key)) > 0);
  }
  /** Flush only when explicitly allowed and exposed by this native client.
   * @returns {Promise<void>} Global flush completion; default disabled.
   */
  async clear() {
    if (!this.config.allowFlushDb || !this.client.flushDb) {
      throw new Error('Redis FLUSHDB is disabled');
    }
    return this.#run('clear', async () => {
      await this.client.flushDb!();
    });
  }
  /** Sweep bounded SCAN pages with literal-prefix checks and per-key deletes.
   * @param {string} prefix - Literal namespace, maximum 256 characters.
   * @returns {Promise<void>} Non-snapshot sweep; concurrent writers can survive.
   */
  async clearPrefix(prefix: string) {
    if (typeof prefix !== 'string' || !prefix.length || prefix.length > 256) {
      throw redisError('REDIS_INVALID_PREFIX');
    }
    return this.#run('clearPrefix', async (check) => {
      /** Native page stream; this sweep is not a snapshot of concurrent writers. */
      const scan = this.client.scanIterator({
        MATCH: prefixGlob(prefix),
        COUNT: 100,
      });
      /** Owned SCAN iterator closed in finally after success or failure. */
      const iterator = scan[Symbol.asyncIterator]();
      let pages = 0;
      try {
        // Bound each native scan page and always release the iterator in finally.
        while (true) {
          check();
          /** Next native scan page, checked before applying the literal namespace filter. */
          const page = await iterator.next();
          if (page.done) {
            break;
          }
          if (++pages > this.#policy.maxScanPages) {
            throw redisError('REDIS_SCAN_LIMIT');
          }
          /** Validated key inventory before asynchronous bulk work begins. */
          const keys =
            typeof page.value === 'string' ? [page.value] : page.value;
          if (!Array.isArray(keys) || keys.length > 10000) {
            throw redisError('REDIS_INVALID_RESULT');
          }
          // Delete literal-prefix matches in bounded per-key groups, never cross-slot DEL.
          for (let i = 0; i < keys.length; i += 32) {
            check();
            await settle(
              keys.slice(i, i + 32).map(async (key) => {
                if (typeof key !== 'string') {
                  throw redisError('REDIS_INVALID_RESULT');
                }
                if (!key.startsWith(prefix + ':')) {
                  return 0;
                }
                redisKey(key);
                return this.client.del(key);
              })
            );
          }
        }
      } finally {
        await iterator.return?.();
      }
    });
  }
  /** Read bounded keys using standalone MGET or cross-slot-safe Cluster groups.
   * @param {string[]} keys - At most 1000 validated keys, copied before dispatch.
   * @returns {Promise<Record<string,CacheValue|undefined>>} Own-key result mapping; no distributed snapshot guarantee.
   */
  async getMany(keys: string[]) {
    keys = redisBulk(keys);
    return this.#run('getMany', async (check) => {
      /** Validated operation result, returned only after the scope fence passes. */
      const result: Record<string, CacheValue | undefined> =
        Object.create(null);
      if (!keys.length) {
        return result;
      }
      let data: Array<string | null>;
      if (this.config.cluster) {
        data = [];
        // Read Cluster keys in bounded per-key groups while retaining every sibling.
        for (let i = 0; i < keys.length; i += 32) {
          check();
          data.push(
            ...(await settle(
              keys.slice(i, i + 32).map(async (key) => this.client.get(key))
            ))
          );
        }
      } else {
        data = await this.client.mGet(keys);
      }
      if (!Array.isArray(data) || data.length !== keys.length) {
        throw redisError('REDIS_INVALID_RESULT');
      }
      keys.forEach((key, i) => {
        result[key] = data[i] === null ? undefined : deserialize(data[i]!);
      });
      return result;
    });
  }
  /** Prepare all values before native MSET or condition/TTL/Cluster batches.
   * @param {Record<string, CacheValue>} values - Own keyed JSON candidates prepared before native writes.
   * @param {RedisSetOptions} opts - Optional TTL and mutually exclusive native condition flags.
   * @returns {Promise<void>} Partial writes remain possible; no transaction guarantee.
   */
  async setMany(
    values: Record<string, CacheValue>,
    opts: RedisSetOptions = {}
  ) {
    this.#conditions(opts);
    opts = { ...opts };
    expiration(opts.ttlSeconds);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw redisError('REDIS_INVALID_VALUE');
    }
    /** Validated key inventory before asynchronous bulk work begins. */
    const keys = redisBulk(Object.keys(values));
    /** Prepared JSON bodies keyed by validated logical keys. */
    const encoded = Object.fromEntries(
      keys.map((key) => [key, serialize(values[key])])
    );
    return this.#run(
      'setMany',
      async (check) => {
        if (!keys.length) {
          return;
        }
        if (
          this.config.cluster ||
          opts.ttlSeconds !== undefined ||
          opts.ifAbsent ||
          opts.ifPresent
        ) {
          // Apply TTL/conditions per key in bounded groups; partial writes are not rolled back.
          for (let i = 0; i < keys.length; i += 32) {
            check();
            await settle(
              keys.slice(i, i + 32).map(async (key) =>
                this.client.set(key, encoded[key], {
                  ...(opts.ttlSeconds === undefined
                    ? {}
                    : { EX: expiration(opts.ttlSeconds) }),
                  ...(opts.ifAbsent ? { NX: true } : {}),
                  ...(opts.ifPresent ? { XX: true } : {}),
                })
              )
            );
          }
        } else {
          await this.client.mSet(encoded);
        }
      },
      opts
    );
  }
  /** Delete in bounded groups without cross-slot native DEL.
   * @param {string[]} keys - At most 1000 validated keys, copied before dispatch.
   * @returns {Promise<number>} Validated total removed count.
   */
  async deleteMany(keys: string[]) {
    keys = redisBulk(keys);
    return this.#run('deleteMany', async (check) => {
      let removed = 0;
      // Delete bounded per-key groups with an actual-settlement barrier.
      for (let i = 0; i < keys.length; i += 32) {
        check();
        // Validate every native delete count before accumulating it.
        for (const count of await settle(
          keys.slice(i, i + 32).map(async (key) => this.client.del(key))
        )) {
          if (!Number.isSafeInteger(count) || count < 0) {
            throw redisError('REDIS_INVALID_RESULT');
          }
          removed += count;
        }
      }
      return removed;
    });
  }
  /** Increment using native signed arithmetic without automatic replay.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {Promise<number>} Safe integer result; rejection after mutation is not rollback.
   */
  async increment(key: string, amount = 1) {
    redisKey(key);
    counterAmount(amount);
    return this.#run('increment', async () =>
      this.#counter(await this.client.incrBy(key, amount))
    );
  }
  /** Decrement using native signed arithmetic without automatic replay.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @param {number} amount - Nonnegative safe integer delta, default one.
   * @returns {Promise<number>} Safe integer result; native range can exceed JavaScript precision.
   */
  async decrement(key: string, amount = 1) {
    redisKey(key);
    counterAmount(amount);
    return this.#run('decrement', async () =>
      this.#counter(await this.client.decrBy(key, amount))
    );
  }
  /** Set an existing key expiry with native EXPIRE.
   * @param {string} key - Exact validated cache key, never an authorization assertion.
   * @param {number} seconds - Required finite positive lifetime in seconds.
   * @returns {Promise<boolean>} Native presence/touch outcome.
   */
  async touch(key: string, seconds: number) {
    redisKey(key);
    if (seconds === undefined) {
      throw redisError('REDIS_INVALID_TTL');
    }
    /** Required validated expiry for a native touch operation. */
    const ttl = expiration(seconds)!;
    return this.#run('touch', async () =>
      Boolean(await this.client.expire(key, ttl))
    );
  }
  /** Execute only the fixed two-key, same-slot atomic limiter script.
   * @param {AtomicRateLimitClaim} input - Security-owned opaque claim; raw subject identity is not accepted.
   * @param {{ namespace: string; maxKeys: number; maxWindowMs: number }} store - Validated namespace/cardinality/window policy.
   * @param {string} store.namespace - Validated same-slot hash tag.
   * @param {number} store.maxKeys - Hard live subject cap.
   * @param {number} store.maxWindowMs - Maximum claim window/TTL milliseconds.
   * @param {RateLimitRequest} request - Optional security-owned cancellation/deadline controls.
   * @returns {Promise<AtomicRateLimitDecision>} Validated server-time decision; deployment persistence remains host-owned.
   */
  async claimRateLimit(
    input: AtomicRateLimitClaim,
    store: { namespace: string; maxKeys: number; maxWindowMs: number },
    request: RateLimitRequest = {}
  ): Promise<AtomicRateLimitDecision> {
    if (
      !input ||
      typeof input.key !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.key) ||
      !Number.isSafeInteger(input.windowMs) ||
      input.windowMs < 1 ||
      !Number.isSafeInteger(input.max) ||
      input.max < 1 ||
      input.max > 1000000 ||
      !Number.isSafeInteger(input.weight) ||
      input.weight < 1 ||
      input.weight > 1000000 ||
      !store ||
      typeof store.namespace !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(store.namespace) ||
      !Number.isSafeInteger(store.maxKeys) ||
      store.maxKeys < 1 ||
      store.maxKeys > 100000 ||
      !Number.isSafeInteger(store.maxWindowMs) ||
      store.maxWindowMs < 1 ||
      store.maxWindowMs > 86400000 ||
      input.windowMs > store.maxWindowMs
    ) {
      throw redisError('REDIS_INVALID_LIMITER_CLAIM');
    }
    if (!this.client.eval) {
      throw redisError('REDIS_ATOMIC_LIMITER_UNSUPPORTED');
    }
    return this.#run(
      'rateLimit',
      async () => {
        /** Validated operation result, returned only after the scope fence passes. */
        const result = await this.client.eval!(fixedWindowScript, {
          keys: [
            `zerux:rl:{${store.namespace}}:counts`,
            `zerux:rl:{${store.namespace}}:expires`,
          ],
          arguments: [
            input.key,
            String(input.windowMs),
            String(input.max),
            String(input.weight),
            String(store.maxKeys),
            String(store.maxWindowMs),
          ],
        });
        if (
          !Array.isArray(result) ||
          result.length !== 5 ||
          result.some((value) => !Number.isSafeInteger(value) || value < 0) ||
          ![0, 1].includes(result[0]) ||
          ![0, 1].includes(result[4]) ||
          result[1] > input.max ||
          result[2] <= result[3] ||
          result[2] - result[3] > store.maxWindowMs ||
          (result[0] === 1 && result[4] === 1)
        ) {
          throw redisError('REDIS_INVALID_LIMITER_RESULT');
        }
        let reason: AtomicRateLimitDecision['reason'] = 'rate';
        if (result[0] === 1) {
          reason = 'allowed';
        } else if (result[4] === 1) {
          reason = 'capacity';
        }
        return {
          allowed: result[0] === 1,
          remaining: result[1],
          resetAt: result[2],
          now: result[3],
          reason,
        };
      },
      request
    );
  }
  /** Fence callers, abort waits and drain native work before owned-client cleanup.
   * @returns {Promise<void>} Idempotent receipt; deadline can reject while eventual drain continues.
   */
  close(): Promise<void> {
    this.#closed = true;
    return (this.#closing ??= Promise.resolve().then(async () => {
      // Abort caller waits while native work remains retained for drain.
      for (const controller of this.#controllers) {
        controller.abort();
      }
      /** Native drain followed by owned-client close and listener removal. */
      const cleanup = Promise.allSettled([...this.#active]).then(async () => {
        try {
          if (this.config.ownClient) {
            await this.client.close?.();
          }
        } finally {
          this.client.off?.('error', this.#onError);
        }
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          cleanup,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              try {
                if (this.config.ownClient) {
                  this.client.destroy?.();
                }
              } catch (cause) {
                reject(redisError('REDIS_CLOSE_FAILED', cause));
                return;
              }
              reject(redisError('REDIS_SHUTDOWN_DEADLINE'));
            }, this.#policy.shutdownTimeoutMs);
          }),
        ]);
      } catch (cause) {
        throw cause instanceof RedisCacheError
          ? cause
          : redisError('REDIS_CLOSE_FAILED', cause);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }));
  }
  /** Expose the privileged borrowed/owned native handle to trusted host code.
   * @returns {RedisCacheClient} Raw access bypasses wrapper guarantees.
   */
  native(): RedisCacheClient {
    if (this.#closed) {
      throw redisError('REDIS_CACHE_CLOSED');
    }
    return this.client;
  }
  /** Reject unsafe native integers after a possibly committed mutation.
   * @param {number} value - Plain JSON payload or native counter result, validated before exposure.
   * @returns {number} Safe JavaScript integer.
   */
  #counter(value: number) {
    if (!Number.isSafeInteger(value)) {
      throw redisError('REDIS_COUNTER_RANGE', undefined, true);
    }
    return value;
  }
  /** Validate condition types and conflicts before async dispatch.
   * @param {CacheSetOptions} opts - Optional TTL and mutually exclusive native condition flags.
   * @returns {void} Invalid conditions reject before native work.
   */
  #conditions(opts: CacheSetOptions) {
    if (
      !opts ||
      typeof opts !== 'object' ||
      Array.isArray(opts) ||
      (opts.ifAbsent !== undefined && typeof opts.ifAbsent !== 'boolean') ||
      (opts.ifPresent !== undefined && typeof opts.ifPresent !== 'boolean') ||
      (opts.ifAbsent && opts.ifPresent)
    ) {
      throw redisError('REDIS_INVALID_CONDITION');
    }
  }
}
/** Wrap a configured client with bounded scoped ownership; borrowed clients stay open by default.
 * @param {RedisCacheClient} client - Host-provided structural client.
 * @param {RedisHelperConfig} config - Optional wrapper policy and explicit ownership.
 * @returns {RedisCacheHelper} Closeable wrapper with no automatic command replay. */
export const createRedisCacheHelper = (
  client: RedisCacheClient,
  config: RedisHelperConfig = {}
): RedisCacheHelper => new RedisCacheHelper(client, config);
