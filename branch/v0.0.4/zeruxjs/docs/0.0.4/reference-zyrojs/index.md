# Standalone reactive applications

Set up zyrojs with explicit lifecycle, typed public APIs and deployment boundaries.


## Installation and integration path

```sh
npm install zyrojs@0.0.4
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { signal, computed, createEffectScope } from 'zyrojs';
const scope = createEffectScope();
const count = signal(0);
const doubled = scope.run(() => computed(() => count.value * 2));
count.value = 2;
console.log(doubled.value);
scope.dispose();
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Use root exports for signals/effects and focused dom/network exports for rendering or remote resources. State ownership matters: effects execute immediately, computed values are eager and subscriptions outside a scope need explicit disposal. A scope makes the route/component owner responsible for all derived work.

Standalone ZyroJS and `@zeruxjs/zyro` are different APIs. The latter is an observable bridge; do not substitute value/get/set shapes without an adapter. Signal convenience functions named like hooks are not React's dispatcher. The standalone renderer is not a complete framework router, general or selective hydration engine or automatic HTML sanitizer.

## Stable component setup

```ts
import { useState, onScopeDispose } from 'zyrojs';
import { defineComponent, h, render, unmount } from 'zyrojs/dom';

const Counter = defineComponent<{ label: string }>(() => {
  const [count, setCount] = useState(0);
  onScopeDispose(() => { /* release application subscriptions */ });
  return props => h('button', { onClick: () => setCount(count() + 1) },
    props.label, () => count());
}, { onError: () => h('p', { role: 'alert' }, 'Counter unavailable') });
const container = document.querySelector('#app')!;
render(h(Counter, { key: 'counter', label: 'Clicks: ' }), container);
// After this owner leaves:
unmount(container);
```

Setup runs once for a mounted type/key; its returned render gets current props and tracks reactive reads. Allocating signal convenience hooks/effects in repeated render is diagnosed. These APIs have no positional React hook slots. Authored functions provide expressions; there is no string template evaluation, Vue compiler or automatic JSX runtime.

Arrays are owned fragments; unique finite-number/string sibling keys preserve component/DOM identity across reorder. Unkeyed nodes retain position. Replaced event callbacks, refs, effects and bindings detach on disposal. Ref holders use `{current}`; `ref()` itself is a signal alias with `.value`. `watch(source, callback, {immediate})` tracks only source reads, compares with `Object.is` and owns callback cleanup through its stop function or setup scope. Synchronous batches coalesce notifications, not transactions or async continuations.

Render boundaries catch synchronous setup/render errors, not events, Promise rejections, later independent child effects or disposal failures. Fallback errors propagate. Subtree construction rolls back partial resources; unmount attempts every cleanup before reporting failures. Failed updates do not guarantee DOM rollback. Async children are rejected: expose pending/result/error as synchronous signal/resource state and explicitly handle Promise rejection. SSR disposes each call's setup effects; it adds no hydration markers.

The package README documents an opt-in Chromium check and packed consumer verification. A deterministic DOM fixture cannot certify browser focus, selection, custom elements or cross-engine behavior; focus restoration across DOM moves remains best-effort.

## Whole-root SSR and hydration

Use `zyrojs/component` for shared authored components, `zyrojs/server` for
`renderToHydratable`, and `zyrojs/hydrate` in the browser. The server import graph
contains no DOM renderer/network client. The existing `renderToString` remains
static and marker-free; it is not hydration input. The package README contains a
complete three-file example using public imports.

Both sides require a public-props validator. Project a small public record;
callbacks, arbitrary classes, accessors, cyclic/sparse data and obvious sensitive
keys reject. This is not a secret detector: the application still owns the schema,
tenant authorization and privacy projection. HTML text/attribute encoders and
script-data serialization have different destinations. The server returns escaped
HTML plus separately escaped JSON `data`; embed data only at a fixed
application/json script sink and read its textContent, never eval it.

V1 uses a host-unique ID prefix, versioned root comments, nested fragment/component
ranges and text separators. `useId()` runs in component setup and yields matching
preorder IDs for matching trees. Hydration verifies parsed nodes and attaches
owned effects/listeners; edited input/checkbox values are retained and two-way
bindings synchronize after adoption. Author valid HTML, explicit table structure
and option selection. Password/file initial values, textarea, foreign/active/raw-text
elements, async children and selective hydration are unsupported. Do not strip
markers or vary initial state by time, randomness or environment.

The default mismatch policy throws with value-free diagnostics, disposes acquired
resources and leaves server nodes. Explicit `mismatch:'replace'` remounts and loses
DOM edits/focus. Neither strategy rolls back arbitrary application callback side
effects; protocol errors/limits/abort are not swallowed. A returned handle or
AbortSignal disposes the exact hydrated owner. Server scopes are released on
completion/failure/abort. Cancellation is synchronous and cooperative, not a way
to interrupt arbitrary code or promise browser parity.

The protocol bounds node count, depth, HTML and public data bytes. Raw HTML stays
explicit: `trustedHTML(text,{sanitize})` requires an application sanitizer and
creates an opaque leaf token; it is not serializable public data. No nested
managed children or reserved marker/active markup is accepted. Sanitizer output
must match canonical browser fragment HTML. This is a trusted host extension,
not an automatic XSS sanitizer.

Focused tests parse actual SSR with parse5 and exercise adoption in the deterministic
DOM fixture. Real Chromium hydration/form/focus qualification is a separate opt-in
check requiring Playwright and an installed browser; offline success does not
prove cross-engine or selective-hydration behavior.

## Public types

```ts
import { signal } from 'zyrojs';
type Inputs = Parameters<typeof signal>;
type Result = Awaited<ReturnType<typeof signal>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Dispose derived values/effects when their owner leaves. Abort remote resources on stale requests and handle network/authentication failures before updating user-visible state. Never create a shared per-user server signal singleton. Test conditional dependency changes, batching, effect cleanup, stale async completion and DOM unmount with the actual browser environment.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### ProtocolClientOptions

