# Valkey cache adapter

Bounded iovalkey operations with explicit ownership and no automatic replay.


## Install and activate explicitly

`@zeruxjs/cache-valkey@0.0.4` is a Node-only adapter using pinned iovalkey 0.4.0. Importing it opens no connection. The adapter was selected for command/Cluster compatibility and explicit offline/replay controls; no superiority or engine-version parity is claimed over Valkey GLIDE. Verify the installed source/export map when using an unpublished workspace change.

```js
import { createCacheHelper } from '@zeruxjs/cache-valkey';
if (!process.env.VALKEY_URL) throw Error('Configure an isolated Valkey endpoint');
const helper = await createCacheHelper({
  url: process.env.VALKEY_URL, commandTimeoutMs: 3000,
});
try {
  await helper.set('tutorial:public:greeting', { text: 'Hello' }, { ttlSeconds: 60 });
  console.log(await helper.get('tutorial:public:greeting'));
} finally {
  await helper.close();
  await helper.whenClosed();
}
```

Use an isolated configured endpoint, `rediss://` for TLS, and verified application/tenant namespace derivation for private data. Prefixes do not authorize a caller. Framework activation is explicit `cache.connector:'@zeruxjs/cache-valkey'` with private `cache.options`; this does not make Valkey a BullMQ worker connection or a rate-limit store.

## Capabilities and failure behavior

Conditional writes, counters and namespace clear are declared; bulk atomicity is unsupported. JSON/key/depth/bulk/pending/SCAN budgets bound work. NX/XX conditions are atomic but the compatible void set API does not report a condition miss. Cluster scans current masters with single-key routed commands; no cross-slot transaction is implied. FLUSHDB requires standalone explicit approval and is unavailable on Cluster.

Owned clients disable offline queueing, automatic unfulfilled-command replay and per-request retries. Reconnects have a finite configured budget; Cluster redirects are deliberately disabled. TLS verification cannot be disabled. Operation signals/deadlines stop observation/subsequent bulk work, not an already dispatched write; unknown write outcomes are explicit and never automatically replayed.

## Ownership and diagnostics

Injected clients are borrowed unless `ownClient:true` and must meet the safe native-policy checks. Close rejects further wrapper calls and drains actual work; it never closes a borrowed client. `whenClosed` is the actual cleanup barrier. The privileged native client bypasses wrapper policy. Redacted operation hooks contain no keys, values, credentials or endpoint labels and have bounded asynchronous backlog.

## Verification scope

Existing fixtures use an actual iovalkey client against a local RESP fixture and injected contracts; they do not qualify a real Valkey/TLS/ACL/Cluster deployment. No service is started by this documentation build. See the linked package README for exact limits and native deployment prerequisites.

## Source ownership

`types.ts` owns structural contracts; `index.ts` owns explicit connection/TLS policy, lazy driver selection and acquisition rollback. `helper.ts` owns bounded native work, shared inert JSON validation and separate close/settlement receipts. The public scoped example closes its manager before awaiting helper cleanup. No native handle, credential or arbitrary error cause belongs in browser configuration. Custom host-created error codes also require redaction.


## Public entry points

Manifest reference for `@zeruxjs/cache-valkey@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@zeruxjs/cache": "0.0.4",
    "iovalkey": "0.4.0"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/cache-valkey

Explicit Node.js Valkey adapter for `@zeruxjs/cache`, using pinned **iovalkey 0.4.0**. Importing the package opens no connections. Node 20+ is required; this is not a browser entry point.

## Client choice

[iovalkey](https://github.com/valkey-io/iovalkey) is the Valkey project's JavaScript fork of ioredis. Its familiar command/Cluster model and explicit offline-queue/replay controls fit the existing cache contract without native platform binaries. [Valkey GLIDE](https://glide.valkey.io/languages/nodejs/api/) is another maintained official client with a shared Rust core; it is not installed or wrapped here. This choice makes no throughput, backend-version parity or superiority claim.

## Minimal example

```ts
import { createCacheHelper } from '@zeruxjs/cache-valkey';
import { createCacheManagerWithHelper } from '@zeruxjs/cache';

