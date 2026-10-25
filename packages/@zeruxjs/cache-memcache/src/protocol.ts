import { createConnection, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

export interface TextConnectionOptions {
  host?: string;
  port?: number;
  /** Absolute per-command deadline, including connection establishment. */
  timeoutMs?: number;
  maxBytes?: number;
  maxConcurrent?: number;
  /** Use verified TLS; configure the server certificate through Node's trust store. */
  tls?: boolean;
}
export interface TextValue { key: string; flags: number; value: Buffer }
export type TextReply = { line: string; values: TextValue[] };

/** Validate text protocol keys before constructing any command. */
export function validateKey(key: string): string {
  if (typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 250 || /[^\x21-\x7e]/.test(key)) {
    throw new TypeError('Key must be 1–250 printable ASCII bytes without spaces');
  }
  return key;
}

/** One bounded socket per operation; no transparent replay of ambiguous writes or pops. */
export class MemcacheTextClient {
  readonly #options: Required<TextConnectionOptions>;
  readonly #sockets = new Set<Socket>();
  #closed = false;
  constructor(options: TextConnectionOptions = {}) {
    this.#options = { host: options.host ?? '127.0.0.1', port: options.port ?? 11211,
      timeoutMs: options.timeoutMs ?? 3000, maxBytes: options.maxBytes ?? 1024 * 1024,
      maxConcurrent: options.maxConcurrent ?? 32, tls: options.tls ?? false };
    for (const [key, max] of [['port', 65535], ['timeoutMs', 120000], ['maxBytes', 16 * 1024 * 1024], ['maxConcurrent', 1000]] as const) {
      const n = this.#options[key];
      if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError(`Invalid ${key}`);
    }
    if (typeof this.#options.host !== 'string' || !this.#options.host || typeof this.#options.tls !== 'boolean') throw new TypeError('Invalid connection options');
  }
  /** Execute a trusted protocol command. This low-level API must never accept browser input. */
  request(command: Buffer | string): Promise<TextReply> {
    if (this.#closed) return Promise.reject(new Error('Client closed'));
    if (this.#sockets.size >= this.#options.maxConcurrent) return Promise.reject(new Error('Connection concurrency limit exceeded'));
    if (Buffer.byteLength(command) > this.#options.maxBytes + 512) return Promise.reject(new RangeError('Command too large'));
    return new Promise((resolve, reject) => {
      const {host, port, tls, timeoutMs, maxBytes} = this.#options;
      const socket = tls ? connectTls({host, port, servername: host}) : createConnection({host, port});
      this.#sockets.add(socket);
      let data = Buffer.alloc(0), settled = false;
      const finish = (error?: Error, reply?: TextReply) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.#sockets.delete(socket); socket.destroy();
        if (error) reject(error); else resolve(reply!);
      };
      const timer = setTimeout(() => finish(new Error('Command deadline exceeded; outcome may be unknown')), timeoutMs);
      socket.once(tls ? 'secureConnect' : 'connect', () => socket.write(command));
      socket.on('error', () => finish(new Error('Memcache connection failed; outcome may be unknown')));
      socket.on('close', () => finish(new Error('Connection closed before complete response')));
      socket.on('data', rawChunk => {
        const chunk = typeof rawChunk === 'string' ? Buffer.from(rawChunk) : rawChunk;
        if (data.length + chunk.length > maxBytes + 1024) return finish(new RangeError('Response too large'));
        data = Buffer.concat([data, chunk]);
        try {
          let offset = 0;
          const values: TextValue[] = [];
          while (true) {
            const end = data.indexOf('\r\n', offset);
            if (end < 0) return;
            const line = data.toString('ascii', offset, end);
            if (line.startsWith('VALUE ')) {
              const match = /^VALUE (\S+) (\d+) (\d+)(?: \d+)?$/.exec(line);
              if (!match) throw new Error('Malformed VALUE header');
              const bytes = Number(match[3]);
              if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw new RangeError('Value too large');
              if (data.length < end + 2 + bytes + 2) return;
              if (data.toString('ascii', end + 2 + bytes, end + 4 + bytes) !== '\r\n') throw new Error('Malformed value terminator');
              values.push({key: match[1], flags: Number(match[2]), value: data.subarray(end + 2, end + 2 + bytes)});
              offset = end + 4 + bytes;
            } else {
              if (/^(ERROR|CLIENT_ERROR|SERVER_ERROR)( |$)/.test(line)) throw new Error('Memcache server rejected command');
              if (values.length && line !== 'END') throw new Error('Malformed retrieval response');
              return finish(undefined, {line, values});
            }
          }
        } catch (error) { finish(error as Error); }
      });
    });
  }
  /** Cancel in-flight operations and refuse new operations; safe to call repeatedly. */
  close(): void { this.#closed = true; for (const socket of this.#sockets) socket.destroy(); }
}
