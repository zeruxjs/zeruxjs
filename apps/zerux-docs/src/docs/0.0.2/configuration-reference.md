---
{
  "title": "Configuration reference",
  "description": "Top-level ZeruxConfig options, defaults, precedence and lifecycle effects.",
  "section": "API reference",
  "order": 10,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/config.ts",
    "packages/zeruxjs/src/bootstrap/services.ts"
  ],
  "related": [
    "configuration",
    "database-queries",
    "services"
  ]
}
---

`zerux.config.ts` exports a configuration object, usually a default export typed with `ZeruxConfig`. Configuration is application startup input, not browser configuration.

## Project and discovery

| Option | Shape / default | Behavior |
| --- | --- | --- |
| `type` | `fix`, `dynamic`, `function`; default `fix` | Structure mode |
| `entryPoint` | string; default `index` | Optional application registration module basename |
| `outDir` | string; default `.zerux` | Runtime output directory; build safety checks constrain output |
| `structure.app` | string; default `app` | File-route root |
| `structure.middleware` | string or array; default `middleware` | Global middleware discovery |
| `structure.controllers` | string or array; default `controllers` | Controller discovery |
| `structure.composables` | string or array; default `composables` | Composable discovery |
| `structure.plugins` | string or array; default `plugins` | Plugin discovery |
| `structure.public` | string or array; default `public` | Public assets |
| `structure.env` | string or array | Additional environment files |

## Server and host options

`server.port`, `server.devPort`, `server.allowedDomains` and `server.allowedDevDomain` configure the server. Runtime host checks prefer nested `server.allowedDomains` / `server.allowedDevDomain` over top-level aliases. An allowed hostname is not an authentication policy. Keep confidential assets out of public directories.

## Database and cache

`db` (with backward-compatible `database`) selects named connections. `connectorManager` defaults to the shared database manager package. `cache` takes `connector`, `options`, `prefix`, `defaultTtlSeconds`, `startupTimeoutMs` and `required`. Do not confuse runtime `cache.connector` with standalone `createCacheManager({helper})` configuration.

## Managed services

| Key | Main role | Dependencies / policy |
| --- | --- | --- |
| `files` | Named local/S3 stores | Storage credentials and application access policy |
| `email` | SMTP, optional inbound mail, tracking/preferences | Named accounts; DB/files/analytics where configured |
| `analytics` | Named DB event pipeline | Best-effort event persistence |
| `tags` | Browser/server tag manager | Analytics, destinations and explicit admin authorization |
| `reports` | Authenticated report studio | Analytics source/store and host authorization |
| `queue` | Redis/BullMQ producers/workers | Explicit Redis config, queues and optional processors |

Initialization strips private service settings before exposing runtime config. Service credentials still belong in protected server environment/secret storage. Configuration alone does not supply session authentication for dashboards.

## Workers, protocols and rendering

`worker.minThreads` and `worker.maxThreads` set thread-worker defaults. `protocols` configures gateway authorization/origins and endpoint behavior. `multisite: true` enables request registration of host/path mappings. `theme` supplies the built-in theme configuration. `websocket` controls the existing websocket integration. `devtools.modules` lists optional modules as strings or `{package,enabled,options}` objects.

## Extensibility and validation

The interface permits additional keys for extensions; accepting a key at type level does not mean a built-in implementation consumes it. Read the linked source and service types for nested options. Validate environment values at startup, and do not use configuration output as a debugging response on a public route.

## JavaScript configuration

See [zerux.config.js](zerux-config.md) for an ESM JavaScript example, file precedence, environment timing and the documentation app configuration.
