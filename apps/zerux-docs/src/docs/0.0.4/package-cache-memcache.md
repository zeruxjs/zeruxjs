---
{
  "title": "Memcached cache adapter",
  "description": "Set up @zeruxjs/cache-memcache with explicit lifecycle and capability boundaries.",
  "section": "Packages",
  "order": 1,
  "sources": [
    "packages/@zeruxjs/cache-memcache/README.md",
    "packages/@zeruxjs/cache-memcache/src/index.ts"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/cache-memcache"
}
---


Memcached ASCII text-protocol adapter for `@zeruxjs/cache`, implemented using Node sockets. Requires Node 20+ and a reachable Memcached server. This is a cache, not MemcacheQ.

```ts
import {createCacheManager} from '@zeruxjs/cache';
const cache = await createCacheManager({
  helper: '@zeruxjs/cache-memcache', prefix: 'shop', defaultTtlSeconds: 60,
  options: {host: '127.0.0.1', port: 11211, timeoutMs: 3000}
});
try {
  await cache.set('product', {stock: 5});
  console.log(await cache.get('product'));
  await cache.delete('product');
} finally { await cache.close(); }
```

`createMemcacheHelper(options)` constructs the adapter directly. `createCacheHelper` is the dynamic cache-manager factory. Options: `host` (127.0.0.1), `port` (11211), `tls` (false, verifies certificates when enabled), `timeoutMs` (3000, maximum 120000), `maxBytes` (1 MiB, maximum 16 MiB), `maxConcurrent` (32, maximum 1000), and `allowFlushAll` (false). No environment values are read automatically. Configure endpoints only from trusted server configuration; outbound network authorization belongs to the host.

Supports JSON values, delete/has, touch, atomic add/replace conditional writes, native integer counters and sequential bulk operations capped at 1000 keys. Conditional writes follow the void cache contract: a failed condition leaves the value unchanged. Initialize counters with a non-negative integer before incrementing. Memcached decrements clamp at zero; missing counters reject. Unsafe integer replies reject. TTL is positive, at most 365 days; values above 30 days are translated to absolute Unix expiration.

Keys, including the manager prefix, must be 1–250 printable ASCII bytes without spaces. A command has an absolute deadline and bounded response; concurrency overload rejects immediately. Each operation owns a separate socket, closed on completion/error. There is no pooling, sharding, SASL, automatic replay or reconnect loop. Closing cancels in-flight operations and prevents reuse. A timeout after a write has an unknown outcome.

`clearPrefix` rejects: Memcached does not safely enumerate arbitrary namespaces. `clear()` therefore rejects for a namespaced manager. Unprefixed global flush requires `allowFlushAll:true` and affects the entire server; use only dedicated servers. Per-key expiration/deletion is the safe default. Bulk writes are not transactions.

The public `@zeruxjs/cache-memcache/protocol` subpath exposes `MemcacheTextClient`, `TextConnectionOptions`, `TextReply`, `TextValue` and `validateKey` for protocol adapters. Its `request` method accepts trusted raw commands; never expose it to clients. It is also used by `queue-memcacheq` for transport only.

Run `npm run build` here after building `@zeruxjs/cache`. See the [Memcached protocol](https://github.com/memcached/memcached/blob/master/doc/protocol.txt). Local protocol fixtures do not establish live server, TLS or distributed acceptance.

## Validated single-endpoint and payload contract

Legacy servers/options configuration explicitly rejects; select a reviewed host/port, never inferred sharding. The helper now declares conditional writes/counters supported, namespace clear/bulk atomicity unsupported and owned sockets. clearPrefix remains fail-closed; no generation-token resurrection scheme or speculative pooling is introduced.

maxBytes counts exact serialized JSON UTF-8 bytes before connection, and maxDepth defaults to 32 (maximum 64). Plain JSON traversal also caps at 100000 nodes. Bulk calls cap at 1000 keys and aggregate maxBytes encoded data; setMany prevalidates every entry before sending. Sparse arrays, accessors, toJSON, cycles and invalid numbers reject. Responses enforce strict UTF-8, JSON depth, framing and matching retrieval keys.

Direct get/set and protocol request accept signal/deadline options. Helper close returns a Promise for actual socket cleanup; protocol close stays synchronous with whenClosed() and activeSocketCount for observation. Stable MemcacheError codes exclude raw key/payload/server text; internal causes remain private. Timeout/cancellation after a write is an unknown outcome, never an automatic replay. TTL rounding above 30 days still converts to absolute Unix expiry, add/replace are atomic per key, counter misses reject and decrement clamps at zero.

See the package README for the packed public-import example and exact migration limits. Live acceptance requires a dedicated ZX_TEST_MEMCACHE_HOST (optional ZX_TEST_MEMCACHE_PORT); loopback fixtures do not certify Memcached/TLS/eviction or MemcacheQ delivery semantics.
