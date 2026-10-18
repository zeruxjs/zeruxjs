---
{
  "title": "Sharing and metadata",
  "description": "Use native share, clipboard fallback and safe public links without surprising cancellation behavior.",
  "section": "Packages",
  "order": 31,
  "sources": [
    "packages/@zeruxjs/share/README.md",
    "packages/@zeruxjs/share/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/share"
}
---

## User-driven sharing

```ts
import { createShareController } from '@zeruxjs/share';
const controller = createShareController({
  share: data => navigator.share(data),
  writeText: text => navigator.clipboard.writeText(text)
});
// Invoke from an explicit user gesture:
const result = await controller.share({ url: 'https://example.com/article', title: 'Article' });
```

Native share/clipboard access needs browser permissions and usually a user gesture. Unavailable/unsupported/denied native sharing can fall back to clipboard. User AbortError cancellation must not unexpectedly copy data.

## Public URLs

URLs must be credential-free HTTP(S). Do not share session tokens or private signed links accidentally. Social links use noopener/noreferrer, and the package never opens a new browser tab automatically.

## Metadata

createShareMetadata creates escaped public metadata, not a complete SEO strategy or publication workflow. Choose the canonical URL and preview image policy in the application; private content requires separate access control.
