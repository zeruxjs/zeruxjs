---
{
  "title": "Search indexes",
  "description": "Build a bounded lexical index and expose a deliberate public or private search endpoint.",
  "section": "Packages",
  "order": 14,
  "sources": [
    "packages/@zeruxjs/search/README.md",
    "packages/@zeruxjs/search/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/search"
}
---

## Build an index

```ts
import { createSearchIndex } from '@zeruxjs/search';
const index = createSearchIndex({ fields: ['title', 'text'], maxDocuments: 10000 });
index.add({ id: 'guide/routing', title: 'Routing', text: 'File routes and dynamic params' });
const results = index.search('dynamic routes', { limit: 10, prefix: true });
```

The index supports relevance scoring, field weighting, replacements/removals, filters, pagination, suggestions and snapshots. Values are defensively copied. It is an in-memory index, not a synchronized search cluster.

## HTTP helper

Import createSearchHandler from @zeruxjs/search/http and register it with the Fetch bridge. It handles bounded GET/HEAD queries, projection, suggestions, cache validators and pagination. Without projection, full matching documents can be returned: index only public fields for a public endpoint.

## Private search

Never use a shared response cache when applying user/tenant visibility filters. Authenticated requests use no-store; filtered indexes disable suggestions to avoid leaking vocabulary. Apply authorization before indexing or returning protected material.

## Persistence

The Node-only persistence export saves/loads snapshots with atomic replacement and symlink checks. The parent directory must already exist. A single-writer local snapshot is not distributed coordination or an authoritative database. Rebuild from source data when the index format/content changes.
