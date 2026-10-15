/** Opt-in bounded, representation-safe response cache for HTTP reverse proxying.
 * Stores only explicitly public, finite-TTL, identity-encoded GET responses.
 * Compression is applied AFTER retrieval, respecting each client's Accept-Encoding. */
import { Transform, Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
export interface ProxyCacheOptions { enabled?: boolean; maxEntries?: number; maxEntryBytes?: number; maxTotalBytes?: number; maxAgeSeconds?: number; }
export interface ProxyCacheStats { entries: number; bytes: number; hits: number; misses: number; stores: number; evictions: number; }
interface CacheEntry { key: string; hostname: string; pathname: string; body: Buffer; headers: IncomingHttpHeaders; expiresAt: number; createdAt: number; }
const SAFE_SIZE = 32 * 1024 * 1024;
export class ProxyResponseCache {
  private readonly items = new Map<string, CacheEntry>();
  private bytes = 0;
  private hits = 0; private misses = 0; private stores = 0; private evictions = 0;
  readonly options: Required<ProxyCacheOptions>;
  constructor(options: ProxyCacheOptions = {}) {
    this.options = { enabled: options.enabled ?? false, maxEntries: options.maxEntries ?? 256,
      maxEntryBytes: options.maxEntryBytes ?? 1024 * 1024, maxTotalBytes: options.maxTotalBytes ?? SAFE_SIZE,
      maxAgeSeconds: options.maxAgeSeconds ?? 300 };
    const o = this.options;
    if (typeof o.enabled !== 'boolean' || ![o.maxEntries, o.maxEntryBytes, o.maxTotalBytes, o.maxAgeSeconds].every(Number.isSafeInteger) ||
      o.maxEntries < 1 || o.maxEntries > 100000 || o.maxEntryBytes < 1 || o.maxEntryBytes > SAFE_SIZE ||
      o.maxTotalBytes < o.maxEntryBytes || o.maxTotalBytes > 512 * 1024 * 1024 || o.maxAgeSeconds < 1 || o.maxAgeSeconds > 86400) throw new RangeError('Invalid proxy cache options');
  }
  /** Only cache safe uncredentialed GET requests; conditional/range requests bypass storage. */
  requestEligible(req: IncomingMessage): boolean {
    if (!this.options.enabled || req.method !== 'GET' || req.headers.authorization || req.headers.cookie ||
      req.headers.range || req.headers['if-range'] || req.headers['if-none-match'] || req.headers['if-modified-since'] ||
      req.headers['transfer-encoding'] || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) return false;
    if (/(?:^|,)\s*(?:no-cache|no-store|max-age=0)\b/i.test(String(req.headers['cache-control'] ?? ''))) return false;
    return true;
  }
  key(hostname: string, signature: string, url: string): string { return `${hostname}\0${signature}\0${url}`; }
  get(key: string): { headers: IncomingHttpHeaders; body: Buffer; statusCode: number } | undefined {
    const entry = this.items.get(key);
    if (!entry || Date.now() >= entry.expiresAt) {
      if (entry) this.remove(key);
      this.misses++;
      return undefined;
    }
    this.items.delete(key); this.items.set(key, entry); this.hits++;
    return { headers: { ...entry.headers, age: String(Math.floor((Date.now() - entry.createdAt) / 1000)) }, body: entry.body, statusCode: 200 };
  }
  private ttl(headers: IncomingHttpHeaders, status: number): number {
    if (status !== 200 || headers['content-encoding'] || headers['set-cookie'] || headers['content-range'] || headers['www-authenticate']) return 0;
    const control = String(headers['cache-control'] ?? '').toLowerCase();
    if (!/(?:^|,)\s*public\s*(?:,|$)/.test(control) || /(?:^|,)\s*(?:private|no-store|no-cache|no-transform)\b/.test(control)) return 0;
    // Do not merge upstream Vary representations, even if the current response
    // happens to be unencoded. ZSRV adds its own Vary header *after* lookup.
    if (headers.vary) return 0;
    const type = String(headers['content-type'] ?? '').toLowerCase();
    if (type.startsWith('text/event-stream') || /(?:grpc|connect\+|application\/octet-stream)/.test(type)) return 0;
    const ttl = /(?:^|,)\s*s-maxage\s*=\s*(\d+)\b/.exec(control)?.[1] ?? /(?:^|,)\s*max-age\s*=\s*(\d+)\b/.exec(control)?.[1];
    if (!ttl) return 0;
    return Math.min(Number(ttl), this.options.maxAgeSeconds);
  }
  /** Capture through a streaming pass-through. Oversized or aborted responses are never cached. */
  capture(source: Readable & { statusCode?: number; headers: IncomingHttpHeaders }, key: string, hostname: string, pathname: string): Readable & { statusCode: number; headers: IncomingHttpHeaders } {
    const status = source.statusCode ?? 502;
    const ttl = this.ttl(source.headers, status);
    if (!ttl) return source as Readable & { statusCode: number; headers: IncomingHttpHeaders };
    const length = Number(source.headers['content-length']);
    if (Number.isFinite(length) && length > this.options.maxEntryBytes) return source as Readable & { statusCode: number; headers: IncomingHttpHeaders };
    const chunks: Buffer[] = []; let count = 0; let rejected = false;
    const thisLimit = this.options.maxEntryBytes;
    const relay = Object.assign(new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        count += chunk.length;
        if (count > thisLimit) { rejected = true; chunks.length = 0; }
        else if (!rejected) chunks.push(Buffer.from(chunk));
        callback(null, chunk);
      }
    }), { statusCode: status, headers: source.headers });
    relay.once('end', () => {
      if (rejected || count > this.options.maxEntryBytes) return;
      this.insert({ key, hostname, pathname, body: Buffer.concat(chunks, count), headers: { ...source.headers }, expiresAt: Date.now() + ttl * 1000, createdAt: Date.now() });
    });
    source.once('error', error => relay.destroy(error));
    relay.once('close', () => { if (!source.destroyed) source.destroy(); });
    source.pipe(relay);
    return relay;
  }
  private insert(entry: CacheEntry) {
    this.remove(entry.key);
    this.items.set(entry.key, entry); this.bytes += entry.body.length; this.stores++;
    while (this.items.size > this.options.maxEntries || this.bytes > this.options.maxTotalBytes) {
      const oldest = this.items.keys().next().value;
      if (!oldest) break;
      this.remove(oldest); this.evictions++;
    }
  }
  private remove(key: string): boolean {
    const old = this.items.get(key);
    if (!old) return false;
    this.items.delete(key); this.bytes -= old.body.length; return true;
  }
  invalidate(hostname: string, pathname?: string): number {
    let count = 0;
    for (const [key, item] of this.items) if (item.hostname === hostname && (pathname === undefined || item.pathname === pathname)) { this.remove(key); count++; }
    return count;
  }
  clear(): void { this.items.clear(); this.bytes = 0; }
  stats(): ProxyCacheStats { return { entries: this.items.size, bytes: this.bytes, hits: this.hits, misses: this.misses, stores: this.stores, evictions: this.evictions }; }
}
export function cachedReadable(entry: { statusCode: number; body: Buffer; headers: IncomingHttpHeaders }) {
  return Object.assign(Readable.from([entry.body]), { statusCode: entry.statusCode, headers: entry.headers });
}
