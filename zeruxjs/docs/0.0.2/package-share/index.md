# Sharing and metadata

Use native share, clipboard fallback and safe public links without surprising cancellation behavior.


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


## Public entry points

Manifest reference for `@zeruxjs/share@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/share

Safe browser sharing, fallback handling, social share links and HTML metadata.

```ts
const controller = createShareController({
  share: data => navigator.share(data),
  writeText: text => navigator.clipboard.writeText(text)
});
const outcome = await controller.share({url:'https://example.com/post',title:'Post'});
const tags = createShareMetadata({url:'https://example.com/post',title:'Post',image:'https://example.com/image.png'});
```

The browser `shareOrCopy()` function prefers `navigator.share`, falls back to clipboard only for unavailable/not-supported/denied share operations, and **does not copy after an `AbortError` user cancellation**. It never auto-opens browser tabs. `shareLinkAttributes` sets `rel="noopener noreferrer"` on third-party links, and metadata/canonical tags escape markup. URLs must be credential-free HTTP(S). Native share/clipboard APIs typically require user gestures and permissions.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/share/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/share/README.md)
- [packages/@zeruxjs/share/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/share/package.json)
