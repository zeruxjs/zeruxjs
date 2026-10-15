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
