# Server hooks and request scope

Use scoped server state, context and application-owned lifecycle actions and filters.


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

Generations emit prepare → ready → activate → close → closed. Ready is prepared, not a listening server. Failed candidates emit prepare → error → close → closed without activation. Successful replacement activates the new generation before draining/closing the old one. `runtime.activateServices()` is the lifecycle-aware activation entry; direct low-level scope activation does not emit that event. Core-invalid configuration has no candidate lifecycle event. See [service lifecycle](/branch/v0.0.4/zeruxjs/docs/0.0.4/service-lifecycle.md) and package README for the runnable public-import example and ownership boundaries.

## Path registries

`createPathRegistry({ directory })` stores aliases with validated names and atomic private writes. Legacy wrappers select the working directory at invocation time. Atomic replacement avoids partial files but not lost updates across processes; serialize writers or use a database.

## Cleanup

Dispose component hooks when the render owner no longer needs them. Explicit cleanup matters for effects and retained resources. This package is not React Hooks and does not install a UI renderer.

## Install and select the integration

```sh
npm install @zeruxjs/hooks@0.0.4
```

There is no automatic `hooks` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Wrap each server request in its own hook context and keep hook order stable for each component identity. Context providers and hook state are scoped through AsyncLocalStorage; this does not implement a frontend renderer or schedule rerenders. Keep render-time hooks synchronous and explicitly schedule application updates where appropriate.

## TypeScript: inputs, results and ownership

```ts
import { runWithRequestHooks } from '@zeruxjs/hooks';

type Inputs = Parameters<typeof runWithRequestHooks>;
type Result = Awaited<ReturnType<typeof runWithRequestHooks>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof runWithRequestHooks>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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

Manifest reference for `@zeruxjs/hooks@0.0.4`.

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
    },
    "./actions": {
      "types": "./dist/server-hooks.d.ts",
      "import": "./dist/server-hooks.js"
    },
    "./lifecycle": {
      "types": "./dist/lifecycle.d.ts",
      "import": "./dist/lifecycle.js"
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

## Server lifecycle actions and filters

These are application/request-owned server registries, inspired by action/filter ordering. They are not a React dispatcher or a complete WordPress compatibility layer. No registry or handler is installed globally. Existing `runHooks`, state/context ordering checks and explicit effect disposal are unchanged.

```ts
import { createServerActions, createServerFilters } from '@zeruxjs/hooks/actions';

