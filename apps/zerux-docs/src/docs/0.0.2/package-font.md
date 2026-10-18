---
{
  "title": "Fonts",
  "description": "Generate font-face CSS while keeping binary hosting and browser lifecycle explicit.",
  "section": "Packages",
  "order": 17,
  "sources": [
    "packages/@zeruxjs/font/README.md",
    "packages/@zeruxjs/font/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/font"
}
---

## Register definitions

```ts
import { createFontRegistry } from '@zeruxjs/font';
const fonts = createFontRegistry();
fonts.add('regular', { family: 'Inter', sources: [
  { url: '/fonts/inter.woff2', format: 'woff2' }
] });
const css = fonts.css();
```

The registry creates CSS from trusted definitions. It does not fetch fonts, bundle binaries or verify licensing. Host the selected files under an intentional cache/CSP policy.

## Stylesheet endpoint

createFontStylesheetHandler from @zeruxjs/font/http returns a Fetch handler with ETag/HEAD support, cache lifetimes and optional bounded preload Link headers. Preload only fonts needed for the initial page to avoid wasting network bandwidth.

## Browser loading

loadFont requires a DOM. Keep server imports separate from actually invoking browser-only functions. Browser support and font loading behavior vary; include fallback fonts and test text visibility during slow loads.
