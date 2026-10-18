# Development tools and module registration

Set up zforge with explicit lifecycle, typed public APIs and deployment boundaries.


## Installation and integration path

```sh
npm install zforge@0.0.2
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


## Public entry points

Manifest reference for `zforge@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/security": "0.0.2"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. This release uses version `0.0.2`.

# zforge


The internal development toolkit for **Zdev**. `zforge` provides the foundational infrastructure for developer tools, including the shared dev server, dev-client injection, and the devtools module registry.

## Core Capabilities

- **Shared Dev Server**: Orchestrates a single devtools server that can handle multiple Zdev applications simultaneously.
- **Client Injection**: Automatically injects development scripts and overlays into HTML responses during development mode.
- **Module Registry**: A flexible system to register and manage devtools modules, complete with API and WebSocket handlers.
- **Event Bus**: A robust event broadcaster for hot-updates and real-time communication between the server and the browser.
- **Security**: Integrated with `@zeruxjs/security` to ensure devtools access is authorized and safe.

## Key APIs

### App Registration
```typescript
import { registerSharedDevApp } from 'zforge';

const devInfo = await registerSharedDevApp({
    appName: 'my-app',
    appPort: 3000,
    rootDir: process.cwd()
});
```

### Client Injection
```typescript
import { injectDevClient } from 'zforge';

const polyfilledHtml = injectDevClient(originalHtml, {
    routeName: 'my-app',
    devServerUrl: 'http://localhost:4000'
});
```

### Module Definition
```typescript
import { defineDevtoolsModule } from 'zforge';

export default defineDevtoolsModule({
    name: 'my-module',
    // ... config and handlers
});
```

## Internal Architecture

`zforge` is designed to be the "brain" behind the Zdev development experience. It manages the lifecycle of the dev server and provides the bridge between the framework's internal services and the developer-facing dashboard.

---

<p align="center">
  Part of the Zdev Monorepo.
</p>


## Request boundaries (Section 7)

The HTTP devtools server enforces a 1 MiB streamed request-body limit via `src/request.ts`, with cleanup on completion, failure, or aborted requests. Local development hostname checks reject crafted authorities. Focused tests: `node --test test/request.test.mjs` after building. Devtools should be restricted to trusted networks; configure firewall and proxy access appropriately.

### Security and live reload diagnostics

The shared development server is loopback-only by default. To listen on a different interface, set `ZDEV_BIND_HOST` **only with trusted access controls**, such as an authenticated reverse proxy. Devtools and its APIs are not an Internet-facing administration service.

State and registry JSON files are private, bounded, atomic and reject symlink destinations. Client HTML injection escapes script-breaking values. Snapshot and bootstrap JSON include a `reload` status object containing the attempt count, generation and last failure message when available.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/zforge/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zforge/README.md)
- [packages/zforge/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zforge/package.json)
