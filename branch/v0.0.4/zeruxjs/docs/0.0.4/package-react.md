# React stores and native rendering

Use independent store hooks and optional native React DOM mount, SSR and hydration entries.


## Inject React APIs

```tsx
import { createReactBindings, createReactStore } from '@zeruxjs/react';
import { useMemo, useSyncExternalStore, useCallback } from 'react';
const bindings = createReactBindings({ useMemo, useSyncExternalStore });
const store = createReactStore({ count: 0 });
/** Render counter state. @returns A button. Reads the explicitly owned store. */
function Counter() {
  const selector = useCallback((state: { count: number }) => state.count, []);
  const count = bindings.useSelector(store, selector);
  return <button onClick={() => store.update(s => ({ count: s.count + 1 }))}>{count}</button>;
}
```

Use the real React hooks inside components. Stable selectors and equality prevent accidental snapshot churn. Core imports do not load React DOM or register an application renderer. Optional native entries use matching host peers.

## SSR and hydration

Provide a stable server snapshot and serialize the same initial state into the client hydration payload. Do not let a shared server singleton leak one user's state into another request. The optional native renderer entries supply explicit HTML/mount/hydration APIs; they do not add automatic state transport, route transitions or framework renderer selection.

## Native renderer entries

Use `@zeruxjs/react/server` for lazy `renderReactToString` (hydratable SSR) or
`renderReactToStaticMarkup` (non-hydratable static HTML). The server import runs
without DOM globals and does not load the client entry. `@zeruxjs/react/browser`
wraps native createRoot/hydrateRoot with explicit update/unmount and one owner per
element container. Acquisition is asynchronous; React commit/scheduling is separate.
Unmount releases subscriptions and runs the accepted owner's explicit onDispose,
including peer-load failure or later abort. Preflight rejection does not transfer
ownership. Strict Mode probes do not destroy the host's store.

React/React DOM are optional peers, never bundled copies. Keep identical versions
and one React module resolution for component hooks and React DOM. Qualification
uses 19.3.1; the declared React 18/19 API range is not full-version certification.
The core entry remains usable without React DOM. Browser bundles are host-owned;
the framework's closed local ESM compiler does not bundle bare client packages.

`@zeruxjs/react/hydration` is an ESM-only bounded codec. Create one public state
projection per request with createReactHydrationState; its pinned server snapshot
is exactly the independently script-encoded payload. Restore with
readReactHydrationState and the same validator/prefix, then pass that store to the
same React tree. Invalid/private/executable JSON state rejects; a non-idempotent
client validator is not allowed to alter serialized state. The README has a
complete three-file example, checked against packed public exports.

Data belongs in a fixed application/json script text sink, not an attribute or
existing JavaScript string. React owns HTML encoding; private component props and
store objects are never automatically serialized. Schema projection, tenant
permissions, consent and authorization remain host responsibilities.

Native hydration mismatches follow React recovery and produce bounded fixed-code
errors. Original causes are retained for trusted diagnostics, not sent to clients.
The adapter reports no streaming/RSC/server-action support. Native renderToString
cannot await suspended data; HTML limits apply after rendering and signals cannot
interrupt synchronous component code. Prefixes must match on both ends and are
identifiers, not authorization tokens.

Real React/React DOM and development-only jsdom checks cover Strict Mode, selector
stability, hydration/input retention and cleanup. jsdom is not a live browser:
layout, cross-engine behavior and other React versions require separate acceptance.

## Ownership

Batch/transaction operations coordinate store notifications. Observable adapters bridge structural stores without bundling Zyro. Unsubscribe on owner teardown; if a store is shared, its lifetime must be intentional.

## Install and select the integration

```sh
npm install @zeruxjs/react@0.0.4
```

There is no automatic `react` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Install React separately and inject its actual hooks through createReactBindings. Create a stable external store and selector functions, and choose equality based on the selected value. Bridge stores do not supply HTML rendering, routers or hydration transport. Treat request/user state as request-scoped on the server.

## TypeScript: inputs, results and ownership

```ts
import { createReactStore } from '@zeruxjs/react';

type Inputs = Parameters<typeof createReactStore>;
type Result = Awaited<ReturnType<typeof createReactStore>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createReactStore>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Serialize exactly the server snapshot used for rendering into the client hydration input. A shared mutable server singleton can leak data between users. Unsubscribe on component/route teardown; injected hooks must be called under React hook rules. Test selector identity, SSR snapshots and unmount cleanup using the actual React runtime.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ExternalStore

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `getSnapshot` | `T` | No |
| `subscribe` | `() => void` | No |
| `getServerSnapshot` | `T` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/react@0.0.4`.

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
    "./hydration": {
      "types": "./dist/hydration.d.mts",
      "import": "./dist/hydration.mjs"
    },
    "./dist/*": "./dist/*",
    "./package.json": "./package.json"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/security": "0.0.4"
  },
  "peerDependencies": {
    "@types/react": "^18.3.0 || ^19.0.0",
    "@types/react-dom": "^18.3.0 || ^19.0.0",
    "react": "^18.3.1 || ^19.0.0",
    "react-dom": "^18.3.1 || ^19.0.0"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/react

External stores and injected hook bindings, plus opt-in native React DOM rendering.
The core entry imports neither React nor React DOM. Existing observable bridges
remain structural adapters; actual HTML, mount and hydration use separate entries.

## Entry points and peer policy

| Public entry | Implemented behavior |
| --- | --- |
| `@zeruxjs/react` | `createReactStore`, stable selectors, injected hooks, observable adapters; usable without React DOM |
| `@zeruxjs/react/browser` | Lazy native `createRoot` / `hydrateRoot`, explicit update/unmount ownership |
| `@zeruxjs/react/server` | Lazy native `renderToString` / `renderToStaticMarkup`; no DOM globals needed |
| `@zeruxjs/react/hydration` | ESM-only, bounded public-state codec and request-owned pinned server snapshots |

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


## Implementation sources

- [packages/@zeruxjs/react/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/react/README.md)
- [packages/@zeruxjs/react/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/react/package.json)
- [packages/@zeruxjs/react/src/browser.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/react/src/browser.ts)
- [packages/@zeruxjs/react/src/server.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/react/src/server.ts)
- [packages/@zeruxjs/react/src/hydration.mts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/react/src/hydration.mts)