const actions = createServerActions<{ ready: [id: string] }>();
const filters = createServerFilters<{ title: [value: string, suffix: string] }>();
const events: string[] = [];
const registration = actions.register('ready', (_context, id) => {
  events.push(id);
}, { once: true, priority: 5 });
filters.register('title', (_context, value, suffix) => value + suffix);
try {
  actions.dispatch('ready', ['application']);
  const title = filters.apply('title', 'Hello', ['!']); // "Hello!"
} finally {
  registration.remove(); // exact registration; safe after once/disposal
  actions.dispose();
  filters.dispose();
}
```

The four factories are also root exports:

| Factory | Execute | Handler result |
| --- | --- | --- |
| `createServerActions<Events>()` | `dispatch(name,args,options?)` | synchronous notification, ignored return value |
| `createAsyncServerActions<Events>()` | `await dispatch(name,args,options?)` | serially awaited notification |
| `createServerFilters<Filters>()` | `apply(name,value,args,options?)` | synchronous next value |
| `createAsyncServerFilters<Filters>()` | `await apply(name,value,args,options?)` | serially awaited next value |

An action map declares each event's argument tuple. A filter map declares a nonempty tuple: the first member is the value type, and the rest are unchanged extra arguments. Each handler receives `{signal}` first. Filters preserve the same declared value type through every stage, including a declared union; they do not form a pipeline of unrelated types. Always pass the extra-argument tuple, even when empty (`[]`). Types describe your application-owned payloads; JavaScript callers and handler return values still need domain-specific validation. Registries validate names/options/resource limits, not an arbitrary payload schema.

### Registration and execution rules

`register(name,callback,{priority?,once?,signal?})` returns a frozen `ServerHookToken` with `id`, `active` and idempotent `remove():boolean`. Each registration gets a unique token, even when it uses the same callback. Numeric priority is an integer from -1,000,000 through 1,000,000 (default 10); lower values run first and equal priorities preserve registration order. Names must match `[A-Za-z][A-Za-z0-9:._/-]{0,127}`. A registration signal removes just that handler and its owned abort listener; an already-aborted signal returns an inactive token.

Dispatch snapshots registrations immediately. New registrations are visible to the next dispatch (including a nested dispatch); a handler removed before its turn is skipped even if present in the snapshot. A `once` handler is removed **before** invocation, including on failure, cancellation or recursive/concurrent dispatch. A failed handler stops the sequence and propagates its original error/rejection; later handlers do not run. Prior mutations/side effects are not rolled back. Actions ignore normal return values; empty actions do nothing and empty filters return their input unchanged. Values and extra argument objects are passed by reference, not cloned or frozen.

Sync and async execution are deliberately separate. Sync registration rejects declared async functions. If a normal function returns a thenable, sync dispatch throws `HOOK_ASYNC_IN_SYNC` and observes its rejection to avoid an unhandled promise; already-started async work cannot be undone. TypeScript permits promise-returning callbacks in some `void` positions, so runtime enforcement is still necessary for actions. Async factories accept synchronous or asynchronous handlers and await each one before starting the next.

### Cancellation, bounds and ownership

Dispatch/apply accepts `{signal?:AbortSignal}`. Each dispatch owns a derived signal passed to its handlers. Aborting skips later handlers and rejects with `HOOK_ABORTED`; cooperative handlers should pass that signal to cancellable dependencies. The registry does not race a timeout and release a still-running handler: its pending slot remains until real settlement. An arbitrary promise cannot be forcibly cancelled. If a handler rejects while cancellation is pending, its original rejection propagates. Caller-supplied abort reasons are not copied into library errors.

Factory options are `maxHandlers` (default 1,024, maximum 10,000), `maxDepth` (default 32, maximum 128) and `maxPending` (default 32, maximum 256). Limits must be positive integers. Depth tracks logical nested dispatch for that registry using AsyncLocalStorage; independent concurrent dispatches are not mistaken for recursion. Pending capacity includes nested dispatches. Argument tuples are capped at 32 total values (filter value plus at most 31 extra arguments). Resource/validation errors have fixed `ServerHookError.code` values: `HOOK_INVALID`, `HOOK_CLOSED`, `HOOK_ABORTED`, `HOOK_DEPTH`, `HOOK_CAPACITY`, `HOOK_ASYNC_IN_SYNC`.

`dispose()` is idempotent: stop admission, remove all registrations/listeners and signal running handlers to stop. For async ownership, follow it with `await registry.whenIdle()` to drain actual settlement, even after a failed dispatch. Handle the dispatch promise's error separately; draining does not replace error handling. Do not await a registry drain from inside its own handler. `getDiagnostics()` returns only `{disposed,handlers,pending}`, with no names or payloads. No timers, sockets or background workers are created.

Create one registry per application/tenant or create it inside `runWithRequestHooks` and dispose it in `finally`. Registries are explicit objects, not inherited global subscriptions; a shared application registry intentionally serves every caller given that object. The host remains responsible for tenant authorization, payload validation and preventing accidental cross-tenant sharing. Creating a registry inside a request does not itself schedule automatic disposal or dispose existing state/effect instances.

## ZeruxJS lifecycle integration

`createServerLifecycleHooks()` (root or `/lifecycle`) is a typed synchronous lifecycle bus built on server actions. Configure it explicitly as `ZeruxConfig.lifecycleHooks`; the framework owns dispatch and each request's `createRequestHookScope`. Registrations stay host-owned across generations. Reuse the same bus on reload; replacing it is restart-required. Dispose it only after closing the application. Plain JSON cannot instantiate a bus; invalid/disposed instances fail preflight before providers. No callbacks enter browser manifests.

```ts
import { createServerLifecycleHooks } from '@zeruxjs/hooks/lifecycle';
import { createApplicationLifecycle } from 'zeruxjs';

