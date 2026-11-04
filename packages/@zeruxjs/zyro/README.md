# @zeruxjs/zyro

Core observable state with batched notifications, stable selected snapshots, bridges and cancelable async resources.

```ts
import {createObservable,mapObservable,createAsyncObservable} from '@zeruxjs/zyro';
const state = createObservable({count:0});
const selected = mapObservable(state, v=>v.count);
state.batch(()=>{state.set({count:1});state.set({count:2})});

const resource = createAsyncObservable(async signal => {
 const response=await fetch('/api/data',{signal});
 if(!response.ok)throw Error('Load failed');
 return response.json();
});
await resource.refresh();
resource.destroy();
```

`mapObservable`/`combineObservables` memoize snapshots for `useSyncExternalStore` consumers. `awaitObservable` supports timeouts/AbortSignals and handles synchronous subscription notifications safely. `createAsyncObservable` aborts previous requests, rejects failures, ignores stale completions, and exposes `idle/loading/success/error` state with `reset()`, `cancel()` and `destroy()`.

## Route/component subscription scope

```ts
import {createObservable,createZyroSubscriptionScope} from '@zeruxjs/zyro';
const count=createObservable(0);
const scope=createZyroSubscriptionScope();
scope.observe(count,value=>console.log(value)); // initial state + updates
// On route leave or component unmount:
scope.destroy(); // idempotent; unsubscribes even if other disposers throw
```

`observe(...,{immediate:false})` skips the initial read. Synchronous subscription callbacks are not duplicated by the initial read. Manual unsubscribers returned by `observe()` and `add()` are idempotent. `destroy()` drains **all** disposers and aggregates failures. Scope ownership is independent of React/Vue and can manage `@zeruxjs/zyro` observables or structurally compatible source objects. The standalone [`zyrojs`](../../zyrojs/README.md) runtime has its own lifecycle and verification requirements.

## Opt-in standalone renderer bridge

Core imports do not load ZyroJS and retain the observable `.get()` / `.set()` /
`.subscribe()` API. Install the optional `zyrojs@0.0.4` peer only for the
`@zeruxjs/zyro/renderer` integration. Signals still belong to ZyroJS; an arbitrary
observable is never implicitly treated as a signal. The host injects the public
standalone primitives explicitly, with no import-time registry or default adapter.
This package currently emits CommonJS; browser use needs an explicit bundler.
The framework's closed local ESM build does not bundle bare client packages, so
that path does not automatically make this bridge a browser asset.

A minimal end-to-end component allocates its source and bridge once in setup:

```ts title="counter.ts"
import * as Zyro from 'zyrojs/component';
import {createObservable} from '@zeruxjs/zyro';
import {useZyroRendererBridge} from '@zeruxjs/zyro/renderer';

export const Counter = Zyro.defineComponent<{label: string}>(() => {
  const source = createObservable(0); // a distinct source per mount/SSR instance
  Zyro.onScopeDispose(() => source.destroy());
  const bridge = useZyroRendererBridge(Zyro);
  const count = bridge.write(source); // explicitly enable write-through
  return props => Zyro.h('button', {
    onClick: () => { count.value++; }
  }, props.label, () => count.value);
});
```

```ts title="browser.ts"
import {h, render, unmount} from 'zyrojs/dom';
import {Counter} from './counter.js';
const container = document.querySelector('#app')!;
render(h(Counter, {label: 'Clicks: '}), container);
// Route/owner teardown: unmount(container);
```

For static SSR use `renderToString(h(Counter,{label:'Clicks: '}))` from
`zyrojs/dom`. Each call's component scope releases its bridge. In ZeruxJS,
register the existing `createZyroRenderer(renderToString)` through the
application generation's `api.renderers()`, then dispatch the explicit token via
`context.render(token, h(Counter, ...))`. The application/plugin consumes its own
configuration to select a renderer; this bridge does not add a framework config
key, choose a default runtime, register one globally or weaken client/server import
checks. Framework renderer registration remains static-HTML-only; this bridge does
not enable framework hydration or mix React/Vue ownership into a ZyroJS root.

### Conversion and ownership

`createZyroRendererBridge(runtime,{signal?,maxConnections?})` creates a manually
owned request/mount scope. `useZyroRendererBridge` additionally registers
`destroy()` with the active ZyroJS scope; call it once in component setup or a
host effect scope, never during repeated render (the standalone hook guard rejects that call). Outside an active scope it rolls
back and throws. Supply `signal`, `batch`, `untracked`, `onScopeDispose` and `useRef` from
the same `zyrojs/component` runtime instance that owns the render.

