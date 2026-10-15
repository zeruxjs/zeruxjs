# ZyroJS — standalone reactive and DOM runtime

ZyroJS provides **framework-neutral signals**, lifecycle-managed browser DOM rendering and abortable Fetch-based network helpers. It is an independent library that can run alongside the `@zeruxjs/zyro` observable bridge, React or Vue. It does **not** require ZeruxJS or a component framework.

**Release status:** `0.0.1-alpha.2`. The source and isolated package tarball pass local checks in Section 81; the prerelease label remains because browser/clean-machine certification has not passed. This package does not currently provide a full React-compatible hooks dispatcher, router, internationalization suite, general SSR hydration, custom HTML compiler or automatic XSS sanitizer.

## Imports

```ts
import { signal, computed, effect, batch, reactive, createEffectScope } from 'zyrojs';
import { h, render, unmount, renderToString } from 'zyrojs/dom';
import { createRemoteResource, createProtocolClient } from 'zyrojs/network';
```

## Reactivity and lifetime

```ts
const scope = createEffectScope();
const price = signal(5);
const quantity = signal(2);

scope.run(() => {
  const total = computed(() => price.value * quantity.value);
  effect(() => console.log('Total:', total.value));
});

batch(() => { price.value = 8; quantity.value = 3; });
scope.dispose(); // stop all owned reactive effects/derived subscriptions
```

`effect(fn)` runs immediately and returns an idempotent `stop()` callback. `fn` may return a cleanup callback, which runs before re-execution and on stopping. Dependency tracking updates after conditional reads; nested synchronous `batch` calls coalesce notifications. `onScopeDispose(fn)` registers additional disposers from inside `scope.run` or an effect owned by that scope. Cleanup errors may be propagated; the scope attempts to run all disposers. Unbounded self-updates fail with a loop guard.

`computed(fn)` is eagerly tracked, read-only, and exposes `.dispose()`. Computed values outside a scope **must be disposed manually** to avoid long-lived subscriptions. `reactive(obj)` observes plain objects and arrays, including property reads, membership, iteration, nested mutable fields and deletions; native collections, Dates, class instances, and immutable slots are preserved rather than wrapped. Mutations made directly to an unproxied original reference cannot notify subscribers.

`useState`, `useEffect`, `useMemo`, `useReactive` and `useRef` are **signal convenience functions**, not React hooks. `useEffect` returns a stop function; `useMemo` returns a getter with `.dispose()`. Avoid constructing new state on every render of a function component. Use stable signals owned by a mount boundary instead.

## DOM, forms and safety

```ts
const count = signal(0);
const name = signal('Visitor');
const app = document.querySelector('#app')!;
render(h('section', {},
  h('input', { 'bind:value': name }),
  h('p', {}, () => `Hello ${name.value}: ${count.value}`),
  h('button', { onClick: () => { count.value++; } }, 'Increment')
), app);

// on route change or component unmount:
unmount(app);
```

`render()` reconciles child lists by `props.key`, retains suitable DOM nodes and removes listeners/effects when replaced. Function children may return text **or a VNode**. `mount()` mounts an additional subtree, and `unmount(container)` releases the render root and manually mounted subtrees. `bind:value` listens for `input` and `bind:checked` listens for `change` on native form controls. Use normal `onInput` / `onChange` handlers for advanced form validation.

DOM text and attributes are escaped through native DOM APIs. **Raw `innerHTML`, `outerHTML`, `srcdoc`, `srcset`, and inline `on*` strings are rejected**; unsafe URL schemes and raw CSS strings are not written. Do not turn user-controlled component tags or callback functions into trusted code. `renderToString()` produces escaped **static HTML** without mounting subscriptions, but does not output hydration markers; clients must remount using `render()` rather than assume hydration. Do not mix this reconciler with React/Vue ownership of the **same DOM container**. Separate mount roots and dispose each app's subscriptions on teardown.

## Network and cancellation

```ts
const client = createProtocolClient({ baseUrl: 'https://example.test', timeoutMs: 10000 });
const resource = createRemoteResource(signal => client.rpc('users.list', {}, { signal }));
await resource.refresh();
resource.cancel();  // abort current work; stale results cannot change data or cache
resource.dispose(); // release resource permanently
```

See `src/network` for Fetch JSON-RPC, MCP, Connect/tRPC, SSE readers, discovery feeds, bounded streaming and in-memory QueryCache. A cancelled stale request rejects with `AbortError` if its loader later resolves without honoring the signal. This is intentional: consumers must handle rejected promises. There is no implicit network retry for mutating calls. Cache entries are per instance; avoid sharing sensitive keys across tenants.

## Local qualification

```sh
cd apps/proworkspace
npm run test:zyrojs  # builds ZyroJS + bridge, runs tests, npm-pack consumer import test
npm run verify:source # source and lock metadata validation, NOT npm ci
```

The Section 81 suite uses a deterministic DOM fixture in Node and an offline tarball consumer. **Real-browser Chromium/WebKit/Firefox, actual React/Vue hydration and cross-OS testing are still release gates** (Sections 83–85). Do not interpret a passed DOM fixture as browser certification or a passed local tarball check as a clean registry-backed workspace install.
