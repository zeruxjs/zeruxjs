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