const helper = await createCacheHelper({
  url: 'redis://127.0.0.1:6379', // use rediss:// for TLS
  commandTimeoutMs: 3000,
});
const cache = createCacheManagerWithHelper(helper, { prefix: 'my-app:tenant-42' });
try {
  await cache.set('greeting', { text: 'Hello' }, { ttlSeconds: 60 });
  console.log(await cache.get('greeting'));
} finally {
  await cache.close();
  await helper.whenClosed();
}
```

Derive prefixes from verified application/tenant identity. A prefix is isolation by convention, not authorization. Framework configuration can explicitly select `cache.connector: '@zeruxjs/cache-valkey'` with connection settings in `cache.options`; the existing cache manager also accepts `helper: '@zeruxjs/cache-valkey'`. No Redis/BullMQ worker or distributed rate-limit store is inferred.

## Semantics and limits

Values are bounded plain JSON. Safe integer numbers, finite fractional numbers, arrays and objects are supported; functions, cyclic values and unsafe integers reject. Native numeric counters require integer-compatible stored JSON and return safe JS integers; a range error after mutation has an unknown write outcome. Strings containing large numeric identifiers remain strings. `SET NX/XX` implements conditional writes atomically, but the compatible void `set` API does not expose a condition miss. Conflicting conditions reject before dispatch. Positive fractional TTL seconds round up; native EX is capped at 2147483647 seconds. Missing reads return `undefined`.

Defaults: 64 pending native operations, 3000ms command observation deadline, 5000ms shutdown deadline, 10000 SCAN pages; shared cache policy defaults bound keys, JSON depth/bytes and bulk size. Configure `valueLimits`, `maxPendingCommands`, `maxScanPages`, `commandTimeoutMs` and `shutdownTimeoutMs` explicitly. Bulk commands are serial per-key and **not atomic**. Namespace clear escapes glob syntax and checks literal prefixes, but is not a snapshot under concurrent writers. Cluster scans every current master and uses routed single-key commands, never cross-slot bulk transactions. Global FLUSHDB is disabled unless `allowFlushDb: true` on a standalone client; it stays unavailable on Cluster.

Each direct helper operation accepts `{ signal, deadline }` (absolute epoch milliseconds); `set` combines these with its normal options. Cancellation/deadline stops waiting and prevents subsequent bulk commands, not an already-issued write. Such writes report `details.writeOutcome: 'unknown'` and are never automatically replayed. Native capacity remains occupied until actual settlement. Host code must reconcile ambiguous writes before retrying.

New clients disable offline queues, automatic unfulfilled-command replay and per-request retries. Reconnect attempts default to zero; `maxReconnectAttempts` allows a finite lifetime budget up to three. Cluster redirects are deliberately disabled (`maxRedirections: 0`), so MOVED/ASK during topology changes fails visibly instead of hiding a replay. Sentinel, native option passthrough and queue-specific policies are unavailable. TLS certificate verification cannot be disabled.

## Ownership and diagnostics

`createCacheHelper({ client })` and `createValkeyCacheHelper(client)` borrow a client by default. Injected clients must expose safe options: `enableOfflineQueue: false`, `autoResendUnfulfilledCommands: false`, `maxRetriesPerRequest: 0`, no key prefix and no reconnect-on-error policy. Cluster additionally requires master reads, no offline queue and zero redirections. `ownClient: true` explicitly transfers shutdown ownership.

Close invalidates all wrapper methods and drains actual work before closing an owned client. It never closes a borrowed client. A shutdown deadline may force an owned client disconnect; `whenClosed()` is the actual cleanup barrier and can remain pending for a noncooperative borrowed client. Never share an owned handle across managers. The privileged `native` handle bypasses wrapper policy.

`onOperation` receives fixed operation labels, duration/outcome/error codes and unknown-write status, with no keys, values, credentials or endpoint labels. At most four asynchronous hook calls are retained; hook errors are isolated and overload is counted by `getDiagnostics()`. Keep native error causes in trusted diagnostics only; exported error messages are redacted. No telemetry begins on import.

## Verification

`npm run build --workspace=@zeruxjs/cache-valkey` and `npm test --workspace=@zeruxjs/cache-valkey` exercise direct/manager contracts, tenant separation, deadlines/cleanup, Cluster namespace behavior and an actual iovalkey connection against a local RESP fixture. That fixture is not live Valkey or Cluster acceptance. Dedicated Valkey/TLS/ACL/Cluster deployments are still required for native deployment qualification.

## Implementation and ownership map

- `src/types.ts` owns structural native-client and package policy contracts. It does not import a driver or open a connection.
- `src/index.ts` owns validated endpoint/TLS selection, fixed lazy driver loading, explicit constructor injection and startup rollback. Factory-owned native clients enforce no replay/offline queueing; injected clients must already expose compatible policy.
- `src/helper.ts` owns shared-cache JSON validation, native result checks, admitted work, bounded hook observations and the separate close/actual-settlement receipts.
- `examples/scoped.ts` demonstrates public imports and manager-before-helper cleanup with an explicitly supplied host URL.

Root runtime imports require Node; type-only imports erase safely. Host configuration is trusted executable configuration, and native handles bypass the wrapper. Internal error codes are fixed and value-free; passing private data as a host-created ValkeyCacheError code would expose it, so keep custom codes bounded/public and causes private. Shutdown does not force-cancel JavaScript or prove ambiguous native writes rolled back.


## Implementation sources

- [packages/@zeruxjs/cache-valkey/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-valkey/package.json)
- [packages/@zeruxjs/cache-valkey/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-valkey/src/index.ts)
- [packages/@zeruxjs/cache-valkey/src/helper.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-valkey/src/helper.ts)
- [packages/@zeruxjs/cache-valkey/src/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/cache-valkey/src/types.ts)
