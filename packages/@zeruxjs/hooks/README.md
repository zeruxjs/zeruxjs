# @zeruxjs/hooks

Server-side scoped hooks and path aliases for ZeruxJS. ESM imports. Uses Node AsyncLocalStorage for request isolation.

```ts
import { runWithRequestHooks, createContext, setContext, useContext, runHooks, useState, useEffect, disposeHooks } from '@zeruxjs/hooks';
const locale = createContext('en');
runWithRequestHooks(() => {
  setContext(locale, 'fr');
  const component = () => { const [value, set] = useState(0); return { value, set, locale: useContext(locale) }; };
  const state = runHooks(component);
  state.set(previous => previous + 1);
  console.log(runHooks(component).value); // 1
  disposeHooks(component);
});
```

Hooks are synchronous-render only and intentionally do not trigger rendering themselves; applications must schedule rerenders. Calling a different number/order of hooks on subsequent renders throws. Effects clean up on dependency changes and disposal. For nested request contexts, use `withContext`.

`createPathRegistry({ directory })` manages aliases with validated names and atomic private writes. The legacy `registerPath`, `resolvePath`, `getAllPaths`, `unregisterPath` wrappers use the current working directory at invocation time. Multi-process registry writes require caller-side serialization; atomic renames prevent partial files but do not prevent concurrent lost updates.
