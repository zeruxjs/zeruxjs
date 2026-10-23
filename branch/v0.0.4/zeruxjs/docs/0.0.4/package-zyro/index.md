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

## Install and select the integration

```sh
npm install @zeruxjs/zyro@0.0.3
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

Manifest reference for `@zeruxjs/zyro@0.0.3`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/zyro

Core observable state with batched notifications, stable selected snapshots, bridges and cancelable async resources.

```ts
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


## Implementation sources

- [packages/@zeruxjs/zyro/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/README.md)
- [packages/@zeruxjs/zyro/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/package.json)
