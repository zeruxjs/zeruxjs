# RSS, Atom and JSON feeds

Publish public content with negotiated representations and cache validators.


## Model the publication

```ts
import { createRssFeed } from '@zeruxjs/feed';
const xml = createRssFeed({ title: 'Updates', description: 'Product news',
  siteUrl: 'https://example.com', feedUrl: 'https://example.com/feed.xml',
  items: [{ id: 'release-1', title: 'First release',
    url: 'https://example.com/releases/1', date: new Date() }] });
```

Equivalent generators cover Atom 1.0 and JSON Feed 1.1. URLs must be credential-free HTTP(S); dates and enclosure sizes are validated. Keep entry IDs stable as content changes.

## Fetch publication

createFeedFetchHandler from @zeruxjs/feed/fetch supports a fixed format or Accept negotiation. It handles GET/HEAD, 405, 406, ETags, Last-Modified, Vary: Accept and public cache lifetimes. Set a maximum item count and supply a current publication function.

## Scope

Only publish content intended for all feed readers. Personalized feeds require an application-specific private response/cache policy. Feed generation does not send SSE, schedule polling or notify subscribers automatically.

## Install and select the integration

```sh
npm install @zeruxjs/feed@0.0.3
```

There is no automatic `feed` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Build a feed from published public items with stable IDs, valid HTTP(S) URLs, dates and the correct feed/site origin. Choose RSS, Atom or JSON Feed for the client population; use the Fetch helper when negotiation, HEAD and conditional responses are needed. Supply a changing content function rather than a stale array when publication can change.

## TypeScript: inputs, results and ownership

```ts
import { createRssFeed } from '@zeruxjs/feed';

type Inputs = Parameters<typeof createRssFeed>;
type Result = Awaited<ReturnType<typeof createRssFeed>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createRssFeed>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Keep public feed helpers separate from personalized/private feeds. A crawler or RSS client may cache content after publication, so do not include unpublished fields or assume later deletion revokes copies. Test Accept negotiation, 406, representation-aware Vary, ETag/304 and item/date/size limits. Feed generation does not create an SSE/WebSocket subscription.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### FeedOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `title` | `string` | No |
| `description` | `string` | No |
| `siteUrl` | `string` | No |
| `feedUrl` | `string` | Yes |
| `language` | `string` | Yes |
| `copyright` | `string` | Yes |
| `image` | `string` | Yes |
| `updated` | `string\|Date` | Yes |
| `items` | `FeedItem[]` | No |

### FeedItem

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `title` | `string` | No |
| `url` | `string` | No |
| `description` | `string` | Yes |
| `contentHtml` | `string` | Yes |
| `date` | `Date \| string` | Yes |
| `updated` | `Date \| string` | Yes |
| `author` | `string` | Yes |
| `tags` | `string[]` | Yes |
| `image` | `string` | Yes |
| `enclosure` | `{url:string;type:string;length:number}` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/feed@0.0.3`.

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./fetch": "./dist/fetch.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/feed

Modular RSS 2.0, Atom 1.0, and JSON Feed 1.1 generators.

```ts
import { createRssFeed, createAtomFeed, createJsonFeed, createFeedResponse } from '@zeruxjs/feed';
const config = {
  title: 'Updates', description: 'Product releases', siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/feed.xml',
  items: [{ id: 'release-1', title: 'Version 1', url: 'https://example.com/releases/1', date: new Date() }],
};
const xml = createRssFeed(config);
const http = createFeedResponse('rss', config, 300); // { status, headers, body }
```

Separated into types, validation/XML escaping utilities, RSS, Atom, JSON Feed, content types and HTTP helpers. URLs must be HTTP(S) and cannot contain credentials. Date and enclosure size validation are included.

## Fetch-compatible publication endpoints

```ts
import { createFeedFetchHandler } from '@zeruxjs/feed/fetch';
const feed = createFeedFetchHandler({
  feed: () => getPublishedArticles(),
  format: 'negotiate', // RSS, Atom or JSON Feed from Accept
  maxItems: 1000,
  cacheSeconds: 300
});
```

Supports GET/HEAD/405, quality-weighted Accept negotiation (406 for unacceptable types), ETag/304, Last-Modified conditional responses, representation-aware `Vary: Accept`, public caching and input limits. Supply only public feed content; personalized or authenticated feeds should be handled by application-specific private routes instead of these public helpers. This does not push SSE/WebSocket updates.


## Implementation sources

- [packages/@zeruxjs/feed/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/README.md)
- [packages/@zeruxjs/feed/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/package.json)
