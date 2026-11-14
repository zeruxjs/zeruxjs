# @zeruxjs/cache

Application cache abstraction with a built-in bounded memory cache, external adapters, and a manager facade. Cache values are JSON-serializable. Cache keys should not contain secrets.

## Setup

```ts
import { createCacheManager, createMemoryCacheHelper, createCacheManagerWithHelper } from '@zeruxjs/cache';

const cache = await createCacheManager({
  helper: 'memory', // or '@zeruxjs/cache-redis' for Redis
  prefix: 'project:users', // keys are project:users:<name>
  defaultTtlSeconds: 300,
  options: { maxEntries: 2000 }
});

try {
  await cache.set('u:42', {name: 'Ada'}, {ttlSeconds: 30});
  const users = await cache.getMany(['u:42', 'u:43']); // logical/unprefixed keys
  await cache.clear(); // namespace only
} finally {
  await cache.close();
}
```

`createCacheManagerWithHelper(adapter, config)` allows testing or injecting an existing adapter. `createMemoryCacheHelper({maxEntries, now})` implements LRU eviction, lazy TTL expiry, defensive JSON cloning, numeric counters, conditional `ifAbsent`/`ifPresent` writes, bulk methods, and stats.

## Cache stampede prevention

```ts
import type { CacheManager, CacheValue } from '@zeruxjs/cache';

export async function loadCatalog(cache: CacheManager, produce: () => Promise<CacheValue>) {
  return await cache.remember('catalog', produce, {ttlSeconds: 60});
}
```

Concurrent misses for the same key **within one manager process** share one pending producer Promise. Failed producers are not cached. It is not a distributed lock and cannot prevent concurrent work across Redis clients or server instances.

## Safety notes

- `clear()` with a prefix must call the provider's `clearPrefix` implementation; it fails closed if unsupported. Without a prefix it calls the provider's global clear, which Redis disables by default.
- TTLs must be positive and finite; counters accept non-negative safe integers.
- Values are JSON-serializable. The memory provider copies objects on get/set to avoid accidental mutation.
- Memory cache is per process: no persistence, synchronization, or cross-worker coordination.
- Conditional writes are atomic only when the provider supports them. `setMany` across multiple keys is not guaranteed atomic.

Run package tests after building: `npm run build && node --experimental-strip-types --test test/*.test.ts`.

## Scoped managers

```ts
import { createMemoryCacheHelper, createCacheManagerWithHelper } from '@zeruxjs/cache';

export async function example() {
  const helper = createMemoryCacheHelper({maxEntries: 100});
  const cache = createCacheManagerWithHelper(helper, {prefix: 'tenant:verified-id',
    policy: {maxBulk: 20, maxPendingProducers: 4, ownHelper: false,
      requireCapabilities: ['conditionalWrites', 'counters']} });
  try {
    return await cache.remember('catalog', async ({signal}) => {
      signal.throwIfAborted();
      return {items: ['example']};
    }, {ttlSeconds: 30, timeoutMs: 1000});
  } finally { await cache.close(); helper.close?.(); }
}
```

Bind the tenant namespace from trusted server context, never a caller's tenant assertion. Prefixing isolates ordinary keys; it is not authorization or a collision-proof tenant encoding (use unambiguous application-owned prefixes/keys). Multiple managers can share a helper with `policy.ownHelper: false`; the host closes it after all managers. Default true preserves manager-owned helper cleanup, including the previous injected-helper behavior. Backend ownership reported by a helper is separate from whether a manager owns the helper wrapper.

`capabilities` snapshots optional helper declarations for conditionalWrites, counters, namespaceClear and bulkAtomicity (`supported`, `unsupported`, `unknown`), plus backend ownership (`owned`, `borrowed`, `unknown`). Explicit unsupported operations reject before dispatch. Missing metadata remains unknown for compatibility; it does not prove atomicity. `policy.requireCapabilities` fails construction unless every requested capability is explicitly supported. A failed dynamically loaded helper negotiation closes that acquired wrapper. No distributed operation is emulated. The Redis adapter declares supported conditions/counters/namespace clear and unsupported overall bulk atomicity; Memcached declares supported conditions/counters and unsupported namespace clear/bulk atomicity; requiring a guarantee needs an adapter with reviewed metadata.

