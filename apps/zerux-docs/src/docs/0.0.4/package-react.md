---
{
  "title": "React stores and native rendering",
  "description": "Use independent store hooks and optional native React DOM mount, SSR and hydration entries.",
  "section": "Packages",
  "order": 28,
  "sources": [
    "packages/@zeruxjs/react/README.md",
    "packages/@zeruxjs/react/package.json",
    "packages/@zeruxjs/react/src/browser.ts",
    "packages/@zeruxjs/react/src/server.ts",
    "packages/@zeruxjs/react/src/hydration.mts"
  ],
  "related": [
    "frontend-ssr",
    "package-vue",
    "frontend"
  ],
  "package": "@zeruxjs/react"
}
---

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

There is no automatic `react` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Install React separately and inject its actual hooks through createReactBindings. Create a stable external store and selector functions, and choose equality based on the selected value. Bridge stores do not supply HTML rendering, routers or hydration transport. Treat request/user state as request-scoped on the server.

## TypeScript: inputs, results and ownership

```ts
import { createReactStore } from '@zeruxjs/react';

type Inputs = Parameters<typeof createReactStore>;
type Result = Awaited<ReturnType<typeof createReactStore>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createReactStore>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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
