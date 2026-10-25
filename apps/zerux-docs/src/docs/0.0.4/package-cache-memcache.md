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
