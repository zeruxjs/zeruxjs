# @zeruxjs/search-mille

Explicit server-side Meilisearch adapter for
[`@zeruxjs/search/adapters`](../search/README.md#explicit-external-adapters-and-named-services).
The requested npm/path spelling is **search-mille**. This package does not change
the standalone local index or install a global search client.

## Setup and supported surface

The runtime dependency is official **`meilisearch` 0.62.0**. This adapter requires
**Node 22.12+**, probes the engine's major version, and targets **Meilisearch 1.x**.
Missing settings/features fail closed; no all-version/native qualification is
claimed. See the official [SDK compatibility and APIs](https://github.com/meilisearch/meilisearch-js).
No connection, index mutation or task starts on import.

The [public-import example](examples/service.ts) registers an explicit
`createMilleSearchFactory` with the shared manager. Configure a private named
connection with HTTPS `endpoint`, exact `allowedEndpoints`, and
`credentials:{apiKey}`; use `requirePersistent:true` if process-memory fallback
would violate requirements. The shared host authorizer must verify the session,
tenant and operation permission. Framework registration uses the existing
`search:{enabled:true,registration}` service; there is no package discovery.

`taskKey` is a stable host-owned **32-byte random secret**, and `taskScope` is a
stable, unique engine/deployment identifier. Keep both in private server
configuration and use a different scope for independent task queues. Task
references bind scope, index, native UID and verified tenant using HMAC. Retain
the same key/scope across instances/restarts when status must remain readable.
Changing either invalidates old references; no automatic key rotation or task
rediscovery occurs. Persist acceptance receipts in application-owned storage
when needed; this adapter is not a durable business outbox.

## Explicit index/settings tasks

Direct `createMilleSearchAdapter(options)` exposes privileged setup operations:

1. `createIndex(call)` enqueues creation with primary key `_zxId`.
2. `waitForTask(receipt.taskId,call)` must return `succeeded` before continuing.
3. `configureIndex(call)` enqueues supported settings; wait for that task too.

These methods are trusted server APIs, not public HTTP handlers. Hosts must
separately authorize provisioning; use a privileged setup key and narrower
normal-operation keys. Runtime keys need the search/index-info/settings-read, document write/delete and task-read permissions used by their enabled operations; a native search-only key cannot run this full adapter. Existing indexes are not silently overwritten at startup.
Before each data operation the adapter verifies the primary key and supported
settings against its configuration. Settings changes require an explicit host
migration; concurrent administrative changes are outside this check's atomicity.
Disable index auto-creation privileges for ordinary writers after provisioning.

`fields` declares at most 32 scalar string/number/boolean fields in addition to
required `id` and `text`. Strings and safe finite numbers are validated before
sending; nested objects, arrays, nulls, accessors, unknown fields and unsafe
integers reject. Searchable fields are explicit strings (default `text`);
filterable fields default to none; sortable fields default to `id` and must retain
it. Internal tenant/ID fields cannot be configured by callers. Displayed fields
are fixed to declared fields plus internal verification metadata; distinct is
disabled and maxTotalHits is 10000. Searchable order is preserved. Meilisearch is
schemaless: external writers/administrators must preserve this homogeneous data
contract too.

## Accepted versus completed

`index` is a full-document upsert, `delete` deletes tenant-bound IDs, and neutral
partial `update` rejects. Both return **`state:'accepted'` with an opaque taskId**,
not searchable completion. Batches contain 1–100 distinct logical IDs and at most
1 MiB of encoded documents/IDs; each document caps at 128 KiB. Duplicate logical
IDs within a batch reject before enqueue. Deletes of missing documents follow
native task semantics.

`taskStatus(taskId,call)` returns enqueued/processing/succeeded/failed/canceled.
`waitForTask(taskId,call,{intervalMs,maxPolls})` polls with 10–1000 ms intervals,
at most 100 polls and the same bounded operation deadline. It returns a terminal
status **including failed/canceled**; callers must inspect state. Failures expose
only allowlisted error codes and optional numeric received/indexed counts, never
native messages, bodies or credentials. Unknown error codes become `task_failed`.
Task UID/index responses are verified. Foreign/forged task references reject
before HTTP. Native task expiration/cleanup causes a backend error, never invented
success. See [official asynchronous task management](https://www.meilisearch.com/docs/reference/api/async-task-management/list-tasks).

Canceling a wait/request or closing the adapter does not cancel an already queued
engine task. A lost enqueue acknowledgement has an unknown outcome; there is no
automatic retry, exactly-once promise, task cancellation, redrive or bulk rollback.
A succeeded engine task confirms processing, not application-level transaction
atomicity or the host's backup/durability policy.

## Tenant/filter/ranking semantics

Direct calls require already verified `{tenant,signal,deadline}` context. Remote
callers must go through the host-authenticated manager/HTTP layer. Every search
ANDs a server-generated tenant digest filter outside user expressions; writes and
deletes hash tenant and logical ID into the engine primary key. Returned tenant
and composite IDs are verified and removed before returning documents. Hashes
namespace records; they do not authenticate a caller or hide shared engine term
statistics. Use dedicated indexes when stronger statistical isolation is required.

Only declared filterable attributes and eq/neq/in/exists/numeric gte/lte translate.
There is no raw filter string/DSL option. Values are validated and quoted as
literal values; an empty IN yields a server-generated contradiction. Native string
filters are **case-insensitive**, so string comparisons/IN require explicit
`caseSensitive:false`; omitted/true reject rather than pretending local exact
matching. Null, contains/prefix, control characters and unknown attributes reject.
See [official native filter semantics](https://www.meilisearch.com/docs/capabilities/filtering_sorting_faceting/advanced/filter_expression_syntax).

Text uses native `q`; typo tolerance, tokenization and ranking remain Meilisearch
semantics, with no Elasticsearch/local-score parity. No numeric relevance score
is invented. Pagination is offset based, pages 1–100 and offset+limit <=10000.
Estimated hit counts always carry `coverage:'partial'`; they are not exact totals.
Sort accepts one configured field and an ID tie key; native ordering semantics
remain authoritative. Cursors, exhaustive scans, vectors and ranking-rule editing
are deliberately unavailable.

## Transport, credentials and cleanup

Owned SDK instances require verified HTTPS root endpoints, exact allowlists and
private nonempty API keys. Redirects reject; no insecure TLS flag or arbitrary SDK
options bag is exposed. Normal OS/Node CA trust applies; a trusted injected `fetch`
may own an explicit CA/dispatcher policy. Egress/DNS controls remain host-owned.
Master/admin keys must **never** be sent to browsers. Prefer narrowly scoped
server keys. Engine search-only keys alone are not tenant authorization; native
tenant-token search rules/expiry are a separate host integration. This package
does not issue browser tokens or expose unrestricted native task APIs. See
[Meilisearch security boundaries](https://www.meilisearch.com/docs/capabilities/security/overview).

The pinned SDK's public `httpRequest` surface propagates per-call AbortSignal.
Its supported but upstream-deprecated `httpClient` hook is deliberately used for
owned instances to reject redirects and cap response bytes at **1 MiB before JSON
parsing**. No private SDK fields or global Fetch patches are used. Future SDK
upgrades require requalification of that hook. Request bodies and task failures
remain bounded/redacted; the adapter adds no retry loop except explicit status
polling. Native/injected transport causes stay private.

`client` injection borrows the official client's HTTP surface and cannot be mixed
with endpoint/key/fetch options. The host must bound that client's response parsing,
TLS/egress behavior and honor `extraRequestInit.signal`. `close()` rejects new calls,
aborts cooperative work, waits for actual settlement and zeros its copied task key.
It does not close borrowed clients or the global Fetch pool. The official SDK has
no client-close API: the adapter owns request scopes, not a dedicated socket pool.
Host-injected fetch/dispatchers remain borrowed. Deadlines default to 5000 ms
(1–60000), pending operations to 32 (1–128). A wait occupies one slot including
poll delays. Closing waits for that operation’s actual settlement before zeroing this wrapper’s key copy; it never zeroes the host’s original key buffer. Noncooperative callbacks can delay direct calls/close; the shared
manager separately bounds caller observation while retaining native ownership.

## Checks and live prerequisites

Build common search, then this package, and run
`node --experimental-strip-types --test packages/@zeruxjs/search-mille/test/*.test.ts`.
Fixtures cover accepted/completed/failed tasks, token tampering, tenant/query
isolation, invalid settings/attributes, unavailable backends, cancellation/drain,
and the actual official SDK with injected Fetch byte/error/cleanup checks.
These are not live engine or browser acceptance.

Opt-in live testing requires an **isolated** `ZX_TEST_MEILI_URL` HTTPS engine and
`ZX_TEST_MEILI_API_KEY` scoped to disposable `zx058-*` indexes/tasks. Normal Node CA
trust must validate its certificate. The test creates/configures a random index,
waits for processing, verifies search/tenant/delete behavior and awaits index
deletion in cleanup. Without those settings it reports a skip. Live failure
injection, crash recovery and all engine-version qualification remain outstanding.
