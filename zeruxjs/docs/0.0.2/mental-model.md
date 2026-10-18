# How ZeruxJS works

Understand the compiler, request runtime, generation lifecycle and package boundaries.


ZeruxJS is a Node server runtime that discovers application modules and combines them with explicit plugin registration. Its most useful organizing idea is a **runtime generation**: a prepared collection of routes, middleware, workers, service managers and configuration that can serve requests together.

## Three layers

| Layer | Responsibility | Examples |
| --- | --- | --- |
| Application | Domain behavior, authentication, authorization and HTML | `app/`, `middleware/`, `plugins/` |
| Framework | Discovery, request dispatch, build, generation lifecycle | `zeruxjs` |
| Ecosystem | Focused reusable capabilities, often independently usable | `@zeruxjs/cache`, `@zeruxjs/files`, `@zeruxjs/search` |

Using a package independently does not register it with your runtime. Some services support configuration-driven startup; others are explicitly constructed and registered by application code.

## Startup lifecycle

1. Load project configuration and resolve source directories.
2. Initialize database/cache and optional managed services.
3. Discover middleware, controllers, composables and file routes.
4. Run plugins and the optional entry module to register extensions.
5. Seal the runtime's route set and register reserved service endpoints.
6. Start managed workers before accepting application traffic.

A startup failure must release resources already initialized. Workers should return cleanup functions. Service managers have their own close/disconnect contracts.

## A request's route through the system

Host checks happen before application dispatch. The protocol gateway and public-file handling occur before the normal middleware-driven route path. For application routes, the runtime parses request state, runs global middleware, applies registered multisite mappings, selects a matching route, runs route middleware and serializes the result. [Request lifecycle](/zeruxjs/docs/0.0.2/request-lifecycle.md) explains the boundaries that matter for security.

## Development generations

Development builds a candidate generation before activation. A failed candidate does not replace the last working handler. Old workers and service resources have lifecycle cleanup; keep custom resources inside that ownership model. A process-global connection started at module import bypasses it.

## Compiled server versus static output

The framework compiler emits application JavaScript and a build manifest. The running Node server executes those modules when handling requests. This documentation app instead renders a finite set of known content routes to HTML during its own build. That exporter is app-specific, not a generic framework static-export feature.

## What is not implied

The project has React/Vue observable bridges and Zyro libraries, but the server runtime does not automatically provide Next-style component layouts, server actions, route caches, image optimization or a complete hydration adapter. Use the [capability map](/zeruxjs/docs/0.0.2/capabilities.md) to distinguish actual contracts from future integrations.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/runtime.ts)
- [packages/zeruxjs/src/bootstrap/hot-runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/hot-runtime.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