Memory advertises supported conditional writes, counters and namespace clear; multi-key atomicity is unsupported. `set`/`setMany` return void: a conditional miss does **not** report success/failure. Never use that void result as lock acquisition or authorization. Memory counters are signed safe integers, create missing counters at zero and preserve existing TTL. Redis uses server signed integer arithmetic (missing keys start at zero), and its native range can exceed JS precision; manager results outside safe integers reject after the server mutation, without rollback. Memcached counters require an existing numeric item and decrement clamps at zero. See [Redis integer semantics](https://redis.io/docs/latest/commands/incr/) and [Memcached text operations](https://docs.memcached.org/protocols/basic/). Their conditional writes use native NX/XX or add/replace; TTL precision and global-clear policy remain provider-owned. Bulk operations can partially succeed and must not be used as transactions.

## Runtime limits and producer lifecycle

`policy` defaults: maxBulk 1000 (maximum 10000), maxPendingProducers 64 (1024), maxKeyBytes 1024 (65536), maxValueBytes 1048576 (16777216), maxDepth 32 (64). Values must be plain JSON data, without getters, toJSON, cycles, undefined or nonfinite numbers; traversal also caps at 100000 nodes. Both input writes and returned values are bounded; logical and fully prefixed keys must fit the key budget. Direct memory helpers accept the same policy through `{policy: {...}}`, enforce bulk/key/value limits without a manager, and evict excess counter entries as well as normal writes. Native handles are privileged host-owned escape hatches; direct native mutations bypass facade guarantees. External direct helpers retain their own package limits; this facade does not certify their direct API. Smaller helper limits still apply beneath a manager.

`remember` bounds all pending miss jobs, including the initial lookup. It coalesces one job per manager/key, not across processes. The first job's TTL/condition/deadline options govern production; subsequent callers only join. Producers receive `{signal, deadline}`. timeoutMs is 1–600000; absolute deadlines must be safe integer timestamps no more than ten minutes ahead. A deadline aborts cooperative production and prevents late cache writes, but the producer retains capacity until it actually settles. A caller's signal only detaches that waiter; it does not cancel another subscriber. Manager close aborts production, rejects stale use immediately, waits for native calls/producers and closes an owned helper once. An uncooperative producer/provider can delay cleanup indefinitely; no Promise is forcibly cancelled. Failed producers are removed after settlement and can retry. Do not call close from inside that manager's own producer.

The active `cache`, get/set/remember exports and configureCacheManager are a process-global compatibility layer. Generation/request code should retain its own manager; replacing the active manager does not close the previous generation. Runtime `cache.policy` uses this package-owned contract and validates limits before service factories. No Redis/Memcached service starts until configured. Offline tests and packed public imports do not prove live-provider behavior.

### Valkey adapter and shared policy

The explicit [`@zeruxjs/cache-valkey`](../cache-valkey/README.md) adapter uses iovalkey with bounded command ownership; select it by helper package name. The public `@zeruxjs/cache/policy` subpath exports the same key, JSON, bulk and condition validators used by the manager, so adapter authors can enforce these limits at direct boundaries. This export does not grant distributed atomicity.

## Implementation and ownership map

- `src/types.ts` owns public helper/manager contracts; `src/policy.ts` validates bounded keys, plain JSON values and capability requirements.
- `src/memory.ts` owns each helper's LRU map, counters and lazy expiry. `src/manager.ts` owns namespace dispatch, producer coalescing and actual-settlement shutdown.
- `src/utils.ts` normalizes trusted configuration and helper factory shapes. `src/index.ts` exports the scoped factories and legacy active-manager facade.

The root entry uses Node module/path resolution; `/policy` uses Node Buffer for UTF-8 budgets. Neither entry is a browser bundle. A helper package name is executable, trusted host configuration: application-first resolution falls back to package-local import. Never derive it from a request or let untrusted administrators select arbitrary modules. `CacheError.details` retains caller-supplied details; hosts must redact private configuration before logging it.

Memory reads/writes copy JSON, but a newly produced `remember` result is the producer's original value shared by joined callers; do not mutate it as though every subscriber received a separate clone. Keep manager shutdown outside its own producer to avoid waiting on itself.
