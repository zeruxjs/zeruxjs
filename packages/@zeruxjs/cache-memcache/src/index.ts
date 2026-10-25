import type { CacheHelper, CacheHelperFactory, CacheSetOptions, CacheValue } from '@zeruxjs/cache';
import { MemcacheTextClient, validateKey, type TextConnectionOptions } from './protocol.js';
export interface MemcacheOptions extends TextConnectionOptions { allowFlushAll?: boolean }
const expiration = (seconds?: number): number => {
  if (seconds === undefined) return 0;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 365 * 86400) throw new RangeError('TTL must be positive and at most 365 days');
  const rounded = Math.ceil(seconds);
  return rounded > 30 * 86400 ? Math.floor(Date.now() / 1000) + rounded : rounded;
};

/** Create an owned Memcached text connection adapter; keys are prefixed by the cache manager. */
export function createMemcacheHelper(options: MemcacheOptions = {}): CacheHelper {
  const client = new MemcacheTextClient(options);
  const request = (command: string | Buffer) => client.request(command);
  const get = async (key: string): Promise<CacheValue | undefined> => {
    const reply = await request(`get ${validateKey(key)}\r\n`);
    if (reply.line !== 'END') throw new Error('Unexpected retrieval response');
    if (!reply.values.length) return undefined;
    return JSON.parse(reply.values[0].value.toString('utf8')) as CacheValue;
  };
  const set = async (key: string, value: CacheValue, opts: CacheSetOptions = {}): Promise<void> => {
    validateKey(key);
    if (opts.ifAbsent && opts.ifPresent) throw new TypeError('Conditional write flags conflict');
    const json = JSON.stringify(value);
    if (typeof json !== 'string') throw new TypeError('Cache value must be JSON serializable');
    const body = Buffer.from(json);
    if (body.length > (options.maxBytes ?? 1024 * 1024)) throw new RangeError('Payload exceeds maxBytes');
    const reply = await request(Buffer.concat([Buffer.from(`${opts.ifAbsent ? 'add' : opts.ifPresent ? 'replace' : 'set'} ${key} 0 ${expiration(opts.ttlSeconds)} ${body.length}\r\n`), body, Buffer.from('\r\n')]));
    if (!['STORED', 'NOT_STORED', 'EXISTS', 'NOT_FOUND'].includes(reply.line)) throw new Error('Unexpected storage response');
  };
  const remove = async (key: string): Promise<boolean> => {
    const {line} = await request(`delete ${validateKey(key)}\r\n`);
    if (!['DELETED', 'NOT_FOUND'].includes(line)) throw new Error('Unexpected delete response');
    return line === 'DELETED';
  };
  const counter = async (key: string, amount: number, command: string): Promise<number> => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Amount must be a non-negative safe integer');
    const {line} = await request(`${command} ${validateKey(key)} ${amount}\r\n`);
    if (line === 'NOT_FOUND') throw new Error('Counter does not exist; initialize it with set(key, 0)');
    const n = Number(line);
    if (!/^\d+$/.test(line) || !Number.isSafeInteger(n)) throw new Error('Invalid or unsafe counter response');
    return n;
  };
  const bounded = (keys: unknown[]) => { if (keys.length > 1000) throw new RangeError('Bulk operation exceeds 1000 keys'); };
  return {
    get, set, delete: remove, has: async key => (await get(key)) !== undefined,
    async clear() {
      if (options.allowFlushAll !== true) throw new Error('Global flush disabled');
      if ((await request('flush_all\r\n')).line !== 'OK') throw new Error('Flush failed');
    },
    clearPrefix() { throw new Error('Memcached cannot safely enumerate a namespace; expire keys individually'); },
    async getMany(keys) { bounded(keys); const result: Record<string, CacheValue | undefined> = Object.create(null); for (const key of keys) result[key] = await get(key); return result; },
    async setMany(values, opts) { const entries = Object.entries(values); bounded(entries); for (const [key, value] of entries) await set(key, value, opts); },
    async deleteMany(keys) { bounded(keys); let count = 0; for (const key of keys) count += Number(await remove(key)); return count; },
    increment: (key, amount = 1) => counter(key, amount, 'incr'),
    decrement: (key, amount = 1) => counter(key, amount, 'decr'),
    async touch(key, ttlSeconds) {
      const {line} = await request(`touch ${validateKey(key)} ${expiration(ttlSeconds)}\r\n`);
      if (!['TOUCHED', 'NOT_FOUND'].includes(line)) throw new Error('Unexpected touch response');
      return line === 'TOUCHED';
    },
    close: () => client.close(), native: () => client
  };
}
/** Factory used by @zeruxjs/cache dynamic helper loading. No environment variables are read. */
export const createCacheHelper: CacheHelperFactory = options => createMemcacheHelper(options as MemcacheOptions);
export default createCacheHelper;
