# @zeruxjs/react

External stores and injected hook bindings, plus opt-in native React DOM rendering.
The core entry imports neither React nor React DOM. Existing observable bridges
remain structural adapters; actual HTML, mount and hydration use separate entries.

## Entry points and peer policy

| Public entry               | Implemented behavior                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `@zeruxjs/react`           | `createReactStore`, stable selectors, injected hooks, observable adapters; usable without React DOM |
| `@zeruxjs/react/browser`   | Lazy native `createRoot` / `hydrateRoot`, explicit update/unmount ownership                         |
| `@zeruxjs/react/server`    | Lazy native `renderToString` / `renderToStaticMarkup`; no DOM globals needed                        |
| `@zeruxjs/react/hydration` | ESM-only, bounded public-state codec and request-owned pinned server snapshots                      |

Install matching host peers, for example the exercised versions:

```sh
npm install @zeruxjs/react@0.0.4 react@19.3.1 react-dom@19.3.1
npm install --save-dev @types/react@19.3.0 @types/react-dom@19.3.0
```

Optional peer ranges permit React/React DOM 18.3.1 or stable 19.x. Native entries
validate the presence of APIs and identical React/React DOM versions. Current
qualification uses 19.3.1; other declared versions are API-compatible targets,
not separately certified. React is a peer, never bundled into this package;
applications must deduplicate React and resolve component hooks and React DOM to
the same copy. Matching versions cannot detect all duplicate same-version copies.
See React's [invalid-hook-call guidance](https://react.dev/warnings/invalid-hook-call-warning).
Core stores and injected hooks remain independently usable; optional peer failures
occur on renderer calls, with a fixed `REACT_DEPENDENCY_UNAVAILABLE` diagnostic.
TypeScript renderer consumers need matching React/React DOM type packages.

Core/browser/server currently emit CommonJS; browser use requires an explicit
bundler. The state codec is ESM so it can reuse the pure security encoders without
Node crypto/DOM imports; CommonJS hosts can use dynamic import for this subpath.
No import starts a root, fetch, application, telemetry or global renderer. The
framework's closed local ESM compiler does not automatically bundle bare React
packages. This integration supplies no route loader, RSC, server actions or complete
Next.js compatibility.

## Minimal SSR and hydration example

Use a component with an explicitly owned store. No per-user store is a module
singleton; only the stateless hook bindings/selector are shared.

```ts title="counter.ts"
import * as React from 'react';
import {createReactBindings, type WritableExternalStore} from '@zeruxjs/react';
export interface CounterState {count: number}
export function validateState(input: unknown): CounterState {
  const value = input as Partial<CounterState> | null;
  if (!value || !Number.isSafeInteger(value.count) || value.count! < 0 ||
      Object.keys(value).some(key => key !== 'count')) throw Error('Invalid public state');
  return {count: value.count!};
}
const bindings = createReactBindings(React);
const selectCount = (state: CounterState) => state.count;
export function Counter({store}: {store: WritableExternalStore<CounterState>}) {
  const count = bindings.useSelector(store, selectCount);
  return React.createElement('button', {
    id: React.useId(),
    onClick: () => store.update(state => ({count: state.count + 1}))
  }, 'Clicks: ', count);
}
```

```ts title="server-example.ts"
import * as React from 'react';
import {renderReactToString} from '@zeruxjs/react/server';
import {createReactHydrationState} from '@zeruxjs/react/hydration';
import {Counter, validateState} from './counter.js';
const state = createReactHydrationState({count: 0}, {
  identifierPrefix: 'counter', validateState
});
try {
  const html = await renderReactToString(React.createElement(Counter, {store: state.store}), {
    identifierPrefix: state.identifierPrefix
  });
  const page = `<main id="app">${html}</main>` +
    `<script id="app-state" type="application/json">${state.data}</script>`;
  // The host owns sending page, CSP and the bundled browser script.
} finally { state.dispose(); }
```

