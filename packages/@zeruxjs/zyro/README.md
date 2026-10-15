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
