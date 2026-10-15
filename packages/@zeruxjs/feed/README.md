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
