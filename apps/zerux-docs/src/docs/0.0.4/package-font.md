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

`loadFont` returns false when no DOM/FontFaceSet exists. Native failure, invalid options, cancellation and timeout reject. Keep imports separate from invoking DOM-only helpers such as `injectFontStyles`. Include explicit fallback families and test text visibility with actual fonts; fixtures do not certify rendering quality.

## Install and select the integration

```sh
npm install @zeruxjs/font@0.0.4
```

There is no automatic `font` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Register trusted font definitions, host actual font binaries separately and generate font-face CSS from the registry. Preload only the weights/styles needed immediately; preloading every face can compete with critical resources. A registry entry does not download, subset, optimize or license a font file.

## TypeScript: inputs, results and ownership

```ts
import { createFontRegistry } from '@zeruxjs/font';

type Inputs = Parameters<typeof createFontRegistry>;
type Result = Awaited<ReturnType<typeof createFontRegistry>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createFontRegistry>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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

## Explicit build assets and provenance

Use `buildFontAssets` from `@zeruxjs/font/build` before the host framework build,
not during requests. It accepts only explicit licensed local files or an opt-in
host-injected allowlisted remote transport. Outputs are content-addressed local
font/SVG/CSS files plus a V1 attribution manifest. No files are acquired on import
and production serving of vendored output requires no provider network access.
Match `publicBase` to the actual mount, such as `/app/fonts/`; the framework copies
configured public assets but does not invoke the pipeline or inject preloads.

The host must declare redistribution permission and retain license notices. Font
container headers are checked; actual axes/subset cmap coverage require an
explicit maintained FontTools implementation. The optional supplied adapter uses
a fixed bounded POSIX Python process with shell disabled, never model/request
commands. It does not install FontTools. Synthetic header/tool fixtures do not
prove decoding, shaping or live-provider compatibility.

| Budget | Default / hard ceiling |
| --- | --- |
| Build faces / icons | 64 / 256 definitions |
| One font | 8 MiB / 16 MiB |
| Whole candidate | 64 MiB / 128 MiB |
| Preload URLs / bytes | Two / 128 KiB; ceilings 16 / 16 MiB |
| Remote redirects / deadline | Two / 15000 ms; ceilings five / 120000 ms |
| Requested subset | Explicit finite Unicode scalars; at most 65536 |

Each build owns an output lease and private sibling staging directory. Validation,
acquisition and pre-promotion quota failures preserve the previous directory.
Same-filesystem rename/rollback is not a crash-atomic deployment transaction;
operators reconcile stale locks/backups, and post-promotion cleanup may fail after
new output is committed. The host owns directory permissions, remote DNS/egress,
license correctness and serving/caching. Cooperative transport cancellation must
settle before its build resources can finish cleanup.

## Zuixs selection and browser ownership

`@zeruxjs/font/registry` supplies DOM-type-free face registration;
`@zeruxjs/font/zuix` maps explicit matching registry/build records into theme
values, a public compiler plugin and selected asset references. It imports no
Zuixs runtime or downloader. Only selected faces appear in its CSS; caller-supplied
route token lists union/deduplicate bounded preloads. User `extend.fontFamily` /
`extend.fontWeight` overrides remain authoritative. Font icons return explicit
glyph text; SVG icons remain separately licensed asset records. Neither generates
an accessible name from arbitrary content.

Use `@zeruxjs/font/browser` for native ESM browser imports without Node ambient
types. `createFontLoadScope` owns per-mount observations (default eight, ceiling
64); dispose it on teardown. Timeouts default to 10000 ms with a 120000 ms ceiling.
Cancellation ends observation and releases timers/listeners; native
FontFaceSet downloads may continue. `injectFontStyles` accepts trusted CSS under
the host CSP and returns a disposer removing only its owned element. Prefer an
external generated stylesheet when the host policy requires one. Registry values
and FontTools factory configuration have no persistent close handle.

The packed public-import examples in the package README cover local vendoring
and actual Zuixs compilation at a non-root mount. Tests use injected FontFaceSet,
remote Fetch and inspector results; native FontTools/font shaping and real
browser/provider qualification remain separate prerequisites.
