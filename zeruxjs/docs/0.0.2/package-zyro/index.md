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


## Public entry points

Manifest reference for `@zeruxjs/zyro@0.0.2`.

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

`mapObservable`/`combineObservables` memoize snapshots for `useSyncExternalStore` consumers. `awaitObservable` supports timeouts/AbortSignals and handles synchronous subscription notifications safely. `createAsyncObservable` aborts previous requests, rejects failures, ignores stale completions, and exposes `idle/loading/success/error` state with `reset()`, `cancel()` and `destroy()`.

## Section 78: route/component subscription scope

```ts
import {createObservable,createZyroSubscriptionScope} from '@zeruxjs/zyro';
const count=createObservable(0);
const scope=createZyroSubscriptionScope();
scope.observe(count,value=>console.log(value)); // initial state + updates
// On route leave or component unmount:
scope.destroy(); // idempotent; unsubscribes even if other disposers throw
```

`observe(...,{immediate:false})` skips the initial read. Synchronous subscription callbacks are not duplicated by the initial read. Manual unsubscribers returned by `observe()` and `add()` are idempotent. `destroy()` drains **all** disposers and aggregates failures. Scope ownership is independent of React/Vue and can manage `@zeruxjs/zyro` observables or structurally compatible source objects. The standalone **`zyrojs`** package is deliberately handled in the dedicated Section 81 release gate; this bridge alone does not certify that runtime.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/zyro/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/zyro/README.md)
- [packages/@zeruxjs/zyro/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/zyro/package.json)
