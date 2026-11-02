# Guide

Build on real rendering, data, security and service owners.


## Build one boundary at a time

- [Rendering](/branch/v0.0.4/zeruxjs/docs/0.0.4/rendering.md) and [SSR ownership](/branch/v0.0.4/zeruxjs/docs/0.0.4/frontend-ssr.md): authored components, explicit adapters, assets and hydration limits.
- [Request lifecycle](/branch/v0.0.4/zeruxjs/docs/0.0.4/request-lifecycle.md): generation/request cleanup and response commitment.
- [Configuration handbook](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-handbook.md): actual consumers versus optional standalone factories.
- [Database queries](/branch/v0.0.4/zeruxjs/docs/0.0.4/database-queries.md): named connectors and driver-specific transaction capabilities.
- [Tenant data](/branch/v0.0.4/zeruxjs/docs/0.0.4/tenant-data.md): verified identity at each data boundary.
- [Route-data cache](/branch/v0.0.4/zeruxjs/docs/0.0.4/route-data-cache.md): explicit policy, invalidation and private defaults.
- [Localization](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-site-settings.md): request locale, inert text and RTL boundaries.

## Find a package contract

The [API directory](/branch/v0.0.4/zeruxjs/docs/0.0.4/packages.md) contains one authored guide per public package, including optional adapters. Imports never imply provider activation, consent or authorization. Required host callbacks, resource shutdown and missing live prerequisites are part of each guide.

## From a complete example

Use [the renderer/data/queue example](/branch/v0.0.4/zeruxjs/docs/0.0.4/example-renderer-data-queue.md) to connect selected owners explicitly. Keep future roadmap tasks separate from this implemented contract.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/runtime.ts)
