# ZyroJS — standalone reactive and DOM runtime

ZyroJS provides **framework-neutral signals**, lifecycle-managed browser DOM rendering and abortable Fetch-based network helpers. It is an independent library that can run alongside the `@zeruxjs/zyro` observable bridge, React or Vue. It does **not** require ZeruxJS or a component framework.

This package does not currently provide a full React-compatible hooks dispatcher, router, internationalization suite, selective hydration, custom HTML compiler or automatic XSS sanitizer.

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

`ref(initial)` aliases `signal(initial)` with the same `.value`/`.peek()` contract; it is distinct from `useRef(initial)`'s nonreactive `{current}` holder. `watch(source, callback, {immediate:false})` tracks only synchronous source reads, compares using `Object.is`, and passes `(value, previous)`. Its callback/returned cleanup are untracked. Cleanup runs before a changed-value callback and on stop/scope disposal. Async callbacks are unsupported: use explicit resources/signals and handle rejected Promises at the caller.

`useState`, `useEffect`, `useMemo`, `useReactive` and `useRef` remain **signal convenience functions**, not a React positional dispatcher. `useEffect` returns a stop function; `useMemo` returns a getter with `.dispose()`. Inside components, allocate them in `defineComponent` setup. Calling allocating hooks, `effect`, `computed` or `watch` during repeated render throws an ownership diagnostic, rather than depending on conditional hook order. Outside rendering the existing standalone helper APIs still work. Setup runs once, so conditional setup does not create positional slots.

Batches are synchronous notification coalescing, not transactions: writes are immediately readable, nested batches flush at the outer exit (also after a thrown callback), and code after an `await` is outside the batch. Derivations/effects may schedule further passes; do not rely on a global ordering between unrelated effects or read a computed inside a batch expecting an already-flushed value. Use `untracked(fn)` for synchronous incidental reads.

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

DOM text and attributes are escaped through native DOM APIs. **Raw `innerHTML`, `outerHTML`, `srcdoc`, `srcset`, and inline `on*` strings are rejected**; unsafe URL schemes and raw CSS strings are not written. Do not turn user-controlled component tags or callback functions into trusted code. `renderToString()` produces escaped **static HTML** without mounting subscriptions, but does not output hydration markers; use the separate versioned API below to hydrate; static strings still require a fresh mount. Do not mix this reconciler with React/Vue ownership of the **same DOM container**. Separate mount roots and dispose each app's subscriptions on teardown.

## Components and subtree ownership

```ts
import { useState, onScopeDispose } from 'zyrojs';
import { defineComponent, h, render, unmount } from 'zyrojs/dom';

const Counter = defineComponent<{ label: string }>(() => {
  const [count, setCount] = useState(0); // once per mounted component
  onScopeDispose(() => { /* release a host-owned subscription here */ });
  return props => h('button', {
    onClick: () => setCount(count() + 1)
  }, props.label, () => count());
}, { onError: () => h('p', { role: 'alert' }, 'Unable to render counter') });

const container = document.querySelector('#app')!;
render(h(Counter, { key: 'counter', label: 'Clicks: ' }), container);
// Later props update preserves count and setup identity:
render(h(Counter, { key: 'counter', label: 'Total: ' }), container);
// When the owner leaves:
unmount(container);
```

`defineComponent(setup, {onError?})` returns a component function accepted by `h`. Setup receives initial props (including children); the synchronous returned render receives current props and tracks signal reads on every update. Use that render argument rather than closing over initial props when a value should change. Type and sibling key preserve ownership; changing either disposes the old instance. Ordinary authored functions remain stateless reactive components. Do not directly call a setup component; mount it through `h`/`render` or `renderToString`.

Children returned as arrays are fragments with owned comment boundaries, including empty fragments. Elements flatten nested child arrays. Sibling keys must be unique strings or finite numbers; keyed lookup uses a map, and unkeyed children reconcile by position without stealing a keyed instance. DOM ranges are moved without remounting retained components. Already-positioned nodes are left alone; reordered connected focused controls use best-effort focus/selection restoration. This does not promise preservation of iframe sessions, contenteditable ranges, animations or custom-element connection callbacks across moves.

