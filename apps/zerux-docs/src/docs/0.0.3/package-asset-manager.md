---
{
  "title": "Asset catalogs",
  "description": "Manage validated brand assets and variants with revision-aware updates.",
  "section": "Packages",
  "order": 18,
  "sources": [
    "packages/@zeruxjs/asset-manager/README.md",
    "packages/@zeruxjs/asset-manager/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/asset-manager"
}
---

## Catalog versus storage

An asset catalog records URLs, colors, types, tags and variants. It does not upload bytes, authorize remote fetches or sanitize the resource at a URL. Combine it with files/media when binary ownership is needed.

```ts
import { createAssetManager } from '@zeruxjs/asset-manager';
const assets = createAssetManager();
assets.add({ id: 'brand/logo', name: 'Logo', type: 'image',
  url: 'https://cdn.example.com/logo.svg',
  variants: { dark: { url: 'https://cdn.example.com/logo-dark.svg' } } });
const dark = assets.resolve('brand/logo', 'dark');
```

## Atomic catalog changes

addMany, import and apply stage changes before publishing them. apply accepts an expected revision and rejects stale updates. Get/list/resolve/snapshot return defensive copies. These are single-process consistency controls, not a shared distributed lock.

## Persistence

saveAssetCatalog/loadAssetCatalog use bounded snapshots, restricted permissions, symlink checks and atomic replacement. Serialize multiple writers or use a database. Metadata URLs remain subject to application SSRF, rendering and SVG/content policies.

## Install and select the integration

```sh
npm install @zeruxjs/asset-manager@0.0.3
```

There is no automatic `asset-manager` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Use the catalog for metadata and brand variants, not as an upload store. Add validated assets with stable IDs; use variants for a dark logo or smaller rendition without duplicating the logical asset. Batch add/import/apply operations stage and validate the entire change before publishing it. Pass the expected revision when making edits based on a previously read snapshot.

## TypeScript: inputs, results and ownership

```ts
import { createAssetManager } from '@zeruxjs/asset-manager';

type Inputs = Parameters<typeof createAssetManager>;
type Result = Awaited<ReturnType<typeof createAssetManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createAssetManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

A revision conflict means another edit won; reload and reconcile instead of silently overwriting it. Returned values are defensive copies. Snapshot persistence is bounded and atomic within a trusted directory, but concurrent writers still need coordination. A URL in a catalog does not authorize fetching it or make SVG/remote content safe to render.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### Asset

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `name` | `string` | No |
| `type` | `'image'\|'video'\|'font'\|'color'\|'document'\|'other'` | No |
| `url` | `string` | Yes |
| `value` | `string` | Yes |
| `tags` | `string[]` | Yes |
| `metadata` | `Record<string,string>` | Yes |
| `variants` | `Record<string, AssetVariant>` | Yes |

### AssetVariant

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `url` | `string` | Yes |
| `value` | `string` | Yes |
| `metadata` | `Record<string,string>` | Yes |

### AssetFilter

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `type` | `Asset['type']` | Yes |
| `tag` | `string` | Yes |
| `query` | `string` | Yes |
| `limit` | `number` | Yes |
| `offset` | `number` | Yes |

### AssetSnapshot

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `version` | `1` | No |
| `assets` | `Asset[]` | No |
| `revision` | `number` | Yes |
