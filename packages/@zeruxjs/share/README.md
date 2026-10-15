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
