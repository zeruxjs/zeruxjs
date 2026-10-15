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
