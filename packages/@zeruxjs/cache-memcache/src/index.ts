import type {
  CacheHelper,
  CacheHelperFactory,
  CacheSetOptions,
  CacheValue,
} from '@zeruxjs/cache';
import {
  MemcacheTextClient,
  validateKey,
  type TextConnectionOptions,
  type TextRequestOptions,
} from './protocol.js';
import { encodeJson, decodeJson } from './json.js';
import { memcacheError } from './errors.js';
export { MemcacheError } from './errors.js';
export type { TextRequestOptions } from './protocol.js';
export interface MemcacheOptions extends TextConnectionOptions {
  /** Default false; explicit true permits destructive whole-server flush. */
  allowFlushAll?: boolean;
  /** JSON nesting limit, default 32, maximum 64. */
  maxDepth?: number;
}
export interface MemcacheSetOptions
  extends CacheSetOptions, TextRequestOptions {}
export interface MemcacheHelper extends CacheHelper {
  /** Read one exact key and validate returned framing, JSON and identity.
   * @param {string} key - Exact printable ASCII key.
   * @param {TextRequestOptions} options - Optional signal and absolute deadline.
   * @returns {Promise<CacheValue|undefined>} Validated JSON or absence.
   */
  get(
    key: string,
    options?: TextRequestOptions
  ): Promise<CacheValue | undefined>;
  /** Validate a complete write before network dispatch.
   * @param {string} key - Exact printable ASCII key.
   * @param {CacheValue} value - Plain JSON data.
   * @param {MemcacheSetOptions} options - Optional TTL, condition, signal and deadline.
   * @returns {Promise<void>} Reply completion, not a conditional-success receipt.
   */
  set(
    key: string,
    value: CacheValue,
    options?: MemcacheSetOptions
  ): Promise<void>;
  /** Fence new requests, cancel sockets and await actual handle release.
   * @returns {Promise<void>} Idempotent cleanup receipt.
   */
  close(): Promise<void>;
  /** Expose the privileged protocol escape hatch to trusted hosts.
   * @returns {MemcacheTextClient} Owned client; raw commands bypass helper validation.
   */
  native(): MemcacheTextClient;
}

/** Convert a positive TTL into Memcached relative or absolute expiry.
 * @param {number|undefined} seconds - Optional TTL seconds; undefined means no expiry.
 * @returns {number} Rounded protocol expiry, with values above 30 days made absolute. */
const expiration = (seconds?: number): number => {
  if (seconds === undefined) {
    return 0;
  }
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 365 * 86400
  ) {
    throw memcacheError('MEMCACHE_INVALID_TTL');
  }

  /** Ceiling TTL seconds so fractional lifetimes do not expire early. */
  const rounded = Math.ceil(seconds);
  return rounded > 30 * 86400
    ? Math.floor(Date.now() / 1000) + rounded
    : rounded;
};

/** Validate mutually exclusive native write conditions before TTL conversion.
 * @param {MemcacheSetOptions} opts - Optional flags, TTL and request cancellation settings.
 * @returns {number} Validated protocol expiry. */
const setOptions = (opts: MemcacheSetOptions = {}) => {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  }
  // Reject invalid native condition flag types before any write.
  for (const flag of ['ifAbsent', 'ifPresent'] as const) {
    if (opts[flag] !== undefined && typeof opts[flag] !== 'boolean') {
      throw memcacheError('MEMCACHE_INVALID_CONDITION');
    }
  }
  if (opts.ifAbsent && opts.ifPresent) {
    throw memcacheError('MEMCACHE_CONDITION_CONFLICT');
  }
  return expiration(opts.ttlSeconds);
};
/** Create a single-endpoint helper owning lazy per-command sockets; no replay, pool or sharding.
 * @param {MemcacheOptions} input - Trusted endpoint/options; default loopback:11211, plain TCP.
 * @returns {MemcacheHelper} Closeable helper; construction opens no connection.
 */
