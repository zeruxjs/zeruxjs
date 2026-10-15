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
