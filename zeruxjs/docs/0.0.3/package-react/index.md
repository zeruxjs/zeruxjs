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

## Install and select the integration

```sh
npm install @zeruxjs/react@0.0.3
```

There is no automatic `react` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/zeruxjs/docs/0.0.3/configuration-reference.md) and [TypeScript](/zeruxjs/docs/0.0.3/typescript.md).

## A practical integration workflow

Install React separately and inject its actual hooks through createReactBindings. Create a stable external store and selector functions, and choose equality based on the selected value. Bridge stores do not supply HTML rendering, routers or hydration transport. Treat request/user state as request-scoped on the server.

## TypeScript: inputs, results and ownership

```ts
import { createReactStore } from '@zeruxjs/react';

type Inputs = Parameters<typeof createReactStore>;
type Result = Awaited<ReturnType<typeof createReactStore>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createReactStore>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.3/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Serialize exactly the server snapshot used for rendering into the client hydration input. A shared mutable server singleton can leak data between users. Unsubscribe on component/route teardown; injected hooks must be called under React hook rules. Test selector identity, SSR snapshots and unmount cleanup using the actual React runtime.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ExternalStore

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `getSnapshot` | `T` | No |
| `subscribe` | `() => void` | No |
| `getServerSnapshot` | `T` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/react@0.0.3`.

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


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/react/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/react/README.md)
- [packages/@zeruxjs/react/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/react/package.json)
