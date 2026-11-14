---
{
  "title": "Guide",
  "description": "Build on real rendering, data, security and service owners.",
  "navigation": "guide",
  "section": "Fundamentals",
  "order": -10,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/config.ts",
    "packages/zeruxjs/src/bootstrap/runtime.ts"
  ],
  "related": [
    "rendering",
    "database-queries",
    "configuration-handbook",
    "request-lifecycle"
  ]
}
---

## Build one boundary at a time

- [Rendering](rendering.md) and [SSR ownership](frontend-ssr.md): authored components, explicit adapters, assets and hydration limits.
- [Request lifecycle](request-lifecycle.md): generation/request cleanup and response commitment.
- [Configuration handbook](configuration-handbook.md): actual consumers versus optional standalone factories.
- [Database queries](database-queries.md): named connectors and driver-specific transaction capabilities.
- [Tenant data](tenant-data.md): verified identity at each data boundary.
- [Route-data cache](route-data-cache.md): explicit policy, invalidation and private defaults.
- [Localization](localization-site-settings.md): request locale, inert text and RTL boundaries.

## Find a package contract

The [API directory](packages.md) contains one authored guide per public package, including optional adapters. Imports never imply provider activation, consent or authorization. Required host callbacks, resource shutdown and missing live prerequisites are part of each guide.

## From a complete example

Use [the renderer/data/queue example](example-renderer-data-queue.md) to connect selected owners explicitly. Keep future roadmap tasks separate from this implemented contract.
