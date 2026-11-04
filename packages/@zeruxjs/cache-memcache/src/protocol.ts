import {memcacheError,MemcacheError} from './errors.js';
export {MemcacheError} from './errors.js';
import { createConnection, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

export interface TextConnectionOptions {
  host?: string;
  port?: number;
  /** Maximum per-command wall time, including connection establishment. */
  timeoutMs?: number;
  maxBytes?: number;
  maxConcurrent?: number;
  /** Use verified TLS; configure the server certificate through Node's trust store. */
  tls?: boolean;
}
export interface TextRequestOptions {signal?:AbortSignal;deadline?:number}
export interface TextValue { key: string; flags: number; value: Buffer }
export type TextReply = { line: string; values: TextValue[] };

/** Validate text protocol keys before constructing any command. */
export function validateKey(key: string): string {
  if (typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 250 || /[^\x21-\x7e]/.test(key)) {
    throw memcacheError('MEMCACHE_INVALID_KEY');
  }
  return key;
}

/** One bounded socket per operation; no transparent replay of ambiguous writes or pops. */
export class MemcacheTextClient {
  readonly #options: Required<TextConnectionOptions>;
  readonly #sockets = new Set<Socket>();
  #closed = false;
  readonly #cancel=new Map<Socket,()=>void>();readonly #waiters=new Set<()=>void>();
  get activeSocketCount():number{return this.#sockets.size;}
  /** Resolves after close() and actual socket close events, not just destroy(). */
  whenClosed():Promise<void>{if(this.#closed&&!this.#sockets.size)return Promise.resolve();return new Promise(resolve=>this.#waiters.add(resolve));}
  constructor(options: TextConnectionOptions = {}) {
    if(!options||typeof options!=='object'||Array.isArray(options))throw memcacheError('MEMCACHE_INVALID_OPTIONS');
    if('servers'in options||'options'in options)throw memcacheError('MEMCACHE_LEGACY_CONFIG_UNSUPPORTED');
    for(const key of ['host','port','timeoutMs','maxBytes','maxConcurrent','tls'] as const)if(options[key]===null)throw memcacheError('MEMCACHE_INVALID_OPTIONS');
    this.#options = { host: options.host ?? '127.0.0.1', port: options.port ?? 11211,
      timeoutMs: options.timeoutMs ?? 3000, maxBytes: options.maxBytes ?? 1024 * 1024,
      maxConcurrent: options.maxConcurrent ?? 32, tls: options.tls ?? false };
    for (const [key, max] of [['port', 65535], ['timeoutMs', 120000], ['maxBytes', 16 * 1024 * 1024], ['maxConcurrent', 1000]] as const) {
      const n = this.#options[key];
      if (!Number.isSafeInteger(n) || n < 1 || n > max) throw memcacheError('MEMCACHE_INVALID_OPTIONS');
    }
    if (typeof this.#options.host !== 'string' || !this.#options.host || this.#options.host.length>253 || /[\s\x00-\x1f\x7f]/.test(this.#options.host) || typeof this.#options.tls !== 'boolean') throw memcacheError('MEMCACHE_INVALID_OPTIONS');
  }
  /** Execute a trusted protocol command. This low-level API must never accept browser input. */
  request(command: Buffer | string,options:TextRequestOptions={}): Promise<TextReply> {
    if(!options||typeof options!=='object'||Array.isArray(options)||options.signal!==undefined&&!(options.signal instanceof AbortSignal)||options.deadline!==undefined&&(!Number.isSafeInteger(options.deadline)||options.deadline<0))return Promise.reject(memcacheError('MEMCACHE_INVALID_REQUEST'));
    const signal=options.signal,deadline=options.deadline;
    if(this.#closed)return Promise.reject(memcacheError('MEMCACHE_CLOSED'));
    if(signal?.aborted)return Promise.reject(memcacheError('MEMCACHE_CANCELLED'));
    const budget=Math.min(this.#options.timeoutMs,(deadline??Infinity)-Date.now());
    if(budget<=0)return Promise.reject(memcacheError('MEMCACHE_DEADLINE'));
    if(typeof command!=='string'&&!Buffer.isBuffer(command))return Promise.reject(memcacheError('MEMCACHE_INVALID_REQUEST'));
    if (this.#sockets.size >= this.#options.maxConcurrent) return Promise.reject(memcacheError('MEMCACHE_CONCURRENCY_LIMIT'));
    if (Buffer.byteLength(command) > this.#options.maxBytes + 512) return Promise.reject(memcacheError('MEMCACHE_COMMAND_LIMIT'));
    const payload=Buffer.from(command);
    return new Promise((resolve, reject) => {
      const {host, port, tls, maxBytes} = this.#options;
      let socket:Socket;try{socket = tls ? connectTls({host, port, servername: host,rejectUnauthorized:true}) : createConnection({host, port});}catch(cause){reject(memcacheError('MEMCACHE_CONNECTION_FAILED',cause));return;}
      this.#sockets.add(socket);
      let data = Buffer.alloc(0), settled = false;let outcome:{error?:Error;reply?:TextReply}|undefined;
      const finish = (error?: Error, reply?: TextReply) => {
        if (settled) return;
        settled = true; clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#cancel.delete(socket);socket.destroy();
        outcome={error,reply};
      };
      const abort=()=>finish(memcacheError('MEMCACHE_CANCELLED'));
      const timer = setTimeout(() => finish(memcacheError('MEMCACHE_DEADLINE')), budget);
      this.#cancel.set(socket,()=>finish(memcacheError('MEMCACHE_CLOSED')));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      socket.once(tls ? 'secureConnect' : 'connect', () => socket.write(payload));
      socket.on('error', cause => finish(memcacheError('MEMCACHE_CONNECTION_FAILED',cause)));
      socket.on('close', () => {this.#sockets.delete(socket);finish(memcacheError('MEMCACHE_DISCONNECTED'));if(outcome?.error)reject(outcome.error);else resolve(outcome!.reply!);if(this.#closed&&!this.#sockets.size){for(const resolve of this.#waiters)resolve();this.#waiters.clear();}});
      socket.on('data', rawChunk => {
        if(settled)return;
        const chunk = typeof rawChunk === 'string' ? Buffer.from(rawChunk) : rawChunk;
        if (data.length + chunk.length > maxBytes + 1024) return finish(memcacheError('MEMCACHE_RESPONSE_LIMIT'));
        data = Buffer.concat([data, chunk]);
        try {
          let offset = 0;
          const values: TextValue[] = [];let totalBytes=0;
          while (true) {
            const end = data.indexOf('\r\n', offset);
            if (end < 0) return;
            if(end-offset>1024||data.subarray(offset,end).some(byte=>byte<32||byte>126))throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
            const line = data.toString('ascii', offset, end);
            if (line.startsWith('VALUE ')) {
              const match = /^VALUE (\S+) (\d+) (\d+)(?: \d+)?$/.exec(line);
              if (!match) throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              validateKey(match[1]);if(!Number.isSafeInteger(Number(match[2]))||Number(match[2])>4294967295)throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              const bytes = Number(match[3]);
              if (!Number.isSafeInteger(bytes) || (totalBytes+=bytes) > maxBytes) throw memcacheError('MEMCACHE_PAYLOAD_LIMIT');
              if (data.length < end + 2 + bytes + 2) return;
              if (data[end+2+bytes]!==13||data[end+3+bytes]!==10) throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              values.push({key: match[1], flags: Number(match[2]), value: data.subarray(end + 2, end + 2 + bytes)});
              offset = end + 4 + bytes;if(values.length>1000)throw memcacheError('MEMCACHE_RESPONSE_LIMIT');
            } else {
              if (/^(ERROR|CLIENT_ERROR|SERVER_ERROR)( |$)/.test(line)) throw memcacheError('MEMCACHE_SERVER_ERROR');
              if (values.length && line !== 'END') throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              if(end+2!==data.length)throw memcacheError('MEMCACHE_PROTOCOL_ERROR');
              return finish(undefined, {line, values});
            }
          }
        } catch (error) { finish(error instanceof MemcacheError?error:memcacheError('MEMCACHE_PROTOCOL_ERROR',error)); }
      });
    });
  }
  /** Cancel in-flight operations and refuse new operations; safe to call repeatedly. */
  close(): void { this.#closed = true;for(const cancel of this.#cancel.values())cancel();for(const socket of this.#sockets)socket.destroy();if(!this.#sockets.size){for(const resolve of this.#waiters)resolve();this.#waiters.clear();} }
}
