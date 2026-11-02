# Memcached cache adapter

Set up @zeruxjs/cache-memcache with explicit lifecycle and capability boundaries.



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


## Public entry points

Manifest reference for `@zeruxjs/cache-memcache@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./protocol": {
      "types": "./dist/protocol.d.ts",
      "default": "./dist/protocol.js"
    }
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@zeruxjs/cache": "0.0.4"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/cache-memcache

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

`createMemcacheHelper(options)` constructs the adapter directly. `createCacheHelper` is the dynamic cache-manager factory. Options: `host` (127.0.0.1), `port` (11211), `tls` (false, verifies certificates when enabled), `timeoutMs` (3000, maximum 120000), `maxBytes` (1 MiB, maximum 16 MiB), `maxConcurrent` (32, maximum 1000), `maxDepth` (32, maximum 64), and `allowFlushAll` (false). No environment values are read automatically. Configure endpoints only from trusted server configuration; outbound network authorization belongs to the host.

Supports JSON values, delete/has, touch, atomic add/replace conditional writes, native integer counters and sequential bulk operations capped at 1000 keys. Conditional writes follow the void cache contract: a failed condition leaves the value unchanged. Initialize counters with a non-negative integer before incrementing. Memcached decrements clamp at zero; missing counters reject. Unsafe integer replies reject. TTL is positive, at most 365 days; values above 30 days are translated to absolute Unix expiration.

Keys, including the manager prefix, must be 1–250 printable ASCII bytes without spaces. A command has an absolute deadline and bounded response; concurrency overload rejects immediately. Each operation owns a separate socket; its Promise settles after the socket close event on completion/error. There is no pooling, sharding, SASL, automatic replay or reconnect loop. Await helper.close() to cancel in-flight operations, observe socket cleanup and prevent reuse. A timeout after a write has an unknown outcome.

`clearPrefix` rejects: Memcached does not safely enumerate arbitrary namespaces. `clear()` therefore rejects for a namespaced manager. Unprefixed global flush requires `allowFlushAll:true` and affects the entire server; use only dedicated servers. Per-key expiration/deletion is the safe default. Bulk writes are not transactions.

The public `@zeruxjs/cache-memcache/protocol` subpath exposes `MemcacheTextClient`, `TextConnectionOptions`, `TextReply`, `TextValue`, `TextRequestOptions`, `MemcacheError` and `validateKey` for protocol adapters. Its `request` method accepts trusted raw commands; never expose it to clients. It is also used by `queue-memcacheq` for transport only.

Run `npm run build` here after building `@zeruxjs/cache`. See the [Memcached protocol](https://github.com/memcached/memcached/blob/master/doc/protocol.txt). Local protocol fixtures do not establish live server, TLS or distributed acceptance.

## Bounded direct helper

```ts
import {createMemcacheHelper} from '@zeruxjs/cache-memcache';
import type {TextRequestOptions} from '@zeruxjs/cache-memcache/protocol';

