# Standalone reactive applications

Set up zyrojs with explicit lifecycle, typed public APIs and deployment boundaries.


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


## Public entry points

Manifest reference for `zyrojs@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./dom": {
      "types": "./dist/dom/index.d.ts",
      "default": "./dist/dom/index.js"
    },
    "./network": {
      "types": "./dist/network/index.d.ts",
      "default": "./dist/network/index.js"
    }
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# ZyroJS — standalone reactive and DOM runtime

ZyroJS provides **framework-neutral signals**, lifecycle-managed browser DOM rendering and abortable Fetch-based network helpers. It is an independent library that can run alongside the `@zeruxjs/zyro` observable bridge, React or Vue. It does **not** require ZeruxJS or a component framework.

**Release status:** `0.0.1`. The source and isolated package tarball pass local checks in Section 81; real-browser and clean-machine certification remain unverified. This package does not currently provide a full React-compatible hooks dispatcher, router, internationalization suite, general SSR hydration, custom HTML compiler or automatic XSS sanitizer.

## Imports

```ts
import { signal, computed, effect, batch, reactive, createEffectScope } from 'zyrojs';
import { h, render, unmount, renderToString } from 'zyrojs/dom';
import { createRemoteResource, createProtocolClient } from 'zyrojs/network';
```

## Reactivity and lifetime

```ts
const scope = createEffectScope();
const price = signal(5);
const quantity = signal(2);

scope.run(() => {
  const total = computed(() => price.value * quantity.value);
  effect(() => console.log('Total:', total.value));
});

batch(() => { price.value = 8; quantity.value = 3; });
scope.dispose(); // stop all owned reactive effects/derived subscriptions
```

`effect(fn)` runs immediately and returns an idempotent `stop()` callback. `fn` may return a cleanup callback, which runs before re-execution and on stopping. Dependency tracking updates after conditional reads; nested synchronous `batch` calls coalesce notifications. `onScopeDispose(fn)` registers additional disposers from inside `scope.run` or an effect owned by that scope. Cleanup errors may be propagated; the scope attempts to run all disposers. Unbounded self-updates fail with a loop guard.

`computed(fn)` is eagerly tracked, read-only, and exposes `.dispose()`. Computed values outside a scope **must be disposed manually** to avoid long-lived subscriptions. `reactive(obj)` observes plain objects and arrays, including property reads, membership, iteration, nested mutable fields and deletions; native collections, Dates, class instances, and immutable slots are preserved rather than wrapped. Mutations made directly to an unproxied original reference cannot notify subscribers.

`useState`, `useEffect`, `useMemo`, `useReactive` and `useRef` are **signal convenience functions**, not React hooks. `useEffect` returns a stop function; `useMemo` returns a getter with `.dispose()`. Avoid constructing new state on every render of a function component. Use stable signals owned by a mount boundary instead.

## DOM, forms and safety

```ts
const count = signal(0);
const name = signal('Visitor');
const app = document.querySelector('#app')!;
render(h('section', {},
  h('input', { 'bind:value': name }),
  h('p', {}, () => `Hello ${name.value}: ${count.value}`),
  h('button', { onClick: () => { count.value++; } }, 'Increment')
), app);

// on route change or component unmount:
unmount(app);
```

`render()` reconciles child lists by `props.key`, retains suitable DOM nodes and removes listeners/effects when replaced. Function children may return text **or a VNode**. `mount()` mounts an additional subtree, and `unmount(container)` releases the render root and manually mounted subtrees. `bind:value` listens for `input` and `bind:checked` listens for `change` on native form controls. Use normal `onInput` / `onChange` handlers for advanced form validation.

DOM text and attributes are escaped through native DOM APIs. **Raw `innerHTML`, `outerHTML`, `srcdoc`, `srcset`, and inline `on*` strings are rejected**; unsafe URL schemes and raw CSS strings are not written. Do not turn user-controlled component tags or callback functions into trusted code. `renderToString()` produces escaped **static HTML** without mounting subscriptions, but does not output hydration markers; clients must remount using `render()` rather than assume hydration. Do not mix this reconciler with React/Vue ownership of the **same DOM container**. Separate mount roots and dispose each app's subscriptions on teardown.

## Network and cancellation

```ts
const client = createProtocolClient({ baseUrl: 'https://example.test', timeoutMs: 10000 });
const resource = createRemoteResource(signal => client.rpc('users.list', {}, { signal }));
await resource.refresh();
resource.cancel();  // abort current work; stale results cannot change data or cache
resource.dispose(); // release resource permanently
```

See `src/network` for Fetch JSON-RPC, MCP, Connect/tRPC, SSE readers, discovery feeds, bounded streaming and in-memory QueryCache. A cancelled stale request rejects with `AbortError` if its loader later resolves without honoring the signal. This is intentional: consumers must handle rejected promises. There is no implicit network retry for mutating calls. Cache entries are per instance; avoid sharing sensitive keys across tenants.

## Local qualification

```sh
cd apps/proworkspace
npm run test:zyrojs  # builds ZyroJS + bridge, runs tests, npm-pack consumer import test
npm run verify:source # source and lock metadata validation, NOT npm ci
```

The Section 81 suite uses a deterministic DOM fixture in Node and an offline tarball consumer. **Real-browser Chromium/WebKit/Firefox, actual React/Vue hydration and cross-OS testing are still release gates** (Sections 83–85). Do not interpret a passed DOM fixture as browser certification or a passed local tarball check as a clean registry-backed workspace install.

## Future project generator

[`create-zyro-app`](https://github.com/zeruxjs/zeruxjs/blob/master/packages/create/create-zyro-app/README.md) is reserved for this package's future project generator. Version `0.0.1` provides placeholder help/version output only; project scaffolding is planned for a future release.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/zyrojs/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zyrojs/README.md)
- [packages/zyrojs/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zyrojs/package.json)
