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
