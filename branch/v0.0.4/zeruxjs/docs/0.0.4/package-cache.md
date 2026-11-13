# Application caching

Cache JSON data with explicit namespaces, TTLs and ownership.


## When to use it

Use the manager when application code should not depend on a particular cache adapter. The bounded memory provider is useful for process-local acceleration; Redis is the option when multiple processes need a shared backend. Neither choice changes HTTP cache headers automatically.

## Create a manager

```ts
import { createCacheManager } from '@zeruxjs/cache';
const cache = await createCacheManager({
  helper: 'memory', prefix: 'catalog:v1', defaultTtlSeconds: 60,
  options: { maxEntries: 2000 }
});
try {
  await cache.set('product:42', { name: 'Notebook' }, { ttlSeconds: 30 });
  const product = await cache.get('product:42');
} finally {
  await cache.close();
}
```

Logical keys are unprefixed at the call site. Values are JSON-serializable; a missing key returns undefined. TTLs must be finite and positive. Defensive copying prevents callers from mutating the stored memory value accidentally.

## Load-through and concurrent misses

`remember(key, producer, options)` coalesces concurrent misses inside the same manager process. A failed producer is not cached. This does not acquire a distributed Redis lock, so two application replicas can still perform the same producer work.

## API choices

| API                                | Behavior                                                  |
| ---------------------------------- | --------------------------------------------------------- |
| `get`, `set`, `delete`, `has`      | Single logical key                                        |
| `getMany`, `setMany`, `deleteMany` | Bulk operations; not necessarily atomic                   |
| `increment`, `decrement`           | Nonnegative safe-integer amounts                          |
| `touch`                            | Refresh a positive TTL                                    |
| `clear`                            | Clear a namespace, or provider-wide clear when unprefixed |
| `remember`                         | Process-local load coalescing                             |
| `native`                           | Trusted provider-specific access                          |
| `close`                            | Release owned resources                                   |

## Invalidation and safety

Include tenant and data-version boundaries in keys. Do not include secrets or raw personal information. A prefixed clear fails closed when the adapter cannot clear that literal namespace. Avoid unprefixed clear on shared infrastructure. Use database transactions for authoritative writes, then invalidate affected cache entries; cache storage is not a transaction journal.

## Install and select the integration

```sh
npm install @zeruxjs/cache@0.0.4
```

This package participates in the runtime's **cache** integration. Start with [cache configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-cache.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Use connector in framework config and helper in the standalone manager. Choose memory for process-local development or install the Redis adapter for shared infrastructure. Set a prefix and freshness policy before inserting entries. Preserve the distinction between a missing value and cached null. Use remember for bounded load coalescing in the same process, not as a distributed lock.

## TypeScript: inputs, results and ownership

```ts
import { createCacheManager } from '@zeruxjs/cache';

type Inputs = Parameters<typeof createCacheManager>;
type Result = Awaited<ReturnType<typeof createCacheManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createCacheManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Close a standalone manager in finally; let runtime shutdown own a configured service. A required cache outage should fail deliberately, while optional-cache request paths must still fetch authoritative data. Use server-verified tenant/data-revision boundaries in keys and invalidate after a successful authoritative write. Never use cache state as the sole durable record of payment, consent or authorization.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### CacheManagerConfig

| Field               | Accepted type/value       | Optional |
| ------------------- | ------------------------- | -------- |
| `helper`            | `string`                  | No       |
| `options`           | `Record<string, unknown>` | Yes      |
| `prefix`            | `string`                  | Yes      |
| `defaultTtlSeconds` | `number`                  | Yes      |

### CacheSetOptions

| Field        | Accepted type/value | Optional |
| ------------ | ------------------- | -------- |
| `ttlSeconds` | `number`            | Yes      |
| `ifAbsent`   | `boolean`           | Yes      |
| `ifPresent`  | `boolean`           | Yes      |

### MemoryCacheOptions

| Field        | Accepted type/value | Optional |
| ------------ | ------------------- | -------- |
| `maxEntries` | `number`            | Yes      |
| `now`        | `() => number`      | Yes      |

### MemoryCacheStats

| Field       | Accepted type/value | Optional |
| ----------- | ------------------- | -------- |
| `entries`   | `number`            | No       |
| `hits`      | `number`            | No       |
| `misses`    | `number`            | No       |
| `evictions` | `number`            | No       |

## Capabilities, limits and cleanup

Scoped managers snapshot optional adapter capability metadata. Missing declarations are unknown; explicit unsupported operations reject and policy.requireCapabilities demands supported declarations. Memory supports conditions/counters/namespace clear, with unsupported bulk atomicity. Void set does not reveal a conditional miss. Provider numeric ranges/TTL/bulk failure semantics differ; no distributed guarantees are synthesized.

The package-owned CachePolicy bounds bulk count, pending remember jobs, key/value bytes and JSON depth. Memory applies equivalent direct-helper limits and evicts counter-created entries. Remember producers receive a cooperative signal/deadline; caller cancellation detaches only its waiter. Timed-out producers retain slots until settlement and cannot write late results. Close rejects stale use, aborts/drains production/native calls and closes an owned helper once. Use ownHelper:false when sharing a helper across tenant managers and close it from the host afterward. Active convenience APIs remain process-global compatibility APIs, not tenant/generation routing.

Framework cache.policy validates before provider startup. See the package README for exact defaults, numeric semantics, compatibility limits and a compiled public-import example. No live Redis/Memcached acceptance is implied by memory/injected checks.

## Source and cleanup boundaries

The manager owns namespace dispatch and pending producers; the memory helper owns its LRU map. Close managers after accepted work settles. Set `policy.ownHelper: false` when sharing a helper, then close it after all borrowing managers. Root imports use Node module resolution and `/policy` uses Buffer; keep runtime imports server-side. Helper module names are trusted executable host configuration. Memory is process-local, and void conditional writes do not provide lock-acquisition receipts. A produced `remember` value is shared by joined callers; cached reads use defensive JSON copies.


## Public entry points

Manifest reference for `@zeruxjs/cache@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./policy": {
      "types": "./dist/policy.d.ts",
      "default": "./dist/policy.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

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

