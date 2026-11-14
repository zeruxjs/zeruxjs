# Elasticsearch adapter

Register a bounded tenant-scoped Elasticsearch adapter without changing local search.


## Register explicitly

Install `@zeruxjs/search-elastic` on the server. It uses official client 9.5.1,
requires Node 22+, and deliberately accepts Elasticsearch 9.5.x. Imports are inert;
there is no browser client, automatic engine discovery or local fallback.

```ts
import { createElasticSearchFactory } from '@zeruxjs/search-elastic';
import { registerSearchService } from '@zeruxjs/search/adapters';

const registration = registerSearchService({
  factories: { elastic: createElasticSearchFactory({ index: 'catalog-v1' }) },
  connections: [{ name: 'catalog', backend: 'elastic',
    endpoint: 'https://search.example.com',
    allowedEndpoints: ['https://search.example.com'],
    credentials: { apiKey: process.env.ELASTIC_API_KEY! }, requirePersistent: true }],
  authorize(context) {
    // Supply the host's verified session, tenant and permission check.
    const tenant = authenticatedTenant(context);
    return tenant ? { tenant } : null;
  },
});
```

The example's `authenticatedTenant` is an application callback, not a library
function. Pass registration to framework `search:{enabled:true,registration}`,
or start it standalone and await `close()` on teardown. Basic username/password
is an alternative to an API key, always over verified TLS. CA trust and credentials
stay private; least-privilege engine credentials complement application authorization.

## Provision before ingestion

Use the direct adapter's explicit `ensureIndex(call)` with a privileged provisioner,
then use normal credentials that cannot auto-create indexes. Mappings are strict:
id keyword, text, an internal tenant keyword and at most 32 optional declared
keyword/double/boolean fields. Every data operation verifies a single compatible
index mapping. Host-owned migrations may create a versioned index, reindex and
swap an alias; no schema/alias mutation happens automatically.

Upserts and deletes use tenant-bound IDs. Queries independently AND the verified
tenant with literal text and allowlisted filters. Unknown fields, raw DSL,
case-folded/null filters and unsafe integers reject. Offset pages stop at 10000;
there are no PIT/scroll cursor resources. Shared engine term statistics remain
shared even when results are tenant-filtered; use separate indexes when necessary.

## Handle outcomes and ownership

Bulk writes are not atomic. Inspect `ElasticBulkError.failures` positions/statuses
and `succeeded`, without exposing bodies or native causes. The adapter never
retries partial or ambiguous writes. Completed indexing is eventually visible,
not an immediate-refresh or exactly-once guarantee. Native sequence/primary-term
tokens from `getVersion` can guard `replaceIfVersion`; conflicts require an
application decision rather than an automatic retry.

Injected clients stay open after wrapper close. Owned clients use bounded verified
HTTPS requests and close after actual native work settles. Cancellation cannot
prove rollback. A shared manager may stop waiting at its observation deadline while the adapter still owns unsettled native work; await service close before tearing down its borrowed dependencies. Unit and disposable HTTPS fixtures cover translation, TLS and
resource ownership; real engine acceptance requires an isolated configured 9.5.x
instance, scoped API key and trusted CA. Those live prerequisites are separate
from the mock transport checks.


## Public entry points

