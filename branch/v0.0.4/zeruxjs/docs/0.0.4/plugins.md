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

## Translate a plugin

Publish domain-isolated locale catalogs and receive the host-selected translator instead of owning a global language. The [module/plugin translation guide](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-package-authoring.md) explains packaging, explicit imports and typed route integration. The [site language guide](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-site-settings.md) covers host settings and request isolation.

## Explicit module registration

Use `registerModule(api, definition)` from `zeruxjs/modules` inside the awaited
entry/plugin registration function. `defineProvider`, `createProviderToken` and
`defineController` retain provider/dependency and Standard Schema output types.
The package README contains a minimal validator-backed greeting controller.
Factories and provider instances stay private to that generation; nothing is
scanned or activated on import.

Provider scopes are generation singleton, request and transient. Dependencies are
module-local and explicit; missing/cyclic graphs and singleton captures of shorter
scopes reject before construction. Lazy construction shares cached in-flight work;
only explicit eager singletons run during registration. Factory `onDispose`
handles partial acquisition; scope disposal releases dependents first and continues
through cleanup errors. Framework managers borrowed through `api.service` retain
their original ownership.

Existing global/route middleware runs before module guards, schema input pipes,
module middleware and the controller. Guards require exactly true and do not get
a provider resolver; denied or invalid input cannot construct controller providers.
Reuse auth session verification, tenant authorization and the HTTP origin/CSRF/rate
policies. A Standard Schema pipe supplies transformed handler input without
changing the original context body. Exception filters can return handler results,
write an explicit response, or throw an `ApplicationError`; unhandled failures use
the framework's sanitized API envelope.

Request scopes reuse lifecycle cancellation and live through streamed responses;
disconnect signals cooperative factories/handlers and disposal waits for actual
settlement. `api.onDispose` now registers explicit generation teardown, including
failed preparation. It does not interpret arbitrary plugin return values.
`api.hasRoute` supports collision preflight. Modules reject exact existing routes;
later-discovered file conflicts fail preparation and reserved service routes stay
protected. Static module paths coexist with existing dynamic file routing; this
layer requires no decorators and promises no full external framework parity.

## Explicit service endpoints and pinned outbox hooks

`zeruxjs/service-endpoints` exports `registerServiceEndpoints`, `defineServiceEndpoint`,
`createServiceClient` and `createTransactionalOutbox`. Register an explicit endpoint
group in an entry/plugin; its startup worker starts zhost-owned HTTP/WS adapters
and its generation disposer closes them. Programmatic owners explicitly start the
returned group. Names, independent numeric-IP/port binds, authorization and full
resource limits are required; duplicate binds and failed startup roll back through
zhost. No arbitrary installed packages or optional transports are discovered.

The typed client is a fixed-destination bounded JSON POST transport with required
response schema, egress decision and injected Fetch-compatible transport. The host
owns TLS/DNS/egress and authentication, including DNS rebinding protection; an
origin predicate alone is insufficient. Retries require declared idempotence and
are capped at three attempts inside one deadline. Close cancels and drains actual
work. `x-zerux-deadline` only shortens zhost policy; it is never authentication.

The outbox hook requires a real negotiated pinned database transaction and supplies
that same facade to both business work and the journal writer. It bounds and awaits
all enqueues, rejects unsupported adapters, and makes journal failure roll back even
when caught by the callback. It does not create a separate transaction system or
publish messages. A durable relay, event schema, tenant/idempotency policy and live
connector acceptance remain host-owned. The package README includes a public-import
endpoint factory and the exact resource, cancellation and retry limits.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