| Option             | Accepted TypeScript value                                    | Required | Meaning                                                                           |
| ------------------ | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| `baseUrl`          | `string`                                                     | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `fetch`            | `typeof fetch`                                               | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `headers`          | `HeadersInit \| (() => HeadersInit \| Promise<HeadersInit>)` | No       | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `credentials`      | `RequestCredentials`                                         | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `timeoutMs`        | `number`                                                     | No       | Passed using this declared shape; omission is allowed only when marked optional.  |
| `maxResponseBytes` | `number`                                                     | No       | Passed using this declared shape; omission is allowed only when marked optional.  |

### CallOptions

| Option    | Accepted TypeScript value | Required | Meaning                                                                          |
| --------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `signal`  | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `headers` | `HeadersInit`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### EventStreamOptions

| Option          | Accepted TypeScript value | Required | Meaning                                                                          |
| --------------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `headers`       | `HeadersInit`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal`        | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch`         | `typeof fetch`            | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `lastEventId`   | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxEventBytes` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `credentials`   | `RequestCredentials`      | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### QueryCacheOptions

| Option         | Accepted TypeScript value | Required | Meaning                                                                          |
| -------------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `maxEntries`   | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `defaultTtlMs` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### CacheQueryOptions

| Option   | Accepted TypeScript value | Required | Meaning                                                                          |
| -------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `ttlMs`  | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `tags`   | `string[]`                | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### DiscoveryClientOptions

| Option             | Accepted TypeScript value | Required | Meaning                                                                          |
| ------------------ | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `baseUrl`          | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `fetch`            | `typeof fetch`            | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `searchPath`       | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `feedPath`         | `string`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `timeoutMs`        | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxResponseBytes` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |

### DiscoverySearchOptions

| Option   | Accepted TypeScript value | Required | Meaning                                                                          |
| -------- | ------------------------- | -------- | -------------------------------------------------------------------------------- |
| `limit`  | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `offset` | `number`                  | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `mode`   | `'any'\|'all'`            | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `boolean`                 | No       | Passed using this declared shape; omission is allowed only when marked optional. |
| `signal` | `AbortSignal`             | No       | Passed using this declared shape; omission is allowed only when marked optional. |

The protocol client preserves the native Fetch global receiver. Application hosts
can still inject a borrowed transport and must own endpoint/authentication policy;
client calls are not implicitly retried. The local integration app qualifies
RPC/MCP/Connect/tRPC calls in Chrome, not every browser or complete vendor parity.


## Public entry points

