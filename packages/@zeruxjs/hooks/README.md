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

| Factory                               | Execute                                 | Handler result                                 |
| ------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `createServerActions<Events>()`       | `dispatch(name,args,options?)`          | synchronous notification, ignored return value |
| `createAsyncServerActions<Events>()`  | `await dispatch(name,args,options?)`    | serially awaited notification                  |
| `createServerFilters<Filters>()`      | `apply(name,value,args,options?)`       | synchronous next value                         |
| `createAsyncServerFilters<Filters>()` | `await apply(name,value,args,options?)` | serially awaited next value                    |

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

| Phase             | Meaning / permitted changes                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `request:before`  | Before host validation, body parsing, middleware or routing. Register up to 128 synchronous `onDispose` callbacks; no HTTP request/response handle is exposed.                                                                                          |
| `route:resolved`  | After global middleware for an application route. `pattern` is the declared route pattern; null denotes static/protocol/early rejection or no resolved route. It fires before first commit/error/termination if routing was bypassed. Observation only. |
| `response:before` | On the first final `writeHead`, including implicit commit by `write`/`end`. Sole mutation phase: bounded `setStatus(200..599)` and `setHeader`. No body, routing, credentials, raw headers or socket access.                                            |
| `request:error`   | Once for a caught handler/phase exception or disconnect. Contains only `kind: 'handler'                                                                                                                                                                 | 'hook' | 'disconnect'`; no raw error/payload/stack. Ordinary 404/403 statuses without exceptions do not imply this event. |
| `response:after`  | Native response finish/close/request abort, not handler promise completion. Observation snapshot: completed status or diagnostic 499 for disconnect.                                                                                                    |
| `request:after`   | Once immediately after response observation, before scope/effect/disposer teardown. Observation only.                                                                                                                                                   |

Caught pre-commit errors run `route:resolved` (null if needed), `request:error`, then the single response commit and terminal phases. A stream can commit before a later error/disconnect; error then precedes its terminal phases. A disconnect before commit has no `response:before`. Requests rejected by the outer draining/closed-generation admission path are not admitted and have no request phases. Multiple native finish/close/error events cannot duplicate phases or teardown.

All contexts are frozen snapshots with bounded server-generated request/generation IDs, method and request `signal`; no URL/query/body/cookie, environment, services or asserted tenant identity is exposed. IDs match framework correlation when present and are never authorization. `ZeruxRequestContext.requestLifecycle?.signal` lets routes cancel cooperative dependencies. Signals abort at terminal response/disposal, even on successful completion. Host callbacks still own tenant/consent checks; these observations grant no permissions.

Header mutation is limited to 32 names, 64-character HTTP token names and 8 KiB values without controls/CRLF. Framing/hop-by-hop headers (`content-length`, `transfer-encoding`, `connection`, `upgrade`, `trailer`) are forbidden. Mutation handles expire synchronously after the callback sequence. Explicit `writeHead` header arguments are preserved, with approved hook header values taking precedence. Informational writes are not final-response phases. No automatic response-body rewriting is performed.

Before/route/commit handler failures stop that phase and produce the framework's safe error path; errors during terminal observation/error/generation/cleanup reporting are contained so teardown continues. The first error event wins if error and disconnect race. Terminal hook failures do not retroactively modify a committed response. Hook-caused bridge errors use a fixed JSON error envelope; existing route-generated API/HTML error negotiation is retained. Register original error logging separately through the trusted observability sink.

The framework enters one owned state/context scope per admitted request. Streams retain it until finish/close. Teardown aborts the signal, removes bridge listeners, invalidates state/context (including nested `withContext` descendants), runs all effect cleanups once even if one throws, and then runs registered disposers LIFO. Disposers are synchronous; async functions are rejected and unexpected returned thenables are observed/reported, not claimed to be cancelled or awaited. Never acquire async resources through an unawaited disposer. A disconnected handler may still settle later, but further managed hook/context access throws. Arbitrary timers/promises or separately created scopes remain their owner's responsibility.

Generation order is `generation:prepare` → `generation:ready` → `generation:activate` → `generation:close` → `generation:closed`. Prepare follows core preflight and precedes schema/provider/runtime preparation; ready means a fully prepared runtime, not an HTTP listener. Activation is emitted once through `runtime.activateServices()` (managed application and CLI hosts use it). A failed candidate emits prepare → error → close → closed and never activates; the previous generation remains usable. Replacement activates the new generation before draining and closing the previous one. Shutdown drains responses before close; rollback does not pretend to have transactional external side effects. Failures during activation/service cleanup emit one generation error. Invalid config rejected before candidate creation has no generation event. Generation observations cannot veto activation or rollback and exceptions are logged generically.

These are Node server lifecycle hooks. React/Vue hooks remain inside their respective frontend runtimes; no browser dispatcher or hydration lifecycle is executed here. Standalone `runWithRequestHooks` retains its original explicit lifetime semantics. Hosts outside ZeruxJS can explicitly own `createRequestHookScope().run(...)`/`.dispose()` and drive the typed bus, but must supply their own phase and HTTP ownership logic.

## Readable ownership boundaries

All published entries are Node server modules: state/context/actions/lifecycle
use AsyncLocalStorage, and paths uses synchronous filesystem operations. Erased
TypeScript imports do not create a browser implementation. Native AsyncLocalStorage
remains valid for broader host use; these APIs are not a generic replacement for
all native context or frontend hooks.

Context maps and registry argument arrays isolate their outer containers, not
borrowed value object graphs. Mutable context defaults remain shared references;
do not put an unscoped user's mutable identity in a default. Symbols, correlation
IDs and event names are not authorization. Host callbacks validate domain payloads
and tenant permissions before using these primitives.

`runWithRequestHooks` creates matching async-local maps but does not automatically
dispose every component or attach an HTTP finish listener. Use the explicit
`createRequestHookScope` owner when lifetime follows a streamed response. Dispose
components/scopes and keep captured setters within their owner lifetime. Effects
and their cleanups are synchronous contracts; arbitrary async work needs separate
host ownership. Failed renders do not transactionally undo prior state mutations
or already-started effects. Registry disposal stops admission and signals running
handlers; async registries require a separate `whenIdle` drain after dispatch
errors are handled.

Path registry writes are private atomic file replacements, not locks or a target
filesystem sandbox. The trusted host owns its directory and serializes competing
writers. Each read/write closes its own descriptor; the inert registry facade has
no persistent close handle. Legacy path errors may include aliases/targets, so do
not expose their raw text as an untrusted HTTP error response.
