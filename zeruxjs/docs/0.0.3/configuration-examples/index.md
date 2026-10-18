# Complete configuration examples

Run a local service stack, add strict checking, and move to explicit production infrastructure.


## Example 1: local database, cache and private files

This example uses only local infrastructure: a SQLite file, a process-local cache and private filesystem storage. It demonstrates service startup; it does not create an application schema or authentication policy.

```sh
npm install zeruxjs @zeruxjs/typescript @zeruxjs/db @zeruxjs/db-sqlite @zeruxjs/cache @zeruxjs/files
npm install --save-dev typescript @types/node
```

Create a private directory before opening the SQLite file. On POSIX systems `mkdir -p private` is sufficient; on other systems create the same application-root directory using the platform's filesystem tools. Use a Node runtime supported by the SQLite adapter.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  type: 'fix', outDir: '.zerux',
  server: { port: 3000, allowedDomains: ['localhost', '127.0.0.1'] },
  structure: { app: 'app', plugins: ['plugins'], public: ['public'] },
  db: {
    default: 'main',
    connections: [{ name: 'Local database', slug: 'main',
      connector: '@zeruxjs/db-sqlite', options: { filename: './private/application.sqlite', driver: 'node' } }],
  },
  cache: { connector: 'memory', prefix: 'local:v1', defaultTtlSeconds: 60,
    options: { maxEntries: 1000 }, required: false },
  files: { defaultStorage: 'private', stores: [{ name: 'private', type: 'local',
    root: './private/files', allowedBuckets: ['uploads'], maxBytes: 8388608 }] },
  worker: { minThreads: 1, maxThreads: 2 },
  protocols: { enabled: false },
} satisfies ZeruxConfig;
```

For JavaScript, use the same object in `zerux.config.js`, remove the type import and `satisfies`, and add `/** @type {import('zeruxjs').ZeruxConfig} */`. Keep only one active file. The TypeScript file wins when both exist.

## Inspect optional service availability

```ts title="plugins/service-status.ts"
import type { ZeruxPluginApi } from 'zeruxjs';
export default function register(api: ZeruxPluginApi): void {
  api.addRoute({ pattern: '/health/services', method: 'GET', handler: () => ({
    database: Boolean(api.service('database')),
    cache: Boolean(api.service('cache')),
    files: Boolean(api.service('files')),
  }) });
}
```

This is a bounded summary, not an authentication mechanism or a comprehensive live readiness probe. It deliberately excludes credentials and manager configuration. Protect richer operational diagnostics through application authorization. Initialize a schema and execute a real database operation separately before calling the application ready.

## Example 2: PostgreSQL and shared Redis

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment key: ${name}`);
  return value;
}
export default {
  server: { port: 3000, allowedDomains: ['app.example.com'] },
  db: { default: 'main', connections: [{ name: 'Primary', slug: 'main',
    connector: '@zeruxjs/db-pg', options: { connectionString: required('DATABASE_URL'), max: 10 } }] },
  cache: { connector: '@zeruxjs/cache-redis', options: { url: required('REDIS_URL') },
    prefix: 'application:v1', defaultTtlSeconds: 60, startupTimeoutMs: 3000, required: false },
} satisfies ZeruxConfig;
```

Install the PostgreSQL/cache Redis adapters. Supply real environment values through the process; no secret is provided by the docs. This module validates at evaluation time, so a build/direct import also needs its required values. Standard server environment-file preload and additional structure.env timing are different paths. Choose whether early evaluation or a later owned factory is the correct validation boundary for your deployment.

Memory values do not migrate to Redis automatically. Decide TTL, invalidation and namespace versioning before switching. Database pool max is per process; multiply by replica/worker counts and keep within backend limits. TLS, credentials, network access and persistence remain real infrastructure setup, not effects of typing an options object.

## Add dependent services deliberately

Use [analytics configuration](/zeruxjs/docs/0.0.3/configuration-analytics.md) to bind events to a named database, then [tags](/zeruxjs/docs/0.0.3/configuration-tags.md) or [reports](/zeruxjs/docs/0.0.3/configuration-reports.md) for protected dependent integrations. Configure [queue](/zeruxjs/docs/0.0.3/configuration-queue.md) for durable Redis jobs; a cache connector does not create queue workers. Configure [email](/zeruxjs/docs/0.0.3/configuration-email.md) with actual accounts and consent/idempotency policy before sending.

## Validate the complete lifecycle

Typecheck, run development, perform a real service operation, exercise one outage, build, start production and shut down with active work. Inspect resource ownership and retained state after restart. The static docs pipeline compiles these examples for shape checks but does not provision or certify your external services.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
