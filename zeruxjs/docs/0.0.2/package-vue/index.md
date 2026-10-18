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


## Public entry points

Manifest reference for `@zeruxjs/vue@0.0.2`.

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

`syncVueRef` prevents write-feedback loops and returns explicit cleanup. `observableToVueRef` exposes an immutable ref view with subscription and stop, and `fromVueRef`/`bindVueRef` remain compatible with earlier versions. This package does **not** install Vue plugins or automatically use Vue reactivity APIs; pass adapter results to your framework code.

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


## Implementation sources

- [packages/@zeruxjs/vue/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/vue/README.md)
- [packages/@zeruxjs/vue/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/vue/package.json)