Manifest reference for `@zeruxjs/search-elastic@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@elastic/elasticsearch": "9.5.1",
    "@zeruxjs/search": "0.0.4"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/search-elastic

Opt-in Node-only Elasticsearch adapter for the existing
[`@zeruxjs/search/adapters`](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/search/README.md#explicit-external-adapters-and-named-services)
contract. Core local search does not depend on this package. No package discovery,
listener, network access or index mutation occurs on import.

## Versions and setup

The runtime dependency is the official `@elastic/elasticsearch` **9.5.1**, requiring
**Node 22+**. This adapter deliberately accepts **Elasticsearch 9.5.x** only, probing
`info` at creation. Other engine minors/majors, OpenSearch and serverless-specific
semantics are not qualified. The official client's [compatibility guidance](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/installation)
is broader than this adapter's tested contract. The optional Arrow/ES|QL helpers
are not imported by this package's declaration surface or used at runtime.

See the minimal [public-import service example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/search-elastic/examples/service.ts). Register
`createElasticSearchFactory({index, fields})` under an explicit name using
`registerSearchService` from `@zeruxjs/search/adapters`; configure the private
connection with `endpoint`, exact `allowedEndpoints` and `credentials`. Pass that
registration to `zeruxjs` as `search:{enabled:true,registration}`, or explicitly
start/drain it standalone. Every request must use the shared manager's host
session/tenant/permission authorizer. Direct adapter methods are trusted server
APIs requiring an already verified `{tenant,signal,deadline}` call context;
they are not HTTP authentication handlers.

## Connection security and ownership

Owned clients require a root HTTPS endpoint on the exact configured allowlist,
with no URL credentials, query or fragment. Authentication is either
`{apiKey:'encoded-key'}` or `{username,password}`; mixing modes rejects. API keys
should have only the required index privileges. Basic authentication also requires
verified TLS; it is never a generic application password/login adapter.
`ca` optionally supplies a trusted PEM CA. There is no insecure TLS switch,
arbitrary SDK-options bag, sniffing or automatic retry. Deadlines/signals and
`maxRetries:0,retryOnTimeout:false` are sent on every request. Production egress,
DNS policy, proxy trust and credential rotation remain the host's responsibility.
No redirect endpoint is selected by this adapter. See official
[connection/TLS/authentication documentation](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/connecting).

`createElasticSearchAdapter({client,index,fields})` borrows an injected compatible
client. Endpoint/auth/CA options cannot accompany it: the host owns those settings
and pool policy. Requests still carry zero retries, deadlines and cancellation.
`close()` invalidates the wrapper, aborts its work and waits for actual settlement;
it closes only an owned client. Startup failures close owned resources too. A
noncooperative injected client can delay direct calls and close; use the shared
manager for an observation deadline while retaining actual pending ownership.
The wrapper retains native work in its pending set through actual settlement: a shared-manager observation timeout does not release that capacity or prove rollback. Dispose the shared service before its host-owned dependencies. Pending operations cap at 32 by default (configurable 1–128); deadlines default to
5 seconds (1–60000 ms). Response/compressed-response limits are 1 MiB for owned
clients. Injected clients must enforce transport-level limits independently.
Backend causes remain private in sanitized `SearchAdapterError.cause`; never expose
native causes, request bodies, credentials or signed URLs to callers/log labels.

## Index, mappings and migration ownership

Index/alias names match `[a-z][a-z0-9_-]{0,127}`: no wildcards, comma lists,
traversal or data streams. Provisioning is explicit: `adapter.ensureIndex(call)`
creates that exact index with `dynamic:'strict'`, `id:keyword`, `text:text`, an
internal `_zxTenant:keyword`, and at most 32 declared scalar fields
(`keyword`, `double`, `boolean`). Existing-index conflicts do not alter mappings.
Each data operation checks that exactly one concrete index has this mapping,
including unmodified keyword fields. Mapping permissions are therefore required.
No arbitrary mapping JSON, scripts, analyzers, nested objects, null values or
unsafe integer values are accepted. Decimal values use JavaScript/Elasticsearch
double precision, not exact decimal arithmetic.

Disable server auto-index creation and omit `auto_configure`/branch/v0.0.4/`create_index` from
normal writer credentials after provisioning: checking mappings cannot make a
concurrent index deletion or alias swap atomic with a write. Use a separately
privileged provisioner. Aliases must resolve to exactly one compatible index.
The host owns versioned index creation, reindexing, alias swaps and rollback;
there is no automatic migration, cluster-wide discovery or destructive cleanup.
Do not attach ingest/default/final pipelines that change these documents or tenant
fields. A hostile cluster administrator is outside this adapter's trust boundary.

## Queries and mutations

`search(query,call)` accepts bounded literal text (4096 characters), at most 16
structured filters, one declared sort and offset pagination. Text uses `match`
on the fixed `text` field with AND semantics, never `query_string`. Empty text is
`match_all`. A separate bool filter always pins `_zxTenant` to the verified tenant
digest. Returned documents are checked against it and internal metadata is removed.
Document IDs hash the tenant digest and logical ID together for all writes,
gets and deletes; equal logical IDs across tenants cannot overwrite each other.
These hashes namespace records, not prove identity. Tenant-scoped filtering does
not isolate shared engine term statistics; use dedicated indexes/clusters if that
statistical side channel matters.

Filters support eq/neq/in/exists on declared scalar fields and numeric gte/lte.
String equality is literal/case-sensitive. Case-folding, null, contains/prefix,
unknown fields and raw DSL reject; this is not local-analyzer/ranking parity.
An empty IN matches nothing. `neq` includes missing fields; exists means indexed
value present. Sort uses declared keyword/double/boolean fields and a final `id`
tie breaker; default is score then ID. Pages have 1–100 hits and `offset+limit`
at most 10000. Counts are exact only when `coverage:'exact'`; timeout, failed
shards or nonexact totals produce partial coverage. No PIT, scroll, search_after
or cursor resources are created. Deep scans are deliberately unavailable.

`index` is full-document upsert; neutral partial `update` is unsupported. Batches
contain 1–100 unique IDs and at most 1 MiB of generated NDJSON. Documents have
bounded inert scalar values and at most 128 KiB each. Deletes are tenant-bound
and missing IDs are idempotent successes. `getVersion(id,call)` exposes native
sequence/primary-term tokens; `replaceIfVersion(document,version,call)` is an
explicit full replacement with both native concurrency guards. Stale tokens throw
`ElasticConflictError`; there is no last-writer retry. Missing versioned gets
surface a redacted backend failure.

[Bulk items can fail independently](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/bulk_examples).
`ElasticBulkError` exposes only failed positions/statuses and the succeeded count,
never source bodies or native reason strings. A batch is not a transaction and
nothing is automatically replayed, including 429/503. Cancellation or lost replies
to writes have unknown outcomes and need application reconciliation/idempotence.
Successful writes return `completed` for the indexing operation, not immediate
search visibility: refresh is false and consistency is eventual. Persistence also
depends on the host's cluster durability policy, not merely this receipt. See
[official sequence/primary-term concurrency guards](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-index).

## Checks and live prerequisites

Run `npm run build --workspace=@zeruxjs/search`, then
`npm run build --workspace=@zeruxjs/search-elastic` and
`node --experimental-strip-types --test packages/@zeruxjs/search-elastic/test/*.test.ts`.
Unit fixtures cover direct input/query/mapping validation, tenant IDs/response
checks, partial failures, version conflicts, borrowed ownership and cancellation.
A disposable OpenSSL-generated local HTTPS fixture exercises the actual official
client, verified CA/auth, redirect rejection and owned socket cleanup. OpenSSL is
needed for that fixture. This is not real engine acceptance.

The separate opt-in test requires `ZX_TEST_ELASTIC_URL` for an **isolated 9.5.x**
engine, `ZX_TEST_ELASTIC_API_KEY`, and optionally `ZX_TEST_ELASTIC_CA` (CA file).
It creates/deletes only a random `zx057-*` index; credentials need those scoped
provision, mapping, read/write, refresh and delete privileges. It checks real
mapping/bulk/query/tenant/CAS/delete behavior and owns its cleanup. Without these
settings it reports a skip. No live engine, shard outage, restart/recovery,
production TLS deployment or ranking-quality qualification is implied by mocks.


## Implementation sources

- [packages/@zeruxjs/search-elastic/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/search-elastic/README.md)
- [packages/@zeruxjs/search-elastic/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/search-elastic/src/index.ts)
- [packages/@zeruxjs/search-elastic/examples/service.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/search-elastic/examples/service.ts)
