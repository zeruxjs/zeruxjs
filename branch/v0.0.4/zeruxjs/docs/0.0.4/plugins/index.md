# Plugins

Register routes and resources against a generation-scoped API.


## Registration

A plugin exports a default registration function (register and plugin are also recognized). Plugins run during runtime creation. The optional application entry module can register additional resources.

```ts
import type { ZeruxPluginApi } from "zeruxjs";

/** Register health endpoint. @param api Runtime API. @returns Nothing. */
export default function register(api: ZeruxPluginApi) {
  api.addRoute({ pattern: "/health", method: "GET",
    handler: () => ({ ok: true }) });
}
```

## Available operations

The API registers and removes routes, middleware and workers; sets controllers and composables; reads config and structure; exposes services, protocols, template variables and load metrics. See API reference for exported runtime interfaces.

## Reload safety

Development stages a replacement runtime before activation. A failed rebuild or worker startup leaves the last activated runtime serving. Return cleanup functions from startup workers and release resources owned by the previous generation.

## Register once per runtime generation

A plugin is startup code, not request middleware. Register routes, middleware and owned workers through the supplied API, then let the runtime create handlers. Do not open a process-global connection that survives reload unless a separate owner deliberately manages that lifetime.

```ts title="plugins/cache-status.ts"
import type { ZeruxPluginApi } from 'zeruxjs';
import { createCacheManager } from '@zeruxjs/cache';
type Cache = Awaited<ReturnType<typeof createCacheManager>>;
export default function register(api: ZeruxPluginApi): void {
  const cache = api.service<Cache>('cache');
  api.addRoute({ pattern: '/health/cache', method: 'GET',
    handler: () => ({ configured: Boolean(cache) }) });
}
```

A generic service type is a compile-time description, not a cast that starts a missing service. Configure cache in the application first; handle disabled/degraded state instead of assuming non-null. A public health response should not expose connection URLs, keys or detailed internal errors.

## Configuration and dependency boundaries

Plugin code can read api.getConfig and api.getStructure. Service bootstrap removes sensitive raw service options before public runtime config is exposed; do not keep an unsanitized config singleton and return it from a route. If a package has no managed startup key, create its resource in an explicit plugin/worker owner rather than inventing a magic top-level setting.

Use api.variables for controlled template-variable registration and api.protocols for registered gateway methods. Those APIs have their own validation, authorization and cleanup contracts. A route prefix or protocol name is not a sandbox for plugin code.

## Reload and teardown verification

Stage the replacement generation without destroying the active one on preparation failure. Startup workers can return cleanup; ordinary plugin registration is not documented as an arbitrary returned-disposer lifecycle. Use the worker/service owner for handles and test that failed startup closes resources already created.

Test duplicate route registration, overlapping service routes, disabled dependencies and an unsuccessful reload while an old request is still running. Verify that an optional integration failure is visible as degraded/disabled state rather than an apparently successful registration. See [plugin API](/branch/v0.0.4/zeruxjs/docs/0.0.4/plugin-reference.md) for the exact methods and [service lifecycle](/branch/v0.0.4/zeruxjs/docs/0.0.4/service-lifecycle.md) for reverse-order cleanup.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
