# zerux.config.js

Configure database, cache and application services, understand startup order, and distinguish runtime settings from static site metadata.


## The runtime configuration entry point

`zerux.config.js` is the application's runtime configuration entry point. Its role includes database connections, cache providers, storage, email, queues, authentication/security, workers, protocols, host restrictions and file discovery. Site metadata is only an optional application extension; it is not the primary purpose of this file.

The runtime server command performs these steps:

1. Load the standard environment files for the selected mode.
2. Find and evaluate the application configuration module.
3. Resolve project structure and load additional `structure.env` files.
4. Bootstrap the database and cache, then the other configured services.
5. Create the application runtime, including application modules and plugins.

Simply importing the config object in a script does not perform these steps. The Node server startup command owns service initialization; the static site exporter does not.

## Where it belongs

Place one configuration file at the application root, alongside its package.json. The framework checks `zerux.config.ts`, `zerux.config.js`, `zerux.config.mjs`, then `zerux.config.cjs`, and uses the first existing file. It does not merge several files. If none exists, the loader returns an empty object and runtime defaults apply. Removing a configuration file therefore does not disable application discovery.

For an ESM application with `"type": "module"`, use a default export:

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  type: 'fix',
  outDir: '.zerux',
  structure: {
    app: 'app',
    middleware: ['middleware'],
    controllers: ['controllers'],
    composables: ['composables'],
    plugins: ['plugins'],
    public: ['public'],
  },
  server: {
    port: 3000,
    allowedDomains: ['localhost', '127.0.0.1'],
  },
};
```

In a CommonJS application use `zerux.config.cjs` with `module.exports = { ... }`, or use `.mjs` for an unambiguous ESM file. The loader accepts default exports and the legacy named `zeruxConfig` / `zdevConfig` exports; prefer a default export for new applications. Configuration modules execute on the server, so keep imports deliberate and side effects minimal.

## Runtime options

`type` selects the `fix`, `dynamic` or `function` structure mode. Paths such as `structure.app`, `structure.public` and `outDir` resolve relative to the application root. The default route folder is `app`, entry module basename is `index`, and runtime output directory is `.zerux`. Middleware, controller, composable and plugin settings accept discovery directories; check the [configuration reference](/zeruxjs/docs/0.0.3/configuration-reference.md) for exact shapes.

The nested `server` object owns ports and allowed-host settings. An allowed hostname does not authenticate a visitor. Database, cache, files, email and queue configuration belongs to runtime service startup; check their guides before configuring external services. Configuration changes generally require restarting the owning runtime or rebuilding its output.

## Database and cache together

The runtime uses `db` (or the legacy `database` alias) to configure the database manager. It selects the manager package through `connectorManager`, defaulting to `@zeruxjs/db`. Connection `connector` values select adapters such as `@zeruxjs/db-pg`.

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  db: {
    default: 'main',
    connections: [{
      name: 'Application database',
      slug: 'main',
      connector: '@zeruxjs/db-pg',
      options: {
        host: process.env.DB_HOST,
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 5432),
      },
    }],
  },
  cache: {
    connector: 'memory',
    options: { maxEntries: 2000 },
    prefix: 'application:v1',
    defaultTtlSeconds: 60,
    startupTimeoutMs: 3000,
    required: true,
  },
};
```

Install the adapter and supply the database environment values before starting this example. The memory cache is process-local and does not share data between application instances. For a standalone cache manager the option is `helper`; for this runtime configuration it is `connector`.

Database initialization runs before cache initialization. A configured database initialization failure rejects startup. Cache startup uses a three-second default timeout; `required: true` makes a startup failure fatal, while an optional connector initialization/timeout failure returns no cache manager after reporting the failure. Manager-package import failures and missing factory exports still propagate; `required: false` does not suppress every configuration error. Omitting a database or cache configuration leaves that service unconfigured. See [database queries](/zeruxjs/docs/0.0.3/database-queries.md), [cache](/zeruxjs/docs/0.0.3/package-cache.md) and [managed services](/zeruxjs/docs/0.0.3/services.md) for ownership, cleanup and integration details.

