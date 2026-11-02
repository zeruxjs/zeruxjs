---
{
  "title": "Elasticsearch adapter",
  "description": "Register a bounded tenant-scoped Elasticsearch adapter without changing local search.",
  "section": "Packages",
  "order": 14.1,
  "sources": ["packages/@zeruxjs/search-elastic/README.md", "packages/@zeruxjs/search-elastic/src/index.ts", "packages/@zeruxjs/search-elastic/examples/service.ts"],
  "related": ["package-search", "plugins"],
  "package": "@zeruxjs/search-elastic"
}
---

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
prove rollback. Unit and disposable HTTPS fixtures cover translation, TLS and
resource ownership; real engine acceptance requires an isolated configured 9.5.x
instance, scoped API key and trusted CA. Those live prerequisites are separate
from the mock transport checks.
