---
{
  "title": "Managed service lifecycle",
  "description": "Configure optional managers and choose who owns startup, degradation and shutdown.",
  "section": "Data and services",
  "order": 20,
  "sources": [
    "packages/zeruxjs/src/bootstrap/services.ts",
    "packages/zeruxjs/src/bootstrap/cache.ts",
    "packages/zeruxjs/src/bootstrap/hot-runtime.ts"
  ],
  "related": [
    "services",
    "package-cache",
    "package-queue"
  ]
}
---

## Standalone package or managed service

Standalone package factories are reusable outside Zerux. You own their close/disconnect calls. A framework-managed service is constructed during generation preparation and released through the service scope. Do not construct a second competing manager solely because a package is installed.

## Framework cache configuration

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  cache: {
    connector: '@zeruxjs/cache-redis', prefix: 'shop:cache',
    options: { url: process.env.REDIS_URL },
    defaultTtlSeconds: 60, startupTimeoutMs: 3000, required: false
  }
} satisfies ZeruxConfig;
```

The runtime key is connector; the standalone createCacheManager key is helper. Bootstrap maps between them. With required false, a startup failure can leave cache unavailable rather than failing the whole application. Callers must handle an absent service. A timeout is not evidence that every remote resource stopped immediately.

## Access initialized services

Plugins use api.service(name). Handlers use context.services.get(name). These return undefined for unavailable/disabled services. Supply a type based on the actual configured service and narrow the value before use; a TypeScript generic does not validate runtime configuration.

## Resource ordering

Database/cache initialize before dependent managers. The scope tracks release functions and closes in reverse initialization order, collecting cleanup errors. Queue shutdown precedes its dependent data infrastructure. Startup rollback releases partially prepared resources; application code must still return cleanup for resources it starts itself.

## Routes and collisions

Some optional services register HTTP routes for collectors, preferences or dashboards. Registration rejects overlapping reserved endpoints instead of silently replacing application routes. Each package has its own authentication/origin/CSRF requirements. A dashboard callback is not supplied by the framework automatically.

## Configuration redaction

Private service startup settings are removed from the runtime config exposed to handlers. Managers can still contain private clients or credentials internally; do not serialize service objects. Use allowlisted status views for operations, not whole manager snapshots.

## Development and production

Development may prepare a replacement generation while the old handler is still valid. Scope objects must not be shared carelessly across generations. For production restarts/rolling deploys, plan connection budgets, draining and compatibility between old and new schemas/configuration.


## Validated custom services and reload

The public `defineService` and `createApplicationLifecycle` APIs register schema-owned namespaces and dependency-ordered resources. See the framework package README for a complete public-import example. Configuration precedence is defaults, selected file, explicit environment layer, then API/CLI overrides; undefined values do not override earlier values. Validation runs before connector factories. Unknown core keys and unregistered service namespaces are rejected.

Custom definitions declare dependencies, a Standard Schema v1 schema, required/optional policy, explicit public fields and reloadable settings fields. Keep credentials, callbacks and clients in private options; browser manifests contain only an explicit public projection. A nonce or public setting never grants authorization. Existing endpoint authentication and route collision checks remain in force.

Generations stage before activation. Required failures roll back acquired resources; optional failures report degraded status. Cleanup aborts each service signal, disposes its instance and registered callbacks, and releases dependents before dependencies. Factories and schemas are trusted executable code, not sandboxes; cleanup must be registered immediately, and cancellation remains cooperative.

Only declared custom settings fields can reload. Changing built-in configuration, private options, enabled state or executable definitions produces restart-required diagnostics. Newly evaluated definition objects also require restart. No application is restarted automatically. Failed preparation retains the previous serving generation. The programmatic lifecycle does not bind ports or launch worker entrypoints; its caller owns hosting and must close it.

## Correlation, tracing and health

Framework request handlers attach server-generated application/generation/request correlation to logs. Optional `observability.createAdapter` creates one generation-owned tracing adapter; `export` receives bounded request span records and a cancellation signal. Finish/close owns span completion once. Exporter failures and saturation do not fail requests; pending/active budgets and shutdown deadlines are explicit. Never share a direct generation-owned adapter with a replacement generation. See the framework README for the public-import example and precise budgets.

Only explicitly trusted, valid version-00 W3C trace parents are accepted. Request IDs and trace IDs are correlation data, never authentication or tenant identity. No request URL, body, cookies, headers or tenant fields are included. Zhost retains separate proxy response counters; the framework owns only application spans, so hosts must not double-wrap its handler.

Explicit JSON Accept preference or file-route `meta.api` selects `{error:{code,message,requestId}}` for framework-generated failures. Messages/codes are fixed; stacks, raw error data and causes stay private. Throw `ApplicationError(422, cause)` for validation failures. Legacy non-API response shapes remain without stack/data disclosure; package-owned responses retain their own contracts. Trusted `observability.onError` receives original errors for application-controlled private logging.

`getHealthStatus` separates liveness and readiness using service startup status. `createHealthHandler` opens no routes: hosts mount it explicitly. Public health returns a status only; diagnostics require an explicit authorizer returning true. Neither correlation IDs nor a public health response grant authorization. This does not probe live dependencies or implement vendor tracing parity.
