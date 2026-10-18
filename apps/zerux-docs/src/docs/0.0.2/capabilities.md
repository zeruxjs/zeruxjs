---
{
  "title": "Capabilities and release status",
  "description": "Choose implemented features without confusing packages, adapters and future plans.",
  "section": "Getting started",
  "order": 90,
  "sources": [
    "packages/zeruxjs/src/index.ts"
  ],
  "related": [
    "mental-model",
    "package-queue",
    "package-analytics"
  ]
}
---

These docs describe workspace source at 0.0.2, an early release. Availability is a code contract, not a statement that every deployment combination has been certified.

## Framework capabilities

| Capability | Current boundary |
| --- | --- |
| File routes and HTTP methods | Implemented in the Node runtime |
| HTML and JSON responses | Returned by application handlers |
| Middleware, controller references, plugins | Discovered/registered during generation creation |
| Startup and thread workers | Lifecycle-managed; cleanup remains application code |
| Compiled application build | Server modules and manifest, not a static-site export |
| Multisite mapping | Host/path-to-folder routing; authorization is separate |
| Fetch-compatible endpoints | Explicit adapter with streamed request/response handling |
| React/Vue adapters | State-store bridges; no automatic component rendering pipeline |
| Project generators | Current create-* packages are placeholders |
| Zenix CMS | Reserved early packages, not a complete CMS |

## Independent packages

Cache, search, feed, SEO, validation, file storage and many browser helpers can be used outside a Zerux application. Read package guides for runtime requirements: filesystem adapters are Node-only; focus/dialog helpers need a DOM; SMTP, Redis and object storage need external infrastructure.

## Durability is feature-specific

Memory caches, local search indexes, hook state and local snapshots are not distributed databases. BullMQ provides durable scheduling through Redis, but handlers are at-least-once. Analytics events are best effort. Numeric aggregates report indexed-only coverage. A shared versioned document store can coordinate control-plane writes only when the underlying store provides atomic compare-and-swap.

## Future documentation versions

Each docs version has its own Markdown content. Sources are linked on every page. When a feature changes, add or update the guide, reference contract, example and limitations together. Do not describe an intended capability as shipped simply because a package name exists.
