---
{
  "title": "Standalone reactive applications",
  "description": "Set up zyrojs with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zyrojs",
  "sources": [
    "packages/zyrojs/README.md",
    "packages/zyrojs/package.json"
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
npm install zyrojs@0.0.2
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { signal, computed, createEffectScope } from 'zyrojs';
const scope = createEffectScope();
const count = signal(0);
const doubled = scope.run(() => computed(() => count.value * 2));
count.value = 2;
console.log(doubled.value);
scope.dispose();
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Use root exports for signals/effects and focused dom/network exports for rendering or remote resources. State ownership matters: effects execute immediately, computed values are eager and subscriptions outside a scope need explicit disposal. A scope makes the route/component owner responsible for all derived work.

Standalone ZyroJS and `@zeruxjs/zyro` are different APIs. The latter is an observable bridge; do not substitute value/get/set shapes without an adapter. Signal convenience functions named like hooks are not React's dispatcher. The standalone renderer is not a complete framework router, general hydration engine or automatic HTML sanitizer.

## Public types

```ts
import { signal } from 'zyrojs';
type Inputs = Parameters<typeof signal>;
type Result = Awaited<ReturnType<typeof signal>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Dispose derived values/effects when their owner leaves. Abort remote resources on stale requests and handle network/authentication failures before updating user-visible state. Never create a shared per-user server signal singleton. Test conditional dependency changes, batching, effect cleanup, stale async completion and DOM unmount with the actual browser environment.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### ProtocolClientOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `baseUrl` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch` | `typeof fetch` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `headers` | `HeadersInit \| (() => HeadersInit \| Promise<HeadersInit>)` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `credentials` | `RequestCredentials` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `timeoutMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxResponseBytes` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### CallOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `signal` | `AbortSignal` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `headers` | `HeadersInit` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### EventStreamOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `headers` | `HeadersInit` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch` | `typeof fetch` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `lastEventId` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxEventBytes` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `credentials` | `RequestCredentials` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### QueryCacheOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `maxEntries` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `defaultTtlMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### CacheQueryOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `ttlMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `tags` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### DiscoveryClientOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `baseUrl` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch` | `typeof fetch` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `searchPath` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `feedPath` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `timeoutMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxResponseBytes` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

### DiscoverySearchOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `limit` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `offset` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `mode` | `'any'\|'all'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal` | No | Passed using this declared shape; omission is allowed only when marked optional. |
