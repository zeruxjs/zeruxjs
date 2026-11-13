---
{
  "title": "Server hooks and request scope",
  "description": "Use scoped server state, context and application-owned lifecycle actions and filters.",
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

## Server lifecycle actions and filters

Use an explicit application/tenant registry, or create one inside a request and dispose it in `finally`. No global subscriptions are inherited. The synchronous and asynchronous factories are separate public APIs, exported from the root and `@zeruxjs/hooks/actions`.

```ts
import { createServerFilters } from '@zeruxjs/hooks/actions';
const filters = createServerFilters<{ title: [value: string, suffix: string] }>();
const token = filters.register('title', (_context, value, suffix) => value + suffix, { priority: 5 });
try {
  const title = filters.apply('title', 'Hello', ['!']);
} finally {
  token.remove();
  filters.dispose();
}
```

`createServerActions<Events>` notifies typed `(context,...args)` handlers through `dispatch(name,args,options?)`. `createServerFilters<Filters>` transforms the first tuple member through `apply(name,value,extraArgs,options?)`; filters preserve that declared value type, including unions. `createAsyncServerActions` and `createAsyncServerFilters` await handlers serially. Empty filters return their input. Values are passed by reference; the host validates domain payloads and authorizes tenant access.

Lower numeric priority runs first (default 10), with stable registration order for ties. Tokens identify exact registrations, including duplicate callbacks, and expose idempotent removal. Dispatch snapshots registrations; additions wait for the next dispatch, removals skip handlers not yet invoked, and `once` removes before invocation even on failure or nested/concurrent dispatch. The first error propagates unchanged and stops the sequence; prior side effects are not rolled back. Sync execution rejects async functions/returned thenables, but cannot undo work already started by a misused callback.

Dispatch `{signal}` and handler `context.signal` provide cooperative cancellation. Disposal removes registrations/listeners, rejects new work and aborts running signals. Follow `dispose()` with `await whenIdle()` for async cleanup, and separately handle dispatch errors. Pending native work retains its slot until actual settlement; no promise timeout claims forced cancellation. Do not drain a registry from its own handler.

Defaults bound handlers to 1,024, nested logical depth to 32 and pending dispatches to 32. Configurable maxima are 10,000/128/256; argument tuples are limited to 32 total members. Diagnostics expose only counts/disposal state. See the package README for name/priority ranges and fixed `ServerHookError` codes. These server lifecycle primitives do not replace the existing synchronous state/context hooks, automatically dispose request state, install a renderer or promise full WordPress/React parity.

## Framework lifecycle phases

Create `createServerLifecycleHooks()` from `@zeruxjs/hooks/lifecycle` and supply the instance as `ZeruxConfig.lifecycleHooks`. It is private executable configuration, not a browser module. Reuse it across reloads; the host disposes it after closing the application.

Requests run `request:before` → `route:resolved` → `response:before` → `response:after` → `request:after`. `request:error` occurs once on an exception or disconnect; early errors get a null route before the error event, while a stream may already have committed before failure. Disconnect without commit omits `response:before`. Static/protocol/early rejection uses a null route. Outer drain/closed rejections are not admitted requests. Native finish/close races do not duplicate phases.

Only `response:before` permits response mutation through bounded synchronous status/header setters; it exposes no raw response/body. Other contexts are frozen observations with server-generated correlation, method and request signal, excluding raw URL/query, credentials, bodies and claimed tenant identity. Error events carry a fixed kind, not private causes. Pre-commit hook failures use the safe error path; terminal/generation observation failures cannot block cleanup. See the package README for header limits and exact exceptional ordering.

`request:before` can register bounded synchronous disposers. The framework owns a request state/context scope until response finish/close, including streaming responses. It then aborts the signal, invalidates context/state, releases effect cleanups once and runs disposers LIFO. Routes can propagate `context.requestLifecycle?.signal`. Late continuations cannot read disposed context, but arbitrary application work must cooperate with cancellation. React/Vue hooks remain in their own runtimes.

Generations emit prepare → ready → activate → close → closed. Ready is prepared, not a listening server. Failed candidates emit prepare → error → close → closed without activation. Successful replacement activates the new generation before draining/closing the old one. `runtime.activateServices()` is the lifecycle-aware activation entry; direct low-level scope activation does not emit that event. Core-invalid configuration has no candidate lifecycle event. See [service lifecycle](service-lifecycle.md) and package README for the runnable public-import example and ownership boundaries.

## Path registries

`createPathRegistry({ directory })` stores aliases with validated names and atomic private writes. Legacy wrappers select the working directory at invocation time. Atomic replacement avoids partial files but not lost updates across processes; serialize writers or use a database.

## Cleanup

Dispose component hooks when the render owner no longer needs them. Explicit cleanup matters for effects and retained resources. This package is not React Hooks and does not install a UI renderer.

## Install and select the integration

```sh
npm install @zeruxjs/hooks@0.0.4
```

There is no automatic `hooks` startup service in `zerux.config.js` for this package. Import its public APIs and create the explicit server-owned scope or registry in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Wrap each server request in its own hook context and keep hook order stable for each component identity. Context providers and hook state are scoped through AsyncLocalStorage; this does not implement a frontend renderer or schedule rerenders. Keep render-time hooks synchronous and explicitly schedule application updates where appropriate.

## TypeScript: inputs, results and ownership

```ts
import { runWithRequestHooks } from '@zeruxjs/hooks';

type Inputs = Parameters<typeof runWithRequestHooks>;
type Result = Awaited<ReturnType<typeof runWithRequestHooks>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof runWithRequestHooks>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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

| Field          | Accepted type/value | Optional |
| -------------- | ------------------- | -------- |
| `id`           | `symbol`            | No       |
| `defaultValue` | `T`                 | Yes      |

## Explicit lifetime and public entry boundaries

Every public Hooks entry is Node-only. Root/state/context/actions/lifecycle use
native async-local context; paths uses the private synchronous file registry.
Use erased type imports where appropriate, rather than treating server state as a
frontend dispatcher. Native AsyncLocalStorage remains valid for unrelated host
context needs; no complete native API equivalence is claimed.

Use `createRequestHookScope` when termination follows response finish/close,
including streams. Standalone `runWithRequestHooks` does not install HTTP cleanup
or automatically dispose every component. State setters do not schedule renders
and must remain within their owning lifetime. Effects/cleanups are synchronous;
failed renders do not undo earlier mutations or already-started effects.

Context defaults, bound values and registry argument objects are borrowed
references. Outer map/tuple copies do not deep-clone user data or authenticate a
principal. Create isolated host-owned registries per intended application/tenant;
event names and server correlation IDs grant no permissions. Disposal removes
registration listeners and stops admission; `whenIdle` separately observes actual
approved async handler settlement. Do not drain a registry inside its own handler.

The path-registry facade has no persistent disposal handle: each operation closes
its descriptor. Atomic rename prevents a partially written file but cannot
serialize processes or constrain a trusted target to a sandbox. Legacy alias/path
errors remain private host diagnostics, not safe HTTP response bodies. The
package's isolated packed-consumer check extracts its local dependency-free
archive without npm install or executing package discovery.
