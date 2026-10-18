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