export async function example(host: string, port: number, signal?: AbortSignal) {
  // Endpoint selection belongs to trusted server configuration.
  const helper = createMemcacheHelper({host, port, maxBytes: 65536, maxDepth: 16});
  const request: TextRequestOptions = {signal, deadline: Date.now() + 1000};
  try {
    await helper.set('shop:example', {stock: 5}, {ttlSeconds: 60, ifAbsent: true, ...request});
    return await helper.get('shop:example', request);
  } finally { await helper.close(); }
}
```

The direct get and set methods accept optional signal/deadline controls; protocol request(command, options) accepts the same TextRequestOptions. Other facade operations use the configured timeoutMs/close policy. Aborting or losing a write reply does not prove that the server rejected the write. There is no automatic replay.

### Compatibility and guarantees

Only one explicit host/port endpoint is supported. Legacy servers/options shapes reject with MEMCACHE_LEGACY_CONFIG_UNSUPPORTED, including one-element server lists: no previous hashing, failover, retry or option semantics can be certified. Migrate by explicitly choosing host/port and reviewed supported options. Unknown helper options, contradictory/nonboolean conditions, invalid depth and unsafe keys reject before network access. This is deliberate validation of previously ignored configuration, not a multi-server implementation.

Capability metadata now declares supported conditionalWrites/counters, unsupported namespaceClear/bulkAtomicity, and owned sockets. Strict cache-manager requirements can negotiate these declarations. Void set still does not expose a condition miss. Counter values use native decimal unsigned semantics and must return JS safe integers; a range error can occur after a mutation, without rollback. Atomic add/replace applies to one key. Sequential bulk methods can partially succeed on a server failure.

No generation-token invalidation is implemented: an evicted or raced token could resurrect old entries. clearPrefix remains fail-closed. Global flush remains opt-in and destructive across namespaces; the default never flushes. Use expiry or explicit owned-key deletion. No socket pool or connection-overhead performance claim is introduced.

### Payload and cleanup boundaries

maxBytes measures exact serialized UTF-8 JSON **body bytes**, including quotes and escapes, before any socket is opened. It is independent of protocol framing overhead. JSON traversal is bounded by maxDepth (root depth zero) and 100000 visited nodes, and accepts plain JSON data only: getters, toJSON, cycles, sparse arrays, undefined, nonfinite numbers and exotic objects reject. JSON retrieval responses also enforce byte/depth limits, strict UTF-8 and JSON validity. Malformed framing, unexpected reply keys and extra response bytes reject. This does not claim full Memcached command parity.

Each bulk call accepts at most 1000 keys; setMany validates and encodes all entries before its first command. The aggregate encoded JSON budget for setMany/getMany is maxBytes, in addition to each value's budget. This tightens previous unchecked/large bulk behavior; split larger administrative batches explicitly. Key validation covers every bulk key before dispatch. Raw protocol request is a trusted command escape hatch bounded by maxBytes plus 512 command bytes and maxBytes plus 1024 response framing bytes; do not expose it to untrusted callers.

Errors expose a fixed code through MemcacheError.code and details.code, with fixed messages and no key/payload/server text. Codes include MEMCACHE_INVALID_OPTIONS, MEMCACHE_INVALID_KEY, MEMCACHE_INVALID_JSON, MEMCACHE_DEPTH_LIMIT, MEMCACHE_PAYLOAD_LIMIT, MEMCACHE_BULK_LIMIT, MEMCACHE_COUNTER_MISSING, MEMCACHE_COUNTER_RANGE, MEMCACHE_NAMESPACE_CLEAR_UNSUPPORTED, MEMCACHE_GLOBAL_CLEAR_DISABLED, MEMCACHE_CONDITION_CONFLICT, MEMCACHE_CONNECTION_FAILED, MEMCACHE_DISCONNECTED, MEMCACHE_SERVER_ERROR, MEMCACHE_PROTOCOL_ERROR, MEMCACHE_DEADLINE, MEMCACHE_CANCELLED, MEMCACHE_CONCURRENCY_LIMIT and MEMCACHE_CLOSED. Internal causes may retain parser/network detail; never serialize them to clients.

Protocol close() remains synchronous/idempotent for existing consumers; await whenClosed() to observe actual handle release. activeSocketCount counts sockets until their close event, so overload cannot bypass the limit while destroyed sockets are still pending cleanup. Abort listeners and timers are removed exactly once. No request opens a socket on import/construction. Live acceptance uses ZX_TEST_MEMCACHE_HOST and optional ZX_TEST_MEMCACHE_PORT against a dedicated test server; no service is started automatically. The default suite exercises local byte-level fixtures, not live Memcached, MemcacheQ, TLS or server-eviction acceptance.


## Implementation sources

- [packages/@zeruxjs/cache-memcache/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-memcache/README.md)
- [packages/@zeruxjs/cache-memcache/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-memcache/src/index.ts)
