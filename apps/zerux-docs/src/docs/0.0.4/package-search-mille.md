---
{
  "title": "Meilisearch adapter",
  "description": "Use bounded tenant-scoped Meilisearch queries and explicit asynchronous task receipts.",
  "section": "Packages",
  "order": 14.2,
  "sources": ["packages/@zeruxjs/search-mille/README.md", "packages/@zeruxjs/search-mille/src/index.ts", "packages/@zeruxjs/search-mille/examples/service.ts"],
  "related": ["package-search", "package-search-elastic", "plugins"],
  "package": "@zeruxjs/search-mille"
}
---

## Register the requested package

The package is named `@zeruxjs/search-mille`. It uses official SDK 0.62.0,
requires Node 22.12+, and targets Meilisearch 1.x without claiming every feature
or version has live qualification. Imports open no connections.

```ts
import {createMilleSearchFactory} from '@zeruxjs/search-mille';
import {registerSearchService} from '@zeruxjs/search/adapters';

const registration = registerSearchService({
  factories: {mille: createMilleSearchFactory({
    index: 'catalog', taskKey: hostTaskKey, taskScope: 'production-search',
    fields: {category: 'string'}, filterable: ['category'],
  })},
  connections: [{name:'catalog',backend:'mille',endpoint:'https://search.example.com',
    allowedEndpoints:['https://search.example.com'],
    credentials:{apiKey:process.env.MEILI_API_KEY!}, requirePersistent:true}],
  authorize(context) {
    const tenant = verifiedTenant(context);
    return tenant ? {tenant} : null;
  },
});
```

`hostTaskKey` is a stable private 32-byte random host secret; `verifiedTenant` is
host authentication/authorization, not a supplied library helper. Choose a distinct
stable taskScope for each independent engine. Register with framework
`search:{enabled:true,registration}` or start/drain standalone. Master/admin keys
never belong in browser configuration. No automatic fallback is installed.

## Treat task acceptance separately

Index creation, settings changes, document upserts and deletes enqueue native
tasks. An accepted receipt does not mean the data is searchable. Direct adapters
expose createIndex/configureIndex plus taskStatus/waitForTask. Wait for setup tasks
to succeed before ingestion, and inspect terminal state: failed/canceled are
terminal outcomes too. Task references are tenant/index/scope-bound HMACs;
raw numeric UIDs and foreign references reject before requests.

Keep receipts in application-owned storage if status must survive request loss.
Stable key/scope allow another authorized instance to read them. Changing keys or
native task retention may make old status unavailable. Cancellation stops waiting,
not a queued engine write. Ambiguous acceptance is never automatically replayed;
this is not an exactly-once or transactional outbox implementation.

## Restrict fields and engine access

Explicit searchable/filterable/sortable lists are checked against live settings.
Every query independently ANDs the verified tenant digest; composite engine IDs
bind writes/deletes to tenant and logical ID. Returned internal fields are verified
then removed. Shared engine statistics remain shared; dedicated indexes provide
stronger isolation when required.

Filters are structured values, not a saved expression language. String filters
require `caseSensitive:false` because Meilisearch equality/IN is natively
case-insensitive. Unknown fields, raw filters, nulls, unsupported operators and
unsafe integer values reject. Counts are native estimates with partial coverage;
typo tolerance and ranking are not Elasticsearch or local-index parity.

## Own cancellation and resources

Always await close. It aborts cooperative request/wait scopes and drains actual
settlement; injected SDK clients, Fetch transports and global pools remain borrowed.
Owned requests enforce HTTPS/allowlists, redirects, deadlines and preparse response
byte limits through the pinned SDK's public transport hook. Backend/task messages
and document bodies are excluded from public diagnostics. Requalify that hook on
SDK upgrades because it is upstream-deprecated.

Fixtures exercise the official SDK with an injected transport and bounded task
states. Real acceptance requires an isolated HTTPS `ZX_TEST_MEILI_URL`, scoped API
key and trusted CA setup; without those, the dedicated disposable-index test skips.
No live browser, engine outage/restart or all-version qualification is inferred.
