# Observable state and resources

Use bounded state ownership, selected snapshots and cancelable asynchronous work.


## Observable state

```ts
import { createObservable, mapObservable, createZyroSubscriptionScope } from '@zeruxjs/zyro';
const state = createObservable({ count: 0 });
const count = mapObservable(state, value => value.count);
const scope = createZyroSubscriptionScope();
scope.observe(count, value => console.log(value));
state.batch(() => { state.set({ count: 1 }); state.set({ count: 2 }); });
scope.destroy();
```

Selected/combined observables keep stable snapshots for external-store consumers. A scope owns subscriptions and drains all disposers even when one throws. Calling destroy repeatedly is safe.

## Async resources

createAsyncObservable passes an AbortSignal to its loader, aborts earlier requests on refresh and ignores stale completions. Inspect idle/loading/success/error state, handle rejection and cancel/destroy at the owner's teardown. Awaiting a resource is not an authorization check on its remote data.

## Runtime boundary

This package supplies state primitives and bridges, not the whole standalone zyrojs renderer. Its behavior does not certify the independent renderer's hydration or browser integration. Keep per-request server state separate from long-lived browser stores.

## Explicit standalone renderer conversion

The optional `@zeruxjs/zyro/renderer` subpath accepts primitives from the same
`zyrojs/component` runtime as the owning component. Core imports stay usable
without ZyroJS. `useZyroRendererBridge(runtime)` runs once in component setup and
owns conversions until unmount/SSR cleanup; the manual factory also accepts an
owner AbortSignal. The package README contains the complete Counter example.

Use `read` or `select` for read-only `.value`/branch/v0.0.4/`.peek()` views and `write` only for
explicit write-through. Source APIs remain `.get()`/branch/v0.0.4/`.set()`/branch/v0.0.4/`.subscribe()` and
are not silently reclassified as signals. Selected snapshots preserve reference
identity when equality (default Object.is) says unchanged. Use immutable source
snapshots and `bridge.batch()` for related changes across several conversions.
Sources are borrowed and never destroyed by conversion teardown.

Each mount/request must own its source and bridge. There is no global default
renderer: framework configuration/application code selects an explicit token
from its generation registry. This integration adds no config key, automatic
runtime registration, hydration protocol or React/Vue dispatcher.

Owned `bridge.resource` loaders inherit scope cancellation; borrowed resources
retain their original owner. Direct async observables accept AbortSignal,
bounded timeout and maxPending settings. Old/timed-out work cannot commit state,
but unsettled loaders keep their slots and cooperative cancellation cannot stop
arbitrary code. Existing refresh promises may still resolve a stale raw result;
render current observable state and handle rejection. Do not expose raw errors or
private state through SSR output. No network request starts merely by import or
resource creation.

Focused tests cover packed public imports/types, deterministic DOM teardown and
concurrent ephemeral framework requests. Live provider/browser behavior is not
implied by those checks.

## Install and select the integration

```sh
npm install @zeruxjs/zyro@0.0.4
```

There is no automatic `zyro` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Create observables around intentional application state and batch related changes to avoid unnecessary notifications. Map/combine functions memoize snapshots for external-store consumers. Use a subscription scope for route/component listeners and a cancelable async observable for latest-request-wins loading. These primitives do not supply a router or renderer.

## TypeScript: inputs, results and ownership

```ts
import { createObservable } from '@zeruxjs/zyro';

type Inputs = Parameters<typeof createObservable>;
type Result = Awaited<ReturnType<typeof createObservable>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createObservable>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Destroy an async resource to abort owned work and ignore stale completions. Dispose scopes even when one cleanup throws; scope teardown is idempotent and aggregates failures. On the server, do not share per-user observable state across requests. Browser bridges and server hooks solve different lifetime problems and should not be substituted for each other.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### Observable

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `get` | `T` | No |
| `subscribe` | `() => void` | No |

### BatchedObservable

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `batch` | `R` | No |

### AsyncState

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `status` | `'idle'\|'loading'\|'success'\|'error'` | No |
| `data` | `T\|undefined` | No |
| `error` | `unknown` | No |
| `updatedAt` | `number` | No |

### AsyncObservable

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `refresh` | `Promise<T\|undefined>` | No |
| `cancel` | `void` | No |
| `reset` | `void` | No |
| `destroy` | `void` | No |

### ZyroSubscriptionScope

An explicit ownership boundary for Zyro-style observable subscriptions.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `observe` | `()=>void` | No |
| `add` | `()=>void` | No |
| `destroy` | `void` | No |
| `destroyed` | `boolean` | No |


## Public entry points

Manifest reference for `@zeruxjs/zyro@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    },
    "./renderer": {
      "types": "./dist/renderer.d.ts",
      "import": "./dist/renderer.js",
      "require": "./dist/renderer.js"
    },
    "./dist/*": "./dist/*",
    "./package.json": "./package.json"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "zyrojs": "0.0.4"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/zyro

