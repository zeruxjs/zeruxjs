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

## Install and select the integration

```sh
npm install @zeruxjs/font@0.0.3
```

There is no automatic `font` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Register trusted font definitions, host actual font binaries separately and generate font-face CSS from the registry. Preload only the weights/styles needed immediately; preloading every face can compete with critical resources. A registry entry does not download, subset, optimize or license a font file.

## TypeScript: inputs, results and ownership

```ts
import { createFontRegistry } from '@zeruxjs/font';

type Inputs = Parameters<typeof createFontRegistry>;
type Result = Awaited<ReturnType<typeof createFontRegistry>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createFontRegistry>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Browser loading requires a DOM and may be blocked by CSP/CORS or a missing binary. Remove injected style elements with their disposer. Verify fallback metrics and real font network responses; a generated stylesheet can be valid while the referenced font is absent. Keep third-party URL/licensing policy explicit instead of silently adding an external font service.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### FontDefinition

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `sources` | `FontSource[]` | No |
| `stretch` | `string` | Yes |
| `featureSettings` | `string` | Yes |
| `variationSettings` | `string` | Yes |

### FontSource

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `url` | `string` | No |
| `format` | `string` | Yes |

### FontFaceOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `family` | `string` | No |
| `src` | `string` | No |
| `weight` | `string \| number` | Yes |
| `style` | `string` | Yes |
| `display` | `'auto'\|'block'\|'swap'\|'fallback'\|'optional'` | Yes |
| `format` | `string` | Yes |
| `unicodeRange` | `string` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/font@0.0.3`.

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


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/font/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/font/README.md)
- [packages/@zeruxjs/font/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/font/package.json)
