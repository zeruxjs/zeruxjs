---
{
  "title": "create-zerux-js",
  "description": "Current placeholder contract, installation and honest upgrade expectations.",
  "section": "Packages",
  "order": 210,
  "package": "create-zerux-js",
  "sources": [
    "packages/create/create-zerux-app/README.md",
    "packages/create/create-zerux-app/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Current release contract

`create-zerux-js@0.0.2` is a public placeholder. The CLI supports help/version only and does not create an application. The purpose of this guide is to distinguish the published contract from future plans, not to invent setup steps that the release cannot perform.

## Install or inspect

```sh
npx create-zerux-js@0.0.2 --help
npx create-zerux-js@0.0.2 --version
```

A generation request exits with failure and does not create files. Do not make a deployment pipeline depend on a scaffold appearing after this command.

## TypeScript and configuration

This is a command-line placeholder, not a typed project-generation factory. A TypeScript application generated in a future release will need its own configuration and checker settings; the current CLI does not create those files.

There is no automatic `create-zerux-js` key in `zerux.config.js` that activates an unfinished feature. Use the [manual installation guide](installation.md) for a working Zerux application and the package guides for implemented storage/cache/queue functionality. Do not copy future-roadmap examples into production and assume package installation supplies their dependencies.

## Upgrading and troubleshooting

Pin the version you actually inspected. When a future release implements functionality, review its changelog, public exports, migration/data policy and configuration contract before adopting it. Existing placeholder imports are not evidence of backward-compatible CMS implementation.

If a command prints help but produces no files, that is the documented placeholder behavior. If an expected factory cannot be imported, inspect the installed version and exports instead of importing internal files. A registry name reservation and a successful tarball install do not certify a working application.
