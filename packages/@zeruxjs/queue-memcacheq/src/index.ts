import { MemcacheTextClient, validateKey, type TextConnectionOptions } from '@zeruxjs/cache-memcache/protocol';
export interface MemcacheQOptions extends TextConnectionOptions { prefix?: string }
export interface MemcacheQMessage { name: string; data: Record<string, unknown> }

/**
 * Connect lazily to MemcacheQ (not Memcached). Each take permanently removes a message.
 * The caller owns polling, cancellation, processing and error policy. No replay or retries.
 */
export function createMemcacheQ(options: MemcacheQOptions = {}) {
  const prefix = options.prefix ?? 'zerux';
  validateKey(prefix);
  const client = new MemcacheTextClient({ ...options, port: options.port ?? 22201 });
  const key = (queue: string) => validateKey(`${prefix}:${validateKey(queue)}`);
  return {
    capabilities: Object.freeze({ acknowledgement: false, delay: false, retry: false, destructiveRead: true }),
    /** Append a JSON job to the named FIFO. A timeout may mean the append succeeded. */
    async add(queue: string, name: string, data: Record<string, unknown>): Promise<void> {
      validateKey(name);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Job data must be an object');
      const body = Buffer.from(JSON.stringify({name, data}));
      if (body.length > (options.maxBytes ?? 1024 * 1024)) throw new RangeError('Payload exceeds maxBytes');
      const reply = await client.request(Buffer.concat([Buffer.from(`set ${key(queue)} 0 0 ${body.length}\r\n`), body, Buffer.from('\r\n')]));
      if (reply.line !== 'STORED') throw new Error('MemcacheQ append rejected');
    },
    /** Destructive pop. A crash, malformed message or lost reply can permanently lose work. */
    async take(queue: string): Promise<MemcacheQMessage | undefined> {
      const reply = await client.request(`get ${key(queue)}\r\n`);
      if (reply.line !== 'END') throw new Error('Unexpected MemcacheQ retrieval response');
      if (!reply.values.length) return undefined;
      const message = JSON.parse(reply.values[0].value.toString('utf8')) as MemcacheQMessage;
      if (!message || typeof message.name !== 'string' || !message.data || typeof message.data !== 'object' || Array.isArray(message.data)) throw new Error('Invalid MemcacheQ job envelope');
      validateKey(message.name);
      return message;
    },
    /** Cancel outstanding sockets and reject future work. */
    close() { client.close(); }
  };
}
export type MemcacheQ = ReturnType<typeof createMemcacheQ>;
