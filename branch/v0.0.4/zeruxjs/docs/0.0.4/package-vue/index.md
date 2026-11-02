# Vue bindings and native rendering

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

There is no automatic `vue` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

For Vue components, install Vue separately and inject its real shallowRef/readonly/watch/effect-scope APIs through createVueBindings. The standalone createVueRef primitive is not a real Vue ref and does not automatically participate in Vue tracking. Connect a stable store inside setup/effect scope or keep an explicit stop function for connections outside it.

## TypeScript: inputs, results and ownership

```ts
import { createVueRef } from '@zeruxjs/vue';

type Inputs = Parameters<typeof createVueRef>;
type Result = Awaited<ReturnType<typeof createVueRef>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createVueRef>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `shallowRef` | `{value:T}` | No |
| `getCurrentScope` | `unknown` | No |
| `onScopeDispose` | `void` | No |
| `readonly` | `(value:{value:any}) => {readonly value:any}` | Yes |
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

Manifest reference for `@zeruxjs/vue@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "import": "./dist/browser.js",
      "require": "./dist/browser.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js",
      "require": "./dist/server.js"
    },
    "./dist/*": "./dist/*",
    "./package.json": "./package.json",
    "./rendering": {
      "types": "./dist/rendering.d.ts",
      "import": "./dist/rendering.js",
      "require": "./dist/rendering.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "@vue/runtime-dom": "~3.5.44",
    "@vue/server-renderer": "~3.5.44",
    "vue": "~3.5.44"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/vue

Standalone ref helpers, injected Vue scope bindings and optional native Vue
rendering. Core imports do not load Vue. The standalone `createVueRef` remains a
plain subscribable object, **not** a native Vue ref/proxy.

## Entry points and peers

| Public entry | Implemented responsibility |
| --- | --- |
| `@zeruxjs/vue` | Standalone ref/store adapters and injected `createVueBindings`; no UI runtime dependency |
| `@zeruxjs/vue/rendering` | Explicit component/view validation and per-app context key/types; imports Vue types only |
| `@zeruxjs/vue/browser` | Lazy runtime-only createApp/createSSRApp, mount/update/unmount and native hydration |
| `@zeruxjs/vue/server` | Lazy fresh-app string SSR through Vue's compiler-free server-renderer build |

Install matching optional peers only when using the native entries:

```sh
npm install @zeruxjs/vue@0.0.4 vue@3.5.44 @vue/runtime-dom@3.5.44 @vue/server-renderer@3.5.44
# Used only by the public-state example below:
npm install @zeruxjs/security@0.0.4
```

The intentional peer range is Vue 3.5.44+ within the 3.5 minor line; server peer
versions must match exactly. Vue's own dependencies should resolve to the same
runtime, not a bundled second copy. The exercised version is 3.5.44. Core APIs
remain usable without those peers; renderer calls fail with a fixed
`VUE_DEPENDENCY_UNAVAILABLE` when dependencies/required exported builds are absent.
Vue ships its own types. Browser code needs a host bundler; the package currently
emits CommonJS and does not provide browser assets automatically. Its server entry
is Node-oriented; qualification used Node 24.15.0 and Vue's exported ESM bundler
server build. No API silently registers a plugin or replaces ZyroJS in ZeruxJS.

## Runtime-only components, not request-time templates

Native entries accept a `VueRenderView` from `createVueView(component,props?)`.
Use authored `setup`/branch/v0.0.4/`render` functions, functional components, or already-built
render/ssrRender output. Static component graphs (local components, mixins,
extends) are checked with bounded traversal; template/compilerOptions fields and
inheritance cycles reject before app initialization. Shallow prop bags are
snapshotted with protected/prototype/accessor keys rejected; native ref/proxy values
are preserved, not JSON-cloned. Components and callbacks are trusted application
code, never executable objects loaded from clients.

Both native entries load `@vue/runtime-dom` and reject a realm where a runtime
compiler has been registered. Use runtime-only imports/aliases; Node's full `vue` entry can
register a compiler globally and is not a compatible browser runtime for this
adapter. External SSR compiler output must also resolve its helper imports to the
compiler-free build, not the Node CJS server-renderer that registers a full Vue
compiler. Server rendering deliberately uses the publicly exported
`@vue/server-renderer/dist/server-renderer.esm-bundler.js`: Vue's maintained build
throws instead of compiling nested templates on the fly. No eval, string template
execution or custom template parser is added. See Vue's [build distinctions](https://github.com/vuejs/core/blob/v3.5.44/packages/vue/README.md)
and [render functions](https://vuejs.org/guide/extras/render-function.html).

This package adds **no SFC/template compiler integration**. Compile authored .vue
files in an explicit external build step, retaining source maps in that pipeline.
Generated JavaScript must still pass the host's client/server import checks; it is
not exempt from server-only import restrictions. The framework's closed local ESM
compiler does not bundle bare Vue dependencies or compile .vue files. Do not claim
that importing this adapter creates a Vite/Nuxt pipeline.

## Minimal component, SSR and hydration example

Only the component definition/bindings are module-level; each setup creates its
own source. The source below uses the legacy standalone API intentionally and is
converted explicitly to a real scoped Vue ref.

```ts title="counter.ts"
import * as Vue from '@vue/runtime-dom';
import {createVueRef, fromVueRef, createVueBindings} from '@zeruxjs/vue';
import {VUE_RENDER_CONTEXT} from '@zeruxjs/vue/rendering';
const bindings = createVueBindings(Vue);
export function publicProps(input: unknown): {initial: number; label: string} {
  const value = input as {initial?: unknown; label?: unknown} | null;
  if (!value || !Number.isSafeInteger(value.initial) || (value.initial as number) < 0 ||
      typeof value.label !== 'string' || Object.keys(value).some(k => !['initial','label'].includes(k)))
    throw Error('Invalid public state');
  return {initial: value.initial as number, label: value.label};
}
export const Counter = Vue.defineComponent({
  props: {initial: {type: Number, required: true}, label: {type: String, required: true}},
  setup(props) {
    const context = Vue.inject(VUE_RENDER_CONTEXT);
    if (!context) throw Error('Explicit render context required');
    const source = createVueRef(props.initial);
    const store = fromVueRef(source, notify => source.subscribe(() => notify()));
    const count = bindings.useStore(store, {ssr: context.ssr});
    const doubled = Vue.computed(() => count.value * 2);
    const id = Vue.useId();
    return () => Vue.h('button', {id, onClick: () => {
      if (!context.signal.aborted) source.value++;
    }}, `${props.label}: ${doubled.value}`);
  }
});
```

```ts title="server-example.ts"
import {renderVueToString} from '@zeruxjs/vue/server';
import {createVueView} from '@zeruxjs/vue/rendering';
import {serializeJsonForScript} from '@zeruxjs/security/encoding';
import {Counter, publicProps} from './counter.js';
const state = publicProps({initial: 2, label: 'Count'}); // one public projection per request
const html = await renderVueToString(createVueView(Counter, state), {idPrefix: 'counter'});
const page = `<main id="app">${html}</main>` +
  `<script id="app-state" type="application/json">${serializeJsonForScript(state)}</script>`;
// The host owns sending page, its CSP and the bundled browser entry.
```

```ts title="browser-example.ts"
import {hydrateVue} from '@zeruxjs/vue/browser';
import {createVueView} from '@zeruxjs/vue/rendering';
import {Counter, publicProps} from './counter.js';
const state = publicProps(JSON.parse(document.querySelector('#app-state')!.textContent!));
const app = await hydrateVue(createVueView(Counter, state), document.querySelector('#app')!, {
  idPrefix: 'counter'
});
// Later props update: await app.update(createVueView(Counter, {...state, label: 'Total'}));
// Route/owner teardown: await app.unmount();
```

`initial` initializes component-owned state once; a props update retains that
state when the component type is unchanged. For client-only output use mountVue.
Nothing serializes component definitions, refs, store callbacks or arbitrary props
automatically. The host must select/validate public fields and serialize them for
their script context; never expose credentials/private state or treat a hydration
payload/idPrefix as authorization. The example's script encoder is separate from
Vue's native HTML escaping. User-authored innerHTML remains a separate trusted
sanitization policy. Use a fresh store/app/request context per principal.

## Root and render ownership

`mountVue(view,element,options)` and `hydrateVue` reserve one owner per element,
lazily load peers and create a fresh native app. `update(view)` uses a shallowRef
and native vnode reconciliation, then awaits nextTick; it does not remount a
same-type component. Native render failures reject updates with retained causes;
only preflight validation preserves the prior tree, not a transactional DOM rollback.
`unmount()` returns an idempotent cleanup Promise: it stops
the native app first, drains all registered async disposers, then releases the
container even on failure. Await it before reusing the root. An old handle cannot
unmount a replacement app. App/plugin configuration and a mutable native App
object are deliberately not exposed.

Each app provides `VUE_RENDER_CONTEXT` with `{ssr,signal,onDispose}`. Register
request/root-owned resources during setup with `context.onDispose` (maximum 32,
reverse order); use native onScopeDispose for native component resources. Native
SSR does not promise to run component unmount hooks: use SSR snapshot mode for
external stores and explicit request disposers for resources. The optional
`onDispose` option runs after context disposers. Input/preflight rejection does
not transfer caller resources; accepted preparation failure still drains the
lease. Independent disposers are attempted even when one fails.

Abort closes a browser app; the handle retains cleanup failures for explicit
awaited unmount and bounded diagnostics. SSR forwards the signal through the
context, waits for actual native settlement and drains the lease on completion,
failure or cancellation. Async setup/server-prefetch work must cooperate with the
signal; arbitrary JavaScript/Promises are not force-cancelled. Native SSR may
continue settling failed parallel work internally; register ownership before
awaiting and keep async work cooperative. No telemetry starts on import.

`renderVueToString(view,{signal?,idPrefix?,maxBytes?,onError?,onDispose?})` creates a
new SSR app/context per call. HTML defaults to a 1 MiB post-render output cap
(maximum 16 MiB); this is not a pre-allocation/execution-time bound inside trusted
Vue code. The native renderer awaits async setup/prefetch. Streaming and SSR
teleport output are unavailable: teleports require a separate explicit target
output contract and reject rather than silently disappearing. The capability API
reports only implemented string SSR, hydration and precompiled-only templates.

`idPrefix` must be the same bounded identifier on server/client, unique per root
on a page. It is never an auth nonce. Hydration requires matching component code,
public state and valid HTML. Vue warnings/errors are retained as fixed-code
VueAdapterError records (16 per app, droppedErrors counts overflow); original
causes remain private trusted diagnostics. onError failures are also retained.
SSR never returns HTML after recorded render errors/warnings. Browser native
hydration recovery remains Vue-owned; it is not a strict mismatch algorithm.

**Controlled forms follow Vue, not React or ZyroJS, semantics.** Qualification
confirmed that hydrating `value: model.value` overwrites a pre-hydration input edit
with the supplied model. Native input events then update that model normally.
Preserving earlier edits requires an explicit application reconciliation policy;
this adapter does not invent one. Retained detached elements may still carry Vue's
native direct event callbacks until GC; do not keep them interactive after
unmount. Context signal guards (as in the example) can fence such callbacks.
Watchers/subscriptions are stopped; no private Vue event-invoker manipulation is
used to claim full DOM listener parity. Layout/cross-engine behavior is unverified.

## Existing standalone helpers and injected bindings

`createVueRef` is a subscribable value with Object.is change suppression, not
Vue.isRef-compatible and not proxy-tracked. mapVueRef/combineVueRefs own explicit
stop handles; syncVueRef prevents write feedback and returns cleanup.
observableToVueRef is a structural read-only view with stop. fromVueRef without a
subscription callback still observes no future writes. These APIs are retained.

`createVueBindings` still accepts supplied shallowRef/getCurrentScope/
onScopeDispose/readonly/watch functions. useStore requires an active Vue scope,
uses readonly when supplied, and owns its external subscription through that
scope. `{ssr:true}` reads one snapshot without subscribing. connect outside a
scope returns an explicit stop. Views now express read-only value types; write to
the source or a native ref rather than mutate a subscription view. Omitting
readonly preserves the legacy raw-ref implementation; supply native readonly or
shallowReadonly for runtime protection. Native ref unwrapping/proxy behavior is
left to the injected runtime. fromRef uses native synchronous watch, whose scope
or explicit unsubscriber owns its lifetime. Failing initial reads/subscription
setup roll back when a disposer is available; a custom source that throws without
returning its native disposer owns its own rollback.

## ZeruxJS integration and verification

Register only through the existing generation-owned `api.renderers()` contract,
for example `createVueRenderer(renderVueToString)` from `zeruxjs/renderers` for
simple static HTML. To forward request cancellation into async SSR, register an
explicit registry adapter whose render(view,context) calls renderVueToString(view,
{signal:context.signal}) and returns `{kind:'html',html}`. The application selects
its token through its own configuration; no default/global adapter replaces
ZyroJS. The framework still supplies no automatic Vue browser bundling/hydration.

From this package run npm run build and focused tests:

```sh
node --test test/advanced.test.mjs test/integration.test.mjs test/vue-scope.test.mjs test/renderer-server.test.mjs test/renderer-dom.test.mjs test/renderer-public.test.mjs test/renderer-framework.test.mjs
```

Tests use real Vue 3.5.44 plus development-only jsdom 30.1.3 on Node 24.15.0.
jsdom is DOM emulation, not a real browser. They verify native ref/computed/watch
updates, scope teardown, controlled hydration, SSR isolation and failure cleanup.
The packed fixture verifies standalone imports without peers, missing-peer
failures, installed public exports/types and this example; no source alias proves
publication. Framework requests use an ephemeral local server that is closed.
No user-managed app is started. Real-browser layouts, other Vue versions and
external SFC/compiler pipelines remain separate prerequisites. Read the official
[application API](https://vuejs.org/api/application.html) and [SSR guide](https://vuejs.org/guide/scaling-up/ssr.html)
for Vue's own semantics; no complete Nuxt/Vue feature parity is promised.


## Implementation sources

- [packages/@zeruxjs/vue/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/vue/README.md)
- [packages/@zeruxjs/vue/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/vue/package.json)
- [packages/@zeruxjs/vue/src/browser.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/vue/src/browser.ts)
- [packages/@zeruxjs/vue/src/server.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/vue/src/server.ts)
- [packages/@zeruxjs/vue/src/rendering.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/vue/src/rendering.ts)
