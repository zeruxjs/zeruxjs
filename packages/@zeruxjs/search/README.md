# @zeruxjs/search

Dependency-free, Unicode-aware in-memory search index. Separate modules for types, tokenization, query parsing, indexing, and relevance scoring.

```ts
import { createSearchIndex, parseSearchQuery, highlightMatches } from '@zeruxjs/search';
const index = createSearchIndex({ fields: ['text'], maxDocuments: 10000 });
index.add({ id: 'docs/1', text: 'Getting started with ZeruxJS' });
const results = index.search('zeruxjs', { limit: 10, prefix: true });
const terms = parseSearchQuery('Hello ZeruxJS');
const safeHtml = highlightMatches('<Hello ZeruxJS>', terms);
const snapshot = index.snapshot();
index.load(snapshot);
```

Features: BM25-style relevance, weighted text fields, stopwords, prefix suggestions, filtering, pagination, replacement and removal, defensive document cloning, JSON-serializable snapshots. The index is in memory; persistence and cross-process coordination are the application's responsibility. `highlightMatches` escapes untrusted input by default.

## HTTP search and durable snapshots (Section 39)

The core index remains framework-neutral. Its Node-only HTTP and persistence helpers are separate exports to avoid importing filesystem or crypto modules into browser bundles.

```ts
import { createSearchIndex } from '@zeruxjs/search';
import { createSearchHandler } from '@zeruxjs/search/http';
import { saveSearchSnapshot, loadSearchSnapshot } from '@zeruxjs/search/persistence';

const index = createSearchIndex({ fields: ['text'], maxDocuments: 10000 });
index.add({ id: 'docs/1', text: 'ZeruxJS framework search' });
const search = createSearchHandler({index, maxResults: 50, cacheSeconds: 30});
const response = search(new Request('http://localhost/search?q=framework'));
await saveSearchSnapshot('/private/data/search.json', index);
await loadSearchSnapshot('/private/data/search.json', index);
```

HTTP search bounds pagination and query length; supports GET, HEAD, search suggestions, projection, `ETag`/304, and explicit cache lifetimes. **Never use a shared cache with a visibility filter**, and suggestions are disabled for filtered indexes to avoid revealing hidden vocabulary. Authenticated requests use `Cache-Control: no-store`. Without a field projection, the entire matching document is returned; do not index private fields for a public endpoint.

Atomic filesystem snapshots are single-writer and local; the parent directory must exist and must not contain symlinks. They are not distributed transactions or a database replacement.
