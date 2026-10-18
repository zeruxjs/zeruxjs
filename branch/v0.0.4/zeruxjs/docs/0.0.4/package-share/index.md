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

## Install and select the integration

```sh
npm install @zeruxjs/share@0.0.3
```

There is no automatic `share` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Keep native sharing behind an explicit user gesture and supply validated credential-free HTTP(S) URLs. Inject share/clipboard capabilities into a controller when testing or using a custom environment. Use the outcome to tell whether a share, copy or cancellation occurred instead of assuming every resolved call sent content to another app.

## TypeScript: inputs, results and ownership

```ts
import { createShareController } from '@zeruxjs/share';

type Inputs = Parameters<typeof createShareController>;
type Result = Awaited<ReturnType<typeof createShareController>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createShareController>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Do not copy to clipboard after a user AbortError cancellation. Native share and clipboard APIs can be unavailable or denied; present a usable manual link as fallback. Third-party share links need noopener/noreferrer, and metadata helpers must escape titles/descriptions. No configuration key automatically adds share buttons to the application.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ShareData

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `url` | `string` | No |
| `title` | `string` | Yes |
| `text` | `string` | Yes |

### ShareEnvironment

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `share` | `(data:ShareData)=>Promise<void>` | Yes |
| `writeText` | `(text:string)=>Promise<void>` | Yes |
| `open` | `(url:string)=>void` | Yes |

### ShareCapabilities

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `native` | `boolean` | No |
| `clipboard` | `boolean` | No |


## Public entry points

Manifest reference for `@zeruxjs/share@0.0.3`.

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


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/share/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/README.md)
- [packages/@zeruxjs/share/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/share/package.json)
