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

## Install and select the integration

```sh
npm install @zeruxjs/search@0.0.3
```

There is no automatic `search` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Choose text fields and weights, stable document IDs, document-count limits and the caller-visible scope before indexing. Replacement/removal must follow content changes. Index only data the query owner is allowed to search; filtering a result after showing a snippet can already disclose information. Use Node-only HTTP/persistence subpaths only in server bundles.

## TypeScript: inputs, results and ownership

```ts
import { createSearchIndex } from '@zeruxjs/search';

type Inputs = Parameters<typeof createSearchIndex>;
type Result = Awaited<ReturnType<typeof createSearchIndex>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createSearchIndex>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

The index and ranking state are in memory. Persist and reload a bounded snapshot when required, and coordinate writers outside the index. Inspect paging, all/any mode and prefix behavior with realistic queries. Escape highlight output and use text nodes for ordinary result labels; a search match is untrusted content, not safe HTML.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### SearchIndexOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `fields` | `(keyof T & string)[]` | Yes |
| `weights` | `Partial<Record<keyof T & string, number>>` | Yes |
| `stopWords` | `Iterable<string>` | Yes |
| `maxDocuments` | `number` | Yes |

### SearchOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `limit` | `number` | Yes |
| `offset` | `number` | Yes |
| `mode` | `'all' \| 'any'` | Yes |
| `prefix` | `boolean` | Yes |
| `filter` | `(document: SearchDocument) => boolean` | Yes |

### SearchDocument

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `text` | `string` | No |

### SearchSnapshot

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `version` | `1` | No |
| `documents` | `T[]` | No |
