# Server hooks and request scope

Use synchronous hook state and context without sharing it across requests.


## Request isolation

The hooks package uses AsyncLocalStorage for scoped server state. Enter `runWithRequestHooks` for a request and execute synchronous render functions through `runHooks`.

```ts
import { runWithRequestHooks, runHooks, useState, disposeHooks } from '@zeruxjs/hooks';
runWithRequestHooks(() => {
  const counter = () => {
    const [value, set] = useState(0);
    return { value, set };
  };
  const first = runHooks(counter);
  first.set(previous => previous + 1);
  const second = runHooks(counter);
  disposeHooks(counter);
});
```

## Render rules

Call hooks in a stable order and count. The package detects mismatched hook sequences. Hook rendering is synchronous; setting state does not schedule a React/Zyro rerender. The application owns rerender scheduling. Effects clean up on dependency changes and disposal.

## Context

Use createContext, setContext and useContext for request-local values. `withContext` supports nested overrides. Do not replace request-scoped state with module-level variables for identity, locale or tenant selection.

## Path registries

`createPathRegistry({ directory })` stores aliases with validated names and atomic private writes. Legacy wrappers select the working directory at invocation time. Atomic replacement avoids partial files but not lost updates across processes; serialize writers or use a database.

## Cleanup

Dispose component hooks when the render owner no longer needs them. Explicit cleanup matters for effects and retained resources. This package is not React Hooks and does not install a UI renderer.


## Public entry points

Manifest reference for `@zeruxjs/hooks@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./state": {
      "types": "./dist/state.d.ts",
      "import": "./dist/state.js"
    },
    "./context": {
      "types": "./dist/context.d.ts",
      "import": "./dist/context.js"
    },
    "./paths": {
      "types": "./dist/path-registry.d.ts",
      "import": "./dist/path-registry.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

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

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/hooks/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/hooks/README.md)
- [packages/@zeruxjs/hooks/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/hooks/package.json)
