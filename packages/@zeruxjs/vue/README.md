# @zeruxjs/vue

Standalone ref helpers, injected Vue scope bindings and optional native Vue
rendering. Core imports do not load Vue. The standalone `createVueRef` remains a
plain subscribable object, **not** a native Vue ref/proxy.

## Entry points and peers

| Public entry             | Implemented responsibility                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `@zeruxjs/vue`           | Standalone ref/store adapters and injected `createVueBindings`; no UI runtime dependency |
| `@zeruxjs/vue/rendering` | Explicit component/view validation and per-app context key/types; imports Vue types only |
| `@zeruxjs/vue/browser`   | Lazy runtime-only createApp/createSSRApp, mount/update/unmount and native hydration      |
| `@zeruxjs/vue/server`    | Lazy fresh-app string SSR through Vue's compiler-free server-renderer build              |

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
Use authored `setup`/`render` functions, functional components, or already-built
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
node --experimental-strip-types --test test/advanced.test.ts test/integration.test.ts test/vue-scope.test.ts test/renderer-server.test.ts test/renderer-dom.test.ts test/renderer-public.test.ts test/renderer-framework.test.ts
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
