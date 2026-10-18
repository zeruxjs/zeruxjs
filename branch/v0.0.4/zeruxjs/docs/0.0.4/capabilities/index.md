# Capabilities and release status

Choose implemented features without confusing packages, adapters and future plans.


These docs describe workspace source at 0.0.3, an early release. Availability is a code contract, not a statement that every deployment combination has been certified.

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

## TypeScript declarations are not feature activation

The public configuration type has an open extension signature. A custom or compatibility field can therefore pass a root typecheck while no runtime code reads it. The configuration handbook distinguishes managed service setup, explicit package factories and declared-but-not-universal switches. Check a nested known option type when validating a service object.

A package export also describes an available function, not all of its operational prerequisites. Browser functions need a DOM, Redis processors need real Redis, and host callbacks such as authorization/persistence must be supplied by the application. A callback name in an example is not a bundled identity provider.

## Evaluate a feature end to end

Start from the installed package version and its public entry point. Follow the guide's setup, run one real operation, exercise invalid input/unavailable dependencies, then verify cleanup and production output. Report which environment was exercised. Source-level type checks, injected-driver tests, a static export and a real multi-instance deployment establish different evidence.

Placeholder packages intentionally document only metadata or help/version output. Do not turn roadmap language into a deployment dependency. Use the manually configured runtime, implemented package APIs and a supported hosting model until a future release supplies the missing application behavior.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
