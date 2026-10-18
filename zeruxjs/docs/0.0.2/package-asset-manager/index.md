# Asset catalogs

Manage validated brand assets and variants with revision-aware updates.


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


## Public entry points

Manifest reference for `@zeruxjs/asset-manager@0.0.2`.

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

# @zeruxjs/asset-manager

Validated in-memory asset catalog for images, video, fonts, color tokens, documents and branding assets. Supports filtering, tagged assets, variant resolution, snapshots, and safe file persistence.

```ts
import { createAssetManager, saveAssetCatalog, loadAssetCatalog } from '@zeruxjs/asset-manager';
const catalog = createAssetManager();
catalog.add({id:'brand/logo',name:'Primary logo',type:'image',url:'https://cdn.example/logo.svg',
  variants:{dark:{url:'https://cdn.example/logo-dark.svg'},small:{url:'https://cdn.example/logo-sm.svg'}}});
const revision = catalog.revision;
catalog.apply([
  {action:'update',id:'brand/logo',changes:{name:'Company logo'}},
  {action:'add',asset:{id:'brand/accent',name:'Accent',type:'color',value:'#345678'}}
],revision); // atomic; throws AssetRevisionError on a stale expected revision
const dark = catalog.resolve('brand/logo','dark');
await saveAssetCatalog(catalog,'./private/assets.json');
const loaded = await loadAssetCatalog('./private/assets.json');
```

`addMany`, `import`, and `apply` stage and validate all changes before publishing. Values returned by `get`, `list`, `resolve` and `snapshot` are defensive copies. `AssetSnapshot` stays version 1 with an optional monotonic `revision`, compatible with earlier files. Variants are URL/value overrides, validated with the same restrictions as the base asset. Catalog files have an 8 MiB limit, restricted permissions, symlink checks and atomic replace; the directory must be trusted.

This is **single-process revision control**, not a distributed lock: concurrent file writers still require a lock or database transaction. URLs are metadata, not fetch permissions; the application must enforce any outbound network/SSRF and SVG sanitization policy.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/asset-manager/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/asset-manager/README.md)
- [packages/@zeruxjs/asset-manager/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/asset-manager/package.json)
