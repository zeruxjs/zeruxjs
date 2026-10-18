# React state bridges

Connect stable external stores to real React hooks without bundling React.


## Inject React APIs

```tsx
import { createReactBindings, createReactStore } from '@zeruxjs/react';
import { useMemo, useSyncExternalStore, useCallback } from 'react';
const bindings = createReactBindings({ useMemo, useSyncExternalStore });
const store = createReactStore({ count: 0 });
/** Render counter state. @returns A button. Reads the explicitly owned store. */
function Counter() {
  const selector = useCallback((state: { count: number }) => state.count, []);
  const count = bindings.useSelector(store, selector);
  return <button onClick={() => store.update(s => ({ count: s.count + 1 }))}>{count}</button>;
}
```

Use the real React hooks inside components. Stable selectors and equality prevent accidental snapshot churn. The package does not install React or register an application renderer.

## SSR and hydration

Provide a stable server snapshot and serialize the same initial state into the client hydration payload. Do not let a shared server singleton leak one user's state into another request. A store bridge does not create HTML rendering, hydration transport or route transitions for the framework.

## Ownership

Batch/transaction operations coordinate store notifications. Observable adapters bridge structural stores without bundling Zyro. Unsubscribe on owner teardown; if a store is shared, its lifetime must be intentional.


## Public entry points

Manifest reference for `@zeruxjs/react@0.0.2`.

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

# @zeruxjs/react

Framework-neutral external-store primitives and injected React Hooks adapters.

```ts
import {createReactStore,createReactBindings} from '@zeruxjs/react';
import {useMemo,useSyncExternalStore} from 'react';
const bindings = createReactBindings({useMemo,useSyncExternalStore});
const store = createReactStore({count:0});
// Inside a component:
const count = bindings.useSelector(store, state => state.count);
store.batch(() => {store.update(s=>({count:s.count+1}));});
```

For real components, stabilize selectors with `useCallback` or a module-level function when possible. `createReactBindings` memoizes selector stores using the supplied real `useMemo`; `useReactSelector` also caches a stable selector/store pair for direct calls. The store supports `getServerSnapshot`, transactions, cleanup, and selector equality. `observableToReactStore`/`reactStoreToObservable` bridge Zyro-style observables via structural typing with no bundled React or Zyro dependency.

## Section 78: hydration and ownership contract

`ExternalStore<T>` may expose `getServerSnapshot()` for React 18+ SSR. The snapshot returned on the server **must be serialized into the client hydration payload**, including its data shape. `createReactStore(initial, {serverSnapshot})` pins its server snapshot rather than returning a subsequently mutated client value. `selectReactStore` memoizes selected client **and server** values using the supplied comparator, preventing newly allocated selectors from changing snapshot identity on every read.

```tsx
import {createReactBindings,createReactStore} from '@zeruxjs/react';
import {useMemo,useSyncExternalStore,useCallback} from 'react';
const bindings = createReactBindings({useMemo,useSyncExternalStore});
const store = createReactStore({count:0});
function Counter(){
  const selector = useCallback((value:{count:number})=>value.count,[]);
  const count = bindings.useSelector(store,selector);
  return <button onClick={()=>store.update(s=>({count:s.count+1}))}>{count}</button>;
}
```

`createReactBindings` invokes the real React Hooks only inside components. The standalone `useReactSelector` convenience helper uses a weak cache and needs a stable selector. When passing an explicit `serverSnapshot` callback, return stable data; React requires consistent snapshots across SSR, hydration and the first client commit. Unsubscribe is idempotent; the external store does not own React's component lifecycle. React itself is **not installed, vendored or automatically registered** by this package.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/react/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/react/README.md)
- [packages/@zeruxjs/react/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/react/package.json)