export function createMemcacheHelper(
  input: MemcacheOptions = {}
): MemcacheHelper {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  }
  if ('servers' in input || 'options' in input) {
    throw memcacheError('MEMCACHE_LEGACY_CONFIG_UNSUPPORTED');
  }

  /** Explicit direct-helper configuration keys; legacy sharding options reject. */
  const allowed = [
    'host',
    'port',
    'tls',
    'timeoutMs',
    'maxBytes',
    'maxConcurrent',
    'allowFlushAll',
    'maxDepth',
  ];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (input.allowFlushAll !== undefined &&
      typeof input.allowFlushAll !== 'boolean')
  ) {
    throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  }

  /** Shallow configuration snapshot owned by this helper. */
  const options = { ...input };

  /** Per-value and aggregate bulk JSON byte ceiling, default 1 MiB. */
  const maxBytes = options.maxBytes ?? 1048576;

  /** Root-zero JSON nesting ceiling, default 32 and maximum 64. */
  const maxDepth = options.maxDepth ?? 32;
  if (
    options.maxDepth === null ||
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 1 ||
    maxDepth > 64
  ) {
    throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  }

  /** Owned lazy protocol client; construction opens no socket. */
  const client = new MemcacheTextClient(options);
  let closed = false,
    closing: Promise<void> | undefined;

  /** Fence use after helper shutdown.

 * @returns {void} Throws when this helper is closed. */
  const open = () => {
    if (closed) {
      throw memcacheError('MEMCACHE_CLOSED');
    }
  };

  /** Dispatch one trusted protocol command through the lifecycle fence.
   * @param {string|Buffer} command - Internally constructed framed command.
   * @param {TextRequestOptions|undefined} opts - Optional signal and absolute deadline.
   * @returns {Promise<TextReply>} Reply after actual socket close; writes are never replayed. */
  const request = (command: string | Buffer, opts?: TextRequestOptions) => {
    open();
    return client.request(command, opts);
  };

  /** Retrieve one JSON value and verify the server returned the requested key.
   * @param {string} key - Validated logical or manager-prefixed key.
   * @param {TextRequestOptions|undefined} opts - Optional read cancellation/deadline.
   * @returns {Promise<CacheValue|undefined>} Bounded decoded JSON or absence. */
  const get = async (
    key: string,
    opts?: TextRequestOptions
  ): Promise<CacheValue | undefined> => {
    /** Completed protocol reply validated before interpreting its outcome. */
    const reply = await request(`get ${validateKey(key)}\r\n`, opts);
    if (
      reply.line !== 'END' ||
      reply.values.length > 1 ||
      (reply.values.length === 1 &&
        (!reply.values[0] || reply.values[0].key !== key))
    ) {
      throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
    }
    /** Single value returned by the bounded Memcache GET operation. */
    const value = reply.values[0];
    return value ? decodeJson(value.value, maxBytes, maxDepth) : undefined;
  };

  /** Send one prevalidated JSON body with native add/replace/set semantics.
   * @param {string} key - Already validated destination key.
   * @param {Buffer} body - Already encoded bounded JSON bytes.
   * @param {MemcacheSetOptions} opts - Native condition and request controls.
   * @param {number} ttl - Already validated protocol expiry.
   * @returns {Promise<void>} Void completion does not report conditional acquisition. */
  const store = async (
    key: string,
    body: Buffer,
    opts: MemcacheSetOptions,
    ttl: number
  ) => {
    // Choose only the native condition requested; void completion is not a lock receipt.
    let command = 'set';
    if (opts.ifAbsent) {
      command = 'add';
    } else if (opts.ifPresent) {
      command = 'replace';
    }
    /** Completed protocol reply validated before interpreting its outcome. */
    const reply = await request(
      Buffer.concat([
        Buffer.from(`${command} ${key} 0 ${ttl} ${body.length}\r\n`),
        body,
        Buffer.from('\r\n'),
      ]),
      opts
    );
    if (!['STORED', 'NOT_STORED', 'EXISTS', 'NOT_FOUND'].includes(reply.line)) {
      throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
    }
  };

  /** Validate key, flags and body before opening a write socket.
   * @param {string} key - Destination protocol key.
   * @param {CacheValue} value - Inert plain JSON payload.
   * @param {MemcacheSetOptions} opts - Optional TTL/conditions/cancellation.
   * @returns {Promise<void>} Write reply completion; conditional misses remain void. */
  const set = async (
    key: string,
    value: CacheValue,
    opts: MemcacheSetOptions = {}
  ) => {
    open();
    validateKey(key);

    /** Validated protocol expiry shared by the prepared write. */
    const ttl = setOptions(opts);

    /** Encoded JSON bytes checked before command dispatch. */
    const body = encodeJson(value, maxBytes, maxDepth);
    await store(key, body, opts, ttl);
  };

  /** Delete one key without namespace enumeration.
   * @param {string} key - Exact key validated before dispatch.
   * @returns {Promise<boolean>} Whether the server reports a deletion. */
  const remove = async (key: string) => {
    /** Final protocol status line; never included in public diagnostics. */
    const { line } = await request(`delete ${validateKey(key)}\r\n`);
    if (!['DELETED', 'NOT_FOUND'].includes(line)) {
      throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
    }
    return line === 'DELETED';
  };

  /** Apply one native unsigned integer operation without retry.
   * @param {string} key - Existing numeric item key.
   * @param {number} amount - Nonnegative safe integer delta.
   * @param {string} command - Internal incr/decr command selector.
   * @returns {Promise<number>} Safe integer result; rejection after mutation does not prove rollback. */
  const counter = async (key: string, amount: number, command: string) => {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw memcacheError('MEMCACHE_INVALID_AMOUNT');
    }

    /** Final protocol status line; never included in public diagnostics. */
    const { line } = await request(
      `${command} ${validateKey(key)} ${amount}\r\n`
    );
    if (line === 'NOT_FOUND') {
      throw memcacheError('MEMCACHE_COUNTER_MISSING');
    }

    /** Parsed server integer checked for decimal syntax and safe precision. */
    const result = Number(line);
    if (!/^\d+$/.test(line) || !Number.isSafeInteger(result)) {
      throw memcacheError('MEMCACHE_COUNTER_RANGE');
    }
    return result;
  };

  /** Validate a bounded bulk key array before any command.
   * @param {unknown} value - Candidate list, maximum 1000 keys.
   * @returns {string[]} Validated keys in original order. */
  const keys = (value: unknown): string[] => {
    open();
    if (!Array.isArray(value) || value.length > 1000) {
      throw memcacheError('MEMCACHE_BULK_LIMIT');
    }
    return value.map(validateKey);
  };
  return {
    capabilities: Object.freeze({
      conditionalWrites: 'supported',
      counters: 'supported',
      namespaceClear: 'unsupported',
      bulkAtomicity: 'unsupported',
      ownership: 'owned',
    }),
    get,
    set,
    delete: remove,
    has: async (key) => (await get(key)) !== undefined,
    /** Flush the whole server only when explicitly enabled on a dedicated endpoint.
     * @returns {Promise<void>} Global flush completion; default rejects.
     */
    async clear() {
      open();
      if (options.allowFlushAll !== true) {
        throw memcacheError('MEMCACHE_GLOBAL_CLEAR_DISABLED');
      }
      if ((await request('flush_all\r\n')).line !== 'OK') {
        throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
      }
    },
    /** Reject unsafe namespace clearing; Memcached cannot enumerate owned keys safely.
     * @returns {never} Always throws, preserving other namespaces.
     */
    clearPrefix() {
      open();
      throw memcacheError('MEMCACHE_NAMESPACE_CLEAR_UNSUPPORTED');
    },
    /** Read a bounded prevalidated key list with an aggregate JSON budget.
     * @param {string[]} input - At most 1000 exact keys.
     * @returns {Promise<Record<string, CacheValue|undefined>>} Logical-key results; reads are sequential, not a snapshot.
     */
    async getMany(input) {
      /** Complete validated key list before sequential bulk dispatch. */
      const all = keys(input);

      /** Parsed server integer checked for decimal syntax and safe precision. */
      const result: Record<string, CacheValue | undefined> =
        Object.create(null);
      let bytes = 0;
      // Account aggregate returned JSON while keeping lookup keys as own fields.
      for (const key of all) {
        /** Retrieved JSON checked against the aggregate bulk byte budget. */
        const value = await get(key);
        if (value !== undefined) {
          bytes += encodeJson(value, maxBytes, maxDepth).length;
        }
        if (bytes > maxBytes) {
          throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
        }
        result[key] = value;
      }
      return result;
    },
    /** Prepare every JSON body before the first sequential write.
     * @param {Record<string, CacheValue>} values - At most 1000 own data entries within aggregate bytes.
     * @param {CacheSetOptions} opts - Optional shared TTL and native condition flags.
     * @returns {Promise<void>} Sequential completion; failures can leave a partial batch.
     */
    async setMany(values, opts = {}) {
      open();
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw memcacheError('MEMCACHE_INVALID_JSON');
      }

      /** Complete validated key list before sequential bulk dispatch. */
      const all = keys(Object.keys(values));

      /** Validated protocol expiry shared by the prepared write. */
      const ttl = setOptions(opts);
      let bytes = 0;

      /** All validated encoded writes; no socket opens until preparation finishes. */
      const prepared = all.map((key) => {
        /** Own bulk data descriptor; getters are never invoked. */
        const property = Object.getOwnPropertyDescriptor(values, key)!;
        if (!('value' in property)) {
          throw memcacheError('MEMCACHE_INVALID_JSON');
        }

        /** Encoded JSON bytes checked before command dispatch. */
        const body = encodeJson(property.value, maxBytes, maxDepth);
        bytes += body.length;
        if (bytes > maxBytes) {
          throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
        }
        return { key, body };
      });
      // Dispatch only after every entry was validated; partial transport failure is not rolled back.
      for (const { key, body } of prepared) {
        await store(key, body, opts, ttl);
      }
    },
    /** Delete each prevalidated key without a global flush.
     * @param {string[]} input - At most 1000 exact keys.
     * @returns {Promise<number>} Reported deleted-key count; no transaction guarantee.
     */
    async deleteMany(input) {
      /** Complete validated key list before sequential bulk dispatch. */
      const all = keys(input);
      let count = 0;
      // Count only server-confirmed deletions in this sequential batch.
      for (const key of all) {
        count += Number(await remove(key));
      }
      return count;
    },
    increment: (key, amount = 1) => counter(key, amount, 'incr'),
    decrement: (key, amount = 1) => counter(key, amount, 'decr'),
    /** Change one existing item lifetime using native expiry semantics.
     * @param {string} key - Exact item key.
     * @param {number|undefined} ttl - Required positive lifetime; undefined rejects.
     * @returns {Promise<boolean>} Whether the server reports a touched item.
     */
    async touch(key, ttl) {
      if (ttl === undefined) {
        throw memcacheError('MEMCACHE_INVALID_TTL');
      }

      /** Final protocol status line; never included in public diagnostics. */
      const { line } = await request(
        `touch ${validateKey(key)} ${expiration(ttl)}\r\n`
      );
      if (!['TOUCHED', 'NOT_FOUND'].includes(line)) {
        throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
      }
      return line === 'TOUCHED';
    },
    /** Fence new requests, cancel sockets and await actual handle release.
     * @returns {Promise<void>} Idempotent cleanup receipt.
     */
    close() {
      closed = true;
      client.close();
      return (closing ??= client.whenClosed());
    },
    /** Expose the privileged protocol escape hatch to trusted hosts.
     * @returns {MemcacheTextClient} Owned client; raw commands bypass helper validation.
     */
    native() {
      open();
      return client;
    },
  };
}

/** Adapt trusted manager configuration to the explicit single-endpoint helper.
 * @param {Record<string, unknown>|undefined} options - Host-owned helper options; legacy multi-server shapes reject.
 * @returns {MemcacheHelper} Owned lazy-socket helper; await close after use. */
export const createCacheHelper: CacheHelperFactory = (options) =>
  createMemcacheHelper(options as MemcacheOptions);
export default createCacheHelper;
