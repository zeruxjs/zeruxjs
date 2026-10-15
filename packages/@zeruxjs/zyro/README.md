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