Manifest reference for `zyrojs@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./dom": {
      "types": "./dist/dom/index.d.ts",
      "default": "./dist/dom/index.js"
    },
    "./network": {
      "types": "./dist/network/index.d.ts",
      "default": "./dist/network/index.js"
    },
    "./component": {
      "types": "./dist/component.d.ts",
      "default": "./dist/component.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "default": "./dist/server.js"
    },
    "./hydrate": {
      "types": "./dist/hydrate.d.ts",
      "default": "./dist/hydrate.js"
    }
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@zeruxjs/security": "0.0.4"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

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

`ref(initial)` aliases `signal(initial)` with the same `.value`/branch/v0.0.4/`.peek()` contract; it is distinct from `useRef(initial)`'s nonreactive `{current}` holder. `watch(source, callback, {immediate:false})` tracks only synchronous source reads, compares using `Object.is`, and passes `(value, previous)`. Its callback/returned cleanup are untracked. Cleanup runs before a changed-value callback and on stop/scope disposal. Async callbacks are unsupported: use explicit resources/signals and handle rejected Promises at the caller.

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

`defineComponent(setup, {onError?})` returns a component function accepted by `h`. Setup receives initial props (including children); the synchronous returned render receives current props and tracks signal reads on every update. Use that render argument rather than closing over initial props when a value should change. Type and sibling key preserve ownership; changing either disposes the old instance. Ordinary authored functions remain stateless reactive components. Do not directly call a setup component; mount it through `h`/branch/v0.0.4/`render` or `renderToString`.

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

Input `.value`/branch/v0.0.4/`.checked` and option `.selected` properties are preserved, including
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

### Cache and transport ownership

`QueryCache` is process-local and retains successful values only with a positive TTL. The default TTL `0` disables completed-value storage while still coalescing concurrent same-key loads. Values are borrowed, not cloned. `invalidate(key)` and `clear()` fence pending cache commits without cancelling the loader; `invalidateTag(tag)` removes completed entries only. Pending loads have no tag index. A joining caller's abort cancels its wait; the initiating caller's abort also suppresses that load's cache commit. Include application/tenant identity in private keys and do not share a cache across authorization scopes implicitly.

Protocol clients and caches start no requests on construction. Resources require `refresh()` and event channels require `start()`; retain their handles and call `dispose()`/branch/v0.0.4/`stop()` on owner teardown. A stopped event channel's `start()` promise observes actual stream settlement. Signals cannot forcibly stop a loader or injected transport that ignores cancellation. The unary MCP helper accepts JSON responses; use the separate SSE reader for event streams. `connectJsonStream` bounds individual frames and response message count, but does not apply `ProtocolClientOptions.timeoutMs` or promise pull-based upload backpressure: supply an explicit deadline signal and a bounded, cooperative input iterable. These helpers do not implement a server-side destination allowlist or all protocol/vendor features.

## Local qualification

```sh
# Run these workspace checks from the repository root.
npm run test:zyrojs  # builds ZyroJS + bridge, runs tests, npm-pack consumer import test
npm run verify:source # source and lock metadata validation, NOT npm ci
```

Focused package checks: `npm run build`, then `node --experimental-strip-types --test test/reactivity.test.ts test/dom.test.ts test/components.test.ts test/components-public.test.ts test/hydration.test.ts`. The public check packs/installs the built package offline and checks its browser declarations without source aliases or Node ambient types. It owns/removes its temporary files and npm cache.

Optional browser checks: `ZX_TEST_BROWSER=1 node --experimental-strip-types --test test/components-browser.test.ts test/hydration-browser.test.ts` require a separately installed Playwright and functioning Chromium. They own ephemeral loopback asset servers/browsers and check keyed fragment reorder, insertion/removal, hydration, nested updates, focus/selection and detached listener cleanup, closing resources in `finally`. They never download a browser or start a user application; without opt-in they explicitly skip.

The integration suite uses a deterministic DOM fixture in Node and an offline tarball consumer. Real-browser Chromium/WebKit/Firefox and cross-OS behavior require separate validation; React/Vue hydration is not provided by this package. Do not interpret a passed DOM fixture as browser certification or a passed local tarball check as a clean registry-backed workspace install.

## Future project generator

[`create-zyro-app`](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/create/create-zyro-app/README.md) generates standalone client, static, SSR and whole-root hydrated projects in JavaScript or TypeScript through zclivo's safe engine. Its README describes runtime prerequisites and qualification limits; source implementation does not imply publication.

The protocol client keeps the native Fetch global receiver when capturing the
default browser transport. Explicit injected transports remain borrowed and are
not closed or retried automatically. The local ZeruxJS integration app exercises
its RPC/MCP/Connect/tRPC calls in Chrome; this is not all-browser certification.


## Implementation sources

- [packages/zyrojs/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/README.md)
- [packages/zyrojs/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/package.json)
- [packages/zyrojs/src/dom/component.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/src/dom/component.ts)
- [packages/zyrojs/src/dom/render.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/src/dom/render.ts)
- [packages/zyrojs/src/reactivity/watch.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/src/reactivity/watch.ts)
- [packages/zyrojs/src/server.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/src/server.ts)
- [packages/zyrojs/src/hydrate.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zyrojs/src/hydrate.ts)
