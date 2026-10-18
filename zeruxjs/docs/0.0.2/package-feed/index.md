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


## Public entry points

Manifest reference for `@zeruxjs/feed@0.0.2`.

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

## Fetch-compatible publication endpoints (Section 39)

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

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/feed/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/feed/README.md)
- [packages/@zeruxjs/feed/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/feed/package.json)