const hooks = createServerLifecycleHooks();
hooks.register('request:before', context => {
  // Acquire a request-owned subscription here and register its synchronous disposer immediately.
  context.onDispose(() => { /* release the subscription */ });
});
hooks.register('response:before', context => {
  context.response.setHeader('x-application', 'example');
});
const app = await createApplicationLifecycle({
  rootDir: process.cwd(), config: { lifecycleHooks: hooks },
});
try {
  // Your HTTP host forwards requests to app.handle(req,res); this example binds no port.
} finally {
  await app.close();
  hooks.dispose();
}
```

Actual request order, with at most one invocation of each phase:

| Phase | Meaning / permitted changes |
| --- | --- |
| `request:before` | Before host validation, body parsing, middleware or routing. Register up to 128 synchronous `onDispose` callbacks; no HTTP request/response handle is exposed. |
| `route:resolved` | After global middleware for an application route. `pattern` is the declared route pattern; null denotes static/protocol/early rejection or no resolved route. It fires before first commit/error/termination if routing was bypassed. Observation only. |
| `response:before` | On the first final `writeHead`, including implicit commit by `write`/branch/v0.0.4/`end`. Sole mutation phase: bounded `setStatus(200..599)` and `setHeader`. No body, routing, credentials, raw headers or socket access. |
| `request:error` | Once for a caught handler/phase exception or disconnect. Contains only `kind: 'handler'|'hook'|'disconnect'`; no raw error/payload/stack. Ordinary 404/403 statuses without exceptions do not imply this event. |
| `response:after` | Native response finish/close/request abort, not handler promise completion. Observation snapshot: completed status or diagnostic 499 for disconnect. |
| `request:after` | Once immediately after response observation, before scope/effect/disposer teardown. Observation only. |

Caught pre-commit errors run `route:resolved` (null if needed), `request:error`, then the single response commit and terminal phases. A stream can commit before a later error/disconnect; error then precedes its terminal phases. A disconnect before commit has no `response:before`. Requests rejected by the outer draining/closed-generation admission path are not admitted and have no request phases. Multiple native finish/close/error events cannot duplicate phases or teardown.

All contexts are frozen snapshots with bounded server-generated request/generation IDs, method and request `signal`; no URL/query/body/cookie, environment, services or asserted tenant identity is exposed. IDs match framework correlation when present and are never authorization. `ZeruxRequestContext.requestLifecycle?.signal` lets routes cancel cooperative dependencies. Signals abort at terminal response/disposal, even on successful completion. Host callbacks still own tenant/consent checks; these observations grant no permissions.

Header mutation is limited to 32 names, 64-character HTTP token names and 8 KiB values without controls/CRLF. Framing/hop-by-hop headers (`content-length`, `transfer-encoding`, `connection`, `upgrade`, `trailer`) are forbidden. Mutation handles expire synchronously after the callback sequence. Explicit `writeHead` header arguments are preserved, with approved hook header values taking precedence. Informational writes are not final-response phases. No automatic response-body rewriting is performed.

Before/route/commit handler failures stop that phase and produce the framework's safe error path; errors during terminal observation/error/generation/cleanup reporting are contained so teardown continues. The first error event wins if error and disconnect race. Terminal hook failures do not retroactively modify a committed response. Hook-caused bridge errors use a fixed JSON error envelope; existing route-generated API/HTML error negotiation is retained. Register original error logging separately through the trusted observability sink.

The framework enters one owned state/context scope per admitted request. Streams retain it until finish/close. Teardown aborts the signal, removes bridge listeners, invalidates state/context (including nested `withContext` descendants), runs all effect cleanups once even if one throws, and then runs registered disposers LIFO. Disposers are synchronous; async functions are rejected and unexpected returned thenables are observed/reported, not claimed to be cancelled or awaited. Never acquire async resources through an unawaited disposer. A disconnected handler may still settle later, but further managed hook/context access throws. Arbitrary timers/promises or separately created scopes remain their owner's responsibility.

Generation order is `generation:prepare` → `generation:ready` → `generation:activate` → `generation:close` → `generation:closed`. Prepare follows core preflight and precedes schema/provider/runtime preparation; ready means a fully prepared runtime, not an HTTP listener. Activation is emitted once through `runtime.activateServices()` (managed application and CLI hosts use it). A failed candidate emits prepare → error → close → closed and never activates; the previous generation remains usable. Replacement activates the new generation before draining and closing the previous one. Shutdown drains responses before close; rollback does not pretend to have transactional external side effects. Failures during activation/service cleanup emit one generation error. Invalid config rejected before candidate creation has no generation event. Generation observations cannot veto activation or rollback and exceptions are logged generically.

These are Node server lifecycle hooks. React/Vue hooks remain inside their respective frontend runtimes; no browser dispatcher or hydration lifecycle is executed here. Standalone `runWithRequestHooks` retains its original explicit lifetime semantics. Hosts outside ZeruxJS can explicitly own `createRequestHookScope().run(...)`/branch/v0.0.4/`.dispose()` and drive the typed bus, but must supply their own phase and HTTP ownership logic.


## Implementation sources

- [packages/@zeruxjs/hooks/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/hooks/README.md)
- [packages/@zeruxjs/hooks/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/hooks/package.json)
