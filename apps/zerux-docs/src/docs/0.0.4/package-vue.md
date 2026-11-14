---
{
  "title": "Vue bindings and native rendering",
  "description": "Inject real Vue 3 APIs and connect stores within an explicit effect scope.",
  "section": "Packages",
  "order": 29,
  "sources": [
    "packages/@zeruxjs/vue/README.md",
    "packages/@zeruxjs/vue/package.json",
    "packages/@zeruxjs/vue/src/browser.ts",
    "packages/@zeruxjs/vue/src/server.ts",
    "packages/@zeruxjs/vue/src/rendering.ts"
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
import { shallowRef, readonly, getCurrentScope, onScopeDispose, watch, effectScope } from '@vue/runtime-dom';
import { createVueBindings } from '@zeruxjs/vue';
const bridge = createVueBindings({ shallowRef, readonly, getCurrentScope, onScopeDispose, watch });
const externalStore = {
  getSnapshot: () => 42,
  subscribe: (_notify: () => void) => () => {},
};
const scope = effectScope();
try {
  scope.run(() => {
    const state = bridge.useStore(externalStore);
    console.log(state.value);
  });
} finally {
  scope.stop();
}
```

The caller supplies actual Vue functions. useStore rejects a missing scope rather than leaking a subscription. Outside setup, connect returns a ref plus stop function that the caller must invoke.

## SSR

Use useStore(store, { ssr: true }) for a one-time snapshot without a long-lived subscription. The host still owns initial state serialization and renderer integration.

## Legacy primitives

createVueRef is a framework-independent primitive, not Vue's native ref. fromVueRef without a subscription callback does not watch future writes. Use injected Vue watch for real reactive interoperability, and dispose synchronization on teardown.

## Opt-in native runtime entries

`@zeruxjs/vue/browser` owns native runtime-only mount/update/unmount and hydration.
`@zeruxjs/vue/server` uses a new app per render and Vue's exported compiler-free
server-renderer build. `@zeruxjs/vue/rendering` validates explicit component/view
registrations and exports the app-scoped context key. Core standalone helpers
still import no Vue. Optional peers target matching Vue/runtime-dom/server-renderer
3.5.44+ within the 3.5 line; qualification uses 3.5.44.

Author render/setup functions or use externally precompiled output. This package
adds no SFC/compiler pipeline: templates/compiler options reject, nested server
templates hit a compiler-free stub, and native renderer realms with a registered runtime
compiler reject. External SSR helper imports must also resolve compiler-free builds. Build-generated code still needs source maps and host import
boundary validation; no client authorization comes from a compiler label.

Each app provides VUE_RENDER_CONTEXT with SSR mode, a cooperative AbortSignal and
bounded explicit disposers. Native component scopes stop watchers on unmount;
SSR bridges must use snapshot mode, because SSR does not run component unmount
hooks. Register request resources before awaiting and await explicit teardown.
Errors retain private causes in bounded fixed-code records. SSR teleport targets
and streaming are unsupported rather than silently dropped.

Use the same public state/tree/idPrefix on both sides. Vue's controlled input
hydration replaces a prior DOM edit with the model; subsequent native events
update normally. Retained detached nodes may still have direct native listeners,
so guards can check the render signal. No cross-framework form/focus parity is
claimed. The README supplies the public-import example, checked from installed
archives. Actual Vue/jsdom checks are DOM emulation, not real-browser acceptance.

Only register a framework renderer through api.renderers(); explicitly forward
its context.signal for async SSR. No token/default renderer, bundle or client
hydration transport is selected automatically. Keep one source/app per request
and never serialize private callbacks, refs or credentials as hydration props.

## Install and select the integration

```sh
npm install @zeruxjs/vue@0.0.4
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

Core Vue runtime injection loads no UI runtime on import; optional native entries load peers only when called.

| Field             | Accepted type/value                           | Optional |
| ----------------- | --------------------------------------------- | -------- |
| `shallowRef`      | `{value:T}`                                   | No       |
| `getCurrentScope` | `unknown`                                     | No       |
| `onScopeDispose`  | `void`                                        | No       |
| `readonly`        | `(value:{value:any}) => {readonly value:any}` | Yes      |
| `watch`           | `()=>void`                                    | Yes      |

### VueStore

| Field         | Accepted type/value | Optional |
| ------------- | ------------------- | -------- |
| `getSnapshot` | `T`                 | No       |
| `subscribe`   | `()=>void`          | No       |

### SubscribableRef

| Field       | Accepted type/value | Optional |
| ----------- | ------------------- | -------- |
| `subscribe` | `()=>void`          | No       |

## Ownership and compatibility details

`toVueReadable`, `mapVueRef`, `combineVueRefs` and `observableToVueRef` own
subscriptions and expose `stop()`. `bindVueRef` and `syncVueRef` return a function
disposer. None destroys a borrowed source. `createVueRef` and `fromVueRef` alone
create no native watcher. Keep manual owners even when a lint rule cannot prove
eventual disposal; the rule detects immediately discarded handles only.

The derived standalone refs retain their legacy writable TypeScript shape, but
runtime writes throw. Readonly protection in injected bindings requires the
runtime's `readonly` function; without it the returned type alone does not prevent
runtime mutation. Callbacks run synchronously and are trusted application code.
Legacy two-way/combined cleanup calls source disposers in order; a throwing
source disposer can prevent later disposers from running. Native render leases
instead attempt all registered cleanup callbacks and report aggregated failures.

An update failure does not roll back native DOM changes. SSR checks its byte
ceiling after native rendering has allocated the complete string, and cancellation
waits for cooperative work to settle. These are output/lifecycle limits, not
forced JavaScript cancellation or preallocation memory quotas.
