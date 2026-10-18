# Vue state bridges

Inject real Vue 3 APIs and connect stores within an explicit effect scope.


## Prefer scoped bindings

```ts
import { shallowRef, readonly, getCurrentScope, onScopeDispose, watch } from 'vue';
import { createVueBindings } from '@zeruxjs/vue';
const bridge = createVueBindings({ shallowRef, readonly, getCurrentScope, onScopeDispose, watch });
// Inside setup() or effectScope.run():
const state = bridge.useStore(externalStore);
```

The caller supplies actual Vue functions. useStore rejects a missing scope rather than leaking a subscription. Outside setup, connect returns a ref plus stop function that the caller must invoke.

## SSR

Use useStore(store, { ssr: true }) for a one-time snapshot without a long-lived subscription. The host still owns initial state serialization and renderer integration.

## Legacy primitives

createVueRef is a framework-independent primitive, not Vue's native ref. fromVueRef without a subscription callback does not watch future writes. Use injected Vue watch for real reactive interoperability, and dispose synchronization on teardown.

## Install and select the integration

```sh
npm install @zeruxjs/vue@0.0.3
```

There is no automatic `vue` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.3/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.3/typescript.md).

## A practical integration workflow

For Vue components, install Vue separately and inject its real shallowRef/readonly/watch/effect-scope APIs through createVueBindings. The standalone createVueRef primitive is not a real Vue ref and does not automatically participate in Vue tracking. Connect a stable store inside setup/effect scope or keep an explicit stop function for connections outside it.

## TypeScript: inputs, results and ownership

```ts
import { createVueRef } from '@zeruxjs/vue';

type Inputs = Parameters<typeof createVueRef>;
type Result = Awaited<ReturnType<typeof createVueRef>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createVueRef>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.3/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

SSR reads should use the snapshot mode without leaving long-lived subscriptions. Stop mappings, combined refs and two-way synchronization on owner teardown. Equal-value checks prevent feedback loops, but do not replace a clear single source of truth. Verify scope absence, unmount, SSR and client updates with the real Vue runtime.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### VueRuntime

Vue 3 runtime injection. Nothing imports Vue at module evaluation / during SSR.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `shallowRef` | `{value:T}` | No |
| `getCurrentScope` | `unknown` | No |
| `onScopeDispose` | `void` | No |
| `readonly` | `T` | Yes |
| `watch` | `()=>void` | Yes |

### VueStore

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `getSnapshot` | `T` | No |
| `subscribe` | `()=>void` | No |

### SubscribableRef

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `subscribe` | `()=>void` | No |


## Public entry points

Manifest reference for `@zeruxjs/vue@0.0.3`.

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

# @zeruxjs/vue

Framework-independent ref primitives and observable/state-store adapters for Vue integrations.

```ts
const count=createVueRef(0);
const doubled=mapVueRef(count, n=>n*2);
const sum=combineVueRefs([count,doubled]);
count.value++;
doubled.stop();sum.stop();

// Two-way state synchronization (call stop on teardown):
const stop=syncVueRef(count, externalStore);
stop();
```

`syncVueRef` prevents write-feedback loops and returns explicit cleanup. `observableToVueRef` exposes an immutable ref view with subscription and stop, and `fromVueRef`/branch/v0.0.4/`bindVueRef` remain compatible with earlier versions. This package does **not** install Vue plugins or automatically use Vue reactivity APIs; pass adapter results to your framework code.

## Section 78: Vue 3 effect-scope bindings

`createVueBindings` injects Vue APIs instead of hard-importing Vue. It is compatible with effect scopes, `setup()`, and SSR when the host supplies Vue's actual runtime functions. The legacy standalone `createVueRef` is **not** a Vue `ref` and `fromVueRef()` without a subscription callback does not observe future writes. Prefer `createVueBindings`:

```ts
import {shallowRef,readonly,getCurrentScope,onScopeDispose,watch} from 'vue';
import {createVueBindings} from '@zeruxjs/vue';
const bridge=createVueBindings({shallowRef,readonly,getCurrentScope,onScopeDispose,watch});
// inside setup() / effectScope.run():
const count=bridge.useStore(externalStore);
// inside SSR setup(): do not leave a long-lived external subscription
const ssrCount=bridge.useStore(externalStore,{ssr:true});
// outside setup(), caller must tear down explicitly:
const {ref,stop}=bridge.connect(externalStore);
stop();
```

`useStore` rejects missing scopes rather than silently leaking subscriptions. SSR mode reads a one-time snapshot and creates **no external subscription**. `fromRef` uses a synchronous Vue `watch` and returns an unsubscriber. If a read races subscription setup, the bridge re-reads after subscribing. This package is not a Vue plugin and **has not been certified against a live Vue runtime** in the offline Section 78 test environment.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/vue/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/vue/README.md)
- [packages/@zeruxjs/vue/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/vue/package.json)
