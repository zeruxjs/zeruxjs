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
