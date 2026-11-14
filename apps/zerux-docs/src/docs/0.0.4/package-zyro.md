---
{
  "title": "Observable state and resources",
  "description": "Use bounded state ownership, selected snapshots and cancelable asynchronous work.",
  "section": "Packages",
  "order": 30,
  "sources": [
    "packages/@zeruxjs/zyro/README.md",
    "packages/@zeruxjs/zyro/package.json",
    "packages/@zeruxjs/zyro/src/renderer.ts",
    "packages/@zeruxjs/zyro/src/async.ts"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/zyro"
}
---

## Observable state

```ts
import { createObservable, mapObservable, createZyroSubscriptionScope } from '@zeruxjs/zyro';
const state = createObservable({ count: 0 });
const count = mapObservable(state, value => value.count);
const scope = createZyroSubscriptionScope();
scope.observe(count, value => console.log(value));
state.batch(() => { state.set({ count: 1 }); state.set({ count: 2 }); });
scope.destroy();
state.destroy();
```

Selected/combined observables keep stable snapshots for external-store consumers. A scope owns subscriptions and drains all disposers even when one throws. Calling destroy repeatedly is safe.

## Async resources

createAsyncObservable passes an AbortSignal to its loader, aborts earlier requests on refresh and ignores stale completions. Inspect idle/loading/success/error state, handle rejection and cancel/destroy at the owner's teardown. Awaiting a resource is not an authorization check on its remote data.

## Runtime boundary

This package supplies state primitives and bridges, not the whole standalone zyrojs renderer. Its behavior does not certify the independent renderer's hydration or browser integration. Keep per-request server state separate from long-lived browser stores.

## Explicit standalone renderer conversion

The optional `@zeruxjs/zyro/renderer` subpath accepts primitives from the same
`zyrojs/component` runtime as the owning component. Core imports stay usable
without ZyroJS. `useZyroRendererBridge(runtime)` runs once in component setup and
owns conversions until unmount/SSR cleanup; the manual factory also accepts an
owner AbortSignal. The package README contains the complete Counter example.

Use `read` or `select` for read-only `.value`/`.peek()` views and `write` only for
explicit write-through. Source APIs remain `.get()`/`.set()`/`.subscribe()` and
are not silently reclassified as signals. Selected snapshots preserve reference
identity when equality (default Object.is) says unchanged. Use immutable source
snapshots and `bridge.batch()` for related changes across several conversions.
Sources are borrowed and never destroyed by conversion teardown.

Each mount/request must own its source and bridge. There is no global default
renderer: framework configuration/application code selects an explicit token
from its generation registry. This integration adds no config key, automatic
runtime registration, hydration protocol or React/Vue dispatcher.

Owned `bridge.resource` loaders inherit scope cancellation; borrowed resources
retain their original owner. Direct async observables accept AbortSignal,
bounded timeout and maxPending settings. Old/timed-out work cannot commit state,
but unsettled loaders keep their slots and cooperative cancellation cannot stop
arbitrary code. Existing refresh promises may still resolve a stale raw result;
render current observable state and handle rejection. Do not expose raw errors or
private state through SSR output. No network request starts merely by import or
resource creation.

Focused tests cover packed public imports/types, deterministic DOM teardown and
concurrent ephemeral framework requests. Live provider/browser behavior is not
implied by those checks.

## Install and select the integration

```sh
npm install @zeruxjs/zyro@0.0.4
```

There is no automatic `zyro` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Create observables around intentional application state and batch related changes to avoid unnecessary notifications. Map/combine functions memoize snapshots for external-store consumers. Use a subscription scope for route/component listeners and a cancelable async observable for latest-request-wins loading. These primitives do not supply a router or renderer.

## TypeScript: inputs, results and ownership

```ts
import { createObservable } from '@zeruxjs/zyro';

type Inputs = Parameters<typeof createObservable>;
type Result = Awaited<ReturnType<typeof createObservable>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createObservable>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Destroy an async resource to abort owned work and ignore stale completions. Dispose scopes even when one cleanup throws; scope teardown is idempotent and aggregates failures. On the server, do not share per-user observable state across requests. Browser bridges and server hooks solve different lifetime problems and should not be substituted for each other.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### Observable

| Field       | Accepted type/value | Optional |
| ----------- | ------------------- | -------- |
| `get`       | `T`                 | No       |
| `subscribe` | `() => void`        | No       |

### BatchedObservable

| Field   | Accepted type/value | Optional |
| ------- | ------------------- | -------- |
| `batch` | `R`                 | No       |

### AsyncState

| Field       | Accepted type/value                     | Optional |
| ----------- | --------------------------------------- | -------- |
| `status`    | `'idle'\|'loading'\|'success'\|'error'` | No       |
| `data`      | `T\|undefined`                          | No       |
| `error`     | `unknown`                               | No       |
| `updatedAt` | `number`                                | No       |

### AsyncObservable

| Field     | Accepted type/value     | Optional |
| --------- | ----------------------- | -------- |
| `refresh` | `Promise<T\|undefined>` | No       |
| `cancel`  | `void`                  | No       |
| `reset`   | `void`                  | No       |
| `destroy` | `void`                  | No       |

### ZyroSubscriptionScope

An explicit ownership boundary for Zyro-style observable subscriptions.

| Field       | Accepted type/value | Optional |
| ----------- | ------------------- | -------- |
| `observe`   | `()=>void`          | No       |
| `add`       | `()=>void`          | No       |
| `destroy`   | `void`              | No       |
| `destroyed` | `boolean`           | No       |

## Snapshot and cleanup semantics

Observable values are borrowed references. `Object.is` suppresses same-identity
writes, so mutating a stored object in place does not notify observers. A function
passed to `set` is an updater; wrap a function-valued replacement in an updater
that returns it. `batch` coalesces synchronous notifications, flushes when its
callback exits and does not roll back writes after an exception or span `await`.
Listener and selector callbacks are trusted synchronous code; no CPU deadline or
reentrant-notification count limit is implied for the core observable.

`mapObservable`, `combineObservables`, `toExternalStore` and `fromExternalStore`
borrow their inputs. Their creation does not own a persistent subscription, but
snapshot projections can read and execute selectors immediately. Each subsequent
subscription returns its own disposer. The legacy combined subscription registers
sources in order without universal partial-registration rollback; a throwing
source registration must clean its own partial work. Its returned cleanup invokes
source disposers in order, so a throwing disposer can prevent later cleanup.
`awaitObservable` likewise expects well-behaved source cleanup. Use trusted sources
with coherent synchronous snapshots and nonthrowing unsubscribe functions.

Subscription scopes and renderer bridges provide stronger owned cleanup: they
attempt every registered disposer and aggregate failures. They fence callbacks
before releasing registrations. They cannot recover an undisclosed handle when a
custom source throws before returning its disposer. Destroying a source clears its
listeners and prevents future writes; it does not erase objects retained by the
host or make their contents public-safe. Keep sources scoped to an authorized
request, tenant or mount, and destroy owned sources separately from borrowed views.
