# Database, cache and services

Share initialized managers through the application lifecycle.


## Database adapters

@zeruxjs/db provides the shared database layer. Adapter packages cover MongoDB, MySQL, PostgreSQL and SQLite, with db-sql-core shared by SQL adapters. Configure named connections and an explicit default rather than embedding credentials in handlers.

## Cache

The cache configuration selects a connector, options, prefix and default TTL. cache-redis supplies Redis integration. Startup timeout and required control whether missing cache infrastructure blocks startup.

## Managed services

Optional files, email, analytics, tags, reports and queue configurations initialize generation-scoped managers. Plugins access api.service(name); handlers access context.services.get(name). Service methods belong to their package APIs.

## Lifecycle ordering

Database and cache initialize before dependent managers. Resources close in reverse initialization order after prior requests finish. Analytics is best effort; email tracking is opt-in. Use queue workers for durable asynchronous jobs and thread workers for CPU work.

## Select one owner for each manager

Framework configuration creates generation-owned managers. Standalone factories create caller-owned managers. Do not configure one manager in zerux.config.js and create another pool in every route. In plugins use api.service; request service lookup returns an unknown-shaped value that must be checked and used with the real package contract.

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { createCacheManager } from '@zeruxjs/cache';
type Cache = Awaited<ReturnType<typeof createCacheManager>>;
export default function register(api: ZeruxPluginApi): void {
  const cache = api.service<Cache>('cache');
  if (!cache) return;
  api.addRoute({ pattern: '/cache-ready', method: 'GET', handler: () => ({ ready: true }) });
}
```

The type argument does not prove the manager exists. Choose whether a dependency is required during startup, then make request behavior consistent with disabled/degraded state. Health endpoints should summarize readiness without exposing private settings.

## Configuration paths

Read the dedicated chapters for [database](/zeruxjs/docs/0.0.2/configuration-database.md), [cache](/zeruxjs/docs/0.0.2/configuration-cache.md), [files](/zeruxjs/docs/0.0.2/configuration-files.md), [email](/zeruxjs/docs/0.0.2/configuration-email.md), [analytics](/zeruxjs/docs/0.0.2/configuration-analytics.md), [tags](/zeruxjs/docs/0.0.2/configuration-tags.md), [reports](/zeruxjs/docs/0.0.2/configuration-reports.md) and [queue](/zeruxjs/docs/0.0.2/configuration-queue.md). They distinguish runtime keys from standalone options and document callback dependencies.

A package without a managed startup key remains usable: instantiate it in the appropriate plugin, worker or browser component. Unknown root config properties do not trigger automatic initialization. Authentication/security helpers require explicit application enforcement rather than an empty auth/security object.

## Failures and shutdown

Initialization order follows dependencies, while shutdown drains owned resources in reverse order. Database failures and required cache/queue failures differ from best-effort analytics or optional dashboards. Test these policies deliberately instead of treating every outage as either universally fatal or silently ignored.

Keep a manager alive while its generation is serving requests, then release it at the generation boundary. Closing it in a request finally block can break simultaneous users. A static docs export does not start these services and cannot validate external database/SMTP/Redis behavior.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
