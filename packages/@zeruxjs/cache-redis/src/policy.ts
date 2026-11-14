export type RedisOperation =
  | 'get'
  | 'set'
  | 'delete'
  | 'has'
  | 'clear'
  | 'clearPrefix'
  | 'getMany'
  | 'setMany'
  | 'deleteMany'
  | 'increment'
  | 'decrement'
  | 'touch'
  | 'rateLimit';
export interface RedisOperationRecord {
  /** Fixed operation label; never a key or URL. */
  readonly operation: RedisOperation;
  /** Monotonic elapsed milliseconds. */
  readonly durationMs: number;
  /** Fixed completion classification. */
  readonly outcome: 'ok' | 'error' | 'deadline' | 'cancelled' | 'overload';
  /** Stable value-free error code. */
  readonly code?: string;
  /** Unknown means a submitted mutation may have committed. */
  readonly writeOutcome?: 'unknown';
}
export interface RedisRequestOptions {
  /** Borrowed cancellation signal; native work can continue after abort. */
  signal?: AbortSignal;
  /** Optional absolute epoch milliseconds, bounded by commandTimeoutMs. */
  deadline?: number;
}
export interface RedisCachePolicy {
  /** Default 3000ms; integer 1–120000. */
  commandTimeoutMs?: number;
  /** Default 3000ms; integer 1–120000. */
  connectTimeoutMs?: number;
  /** Default 5000ms; integer 1–120000. */
  shutdownTimeoutMs?: number;
  /** Default 64; integer 1–1024, retained until native settlement. */
  maxPendingCommands?: number;
  /** Default zero; integer 0–3 for owned cache clients only. */
  maxReconnectAttempts?: number;
  /** Default 10000; integer 1–100000. */
  maxScanPages?: number;
  /** Optional host callback receiving fixed-label records; throws/rejections are isolated. */
  onOperation?: (record: RedisOperationRecord) => void | Promise<void>;
}
/** Fixed internal diagnostics with private causes and explicit unknown-write outcomes. */
export class RedisCacheError extends Error {
  /** Public fixed-code diagnostics; native causes stay private. */
  readonly details: {
    /** Stable classification, never a native response string. */
    code: string;
    /** Host-supplied public message still requires host redaction. */
    message: string;
    /** Submitted writes can remain committed after timeout/cancellation. */
    writeOutcome?: 'unknown';
  };
  /** Construct public diagnostics; host-supplied messages still require redaction.
   * @param {string} code - Fixed classification.
   * @param {string} message - Public message supplied by trusted code.
   * @param {{cause?: unknown, writeOutcome?: 'unknown'}} options - Optional private cause and unknown-write marker.
   * @param {unknown} options.cause - Private native cause, never serialized to clients.
   * @param {'unknown'} options.writeOutcome - Optional uncertainty marker after an issued write.
   */
  constructor(
    readonly code: string,
    message: string,
    options?: {
      /** Raw native cause stays private. */
      cause?: unknown;
      /** Submitted writes may already have committed. */
      writeOutcome?: 'unknown';
    }
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = 'RedisCacheError';
    this.details = {
      code,
      message,
      ...(options?.writeOutcome ? { writeOutcome: options.writeOutcome } : {}),
    };
  }
}
/** Produce code-derived diagnostics while retaining raw causes privately.
 * @param {string} code - Fixed internal classification.
 * @param {unknown} cause - Optional private failure.
 * @param {boolean} write - Whether the write outcome may be unknown, default false.
 * @returns {RedisCacheError} Value-free public diagnostics with optional unknown-write marker. */
export const redisError = (code: string, cause?: unknown, write = false) =>
  new RedisCacheError(code, code.toLowerCase().replaceAll('_', ' '), {
    cause,
    ...(write ? { writeOutcome: 'unknown' as const } : {}),
  });
/** Validate package-owned integer budgets without modifying native worker policy.
 * @param {RedisCachePolicy} raw - Optional configured limits; defaults are bounded.
 * @returns {{commandTimeoutMs:number, connectTimeoutMs:number, shutdownTimeoutMs:number, maxPendingCommands:number, maxReconnectAttempts:number, maxScanPages:number, onOperation?: (record: RedisOperationRecord) => void|Promise<void>}} Resolved limits; missing hook remains absent.
 */
export function redisPolicy(raw: RedisCachePolicy = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw redisError('REDIS_INVALID_OPTIONS');
  }
  /** Resolve and validate one integer policy limit.
   * @param {unknown} value - Configured candidate.
   * @param {number} fallback - Default when absent.
   * @param {number} max - Inclusive upper bound.
   * @param {number} min - Inclusive lower bound, default one.
   * @returns {number} Validated integer. */
  const n = (value: unknown, fallback: number, max: number, min = 1) => {
    /** Configured integer or default before range validation. */
    const result = value === undefined ? fallback : value;
    if (
      typeof result !== 'number' ||
      !Number.isSafeInteger(result) ||
      result < min ||
      result > max
    ) {
      throw redisError('REDIS_INVALID_LIMIT');
    }
    return result;
  };
  if (raw.onOperation !== undefined && typeof raw.onOperation !== 'function') {
    throw redisError('REDIS_INVALID_HOOK');
  }
  return {
    commandTimeoutMs: n(raw.commandTimeoutMs, 3000, 120000),
    connectTimeoutMs: n(raw.connectTimeoutMs, 3000, 120000),
    shutdownTimeoutMs: n(raw.shutdownTimeoutMs, 5000, 120000),
    maxPendingCommands: n(raw.maxPendingCommands, 64, 1024),
    maxReconnectAttempts: n(raw.maxReconnectAttempts, 0, 3, 0),
    maxScanPages: n(raw.maxScanPages, 10000, 100000),
    onOperation: raw.onOperation,
  };
}
/** Validate a nonempty bounded UTF-8 key.
 * @param {unknown} key - Candidate key, maximum 1024 bytes.
 * @returns {string} Original validated string. */
export const redisKey = (key: unknown) => {
  if (typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 1024) {
    throw redisError('REDIS_INVALID_KEY');
  }
  return key;
};
/** Validate at most 1000 keys before dispatch.
 * @param {unknown} keys - Candidate key list.
 * @returns {string[]} Validated detached key list. */
export const redisBulk = (keys: unknown) => {
  if (!Array.isArray(keys) || keys.length > 1000) {
    throw redisError('REDIS_BULK_LIMIT');
  }
  return keys.map(redisKey);
};
