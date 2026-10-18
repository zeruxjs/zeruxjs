---
{
  "title": "zenixjs",
  "description": "Current placeholder contract, installation and honest upgrade expectations.",
  "section": "Packages",
  "order": 210,
  "package": "zenixjs",
  "sources": [
    "packages/zenixjs/README.md",
    "packages/zenixjs/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Current release contract

`zenixjs@0.0.2` is a public placeholder. The package exports version/status metadata; it does not provide a working CMS or admin application. The purpose of this guide is to distinguish the published contract from future plans, not to invent setup steps that the release cannot perform.

## Install or inspect

```ts
import { version, status } from 'zenixjs';
console.log(version, status);
```

Read the returned metadata to identify the installed release. There are no database migrations, authentication screens, routing integrations or CMS service options to enable in this placeholder.

## TypeScript and configuration

The installed declarations describe only the metadata export surface. A type assertion cannot create a future CMS API. Keep application configuration typed against the real Zerux runtime if building an application manually.

There is no automatic `zenixjs` key in `zerux.config.js` that activates an unfinished feature. Use the [manual installation guide](installation.md) for a working Zerux application and the package guides for implemented storage/cache/queue functionality. Do not copy future-roadmap examples into production and assume package installation supplies their dependencies.

## Upgrading and troubleshooting

Pin the version you actually inspected. When a future release implements functionality, review its changelog, public exports, migration/data policy and configuration contract before adopting it. Existing placeholder imports are not evidence of backward-compatible CMS implementation.

If a command prints help but produces no files, that is the documented placeholder behavior. If an expected factory cannot be imported, inspect the installed version and exports instead of importing internal files. A registry name reservation and a successful tarball install do not certify a working application.
