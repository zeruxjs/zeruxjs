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

## Install and select the integration

```sh
npm install @zeruxjs/hooks@0.0.2
```

There is no automatic `hooks` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/zeruxjs/docs/0.0.2/configuration-reference.md) and [TypeScript](/zeruxjs/docs/0.0.2/typescript.md).

## A practical integration workflow

Wrap each server request in its own hook context and keep hook order stable for each component identity. Context providers and hook state are scoped through AsyncLocalStorage; this does not implement a frontend renderer or schedule rerenders. Keep render-time hooks synchronous and explicitly schedule application updates where appropriate.

## TypeScript: inputs, results and ownership

```ts
import { runWithRequestHooks } from '@zeruxjs/hooks';

type Inputs = Parameters<typeof runWithRequestHooks>;
type Result = Awaited<ReturnType<typeof runWithRequestHooks>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof runWithRequestHooks>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.2/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Dispose component hooks when their owner ends so effects release resources. Do not keep a user-specific context in a process-global singleton. Path registry persistence uses private atomic writes but competing processes still require serialization. Test nested contexts, changed hook order and cleanup failures rather than treating successful registration as lifecycle correctness.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### Context

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `symbol` | No |
| `defaultValue` | `T` | Yes |


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