Core observable state with batched notifications, stable selected snapshots, bridges and cancelable async resources.

```ts
import {createObservable,mapObservable,createAsyncObservable} from '@zeruxjs/zyro';
const state = createObservable({count:0});
const selected = mapObservable(state, v=>v.count);
state.batch(()=>{state.set({count:1});state.set({count:2})});

const resource = createAsyncObservable(async signal => {
 const response=await fetch('/api/data',{signal});
 if(!response.ok)throw Error('Load failed');
 return response.json();
});
await resource.refresh();
resource.destroy();
```

`mapObservable`/branch/v0.0.4/`combineObservables` memoize snapshots for `useSyncExternalStore` consumers. `awaitObservable` supports timeouts/AbortSignals and handles synchronous subscription notifications safely. `createAsyncObservable` aborts previous requests, rejects failures, ignores stale completions, and exposes `idle/loading/success/error` state with `reset()`, `cancel()` and `destroy()`.

## Route/component subscription scope

```ts
import {createObservable,createZyroSubscriptionScope} from '@zeruxjs/zyro';
const count=createObservable(0);
const scope=createZyroSubscriptionScope();
scope.observe(count,value=>console.log(value)); // initial state + updates
// On route leave or component unmount:
scope.destroy(); // idempotent; unsubscribes even if other disposers throw
```

`observe(...,{immediate:false})` skips the initial read. Synchronous subscription callbacks are not duplicated by the initial read. Manual unsubscribers returned by `observe()` and `add()` are idempotent. `destroy()` drains **all** disposers and aggregates failures. Scope ownership is independent of React/Vue and can manage `@zeruxjs/zyro` observables or structurally compatible source objects. The standalone [`zyrojs`](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/README.md) runtime has its own lifecycle and verification requirements.

## Opt-in standalone renderer bridge

Core imports do not load ZyroJS and retain the observable `.get()` / `.set()` /
`.subscribe()` API. Install the optional `zyrojs@0.0.4` peer only for the
`@zeruxjs/zyro/renderer` integration. Signals still belong to ZyroJS; an arbitrary
observable is never implicitly treated as a signal. The host injects the public
standalone primitives explicitly, with no import-time registry or default adapter.
This package currently emits CommonJS; browser use needs an explicit bundler.
The framework's closed local ESM build does not bundle bare client packages, so
that path does not automatically make this bridge a browser asset.

A minimal end-to-end component allocates its source and bridge once in setup:

```ts title="counter.ts"
import * as Zyro from 'zyrojs/component';
import {createObservable} from '@zeruxjs/zyro';
import {useZyroRendererBridge} from '@zeruxjs/zyro/renderer';

export const Counter = Zyro.defineComponent<{label: string}>(() => {
  const source = createObservable(0); // a distinct source per mount/SSR instance
  Zyro.onScopeDispose(() => source.destroy());
  const bridge = useZyroRendererBridge(Zyro);
  const count = bridge.write(source); // explicitly enable write-through
  return props => Zyro.h('button', {
    onClick: () => { count.value++; }
  }, props.label, () => count.value);
});
```

```ts title="browser.ts"
import {h, render, unmount} from 'zyrojs/dom';
import {Counter} from './counter.js';
const container = document.querySelector('#app')!;
render(h(Counter, {label: 'Clicks: '}), container);
// Route/owner teardown: unmount(container);
```

For static SSR use `renderToString(h(Counter,{label:'Clicks: '}))` from
`zyrojs/dom`. Each call's component scope releases its bridge. In ZeruxJS,
register the existing `createZyroRenderer(renderToString)` through the
application generation's `api.renderers()`, then dispatch the explicit token via
`context.render(token, h(Counter, ...))`. The application/plugin consumes its own
configuration to select a renderer; this bridge does not add a framework config
key, choose a default runtime, register one globally or weaken client/server import
checks. Framework renderer registration remains static-HTML-only; this bridge does
not enable framework hydration or mix React/Vue ownership into a ZyroJS root.

### Conversion and ownership

`createZyroRendererBridge(runtime,{signal?,maxConnections?})` creates a manually
owned request/mount scope. `useZyroRendererBridge` additionally registers
`destroy()` with the active ZyroJS scope; call it once in component setup or a
host effect scope, never during repeated render (the standalone hook guard rejects that call). Outside an active scope it rolls
back and throws. Supply `signal`, `batch`, `untracked`, `onScopeDispose` and `useRef` from
the same `zyrojs/component` runtime instance that owns the render.

