# Fonts

Generate font-face CSS while keeping binary hosting and browser lifecycle explicit.


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


## Public entry points

Manifest reference for `@zeruxjs/font@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./http": "./dist/http.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/font

Modular font-face generation and browser font loading.

```ts
import { createFontRegistry, fontPreload, loadFont } from "@zeruxjs/font";
const fonts = createFontRegistry();
fonts.add("regular", { family: "Inter", sources: [{ url: "/fonts/inter.woff2", format: "woff2" }] });
const css = fonts.css();
```

The registry generates CSS; it does not download or bundle font files. Sources are validated, and browser font loading requires a DOM.

## Font stylesheet endpoint (Section 39)

```ts
import { createFontRegistry } from '@zeruxjs/font';
import { createFontStylesheetHandler } from '@zeruxjs/font/http';
const registry = createFontRegistry();
registry.add('ui', { family: 'Inter', sources: [{ url: '/fonts/inter.woff2', format: 'woff2' }] });
const endpoint = createFontStylesheetHandler({ registry, preloadKeys: ['ui'], cacheSeconds: 600 });
```

Generates a CSS `@font-face` stylesheet with ETag/304 and HEAD, optional bounded `Link: preload` headers and cache policy. Font binary hosting, licensing, Content Security Policy and font optimization remain application/deployment responsibilities. Only trusted font definitions should be registered.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/font/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/font/README.md)
- [packages/@zeruxjs/font/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/font/package.json)