## Other managed settings

| Setting | Runtime responsibility |
| --- | --- |
| `files` | Named file stores; available before email initialization |
| `email` | Email service and explicitly configured tracking/preferences |
| `analytics`, `tags`, `reports` | Analytics and its dependent integrations |
| `queue` | Explicitly enabled Redis/BullMQ integration and workers |
| `auth`, `security` | Application authentication and security configuration |
| `worker`, `protocols`, `websocket` | Worker and protocol configuration |
| `server`, `allowedDomains` | Listener and host restrictions |
| `structure`, `entryPoint`, `outDir` | Discovery and runtime output paths |

These settings are not automatically interchangeable with the standalone package factory APIs. Services have different enablement, dependency and failure policies; the [configuration reference](/zeruxjs/docs/0.0.3/configuration-reference.md) and individual guides describe them. Raw database, cache and service settings are removed from the public runtime configuration during service bootstrap. This is not permission to serialize the original config object or expose it to the browser.

## Environment values and secrets

Read credentials through `process.env` and keep them out of public asset directories, browser bundles and static Markdown. The runtime resolves standard `.env` variants and additional `structure.env` paths. The runtime server command loads standard environment files before evaluating the config, but additional `structure.env` files are loaded afterward. The build command and static exporter follow different paths; do not assume a direct import or build has loaded server environment files. Supply deployment environment variables through the hosting process and follow the environment guide for file loading order.

## The documentation application's config

The repository's `apps/zerux-docs/zerux.config.js` is a real configuration input. Its `documentation` object contains `basePath`, `origin`, `latest`, versions, section order and repository metadata. `src/site.config.mjs` imports this object, and the static builder, Markdown exporter, links and preview use those values.

The static exporter imports this object directly and consumes only `documentation`: it does **not** call runtime service initialization. Adding `db`, `cache` or other service settings here would not start those services during docs builds or on GitHub Pages. The docs site currently requires no database or cache connection. A future server-backed docs application must use the real runtime startup path and keep its backend separate from the static Pages output.

`documentation` is an **app-specific extension**, allowed by the public config type; it is not a built-in static-export API of ZeruxJS. `outDir: '.zerux'` remains the runtime output setting. This app's static exporter writes `dist/`, and the shared site builder mounts it under `/zeruxjs/` before GitHub Pages deployment. Run `npm run build` from the docs application or `pages/` for the complete ecosystem site. `zerux build` compiles Node server applications and does not replace this exporter.

## Styling and site metadata

Zuixs settings remain in `zuix.config.mjs`. Prefer utilities directly in template classes. Optional recipes compose utilities for resets or generated Markdown elements; they are not required for ordinary components. A custom application namespace does not cause the framework to consume another tool's configuration automatically.

Set `documentation.origin` to the public origin to emit canonical URLs and the documentation sitemap. Set `documentation.basePath` to the mounted app path; the combined builder's site mount must agree with it. Archive version references before changing release versions, as described in the documentation application README.

## TypeScript application setup

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
const cache = {
  connector: 'memory', options: { maxEntries: 1000 },
  prefix: 'application:v1', defaultTtlSeconds: 60,
} satisfies NonNullable<ZeruxConfig['cache']>;
export default { type: 'fix', cache } satisfies ZeruxConfig;
```

Keep a single active config file and check nested service objects as well as the root. The root type permits application-specific extensions, so a misspelled unknown top-level property may still be accepted. TypeScript does not validate environment strings or initialize a service. Read the [complete configuration handbook](/zeruxjs/docs/0.0.3/configuration-handbook.md) and [TypeScript guide](/zeruxjs/docs/0.0.3/typescript.md) for full application and package setup.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [apps/zerux-docs/zerux.config.js](https://github.com/zeruxjs/zeruxjs/blob/master/apps/zerux-docs/zerux.config.js)
- [apps/zerux-docs/src/site.config.mjs](https://github.com/zeruxjs/zeruxjs/blob/master/apps/zerux-docs/src/site.config.mjs)
