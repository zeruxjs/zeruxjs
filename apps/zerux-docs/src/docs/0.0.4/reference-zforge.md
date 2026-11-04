---
{
  "title": "Development tools and module registration",
  "description": "Set up zforge with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zforge",
  "sources": [
    "packages/zforge/README.md",
    "packages/zforge/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Installation and integration path

```sh
npm install zforge@0.0.4
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { registerSharedDevApp } from 'zforge';
type Registration = Parameters<typeof registerSharedDevApp>[0];
const options = { appName: 'example', appPort: 3000, rootDir: process.cwd() } satisfies Registration;
// The host owns startup and teardown when registering this application. 
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Zforge supplies shared development registration, client injection and module definitions used by the server orchestration layer. Ordinary Zerux applications normally configure their development modules through the framework rather than creating another shared server manually.

Module API/socket handlers run trusted application code. Validate origin/host and request size at the real development-server boundary; development is not permission to expose tokens or arbitrary filesystem operations to a network. Only inject the development client into responses belonging to that controlled development environment.

## Public types

```ts
import { registerSharedDevApp } from 'zforge';
type Inputs = Parameters<typeof registerSharedDevApp>;
type Result = Awaited<ReturnType<typeof registerSharedDevApp>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Avoid duplicate global registrations during reload. Use the owning module/server lifecycle and unregister callbacks where available. A shared server is a development convenience, not a public production reverse proxy. Test request abort/size limits, host matching, module loading failure and browser disconnect. Keep source paths and application metadata out of unrelated public sites.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### SharedDevRegistrationOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `appName` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `appPort` | `number` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `rootDir` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `preferredPort` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `dataFilePath` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `logFilePath` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `runtimeManifestPath` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDomains` | `string \| string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedDevDomain` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `serviceName` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `devtools` | `{ modules: Array<string \| { package: string; enabled?: boolean; options?: Record<string, unknown> }>; }` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### DevtoolsModuleConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `title` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `version` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `description` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `entry` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `assets` | `DevtoolsModuleAssetConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `server` | `DevtoolsModuleServerConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `dependencies` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `meta` | `Record<string, unknown>` | No | Passed using this declared shape; omission is allowed only when marked optional. |

## Explicit transport module ownership

The optional `zforge/modules` entry accepts an injected `zhost/protocols` kit and
mandatory host authentication. It supports actual SSE `/events` and the existing
stateless HTTP MCP tool subset at `/mcp`; native gRPC declarations reject before
startup. Each endpoint declares exact origins, bounded messages/concurrency/time
and public output fields. Loopback/forwarded headers never authenticate a caller.
A supplied Origin must match; non-browser clients still require authentication.

Await module disposal or host close. Reload disables and drains the previous module
before starting its replacement, closing old sockets/streams; failed replacement
leaves the module unavailable. Signals are cooperative and teardown waits for real
handler settlement. Legacy shared UI/HTTP/WS module registration remains separate.

`zforge/diagnostics` accepts real framework RequestSpan records through an optional
TracingAdapter. Per-app count/byte/TTL caps and generation fencing bound retention.
Headers are MIME/length only, bodies default to omitted, and normalized error codes
exclude causes/stacks. Host authorization remains required when mounting its escaped
request table. The package README and `examples/modules.mjs` describe the public
integration; importing either entry starts no server. Node ephemeral HTTP fixtures
are not browser, remote TLS or full MCP/gRPC qualification.

## Development experiment controls

`zforge/experiments` returns a registered MCP module over the shared deterministic
`ztrial/experiments` API. Production mode rejects. Explicit host authorization is
required for inspection, preview and named test callbacks; mutations also require
POST, exact Origin and host session-bound CSRF verification. Client role/group or
subject strings never grant overrides.

Previews are expiring display-only results, capped at 60 seconds and the current
credential/deadline. They do not write assignments or emit analytics. The separate
stateless evaluator preserves consent/tenant/environment gates; durable `preserve`
history is deliberately unsupported. Audit metadata excludes private traits and
raw callback output. Dispose/reload drains the generation and closes the evaluator.
The package's `examples/experiments.mjs` demonstrates public imports and explicit
policies. Host authentication/audit durability and browser UI remain integrations
that require their own acceptance checks.


## Clean source builds

The repository build planner compiles zforge's independent strict core first, then its hosting/framework owners, then the normal full strict package build. This explicit manifest metadata resolves declaration cycles for optional integrations; it does not create runtime services. Use `node scripts/build-workspaces.mjs --scope zforge` in a checkout. The intermediate `build:core` does not certify the full archive. Published consumers still select the actual optional peers and own host authorization and teardown.