`ref` props accept an element/null callback or a `{current}` holder. They detach on prop reconciliation/removal and unmount, and attach to the retained element; holders are cleared only if they still own that element. Replaced event callbacks and two-way bindings release old listeners. Native event exceptions and rejected async event handlers remain with the browser/caller: handle them explicitly; render boundaries do not intercept them. DOM event dispatch snapshots listeners, so a replacement listener is not called again in the same dispatch ([DOM standard](https://dom.spec.whatwg.org/#concept-event-listener-invoke)). Focus restoration uses the native [focus API](https://html.spec.whatwg.org/multipage/interaction.html#dom-focus-dev).

A component's `onError` handles synchronous setup/render failures and descendant failures that propagate during that render. It can return a safe fallback; fallback failures propagate. It does not catch a later independent dynamic-child effect, Promise rejection, event, or disposer error. Failed setup releases acquired setup effects immediately. Failed subtree construction rolls back acquired nodes/listeners. Unmount attempts all disposers and reports an `AggregateError` after cleanup if any fail. A failed update is not a transactional DOM rollback: unmount or render a new boundary to recover a root after an unhandled error.

Async children/async component returns are deliberately unsupported and diagnosed at runtime. Represent pending/success/error through an owned signal or `createRemoteResource`; render a synchronous expression reading that state, handle refresh rejection and register `resource.dispose()` with `onScopeDispose`. No string evaluation or Vue template compiler exists. Author expressions as JavaScript/TypeScript functions. There is no automatic JSX runtime or intrinsic JSX namespace; the supported typed construction API is `h`. An external JSX/TSX transform must target compatible authored functions; this package does not claim a JSX compiler integration.

SSR runs setup and synchronous rendering in a disposable effect scope for each call; no subscriptions survive `renderToString`. DOM refs/listeners are not attached. The static API creates no shared per-request state or hydration markers.

## Explicit server rendering and hydration (V1)

`zyrojs/server` imports only universal component/reactivity code and the pure
`@zeruxjs/security/encoding` entry, without the DOM renderer or network clients.
`zyrojs/component` is the shared authored-component entry. `zyrojs/hydrate` is
browser-only execution. Root/`dom` imports remain compatible. Browser builds must
bundle bare dependencies or explicitly map their public imports; the package does
not supply a browser bundler or fetch code automatically.

A minimal application uses the same authored component and public-props validator
on both ends:

```ts title="counter.ts"
import { defineComponent, h, signal, useId } from 'zyrojs/component';
export const validateProps = (input: unknown): { label: string } => {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof (input as { label?: unknown }).label !== 'string' ||
      Object.keys(input).some(key => key !== 'label')) throw Error('Invalid public props');
  return { label: (input as { label: string }).label };
};
export const Counter = defineComponent<{ label: string }>(() => {
  const id = useId(); // setup only; stable for the same tree/prefix
  const count = signal(0);
  return props => h('button', { id, onClick: () => count.value++ },
    props.label, () => count.value);
});
```

```ts title="server.ts"
import { renderToHydratable } from 'zyrojs/server';
import { Counter, validateProps } from './counter.js';
const output = renderToHydratable(Counter, { label: 'Clicks: ' }, {
  idPrefix: 'counter', validateProps
});
// Embed at fixed, host-owned HTML sinks. data is JSON script text, never an attribute.
const page = `<main id="app">${output.html}</main>` +
  `<script id="app-data" type="application/json">${output.data}</script>`;
// The host owns the HTTP response, CSP, application script and authentication.
```

```ts title="browser.ts"
import { hydrate } from 'zyrojs/hydrate';
import { Counter, validateProps } from './counter.js';
const handle = hydrate(Counter, document.querySelector('#app')!, {
  data: document.querySelector('#app-data')!.textContent!, validateProps,
  mismatch: 'throw', // opt into 'replace' only if losing existing DOM edits is acceptable
  onMismatch: diagnostic => console.warn(diagnostic.code, diagnostic.node)
});
// Route/owner teardown: handle.dispose(); or abort the explicit options.signal.
```

`renderToHydratable` returns frozen `{version:1, html, data, idPrefix}`. It is
synchronous and whole-root, not streaming/selective hydration. V1 requires matching
server/client component definitions, synchronous state and structure. Do not use
random/time/environment-dependent initial output. The host supplies a unique
prefix per root on the page; it is an identifier, never authorization. `useId()`
returns `<prefix>-c<preorder component number>-<setup local number>` and is only
available in protocol component setup. Later inserted components receive fresh
IDs from that root. Ordinary `renderToString` stays marker-free and cannot serve
as hydration input; ordinary non-protocol mounts cannot call `useId`.

V1 HTML begins with `<!--zyro-h1:PREFIX-->` and ends with `<!--/zyro-h1-->`.
Components/fragments use nested `<!--zyro-start-->` / `<!--zyro-->` ranges; text
uses `<!--zyro-text-->` to separate empty/adjacent nodes. Hydration verifies the
root version/prefix, tags, exact text and attributes, adopts existing nodes,
removes text separators and attaches owned listeners/effects. Do not minify away
or inject whitespace between protocol nodes. Browser parser corrections (for
example implicit table containers) produce mismatches: author valid HTML with
explicit structure. Component/key identity uses the existing keyed reconciler.

Input `.value`/`.checked` and option `.selected` properties are preserved, including
pre-hydration edits. Two-way bindings take the live value only **after** successful
adoption, then notify reactive readers in a batch. Use strings/numbers for values
and booleans for checked/selected; form resets/defaultValue and custom controls
remain application-owned. Select defaults should be expressed with explicit option
`selected` props. Password/file initial values are rejected. V1 excludes textarea,
raw-text/executable/head-control elements, template and SVG/MathML; static SSR
retains its previous behavior. Cross-browser form/focus parity is not certified;
selective hydration remains unavailable.

Props must pass the caller's required `validateProps` both server-side and on
hydration. Explicitly project only public fields; passing validation does not
turn private data into public data. The additional serializer rejects functions,
undefined, nonfinite numbers, symbols, sparse/cyclic arrays, accessors/toJSON,
class instances, prototype keys and obvious password/secret/token/credential keys.
It clones inert JSON records, bounds depth to 32 and entries to 10000, and never
walks component closures or copies VNode props implicitly. A secret placed
under an innocent field name cannot be detected: the host's schema/projection is
the privacy boundary. Validator callbacks are trusted synchronous application
code. The returned `data` uses independent script-data encoding (`<`, `>`, `&`,
U+2028/U+2029 escaped), not HTML escaping. Read application/json `.textContent` (see the [HTML script-data restrictions](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements));
never eval it or place it inside an existing JS string/attribute. A public-data
payload is not authentication, consent or tenant authorization.

Hydratable text and quoted attributes use destination-specific security encoders.
URL attributes allow HTTP(S)/relative navigation only, rejecting credentials,
control/backslash obfuscation and protocol-relative references. Inline event
strings, raw HTML attributes and style strings are rejected. Event functions stay
in authored code and are never serialized. For deliberate opaque HTML only,
`trustedHTML(text, {sanitize})` from `zyrojs/component` creates a private token
for `h('div', {trustedHTML: token})`; no managed children are allowed. Supply a
real host-owned sanitizer/allowlist, not an identity function for untrusted input.
ZyroJS supplies no sanitizer. Tokens cannot be public props; the host must produce
them on each side. Output is capped at 64 KiB and excludes comments/reserved
active markup so it cannot forge hydration ranges. The sanitizer must produce
canonical fragment HTML matching browser `innerHTML`; otherwise hydration rejects.
The leaf is opaque: ZyroJS owns no nested listeners/effects, and does not claim
that sanitizer-approved HTML grants authorization or is safe in every context.

Defaults/caps: `maxNodes` 10000/100000, `maxDepth` 64/128, `maxBytes` 1/16 MiB,
`maxPropsBytes` 64 KiB/1 MiB. Oversize props/HTML and unsupported features throw
coded `HydrationError`s. Error boundaries do not swallow protocol/limit/abort
errors. `signal` is cooperative at synchronous checkpoints: a same-thread timer
cannot interrupt application code. Server scopes dispose on success/failure/abort;
hydrated scopes additionally dispose on later abort. Host callback/cleanup errors
propagate; no forced cancellation of JavaScript is claimed.

Mismatches default to a coded error, with optional path/value-free
`{code,node,expected,actual}` diagnostics. The failed attempt releases setup,
listeners and refs while leaving adopted server nodes in place; arbitrary host
callback side effects are not rolled back. Explicit `mismatch:'replace'` clears
the container and mounts anew with the same ID prefix, losing form edits/focus
and potentially running setup twice (each failed scope is disposed). Other errors
are never hidden by replacement. Handles dispose only their exact owner; a stale
handle cannot remove a later replacement root. Never hydrate an already-owned
container or mix runtimes in one root.

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
# Run these workspace checks from the repository root.
npm run test:zyrojs  # builds ZyroJS + bridge, runs tests, npm-pack consumer import test
npm run verify:source # source and lock metadata validation, NOT npm ci
```

Focused package checks: `npm run build`, then `node --test test/reactivity.test.mjs test/dom.test.mjs test/components.test.mjs test/components-public.test.mjs test/hydration.test.mjs`. The public check packs/installs the built package offline and checks its browser declarations without source aliases or Node ambient types. It owns/removes its temporary files and npm cache.

Optional browser checks: `ZX_TEST_BROWSER=1 node --test test/components-browser.test.mjs test/hydration-browser.test.mjs` require a separately installed Playwright and functioning Chromium. They own ephemeral loopback asset servers/browsers and check keyed fragment reorder, insertion/removal, hydration, nested updates, focus/selection and detached listener cleanup, closing resources in `finally`. They never download a browser or start a user application; without opt-in they explicitly skip.

The integration suite uses a deterministic DOM fixture in Node and an offline tarball consumer. Real-browser Chromium/WebKit/Firefox and cross-OS behavior require separate validation; React/Vue hydration is not provided by this package. Do not interpret a passed DOM fixture as browser certification or a passed local tarball check as a clean registry-backed workspace install.

## Future project generator

[`create-zyro-app`](../create/create-zyro-app/README.md) generates standalone client, static, SSR and whole-root hydrated projects in JavaScript or TypeScript through zclivo's safe engine. Its README describes runtime prerequisites and qualification limits; source implementation does not imply publication.
