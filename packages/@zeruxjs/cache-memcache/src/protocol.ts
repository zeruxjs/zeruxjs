import { memcacheError, MemcacheError } from './errors.js';
export { MemcacheError } from './errors.js';
import { createConnection, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

export interface TextConnectionOptions {
  /** Trusted host, default 127.0.0.1; egress authorization stays with the host. */
  host?: string;
  /** Integer port 1–65535, default 11211. */
  port?: number;
  /** Maximum per-command wall time, including connection establishment. */
  timeoutMs?: number;
  /** Body bytes, default 1 MiB, maximum 16 MiB; framing has separate allowance. */
  maxBytes?: number;
  /** Owned sockets including pending close, default 32, maximum 1000. */
  maxConcurrent?: number;
  /** Use verified TLS; configure the server certificate through Node's trust store. */
  tls?: boolean;
}
export interface TextRequestOptions {
  /** Borrowed caller signal; abort does not prove a write/pop was rejected. */
  signal?: AbortSignal;
  /** Optional absolute epoch-millisecond deadline; configured timeout still bounds it. */
  deadline?: number;
}
export interface TextValue {
  /** Returned key; retrieval helpers require an exact requested-key match. */
  key: string;
  /** Unsigned 32-bit protocol flags; not an authorization assertion. */
  flags: number;
  /** Raw body bytes; protocol transport does not interpret or execute data. */
  value: Buffer;
}
export type TextReply = {
  /** Terminal ASCII status, interpreted by the owning higher-level adapter. */
  line: string; /** Bounded raw VALUE records before the terminal END marker. */
  values: TextValue[];
};

/** Validate the 1–250-byte printable ASCII protocol key before interpolation.
 * @param {string} key - Candidate key; spaces, control/non-ASCII bytes reject.
 * @returns {string} Original validated key.
 */
export function validateKey(key: string): string {
  if (
    typeof key !== 'string' ||
    !key.length ||
    Buffer.byteLength(key) > 250 ||
    /[^\x21-\x7e]/.test(key)
  ) {
    throw memcacheError('MEMCACHE_INVALID_KEY');
  }
  return key;
}

/** One bounded socket per operation; no transparent replay of ambiguous writes or pops. */
export class MemcacheTextClient {
  /** Validated endpoint/budgets copied at construction; never shared across apps. */
  readonly #options: Required<TextConnectionOptions>;
  /** Accepted socket handles retained through their actual close events. */
  readonly #sockets = new Set<Socket>();
  /** Permanent shutdown fence preventing new requests. */
  #closed = false;
  /** Per-socket first-outcome cancellation, removed exactly once. */
  readonly #cancel = new Map<Socket, () => void>();
  /** Shutdown observers released only when the owned socket set is empty. */
  readonly #waiters = new Set<() => void>();
  /** Count accepted sockets, including destroyed handles awaiting close.
   * @returns {number} Actual retained socket count, not just active read promises.
   */
  get activeSocketCount(): number {
    return this.#sockets.size;
  }
  /** Observe shutdown only after all owned socket close events.
   * @returns {Promise<void>} Resolves after close and actual handle release; calling before close waits.
   */
  whenClosed(): Promise<void> {
    if (this.#closed && !this.#sockets.size) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#waiters.add(resolve));
  }
  /** Validate one trusted endpoint without opening a socket.
   * @param {TextConnectionOptions} options - Default loopback:11211; bounded timeout/bytes/concurrency and optional verified TLS.
   */
  constructor(options: TextConnectionOptions = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw memcacheError('MEMCACHE_INVALID_OPTIONS');
    }
    if ('servers' in options || 'options' in options) {
      throw memcacheError('MEMCACHE_LEGACY_CONFIG_UNSUPPORTED');
    }
    // Reject explicit null rather than silently selecting default connection settings.
    for (const key of [
      'host',
      'port',
      'timeoutMs',
      'maxBytes',
      'maxConcurrent',
      'tls',
    ] as const) {
      if (options[key] === null) {
        throw memcacheError('MEMCACHE_INVALID_OPTIONS');
      }
    }
    this.#options = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 11211,
      timeoutMs: options.timeoutMs ?? 3000,
      maxBytes: options.maxBytes ?? 1024 * 1024,
      maxConcurrent: options.maxConcurrent ?? 32,
      tls: options.tls ?? false,
    };
    // Validate every numeric budget before allocating a socket.
    for (const [key, max] of [
      ['port', 65535],
      ['timeoutMs', 120000],
      ['maxBytes', 16 * 1024 * 1024],
      ['maxConcurrent', 1000],
    ] as const) {
      /** Configured numeric limit checked for integer range before socket creation. */
      const n = this.#options[key];
      if (!Number.isSafeInteger(n) || n < 1 || n > max) {
        throw memcacheError('MEMCACHE_INVALID_OPTIONS');
      }
    }

    if (
      typeof this.#options.host !== 'string' ||
      !this.#options.host ||
      this.#options.host.length > 253 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\s\x00-\x1f\x7f]/.test(this.#options.host) ||
      typeof this.#options.tls !== 'boolean'
    ) {
      throw memcacheError('MEMCACHE_INVALID_OPTIONS');
    }
  }
  /** Send a trusted bounded raw command on one owned socket; never expose browser-supplied commands.
   * @param {Buffer | string} command - Complete internally constructed command, including framing.
   * @param {TextRequestOptions} options - Optional signal/deadline bounded by configured timeout.
   * @returns {Promise<TextReply>} Bounded parsed reply after socket close; failures never auto-replay.
   */
  request(
    command: Buffer | string,
    options: TextRequestOptions = {}
  ): Promise<TextReply> {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.signal !== undefined &&
        !(options.signal instanceof AbortSignal)) ||
      (options.deadline !== undefined &&
        (!Number.isSafeInteger(options.deadline) || options.deadline < 0))
    ) {
      return Promise.reject(memcacheError('MEMCACHE_INVALID_REQUEST'));
    }

    /** Borrowed per-request cancellation signal; its listener is removed on settlement. */
    const signal = options.signal;

    /** Optional absolute wall-clock deadline, bounded by configured timeout. */
    const deadline = options.deadline;
    if (this.#closed) {
      return Promise.reject(memcacheError('MEMCACHE_CLOSED'));
    }
    if (signal?.aborted) {
      return Promise.reject(memcacheError('MEMCACHE_CANCELLED'));
    }

    /** Remaining wall time including connection establishment. */
    const budget = Math.min(
      this.#options.timeoutMs,
      (deadline ?? Infinity) - Date.now()
    );
    if (budget <= 0) {
      return Promise.reject(memcacheError('MEMCACHE_DEADLINE'));
    }
    if (typeof command !== 'string' && !Buffer.isBuffer(command)) {
      return Promise.reject(memcacheError('MEMCACHE_INVALID_REQUEST'));
    }
    if (this.#sockets.size >= this.#options.maxConcurrent) {
      return Promise.reject(memcacheError('MEMCACHE_CONCURRENCY_LIMIT'));
    }
    if (Buffer.byteLength(command) > this.#options.maxBytes + 512) {
      return Promise.reject(memcacheError('MEMCACHE_COMMAND_LIMIT'));
    }

    /** Copied trusted command bounded independently of response framing. */
    const payload = Buffer.from(command);
    return new Promise((resolve, reject) => {
      /** Validated endpoint and response ceiling for this one socket. */
      const { host, port, tls, maxBytes } = this.#options;
      let socket: Socket;
      try {
        socket = tls
          ? connectTls({
              host,
              port,
              servername: host,
              rejectUnauthorized: true,
            })
          : createConnection({ host, port });
      } catch (cause) {
        reject(memcacheError('MEMCACHE_CONNECTION_FAILED', cause));
        return;
      }
      this.#sockets.add(socket);
      // Buffered response is bounded before concatenation; only the first outcome can settle.
      let data = Buffer.alloc(0),
        settled = false;
      let outcome: { error?: Error; reply?: TextReply } | undefined;

      /** Fence the first outcome, remove request controls and destroy the owned socket.
       * @param {Error|undefined} error - Optional fixed public error with private cause.
       * @param {TextReply|undefined} reply - Fully parsed terminal reply.
       * @returns {void} Records outcome; the caller settles only after socket close. */
      const finish = (error?: Error, reply?: TextReply) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.#cancel.delete(socket);
        socket.destroy();
        // Store the outcome now; resolve/reject only after the socket close event.
        outcome = { error, reply };
      };

      /** Translate caller cancellation without replaying the command.

 * @returns {void} Records cancellation and starts socket destruction. */
      const abort = () => finish(memcacheError('MEMCACHE_CANCELLED'));

      /** One wall-clock timer including connect and read, removed on first outcome. */
      const timer = setTimeout(
        () => finish(memcacheError('MEMCACHE_DEADLINE')),
        budget
      );
      this.#cancel.set(socket, () => finish(memcacheError('MEMCACHE_CLOSED')));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
      }
      socket.once(tls ? 'secureConnect' : 'connect', () =>
        socket.write(payload)
      );
      socket.on('error', (cause) =>
        finish(memcacheError('MEMCACHE_CONNECTION_FAILED', cause))
      );
      socket.on('close', () => {
        this.#sockets.delete(socket);
        finish(memcacheError('MEMCACHE_DISCONNECTED'));
        if (outcome?.error) {
          reject(outcome.error);
        } else {
          resolve(outcome!.reply!);
        }
        if (this.#closed && !this.#sockets.size) {
          // Release all shutdown observers after the final actual socket close.
          for (const resolve of this.#waiters) {
            resolve();
          }
          this.#waiters.clear();
        }
      });
      socket.on('data', (rawChunk) => {
        if (settled) {
          return;
        }

        /** Normalized incoming bytes; decoding waits for complete protocol frames. */
        const chunk =
          typeof rawChunk === 'string' ? Buffer.from(rawChunk) : rawChunk;
        if (data.length + chunk.length > maxBytes + 1024) {
          return finish(memcacheError('MEMCACHE_RESPONSE_LIMIT'));
        }
        data = Buffer.concat([data, chunk]);
        try {
          let offset = 0;

          /** Current parse-pass value records, bounded by bytes and count. */
          const values: TextValue[] = [];
          let totalBytes = 0;
          // Parse only complete headers and bodies; incomplete frames return to the next data event.
          while (true) {
            /** Next complete CRLF boundary; incomplete frames await more bytes. */
            const end = data.indexOf('\r\n', offset);
            if (end < 0) {
              return;
            }
            if (
              end - offset > 1024 ||
              data.subarray(offset, end).some((byte) => byte < 32 || byte > 126)
            ) {
              throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
            }

            /** ASCII-only protocol header or terminal status. */
            const line = data.toString('ascii', offset, end);
            if (line.startsWith('VALUE ')) {
              /** Strict VALUE header fields, validated before interpreting body length. */
              const match = /^VALUE (\S+) (\d+) (\d+)(?: \d+)?$/.exec(line);
              if (!match) {
                throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              }
              /** Validated protocol key captured from the VALUE response line. */
              const key = match[1];
              /** Decimal flags captured from the VALUE response line. */
              const flagsText = match[2];
              /** Decimal byte length captured from the VALUE response line. */
              const bytesText = match[3];
              if (!key || !flagsText || !bytesText) {
                throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              }
              validateKey(key);
              if (
                !Number.isSafeInteger(Number(flagsText)) ||
                Number(flagsText) > 4294967295
              ) {
                throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              }

              /** Declared body length checked before reading or retaining a value. */
              const bytes = Number(bytesText);
              if (
                !Number.isSafeInteger(bytes) ||
                (totalBytes += bytes) > maxBytes
              ) {
                throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
              }
              if (data.length < end + 2 + bytes + 2) {
                return;
              }
              if (
                data[end + 2 + bytes] !== 13 ||
                data[end + 3 + bytes] !== 10
              ) {
                throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              }
              values.push({
                key,
                flags: Number(flagsText),
                value: data.subarray(end + 2, end + 2 + bytes),
              });
              offset = end + 4 + bytes;
              if (values.length > 1000) {
                throw memcacheError('MEMCACHE_RESPONSE_LIMIT');
              }
            } else {
              if (/^(ERROR|CLIENT_ERROR|SERVER_ERROR)( |$)/.test(line)) {
                throw memcacheError('MEMCACHE_SERVER_ERROR');
              }
              if (values.length && line !== 'END') {
                throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              }
              if (end + 2 !== data.length) {
                throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              }
              return finish(undefined, { line, values });
            }
          }
        } catch (error) {
          finish(
            error instanceof MemcacheError
              ? error
              : memcacheError('MEMCACHE_PROTOCOL_ERROR', error)
          );
        }
      });
    });
  }
  /** Fence new work and cancel all in-flight sockets without claiming immediate handle release.
   * @returns {void} Idempotent initiation; await whenClosed for settlement.
   */
  close(): void {
    this.#closed = true;
    // Cancel each pending first-outcome handler without replay.
    for (const cancel of this.#cancel.values()) {
      cancel();
    }
    // Destroy retained sockets; capacity stays occupied until their close events.
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    if (!this.#sockets.size) {
      // Release observers immediately only when no owned socket remains.
      for (const resolve of this.#waiters) {
        resolve();
      }
      this.#waiters.clear();
    }
  }
}
