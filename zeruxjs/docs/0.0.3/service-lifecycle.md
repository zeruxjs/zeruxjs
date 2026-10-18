# Managed service lifecycle

Configure optional managers and choose who owns startup, degradation and shutdown.


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


## Implementation sources

- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
- [packages/zeruxjs/src/bootstrap/cache.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/cache.ts)
- [packages/zeruxjs/src/bootstrap/hot-runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/hot-runtime.ts)
