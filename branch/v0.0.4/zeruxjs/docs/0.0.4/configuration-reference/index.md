# Configuration reference

Top-level ZeruxConfig options, defaults, precedence and lifecycle effects.


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

See [zerux.config.js](/branch/v0.0.4/zeruxjs/docs/0.0.4/zerux-config.md) for an ESM JavaScript example, file precedence, environment timing and the documentation app configuration.

## Configuration handbook

Choose the section matching the service you are enabling. Every page separates runtime setup from standalone factories and includes JavaScript, TypeScript, prerequisites, failure behavior and verification.


- [Database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md)

- [Cache configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-cache.md)

- [File storage configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-files.md)

- [Analytics configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-analytics.md)

- [Queue configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-queue.md)

- [Email configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-email.md)


## Complete root option contracts

These are the declared shapes of the current source version. A type declaration is not evidence of automatic runtime consumption: `auth`, `security`, `websocket` and custom keys require checking their actual integration path. The root config has an open index signature for application extensions; unknown keys are not automatically initialized.


### ZeruxConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `files` | `import('./bootstrap/services.js').FilesStartupConfig` | No | Named storage connections; initialized before email service. |
| `email` | `import('./bootstrap/services.js').EmailStartupConfig` | No | Named SMTP providers. Never serialized into runtime manifests. |
| `analytics` | `import('./bootstrap/services.js').AnalyticsStartupConfig` | No | Best-effort telemetry backed by a named database connector. |
| `tags` | `import('./bootstrap/services.js').TagsStartupConfig` | No | GA4-style event tags and browser ttag script, managed as a private service. |
| `reports` | `import('./bootstrap/services.js').ReportsStartupConfig` | No | Authenticated internal analytics report studio. |
| `queue` | `import('./bootstrap/services.js').QueueStartupConfig` | No | BullMQ queues and optional workers. Credentials remain server-side. |
| `protocols` | `import("./protocols.js").ZeruxProtocolOptions` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `type` | `"fix" \| "dynamic" \| "function"` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `entryPoint` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `outDir` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `multisite` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `structure` | `ZeruxStructureConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `server` | `ZeruxServerConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `devtools` | `ZeruxDevtoolsConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `worker` | `ZeruxWorkerConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDomains` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDevDomain` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `connectorManager` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `db` | `DatabaseConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `database` | `DatabaseConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `websocket` | `{ enabled?: boolean; path?: string; maxPayload?: number; }` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `cache` | `{ connector?: string; options?: Record<string, unknown>; prefix?: string; defaultTtlSeconds?: number; startupTimeoutMs?: number; required?: boolean; }` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `security` | `SecurityConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `auth` | `AuthConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `theme` | `import("./theme.js").ThemeConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### DatabaseConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `default` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `connections` | `DatabaseConnection[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `connection` | `DatabaseConnection[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### DatabaseConnection

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `slug` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `connector` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `connecter` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `options` | `Record<string, unknown>` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### ZeruxStructureConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `app` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `middleware` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `controllers` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `composables` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `plugins` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `public` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `env` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### ZeruxServerConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `port` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `devPort` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDomains` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDevDomain` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### ZeruxDevtoolsConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `modules` | `Array<string \| ZeruxDevtoolsModuleConfig>` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### ZeruxDevtoolsModuleConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `package` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `enabled` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `options` | `Record<string, unknown>` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### ZeruxWorkerConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `minThreads` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxThreads` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### SecurityConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `keys` | `SecuritySaltsAndKeys` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `salts` | `SecuritySaltsAndKeys` | No | Passed using this declared shape; omission is allowed only when marked optional. |


### AuthConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |

## Additional configuration chapters

- [Tags](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-tags.md)
- [Reports](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reports.md)
- [Server](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-server.md)
- [Structure](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-structure.md)
- [Theme](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-theme.md)
- [Protocols](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-protocols.md)
- [Workers](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-workers.md)
- [Auth Security](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-auth-security.md)


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/config.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/config.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