`createCacheManagerWithHelper(adapter, config)` allows testing or injecting an existing adapter. `createMemoryCacheHelper({maxEntries, now})` implements LRU eviction, lazy TTL expiry, defensive JSON cloning, numeric counters, conditional `ifAbsent`/branch/v0.0.4/`ifPresent` writes, bulk methods, and stats.

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

Run package tests after building: `npm run build && node --test test/*.test.mjs`.

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

Memory advertises supported conditional writes, counters and namespace clear; multi-key atomicity is unsupported. `set`/branch/v0.0.4/`setMany` return void: a conditional miss does **not** report success/failure. Never use that void result as lock acquisition or authorization. Memory counters are signed safe integers, create missing counters at zero and preserve existing TTL. Redis uses server signed integer arithmetic (missing keys start at zero), and its native range can exceed JS precision; manager results outside safe integers reject after the server mutation, without rollback. Memcached counters require an existing numeric item and decrement clamps at zero. See [Redis integer semantics](https://redis.io/docs/latest/commands/incr/) and [Memcached text operations](https://docs.memcached.org/protocols/basic/). Their conditional writes use native NX/XX or add/replace; TTL precision and global-clear policy remain provider-owned. Bulk operations can partially succeed and must not be used as transactions.

## Runtime limits and producer lifecycle

`policy` defaults: maxBulk 1000 (maximum 10000), maxPendingProducers 64 (1024), maxKeyBytes 1024 (65536), maxValueBytes 1048576 (16777216), maxDepth 32 (64). Values must be plain JSON data, without getters, toJSON, cycles, undefined or nonfinite numbers; traversal also caps at 100000 nodes. Both input writes and returned values are bounded; logical and fully prefixed keys must fit the key budget. Direct memory helpers accept the same policy through `{policy: {...}}`, enforce bulk/key/value limits without a manager, and evict excess counter entries as well as normal writes. Native handles are privileged host-owned escape hatches; direct native mutations bypass facade guarantees. External direct helpers retain their own package limits; this facade does not certify their direct API. Smaller helper limits still apply beneath a manager.

`remember` bounds all pending miss jobs, including the initial lookup. It coalesces one job per manager/key, not across processes. The first job's TTL/condition/deadline options govern production; subsequent callers only join. Producers receive `{signal, deadline}`. timeoutMs is 1–600000; absolute deadlines must be safe integer timestamps no more than ten minutes ahead. A deadline aborts cooperative production and prevents late cache writes, but the producer retains capacity until it actually settles. A caller's signal only detaches that waiter; it does not cancel another subscriber. Manager close aborts production, rejects stale use immediately, waits for native calls/producers and closes an owned helper once. An uncooperative producer/provider can delay cleanup indefinitely; no Promise is forcibly cancelled. Failed producers are removed after settlement and can retry. Do not call close from inside that manager's own producer.

The active `cache`, get/set/remember exports and configureCacheManager are a process-global compatibility layer. Generation/request code should retain its own manager; replacing the active manager does not close the previous generation. Runtime `cache.policy` uses this package-owned contract and validates limits before service factories. No Redis/Memcached service starts until configured. Offline tests and packed public imports do not prove live-provider behavior.

### Valkey adapter and shared policy

The explicit [`@zeruxjs/cache-valkey`](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-valkey/README.md) adapter uses iovalkey with bounded command ownership; select it by helper package name. The public `@zeruxjs/cache/policy` subpath exports the same key, JSON, bulk and condition validators used by the manager, so adapter authors can enforce these limits at direct boundaries. This export does not grant distributed atomicity.

## Implementation and ownership map

- `src/types.ts` owns public helper/manager contracts; `src/policy.ts` validates bounded keys, plain JSON values and capability requirements.
- `src/memory.ts` owns each helper's LRU map, counters and lazy expiry. `src/manager.ts` owns namespace dispatch, producer coalescing and actual-settlement shutdown.
- `src/utils.ts` normalizes trusted configuration and helper factory shapes. `src/index.ts` exports the scoped factories and legacy active-manager facade.

The root entry uses Node module/path resolution; `/policy` uses Node Buffer for UTF-8 budgets. Neither entry is a browser bundle. A helper package name is executable, trusted host configuration: application-first resolution falls back to package-local import. Never derive it from a request or let untrusted administrators select arbitrary modules. `CacheError.details` retains caller-supplied details; hosts must redact private configuration before logging it.

Memory reads/writes copy JSON, but a newly produced `remember` result is the producer's original value shared by joined callers; do not mutate it as though every subscriber received a separate clone. Keep manager shutdown outside its own producer to avoid waiting on itself.


## Implementation sources

- [packages/@zeruxjs/cache/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache/README.md)
- [packages/@zeruxjs/cache/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache/package.json)
