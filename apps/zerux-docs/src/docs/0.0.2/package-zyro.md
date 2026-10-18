---
{
  "title": "Observable state and resources",
  "description": "Use bounded state ownership, selected snapshots and cancelable asynchronous work.",
  "section": "Packages",
  "order": 30,
  "sources": [
    "packages/@zeruxjs/zyro/README.md",
    "packages/@zeruxjs/zyro/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/zyro"
}
---

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
