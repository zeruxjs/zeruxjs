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
