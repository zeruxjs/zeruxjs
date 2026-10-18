---
{
  "title": "Vue state bridges",
  "description": "Inject real Vue 3 APIs and connect stores within an explicit effect scope.",
  "section": "Packages",
  "order": 29,
  "sources": [
    "packages/@zeruxjs/vue/README.md",
    "packages/@zeruxjs/vue/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/vue"
}
---

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

There is no automatic `vue` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

For Vue components, install Vue separately and inject its real shallowRef/readonly/watch/effect-scope APIs through createVueBindings. The standalone createVueRef primitive is not a real Vue ref and does not automatically participate in Vue tracking. Connect a stable store inside setup/effect scope or keep an explicit stop function for connections outside it.

## TypeScript: inputs, results and ownership

```ts
import { createVueRef } from '@zeruxjs/vue';

type Inputs = Parameters<typeof createVueRef>;
type Result = Awaited<ReturnType<typeof createVueRef>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createVueRef>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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