| Method | Behavior |
| --- | --- |
| `read(source)` | Immediate read-only conversion with `.value`, `.peek()` and `.dispose()` |
| `select(source, selector, equal = Object.is)` | Read-only stable projection; equal results retain the previous reference |
| `write(mutableSource)` | Explicit `.value` write-through to source `.set()`; no projected writes or optimistic state |
| `batch(fn)` | Synchronous batching of target ZyroJS notifications, including updates across multiple sources/conversions |
| `resource(loader, options)` | Create an owned async observable; bridge lifetime owns its AbortSignal |
| `destroy()` | Idempotent unsubscribe/resource teardown; attempts all disposers and aggregates errors |

Conversions subscribe synchronously and read the latest source snapshot on
registration. Selectors and initial reads are untracked in the renderer. Sources
must provide coherent `.get()` snapshots and a real unsubscribe function;
synchronous initial emissions are supported. Source-owned `batch()` coalesces its
own notifications. For an effect reading several conversions, wrap related writes
in `bridge.batch()` to coalesce all renderer notifications; external observable
listeners retain their source's notification semantics. Batches do not span await
or roll back writes.

Updates use `Object.is` by default. Use immutable source snapshots; mutating the
same object reference cannot be detected. Equality must return a boolean. Selector
and equality failures propagate without caching a failed projection; later reads
can retry. Subscription setup rolls back once its disposer is returned. A custom
source that throws before returning its disposer must clean up its own partial
registration; the bridge cannot recover an undisclosed native handle.

Sources are borrowed: disposing a conversion/bridge never destroys a source.
A manual bridge does not own arbitrary external ZyroJS effects or the DOM root;
dispose those with their own scope or unmount the component.
Register cleanup separately for sources you own, as above. `maxConnections`
defaults to 128, is bounded to 1–4096, and separately caps conversions and owned
resources. `activeConnections` counts live conversions without source labels.
Read/write/batch/conversion operations reject after destruction. No process-global
observable or bridge is created, and no state is serialized implicitly: use a new
scope and appropriately authorized source for each tenant/request. Explicitly
sharing a source shares its values; isolation is the host's responsibility.

### Async work and cancellation

```ts
const resource = bridge.resource(async signal => {
  const response = await fetch('/api/data', {signal});
  if (!response.ok) throw Error('Load failed');
  return response.json(); // apply your owning API's schema before use
}, {timeoutMs: 10000, maxPending: 4});
const state = bridge.read(resource);
// Explicit user/host action, never automatic import-time or SSR network access:
await resource.refresh(); // handle rejection at the caller
```

`createAsyncObservable` also accepts `{signal,timeoutMs,maxPending,initial}`.
Parent abort cancels the current loader, fences state updates and makes later
refreshes reject with `AbortError`; destroy removes listeners and timers. Refresh,
reset and destroy fence older completions; failures remain visible and may be
retried. A loader receives an actual AbortSignal. Timeout (integer 1–300000ms)
leaves loading state and aborts cooperatively. It cannot force-interrupt a Promise
or stop side effects in a loader that ignores the signal. `maxPending` defaults to
8 (1–128); cancelled/timed-out work keeps a slot until actual settlement, and an
overload rejects before replacing the current job. There are no automatic retries.

For compatibility, an old `refresh()` Promise can still resolve its raw loader
result after cancellation/replacement, although that result cannot commit to
observable state. Drive UI from the current observable snapshot, not a stale
refresh return value. Handle every rejected refresh; raw error objects stay
internal/application-owned and should not be rendered or serialized to clients.
Bridge-created resources are destroyed on unmount/request scope close. Borrowed
async observables passed to `read()` are only unsubscribed; their cancellation
still belongs to their original owner.

## Focused verification

From this package run `npm run build`, then
`node --test test/advanced.test.mjs test/integration.test.mjs test/subscription-scope.test.mjs test/renderer.test.mjs test/renderer-public.test.mjs test/renderer-framework.test.mjs`.
Build the required standalone ZyroJS/security and framework packages first when
their compiled exports are absent. The installed tarball fixture verifies core
imports/types without the optional runtime, then bridge declarations and this
component example through real public exports without source aliases. The DOM
fixture and ephemeral local framework requests cover batching, scope isolation,
cancellation, failure and teardown; they do not certify a real browser, live API or
cross-framework hydration. No user-managed application is started.
