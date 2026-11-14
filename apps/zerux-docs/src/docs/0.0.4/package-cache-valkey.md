---
{
  "title": "Valkey cache adapter",
  "description": "Bounded iovalkey operations with explicit ownership and no automatic replay.",
  "navigation": "api",
  "section": "Packages",
  "order": 19,
  "sources": [
    "packages/@zeruxjs/cache-valkey/package.json",
    "packages/@zeruxjs/cache-valkey/src/index.ts",
    "packages/@zeruxjs/cache-valkey/src/helper.ts",
    "packages/@zeruxjs/cache-valkey/src/types.ts"
  ],
  "related": [
    "package-cache",
    "package-cache-redis",
    "configuration-cache"
  ],
  "package": "@zeruxjs/cache-valkey"
}
---

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
