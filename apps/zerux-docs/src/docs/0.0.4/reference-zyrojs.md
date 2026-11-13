---
{
  "title": "Standalone reactive applications",
  "description": "Set up zyrojs with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zyrojs",
  "sources": [
    "packages/zyrojs/README.md",
    "packages/zyrojs/package.json",
    "packages/zyrojs/src/dom/component.ts",
    "packages/zyrojs/src/dom/render.ts",
    "packages/zyrojs/src/reactivity/watch.ts",
    "packages/zyrojs/src/server.ts",
    "packages/zyrojs/src/hydrate.ts"
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
npm install zyrojs@0.0.4
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

Standalone ZyroJS and `@zeruxjs/zyro` are different APIs. The latter is an observable bridge; do not substitute value/get/set shapes without an adapter. Signal convenience functions named like hooks are not React's dispatcher. The standalone renderer is not a complete framework router, general or selective hydration engine or automatic HTML sanitizer.

## Stable component setup

```ts
import { useState, onScopeDispose } from 'zyrojs';
import { defineComponent, h, render, unmount } from 'zyrojs/dom';

const Counter = defineComponent<{ label: string }>(() => {
  const [count, setCount] = useState(0);
  onScopeDispose(() => { /* release application subscriptions */ });
  return props => h('button', { onClick: () => setCount(count() + 1) },
    props.label, () => count());
}, { onError: () => h('p', { role: 'alert' }, 'Counter unavailable') });
const container = document.querySelector('#app')!;
render(h(Counter, { key: 'counter', label: 'Clicks: ' }), container);
// After this owner leaves:
unmount(container);
```

Setup runs once for a mounted type/key; its returned render gets current props and tracks reactive reads. Allocating signal convenience hooks/effects in repeated render is diagnosed. These APIs have no positional React hook slots. Authored functions provide expressions; there is no string template evaluation, Vue compiler or automatic JSX runtime.

Arrays are owned fragments; unique finite-number/string sibling keys preserve component/DOM identity across reorder. Unkeyed nodes retain position. Replaced event callbacks, refs, effects and bindings detach on disposal. Ref holders use `{current}`; `ref()` itself is a signal alias with `.value`. `watch(source, callback, {immediate})` tracks only source reads, compares with `Object.is` and owns callback cleanup through its stop function or setup scope. Synchronous batches coalesce notifications, not transactions or async continuations.

Render boundaries catch synchronous setup/render errors, not events, Promise rejections, later independent child effects or disposal failures. Fallback errors propagate. Subtree construction rolls back partial resources; unmount attempts every cleanup before reporting failures. Failed updates do not guarantee DOM rollback. Async children are rejected: expose pending/result/error as synchronous signal/resource state and explicitly handle Promise rejection. SSR disposes each call's setup effects; it adds no hydration markers.

The package README documents an opt-in Chromium check and packed consumer verification. A deterministic DOM fixture cannot certify browser focus, selection, custom elements or cross-engine behavior; focus restoration across DOM moves remains best-effort.

## Whole-root SSR and hydration

Use `zyrojs/component` for shared authored components, `zyrojs/server` for
`renderToHydratable`, and `zyrojs/hydrate` in the browser. The server import graph
contains no DOM renderer/network client. The existing `renderToString` remains
static and marker-free; it is not hydration input. The package README contains a
complete three-file example using public imports.

Both sides require a public-props validator. Project a small public record;
callbacks, arbitrary classes, accessors, cyclic/sparse data and obvious sensitive
keys reject. This is not a secret detector: the application still owns the schema,
tenant authorization and privacy projection. HTML text/attribute encoders and
script-data serialization have different destinations. The server returns escaped
HTML plus separately escaped JSON `data`; embed data only at a fixed
application/json script sink and read its textContent, never eval it.

V1 uses a host-unique ID prefix, versioned root comments, nested fragment/component
ranges and text separators. `useId()` runs in component setup and yields matching
preorder IDs for matching trees. Hydration verifies parsed nodes and attaches
owned effects/listeners; edited input/checkbox values are retained and two-way
bindings synchronize after adoption. Author valid HTML, explicit table structure
and option selection. Password/file initial values, textarea, foreign/active/raw-text
elements, async children and selective hydration are unsupported. Do not strip
markers or vary initial state by time, randomness or environment.

The default mismatch policy throws with value-free diagnostics, disposes acquired
resources and leaves server nodes. Explicit `mismatch:'replace'` remounts and loses
DOM edits/focus. Neither strategy rolls back arbitrary application callback side
effects; protocol errors/limits/abort are not swallowed. A returned handle or
AbortSignal disposes the exact hydrated owner. Server scopes are released on
completion/failure/abort. Cancellation is synchronous and cooperative, not a way
to interrupt arbitrary code or promise browser parity.

The protocol bounds node count, depth, HTML and public data bytes. Raw HTML stays
explicit: `trustedHTML(text,{sanitize})` requires an application sanitizer and
creates an opaque leaf token; it is not serializable public data. No nested
managed children or reserved marker/active markup is accepted. Sanitizer output
must match canonical browser fragment HTML. This is a trusted host extension,
not an automatic XSS sanitizer.

Focused tests parse actual SSR with parse5 and exercise adoption in the deterministic
DOM fixture. Real Chromium hydration/form/focus qualification is a separate opt-in
check requiring Playwright and an installed browser; offline success does not
prove cross-engine or selective-hydration behavior.

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

| Option             | Accepted TypeScript value                                    | Required | Meaning                                                                           |
| ------------------ | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| `baseUrl`          | `string`                                                     | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `fetch`            | `typeof fetch`                                               | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `headers`          | `HeadersInit \| (() => HeadersInit \| Promise<HeadersInit>)` | No       | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `credentials`      | `RequestCredentials`                                         | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `timeoutMs`        | `number`                                                     | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `maxResponseBytes` | `number`                                                     | No       | Passed using this declared shape; omission is allowed only when marked optional.  |

### CallOptions

| Option    | Accepted TypeScript value | Required | Meaning                                                                          |
| --------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `signal`  | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `headers` | `HeadersInit`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### EventStreamOptions

| Option          | Accepted TypeScript value | Required | Meaning                                                                          |
| --------------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `headers`       | `HeadersInit`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal`        | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch`         | `typeof fetch`            | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `lastEventId`   | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxEventBytes` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `credentials`   | `RequestCredentials`      | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### QueryCacheOptions

| Option         | Accepted TypeScript value | Required | Meaning                                                                          |
| -------------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `maxEntries`   | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `defaultTtlMs` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### CacheQueryOptions

| Option   | Accepted TypeScript value | Required | Meaning                                                                          |
| -------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `ttlMs`  | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `tags`   | `string[]`                | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### DiscoveryClientOptions

| Option             | Accepted TypeScript value | Required | Meaning                                                                          |
| ------------------ | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `baseUrl`          | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch`            | `typeof fetch`            | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `searchPath`       | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `feedPath`         | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `timeoutMs`        | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxResponseBytes` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### DiscoverySearchOptions

| Option   | Accepted TypeScript value | Required | Meaning                                                                          |
| -------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `limit`  | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `offset` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `mode`   | `'any'\|'all'`            | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `boolean`                 | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |

The protocol client preserves the native Fetch global receiver. Application hosts
can still inject a borrowed transport and must own endpoint/authentication policy;
client calls are not implicitly retried. The local integration app qualifies
RPC/MCP/Connect/tRPC calls in Chrome, not every browser or complete vendor parity.
