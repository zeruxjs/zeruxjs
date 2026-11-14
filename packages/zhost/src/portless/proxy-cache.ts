/** Opt-in bounded, representation-safe response cache for HTTP reverse proxying.
 * Stores only explicitly public, finite-TTL, identity-encoded GET responses.
 * Compression is applied AFTER retrieval, respecting each client's Accept-Encoding. */
import { Transform, Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
export interface ProxyCacheOptions {
  /** Explicit opt-in flag; false preserves upstream-only behavior. */
  enabled?: boolean;
  /** Positive bounded retained representation count, default 256. */
  maxEntries?: number;
  /** Maximum one identity body bytes, default 1 MiB and at most 32 MiB. */
  maxEntryBytes?: number;
  /** Total retained body bytes, default 32 MiB and at most 512 MiB. */
  maxTotalBytes?: number;
  /** Maximum positive public freshness seconds, default 300 and at most 86400. */
  maxAgeSeconds?: number;
}
export interface ProxyCacheStats {
  /** Currently retained representation count. */
  entries: number;
  /** Currently retained identity-body bytes. */
  bytes: number;
  /** Lifetime successful fresh local lookups. */
  hits: number;
  /** Lifetime absent or expired local lookups. */
  misses: number;
  /** Lifetime completed inserted representations. */
  stores: number;
  /** Lifetime capacity-evicted representations. */
  evictions: number;
}
interface CacheEntry {
  /** Host/backend/URL-scoped internal lookup identity. */
  key: string;
  /** Validated route label retained for local invalidation. */
  hostname: string;
  /** Exact caller-supplied request URL retained for local invalidation; the proxy includes query bytes. */
  pathname: string;
  /** Retained identity Buffer; callers must not mutate its bytes. */
  body: Buffer;
  /** Stored upstream identity metadata before serving-layer content encoding. */
  headers: IncomingHttpHeaders;
  /** Host-clock expiration epoch milliseconds. */
  expiresAt: number;
  /** Host-clock insertion epoch milliseconds used for Age. */
  createdAt: number;
}
/** Maximum per-entry identity body size and default total retained bytes, 32 MiB. */
const SAFE_SIZE = 32 * 1024 * 1024;
/** Process-local public identity-response cache; the serving layer owns compression and authorization. */
export class ProxyResponseCache {
  /** Process-local LRU map of completed identity representations. */
  private readonly items = new Map<string, CacheEntry>();
  /** Current retained body-byte total. */
  private bytes = 0;
  /** Lifetime fresh lookup count. */
  private hits = 0;
  private misses = 0;
  private stores = 0;
  private evictions = 0;
  /** Normalized validated policy; hosts must not mutate it while serving. */
  readonly options: Required<ProxyCacheOptions>;
  /** Validate opt-in bounded process-local identity-response storage without starting timers or opening native resources.
   * @param {ProxyCacheOptions} options - Trusted explicit cache count/byte/TTL policy; disabled by default.
   */
  constructor(options: ProxyCacheOptions = {}) {
    this.options = {
      enabled: options.enabled ?? false,
      maxEntries: options.maxEntries ?? 256,
      maxEntryBytes: options.maxEntryBytes ?? 1024 * 1024,
      maxTotalBytes: options.maxTotalBytes ?? SAFE_SIZE,
      maxAgeSeconds: options.maxAgeSeconds ?? 300,
    };
    /** Normalized policy validated before any retention is permitted. */
    const o = this.options;
    if (
      typeof o.enabled !== 'boolean' ||
      ![o.maxEntries, o.maxEntryBytes, o.maxTotalBytes, o.maxAgeSeconds].every(
        Number.isSafeInteger
      ) ||
      o.maxEntries < 1 ||
      o.maxEntries > 100000 ||
      o.maxEntryBytes < 1 ||
      o.maxEntryBytes > SAFE_SIZE ||
      o.maxTotalBytes < o.maxEntryBytes ||
      o.maxTotalBytes > 512 * 1024 * 1024 ||
      o.maxAgeSeconds < 1 ||
      o.maxAgeSeconds > 86400
    ) {
      throw new RangeError('Invalid proxy cache options');
    }
  }
  /** Admit only enabled uncredentialed bodyless GET requests; range/conditional/cache-bypass requests stay upstream.
   * @param {IncomingMessage} req - Borrowed native incoming request; headers are inspected without reading its body.
   * @returns {boolean} Whether this request may use the explicitly public response cache.
   */
  requestEligible(req: IncomingMessage): boolean {
    if (
      !this.options.enabled ||
      req.method !== 'GET' ||
      req.headers.authorization ||
      req.headers.cookie ||
      req.headers.range ||
      req.headers['if-range'] ||
      req.headers['if-none-match'] ||
      req.headers['if-modified-since'] ||
      req.headers['transfer-encoding'] ||
      (req.headers['content-length'] !== undefined &&
        req.headers['content-length'] !== '0')
    ) {
      return false;
    }
    if (
      /(?:^|,)\s*(?:no-cache|no-store|max-age=0)\b/i.test(
        String(req.headers['cache-control'] ?? '')
      )
    ) {
      return false;
    }
    return true;
  }
  /** Construct a representation namespace from the host-authorized route, backend signature and exact request URL.
   * @param {string} hostname - Serving-proxy validated route name.
   * @param {string} signature - Current route/backend generation signature.
   * @param {string} url - Exact native request URL; query bytes remain part of identity.
   * @returns {string} NUL-separated process-local identity; never use private subjects as public cache labels.
   */
  key(hostname: string, signature: string, url: string): string {
    return `${hostname}\0${signature}\0${url}`;
  }
  /** Read fresh identity bytes and update local LRU/hit counters, expiring old entries lazily.
   * @param {string} key - Previously constructed same-route/backend/request key.
   * @returns {{ headers: IncomingHttpHeaders; body: Buffer; statusCode: number } | undefined} Copied headers with computed Age and borrowed body bytes; consumers must not mutate retained bytes.
   */
  get(key: string):
    | {
        /** Stored upstream identity metadata before serving-layer content encoding. */
        headers: IncomingHttpHeaders;
        /** Retained identity Buffer; callers must not mutate its bytes. */
        body: Buffer;
        statusCode: number;
      }
    | undefined {
    /** Current retained representation for this key, if present. */
    const entry = this.items.get(key);
    if (!entry || Date.now() >= entry.expiresAt) {
      if (entry) {
        this.remove(key);
      }
      this.misses++;
      return undefined;
    }
    this.items.delete(key);
    this.items.set(key, entry);
    this.hits++;
    return {
      headers: {
        ...entry.headers,
        age: String(Math.floor((Date.now() - entry.createdAt) / 1000)),
      },
      body: entry.body,
      statusCode: 200,
    };
  }
  /** Require explicit finite public max-age/s-maxage and reject private, encoded, varying, authenticated or streaming representations.
   * @param {IncomingHttpHeaders} headers - Borrowed native upstream response metadata.
   * @param {number} status - Native upstream status; only 200 can be retained.
   * @returns {number} Bounded positive freshness seconds or zero to bypass capture.
   */
  private ttl(headers: IncomingHttpHeaders, status: number): number {
    if (
      status !== 200 ||
      headers['content-encoding'] ||
      headers['set-cookie'] ||
      headers['content-range'] ||
      headers['www-authenticate']
    ) {
      return 0;
    }
    /** Lower-case explicit upstream cache policy; no implicit public freshness is inferred. */
    const control = String(headers['cache-control'] ?? '').toLowerCase();
    if (
      !/(?:^|,)\s*public\s*(?:,|$)/.test(control) ||
      /(?:^|,)\s*(?:private|no-store|no-cache|no-transform)\b/.test(control)
    ) {
      return 0;
    }
    // Do not merge upstream Vary representations, even if the current response
    // happens to be unencoded. ZHOST adds its own Vary header *after* lookup.
    if (headers.vary) {
      return 0;
    }
    /** Lower-case media type used to bypass SSE and binary/RPC streams. */
    const type = String(headers['content-type'] ?? '').toLowerCase();
    if (
      type.startsWith('text/event-stream') ||
      /(?:grpc|connect\+|application\/octet-stream)/.test(type)
    ) {
      return 0;
    }
    /** Declared freshness extracted in s-maxage-first order, bounded before retention. */
    const ttl =
      /(?:^|,)\s*s-maxage\s*=\s*(\d+)\b/.exec(control)?.[1] ??
      /(?:^|,)\s*max-age\s*=\s*(\d+)\b/.exec(control)?.[1];
    if (!ttl) {
      return 0;
    }
    return Math.min(Number(ttl), this.options.maxAgeSeconds);
  }
  /** Stream a public identity response through bounded optional capture; only completed within-budget bodies become local cache entries.
   * @param {Readable & { statusCode?: number; headers: IncomingHttpHeaders }} source - Borrowed native upstream readable and response metadata; relay close destroys its source.
   * @param {string} key - Host-constructed exact route/backend/request key.
   * @param {string} hostname - Validated host route for explicit invalidation.
   * @param {string} pathname - Exact caller-supplied request URL retained for invalidation; the serving proxy includes query bytes.
   * @returns {Readable & { statusCode: number; headers: IncomingHttpHeaders }} Original source on bypass, otherwise owned pass-through relay; the serving layer owns consumption/cancellation.
   */
  capture(
    source: Readable & {
      statusCode?: number;
      /** Stored upstream identity metadata before serving-layer content encoding. */
      headers: IncomingHttpHeaders;
    },
    key: string,
    hostname: string,
    pathname: string
  ): Readable & {
    statusCode: number;
    /** Stored upstream identity metadata before serving-layer content encoding. */
    headers: IncomingHttpHeaders;
  } {
    /** Native upstream status, default Bad Gateway when unavailable. */
    const status = source.statusCode ?? 502;
    /** Declared freshness extracted in s-maxage-first order, bounded before retention. */
    const ttl = this.ttl(source.headers, status);
    if (!ttl) {
      return source as Readable & {
        statusCode: number;
        /** Stored upstream identity metadata before serving-layer content encoding. */
        headers: IncomingHttpHeaders;
      };
    }
    /** Optional declared upstream byte length used only as an early oversize rejection. */
    const length = Number(source.headers['content-length']);
    if (Number.isFinite(length) && length > this.options.maxEntryBytes) {
      return source as Readable & {
        statusCode: number;
        /** Stored upstream identity metadata before serving-layer content encoding. */
        headers: IncomingHttpHeaders;
      };
    }
    /** Bounded copied body chunks; discarded immediately after capture exceeds its byte cap. */
    const chunks: Buffer[] = [];
    let count = 0;
    let rejected = false;
    /** Per-capture byte ceiling retained independently of callback this binding. */
    const thisLimit = this.options.maxEntryBytes;
    /** Owned identity pass-through whose close destroys the borrowed upstream source. */
    const relay = Object.assign(
      new Transform({
        /** Forward bytes unchanged while retaining only a bounded candidate; exceeding the budget discards capture without truncating the response.
         * @param {Buffer} chunk - Native Buffer chunk supplied by the readable stream.
         * @param {BufferEncoding} _encoding - Native transform encoding metadata; bytes are forwarded unchanged.
         * @param {(error: Error | null, chunk: Buffer) => void} callback - Native transform continuation invoked once with the original chunk.
         * @returns {void} Preserves streaming backpressure through the native transform callback.
         */
        transform(chunk: Buffer, _encoding, callback) {
          count += chunk.length;
          if (count > thisLimit) {
            rejected = true;
            chunks.length = 0;
          } else if (!rejected) {
            chunks.push(Buffer.from(chunk));
          }
          callback(null, chunk);
        },
      }),
      { statusCode: status, headers: source.headers }
    );
    relay.once('end', () => {
      if (rejected || count > this.options.maxEntryBytes) {
        return;
      }
      this.insert({
        key,
        hostname,
        pathname,
        body: Buffer.concat(chunks, count),
        headers: { ...source.headers },
        expiresAt: Date.now() + ttl * 1000,
        createdAt: Date.now(),
      });
    });
    source.once('error', (error) => relay.destroy(error));
    relay.once('close', () => {
      if (!source.destroyed) {
        source.destroy();
      }
    });
    source.pipe(relay);
    return relay;
  }
  /** Replace one completed public candidate and evict oldest entries until count/byte budgets hold.
   * @param {CacheEntry} entry - Internal completed identity representation, never untrusted request data.
   * @returns {void} Updates local counters; no distributed coordination or persistence is implied.
   */
  private insert(entry: CacheEntry) {
    this.remove(entry.key);
    this.items.set(entry.key, entry);
    this.bytes += entry.body.length;
    this.stores++;
    while (
      this.items.size > this.options.maxEntries ||
      this.bytes > this.options.maxTotalBytes
    ) {
      /** Oldest retained key selected for local capacity eviction. */
      const oldest = this.items.keys().next().value;
      if (!oldest) {
        break;
      }
      this.remove(oldest);
      this.evictions++;
    }
  }
  /** Remove one currently retained representation and account its bytes.
   * @param {string} key - Internal exact cache key.
   * @returns {boolean} Whether an entry was present and removed.
   */
  private remove(key: string): boolean {
    /** Existing representation whose bytes are accounted before removal. */
    const old = this.items.get(key);
    if (!old) {
      return false;
    }
    this.items.delete(key);
    this.bytes -= old.body.length;
    return true;
  }
  /** Remove currently retained entries for one host and optional exact stored request URL; callers separately authorize this server-only operation.
   * @param {string} hostname - Validated authorized host route.
   * @param {string} pathname - Optional exact stored request URL, including query bytes in the proxy; absence invalidates all retained entries for that host.
   * @returns {number} Number removed now; this legacy cache does not fence captures already in flight.
   */
  invalidate(hostname: string, pathname?: string): number {
    let count = 0;
    for (const [key, item] of this.items) {
      if (
        item.hostname === hostname &&
        (pathname === undefined || item.pathname === pathname)
      ) {
        this.remove(key);
        count++;
      }
    }
    return count;
  }
  /** Clear currently retained local bytes while preserving lifetime hit/miss/store/eviction counters.
   * @returns {void} Does not abort upstream captures; later completed captures may insert again.
   */
  clear(): void {
    this.items.clear();
    this.bytes = 0;
  }
  /** Read fixed aggregate process-local cache counters without disclosing URLs, keys or peer identities.
   * @returns {ProxyCacheStats} Detached count/byte metrics; memory storage is neither durable nor distributed.
   */
  stats(): ProxyCacheStats {
    return {
      entries: this.items.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      stores: this.stores,
      evictions: this.evictions,
    };
  }
}
/** Wrap retained identity bytes as a readable for the single serving response layer to transform if negotiated.
 * @param {{ statusCode: number; body: Buffer; headers: IncomingHttpHeaders }} entry - Trusted retained representation; do not mutate its borrowed bytes or headers.
 * @param {number} entry.statusCode - Stored identity representation status, normally 200.
 * @param {Buffer} entry.body - Borrowed retained identity bytes; serving consumers must not mutate them.
 * @param {IncomingHttpHeaders} entry.headers - Borrowed trusted identity headers before serving-layer encoding.
 * @returns {Readable & { statusCode: number; headers: IncomingHttpHeaders }} New per-response readable; this helper performs no encoding or upstream fetch.
 */
export function cachedReadable(entry: {
  statusCode: number;
  /** Retained identity Buffer; callers must not mutate its bytes. */
  body: Buffer;
  /** Stored upstream identity metadata before serving-layer content encoding. */
  headers: IncomingHttpHeaders;
}) {
  return Object.assign(Readable.from([entry.body]), {
    statusCode: entry.statusCode,
    headers: entry.headers,
  });
}
