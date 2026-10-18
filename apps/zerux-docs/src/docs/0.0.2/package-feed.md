---
{
  "title": "RSS, Atom and JSON feeds",
  "description": "Publish public content with negotiated representations and cache validators.",
  "section": "Packages",
  "order": 16,
  "sources": [
    "packages/@zeruxjs/feed/README.md",
    "packages/@zeruxjs/feed/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/feed"
}
---

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