| Method | Behavior |
| --- | --- |
| `read(source)` | Immediate read-only conversion with `.value`, `.peek()` and `.dispose()` |
| `select(source, selector, equal = Object.is)` | Read-only stable projection; equal results retain the previous reference |
| `write(mutableSource)` | Explicit `.value` write-through to source `.set()`; no projected writes or optimistic state |
| `batch(fn)` | Synchronous batching of target ZyroJS notifications, including updates across multiple sources/conversions |
| `resource(loader, options)` | Create an owned async observable; bridge lifetime owns its AbortSignal |
| `destroy()` | Idempotent unsubscribe/resource teardown; attempts all disposers and aggregates errors |

Conversions subscribe synchronously and read the latest source snapshot on
registration. Selectors and initial reads are untracked in the renderer. Sources
must provide coherent `.get()` snapshots and a real unsubscribe function;
synchronous initial emissions are supported. Source-owned `batch()` coalesces its
own notifications. For an effect reading several conversions, wrap related writes
in `bridge.batch()` to coalesce all renderer notifications; external observable
listeners retain their source's notification semantics. Batches do not span await
or roll back writes.

Updates use `Object.is` by default. Use immutable source snapshots; mutating the
same object reference cannot be detected. Equality must return a boolean. Selector
and equality failures propagate without caching a failed projection; later reads
can retry. Subscription setup rolls back once its disposer is returned. A custom
source that throws before returning its disposer must clean up its own partial
registration; the bridge cannot recover an undisclosed native handle.

Sources are borrowed: disposing a conversion/bridge never destroys a source.
A manual bridge does not own arbitrary external ZyroJS effects or the DOM root;
dispose those with their own scope or unmount the component.
Register cleanup separately for sources you own, as above. `maxConnections`
defaults to 128, is bounded to 1–4096, and separately caps conversions and owned
resources. `activeConnections` counts live conversions without source labels.
Read/write/batch/conversion operations reject after destruction. No process-global
observable or bridge is created, and no state is serialized implicitly: use a new
scope and appropriately authorized source for each tenant/request. Explicitly
sharing a source shares its values; isolation is the host's responsibility.

### Async work and cancellation

```ts
const resource = bridge.resource(async signal => {
  const response = await fetch('/api/data', {signal});
  if (!response.ok) throw Error('Load failed');
  return response.json(); // apply your owning API's schema before use
}, {timeoutMs: 10000, maxPending: 4});
const state = bridge.read(resource);
// Explicit user/host action, never automatic import-time or SSR network access:
await resource.refresh(); // handle rejection at the caller
```

`createAsyncObservable` also accepts `{signal,timeoutMs,maxPending,initial}`.
Parent abort cancels the current loader, fences state updates and makes later
refreshes reject with `AbortError`; destroy removes listeners and timers. Refresh,
reset and destroy fence older completions; failures remain visible and may be
retried. A loader receives an actual AbortSignal. Timeout (integer 1–300000ms)
leaves loading state and aborts cooperatively. It cannot force-interrupt a Promise
or stop side effects in a loader that ignores the signal. `maxPending` defaults to
8 (1–128); cancelled/timed-out work keeps a slot until actual settlement, and an
overload rejects before replacing the current job. There are no automatic retries.

For compatibility, an old `refresh()` Promise can still resolve its raw loader
result after cancellation/replacement, although that result cannot commit to
observable state. Drive UI from the current observable snapshot, not a stale
refresh return value. Handle every rejected refresh; raw error objects stay
internal/application-owned and should not be rendered or serialized to clients.
Bridge-created resources are destroyed on unmount/request scope close. Borrowed
async observables passed to `read()` are only unsubscribed; their cancellation
still belongs to their original owner.

## Focused verification

From this package run `npm run build`, then
`node --test test/advanced.test.mjs test/integration.test.mjs test/subscription-scope.test.mjs test/renderer.test.mjs test/renderer-public.test.mjs test/renderer-framework.test.mjs`.
Build the required standalone ZyroJS/security and framework packages first when
their compiled exports are absent. The installed tarball fixture verifies core
imports/types without the optional runtime, then bridge declarations and this
component example through real public exports without source aliases. The DOM
fixture and ephemeral local framework requests cover batching, scope isolation,
cancellation, failure and teardown; they do not certify a real browser, live API or
cross-framework hydration. No user-managed application is started.


## Implementation sources

- [packages/@zeruxjs/zyro/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/README.md)
- [packages/@zeruxjs/zyro/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/package.json)
- [packages/@zeruxjs/zyro/src/renderer.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/src/renderer.ts)
- [packages/@zeruxjs/zyro/src/async.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/src/async.ts)
