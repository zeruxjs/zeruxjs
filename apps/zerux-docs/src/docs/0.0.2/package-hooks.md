---
{
  "title": "Server hooks and request scope",
  "description": "Use synchronous hook state and context without sharing it across requests.",
  "section": "Packages",
  "order": 8,
  "sources": [
    "packages/@zeruxjs/hooks/README.md",
    "packages/@zeruxjs/hooks/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/hooks"
}
---

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
