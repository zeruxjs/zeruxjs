# Frontend state and SSR ownership

Use React/Vue/observable bridges while keeping rendering and hydration responsibilities explicit.


## A bridge is not a renderer

@zeruxjs/react, @zeruxjs/vue and @zeruxjs/zyro coordinate state and subscriptions. They do not automatically turn a Zerux HTML-string route into a React/Vue server-rendering pipeline. The host renderer owns component rendering, state serialization, client assets and hydration.

## Request-local server stores

Create state per request when it includes private/user-specific data. A module singleton can accidentally share identity or cart data across requests. Browser stores can live as long as the intentionally shared application shell; route-owned subscriptions should be disposed on navigation/unmount.

## React snapshots

createReactStore supports a pinned serverSnapshot. Supply the same shape/value through the initial hydration payload and a stable getServerSnapshot on the client. Stabilize selectors with useCallback or a module function; a selector allocating a new object on every read needs an appropriate comparator/memoization strategy.

Injected useMemo/useSyncExternalStore must be real React hooks invoked within components. The adapter does not own React's component lifetime. Do not run a hook function at module top level because it has a use-style name.

## Vue scopes

createVueBindings receives actual Vue runtime functions. useStore expects an active effect scope and disposes with it. SSR mode reads a one-time snapshot and creates no live external subscription. Outside a scope, connect returns an explicit stop function. The standalone createVueRef primitive is not a native Vue ref.

## Observable resources

Selected/combined observables retain stable snapshots. Async resources pass an AbortSignal, cancel older work and ignore stale completions. Use a subscription scope for all route-owned observers and destroy it on leave. A canceled UI request should not mutate an already-destroyed route view.

## Safe initial state

Serialize only an allowlisted public projection. Never send runtime/context/service objects or process.env to a browser. If JSON is embedded inside an HTML script payload, escape the HTML-breaking characters with a proven serializer; JSON.stringify alone does not make an arbitrary string safe inside an HTML script element. Keep the client and server snapshot consistent after sanitization.

## Accessibility

A state change does not automatically announce itself. Author semantic buttons, tabs and panels with correct references. Dispose focus/dialog helpers on teardown and test keyboard focus after route changes. Reduced-motion behavior and screen-reader announcements belong to the user interaction design, not just state adapters.

## TypeScript snapshots and serialization

Define a narrow public snapshot rather than serializing server context or manager options. For example, an interface describing a counter and display name is useful shared data; it must not grow to include session keys or database configuration just because those fields are available on the server.

```ts
interface PublicSnapshot { count: number; displayName: string }
const initial = { count: 0, displayName: 'Guest' } satisfies PublicSnapshot;
```

The host must serialize the same snapshot used during server rendering and supply it at hydration. TypeScript checks the shape, not whether a client received a different value or whether untrusted text was escaped for a script context. Use script-safe JSON serialization and the actual renderer's documented hydration behavior.

## Concurrency and teardown

Render two users concurrently with different initial state and verify neither sees the other's snapshot. Dispose effects/subscriptions created during an SSR owner rather than leaving browser-style subscriptions in a long-lived server process. On the client, verify hydration, updates and unmount with the real React/Vue/Zyro integration, not only a structural fake store.

A store adapter does not implement a complete SSR renderer, route transport or generic hydration engine. Keep capability statements tied to the actual library and release; choose an explicit static renderer or component integration rather than inferring one from a package name.


## Implementation sources

- [packages/@zeruxjs/react/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/react/README.md)
- [packages/@zeruxjs/vue/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/vue/README.md)
- [packages/@zeruxjs/zyro/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/zyro/README.md)
- [packages/@zeruxjs/accessibility/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/accessibility/README.md)