```ts title="browser-example.ts"
import * as React from 'react';
import {hydrateReact} from '@zeruxjs/react/browser';
import {readReactHydrationState} from '@zeruxjs/react/hydration';
import {Counter, validateState} from './counter.js';
const state = readReactHydrationState(document.querySelector('#app-state')!.textContent!, {
  validateState
});
try {
  const root = await hydrateReact(React.createElement(Counter, {store: state.store}),
    document.querySelector('#app')!, {
      identifierPrefix: state.identifierPrefix, onDispose: state.dispose
    });
  // Later: root.update(React.createElement(Counter, {store: state.store}));
  // On owner/route teardown: root.unmount();
} catch (error) { state.dispose(); throw error; }
```

For client-only output use `mountReact(element, container, options)` with an empty
host-owned element. A root accepts a real React element or null; wrap other node
lists/values in a React Fragment. Only element containers are supported by this
wrapper, not whole-document/fragment roots. Each container gets one ownership
reservation, including while peers load. `update` delegates to native root.render;
`unmount` is idempotent, closes the native root before `onDispose`, removes abort
listeners and releases the container even if cleanup fails. Stale handles cannot
unmount a later root. External stores are borrowed unless the host explicitly
transfers their teardown using `onDispose`.

The async mount/hydrate result means **root acquisition, not React commit**.
Native scheduling, transitions and Strict Mode probes remain React-owned. React
Strict Mode's effect cleanup/remount is not a request to destroy a shared store;
root `onDispose` runs only for the accepted owner, including failed peer loading or
later cancellation. Preflight failures (invalid/duplicate containers or an already
aborted signal) leave caller-owned resources with the caller. A signal abort
unmounts an accepted root; it cannot force-interrupt JavaScript rendering or native
module loading. Pending calls check cancellation when module loading settles. Do not
update a hydrating root before React commits: [React documents that an early root.render
can discard server HTML](https://react.dev/reference/react-dom/client/hydrateRoot).

## Native SSR capabilities and errors

`renderReactToString(element,{identifierPrefix?,signal?,maxBytes?})` uses actual
React DOM SSR and produces hydration-capable output. `renderReactToStaticMarkup`
is explicitly non-hydratable. `getReactServerCapabilities()` reports the installed
version and these string-render capabilities; streaming is false. Native
[renderToString](https://react.dev/reference/react-dom/server/renderToString) is
synchronous, cannot wait for data and has limited Suspense support. This adapter
rejects incomplete string-SSR boundary markers with `REACT_INCOMPLETE_SSR`, rather
than exposing development fallback templates containing private error details.
Completed Suspense boundaries work; streaming/data waiting is unsupported. There
is no RSC or custom parser. Preload/authorize data before rendering;
caller-created SSR resources remain caller-owned and belong in finally blocks.

The HTML byte limit defaults to 1 MiB, capped at 16 MiB, and is checked after native
rendering. It does not bound allocations or execution time inside trusted component
code. Signals are checked before/after peer loading and synchronous rendering;
a same-thread timer cannot stop a render. `identifierPrefix` is empty by default
or a bounded HTML-safe identifier (48 characters); hydration must use the exact
server prefix and the same tree. It is not an authorization nonce.

Client recoverable errors are retained as fixed-code `ReactAdapterError` records;
React 19 additionally supplies caught/uncaught error callbacks, whereas React 18
requires application error boundaries for those errors. At most 16 records are
retained per root; `droppedErrors` counts overflow. `onError` is an explicit trusted
observer. Observer exceptions are retained as `REACT_OBSERVER_FAILED`; no private
stack, DOM diff or payload is logged by this adapter. Original native errors are
available through non-enumerable `cause` for trusted diagnostics. Do not transmit
causes to clients. Native React hydration recovery is recorded, not silently called
successful matching. The wrapper does not invent a strict mismatch algorithm or
promise preserved form state for mismatched markup. Unmount/preparation failures
keep their cleanup/native causes and reject/throw coded errors.

## Exact public hydration state

`createReactHydrationState(input,{validateState,identifierPrefix,maxBytes?})`
creates a new immutable JSON snapshot, owned store and separately encoded `data`.
Its pinned `getServerSnapshot()` is exactly the state encoded in that payload,
even when client `getSnapshot()` is later updated. `readReactHydrationState` validates
version 1, prefix and public state, creates a new store, and rejects a validator
that changes the serialized value. Validators must be synchronous/idempotent on
already-normalized data. Use new objects for updates; do not mutate snapshots.

The required validator/projection owns privacy and authorization. Extra guards
reject functions, undefined/nonfinite values, sparse/cyclic arrays, accessors,
toJSON, class instances, prototype keys and obvious sensitive field names. A
secret under an innocent field name is not detectable: project public data only,
and never serialize React elements, store objects or arbitrary component props.
Defaults are 64 KiB encoded data (maximum 1 MiB), depth 16 and 4096 entries.
Data callbacks/getters are not executed by serialization. Input validation is trusted
application code and its original failures stay private causes.

Script-data encoding reuses `@zeruxjs/security/encoding` and independently escapes
`<`, `>`, `&`, U+2028/U+2029. Put data only in a fixed application/json script sink,
read textContent and parse through the helper; never HTML-escape it, eval it, put
it into an existing JS string/attribute, or treat it as identity/tenant proof.
React owns HTML context encoding; authored `dangerouslySetInnerHTML` remains a
separate trusted application policy. Each request must have its own state/store;
there is no global hydration-state registry. See React's
[server snapshot requirements](https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering).

## Existing injected bridge

`createReactBindings({useMemo,useSyncExternalStore})` still invokes real hooks
only inside components. Stabilize selectors/override callbacks using useCallback
or stateless module functions. `useReactSelector` caches a stable store/selector/
equality/server-read combination; the binding factory uses React's useMemo.
Selected client and server snapshots retain references according to equality
(default Object.is), including explicit serverSnapshot overrides. Failed selector
projections do not poison later reads. Use immutable snapshots and stable server
callbacks; the package does not clone ordinary store values automatically.

`createReactStore` supports synchronous batched updates, a pinned optional
`serverSnapshot` and idempotent unsubscribe/destroy. `selectReactStore` filters
unrelated notifications. `observableToReactStore` and `reactStoreToObservable`
retain their structural contracts without importing a UI runtime. They do not
supply a server snapshot automatically. No API selects a default framework renderer.
For ZeruxJS static SSR explicitly register
`createReactRenderer(renderReactToString)` from `zeruxjs/renderers`; browser
hydration, serialized state delivery and bundle ownership remain host-owned.

## Focused verification

Build this package and required dependencies locally, then run:

```sh
node --test test/advanced.test.mjs test/integration.test.mjs test/ssr-lifecycle.test.mjs test/renderer-server.test.mjs test/renderer-dom.test.mjs test/renderer-public.test.mjs test/renderer-framework.test.mjs
```

Native SSR and React DOM checks use React/React DOM 19.3.1. jsdom 30.1.3 is a
**development-only DOM emulator** (requires Node 22.22.2+, 24.15+ or 26+), not a live
browser. Tests execute real Strict Mode probes, hooks, hydration, input edits,
cancellation and unmount; they do not certify browser layout/focus, other React
versions or every renderer feature. Packed fixtures verify core imports without
React DOM, missing-peer diagnostics, installed public declarations and the example.
Ephemeral local framework requests verify real output/isolation and close their
server; no user-managed application is started. Live browser qualification needs
a separately configured functioning browser and application bundle.

## Ownership during parallel development

Keep root, store and subscription owners distinct. `createReactBindings`, selectors and structural observable bridges borrow stores; they do not destroy them. `createReactStore` owns its listeners, `mountReact`/`hydrateReact` own accepted native roots, and hydration create/read helpers own a fresh public store through `dispose()`. Preflight rejection leaves resources with the caller. Native root acquisition is asynchronous and remains separate from commit.

The focused DOM fixtures register successful root handles before assertions, unmount while their emulated window still exists, and restore original global descriptors afterward. Synthetic stores/subscriptions are released even when an assertion fails. These are React 19.3.1/jsdom checks, not browser layout, assistive-technology or all-peer-version certification.
