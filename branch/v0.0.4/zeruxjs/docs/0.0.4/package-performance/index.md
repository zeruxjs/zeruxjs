# Performance observations

Collect browser metrics intentionally and audit with an existing Chrome instance.


## Browser ownership

observeWebVitals reports supported LCP, CLS, FCP and navigation TTFB observations. It does not claim spec-accurate INP. Browser lifecycle and support affect accuracy; compare deployment baselines with that context.

## Collect and report

createVitalCollector keeps bounded per-metric samples and percentile summaries. createVitalReporter sends explicitly added batches through fetch and retains retry data only in memory. Consent, allowed destination, lifecycle cleanup and privacy are application choices; import alone does not start telemetry.

## Cleanup

Call the observer stop function and reporter.destroy on page/component teardown. Avoid registering duplicate observers on every route transition. A bounded in-process sample is not a durable metrics backend.

## Lighthouse

auditLighthouse loads Lighthouse lazily and connects to an already running Chrome debugging port. It does not install or launch Chrome. Keep debugging ports private and use deliberate audit targets. Lab results and real-user observations answer different performance questions.

## Static navigation prefetch

Use the browser entry point for public, static documentation routes:

```js
import { installNavigationPrefetch } from '@zeruxjs/performance/navigation';

const navigation = installNavigationPrefetch({
  paths: ['/branch/v0.0.4/zeruxjs/'],
  maxPages: 6,
  delayMs: 120,
});

// Dispose when the owning page/application is permanently removed.
navigation.destroy();
```

Install once per document. The controller waits for hover or keyboard focus, submits speculation prefetch rules when supported, and otherwise uses link prefetch hints. It never prerenders or executes a destination page. Browsers may decline hints. Only allow explicitly public paths: prefetch requests still reach your server.

The budget is per document, with a maximum of twenty distinct hints. Same-origin directory URLs are eligible; queries, external URLs, current-page anchors, downloads and opted-out links are excluded. `data-no-prefetch` opts out a link or its containing region. Offline, slow connections and Save-Data suppress new hints. Use `strategy: 'link'` for a restrictive inline-script CSP, or supply an allowed `nonce` for speculation rules. Without a DOM the installer returns a disabled controller.

## Install and select the integration

```sh
npm install @zeruxjs/performance@0.0.3
```

There is no automatic `performance` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Use browser-safe entry points for navigation and explicit observers only when metrics are needed. Choose known public static paths for prefetching; the helper submits bounded intent-driven hints and browsers decide whether to perform them. Web-vital observation, resource hints and server cache directives solve different problems and should not be enabled as an undifferentiated switch.

## TypeScript: inputs, results and ownership

```ts
import { installNavigationPrefetch } from '@zeruxjs/performance';

type Inputs = Parameters<typeof installNavigationPrefetch>;
type Result = Awaited<ReturnType<typeof installNavigationPrefetch>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof installNavigationPrefetch>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Dispose observers/reporters/prefetch controllers on owner teardown. Respect Save-Data, slow/offline states and consent before reporting. Lighthouse connects to an already running Chrome debugging port and does not install or launch Chrome. Lab scores are not a guarantee of real-user performance, and a submitted hint is not proof that a page is cached.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### NavigationPrefetchOptions

Public-static navigation prefetching. Browser globals are read only when installed.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `paths` | `readonly string[]` | No |
| `maxPages` | `number` | Yes |
| `delayMs` | `number` | Yes |
| `strategy` | `"auto" \| "link"` | Yes |
| `nonce` | `string` | Yes |

### VitalObserverOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `onMetric` | `(metric:PerformanceMetric)=>void` | No |
| `createObserver` | `(callback:(entries:PerformanceEntry[])=>void)=>{observe(options:PerformanceObserverInit):void;disconnect():void}` | Yes |
| `navigation` | `()=>{responseStart:number;requestStart:number}\|undefined` | Yes |

### VitalReporterOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `url` | `string` | No |
| `fetch` | `typeof fetch` | Yes |
| `maxBatch` | `number` | Yes |
| `signal` | `AbortSignal` | Yes |
| `credentials` | `RequestCredentials` | Yes |

### LighthouseOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `port` | `number` | Yes |
| `runner` | `(url:string,options:Record<string,unknown>)=>Promise<unknown>` | Yes |

### CacheOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxAge` | `number` | Yes |
| `immutable` | `boolean` | Yes |
| `private` | `boolean` | Yes |
| `noStore` | `boolean` | Yes |
| `mustRevalidate` | `boolean` | Yes |
| `staleWhileRevalidate` | `number` | Yes |
| `staleIfError` | `number` | Yes |
| `sMaxAge` | `number` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/performance@0.0.3`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./navigation": {
      "types": "./dist/navigation.d.ts",
      "import": "./dist/navigation.js",
      "require": "./dist/navigation.js",
      "default": "./dist/navigation.js"
    },
    "./dist/cache.js": "./dist/cache.js",
    "./dist/cache.js.map": "./dist/cache.js.map",
    "./dist/cache.d.ts": "./dist/cache.d.ts",
    "./dist/hints.js": "./dist/hints.js",
    "./dist/hints.js.map": "./dist/hints.js.map",
    "./dist/hints.d.ts": "./dist/hints.d.ts",
    "./dist/index.js": "./dist/index.js",
    "./dist/index.js.map": "./dist/index.js.map",
    "./dist/index.d.ts": "./dist/index.d.ts",
    "./dist/navigation.js": "./dist/navigation.js",
    "./dist/navigation.js.map": "./dist/navigation.js.map",
    "./dist/navigation.d.ts": "./dist/navigation.d.ts",
    "./dist/rum.js": "./dist/rum.js",
    "./dist/rum.js.map": "./dist/rum.js.map",
    "./dist/rum.d.ts": "./dist/rum.d.ts",
    "./dist/timing.js": "./dist/timing.js",
    "./dist/timing.js.map": "./dist/timing.js.map",
    "./dist/timing.d.ts": "./dist/timing.d.ts",
    "./dist/types.js": "./dist/types.js",
    "./dist/types.js.map": "./dist/types.js.map",
    "./dist/types.d.ts": "./dist/types.d.ts",
    "./dist/utils/lighthouse.js": "./dist/utils/lighthouse.js",
    "./dist/utils/lighthouse.js.map": "./dist/utils/lighthouse.js.map",
    "./dist/utils/lighthouse.d.ts": "./dist/utils/lighthouse.d.ts",
    "./dist/utils/webVitals.js": "./dist/utils/webVitals.js",
    "./dist/utils/webVitals.js.map": "./dist/utils/webVitals.js.map",
    "./dist/utils/webVitals.d.ts": "./dist/utils/webVitals.d.ts",
    "./package.json": "./package.json",
    "./README.md": "./README.md",
    "./LICENSE-MIT": "./LICENSE-MIT",
    "./LICENSE-APACHE": "./LICENSE-APACHE"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/performance

Browser performance observations, resource hints, cache validators, reporting, and optional Lighthouse auditing.

```ts
const collector = createVitalCollector({maxPerMetric:200});
const stop = observeWebVitals({onMetric:metric => collector.record(metric)});
const reporter = createVitalReporter({url:'https://metrics.example.com/vitals', maxBatch:50});
for (const summary of collector.snapshot()) console.log(summary.name, summary.p75);
// Add consent-approved metrics with reporter.add(metric); await reporter.flush().
stop(); reporter.destroy();
```

`observeWebVitals` observes browser `LCP`, `CLS`, `FCP` and navigation `TTFB`, and stops observers when disposed. It **does not claim spec-accurate INP**; browser support, page lifecycle, and metric accuracy vary. `createVitalCollector` retains bounded percentile samples, and `createVitalReporter` sends bounded JSON batches through an explicit fetch call, defaulting to omitted credentials and retrying a failed batch in memory. Callers are responsible for consent, privacy and opting into any telemetry. No tracking starts on import.

`auditLighthouse(url, {port, runner})` uses an already-running Chrome debugging port (default 9222). It loads `lighthouse` lazily and does not install/start Chrome; its runner can be injected for testing. Cache ETags support weak and strong matching separately.

## Public static-page navigation prefetch

```ts
import {installNavigationPrefetch} from '@zeruxjs/performance/navigation';
const navigation=installNavigationPrefetch({paths:['/branch/v0.0.4/zeruxjs/'],maxPages:6,delayMs:120});
// On SPA/component teardown:
navigation.destroy();
```

The browser-safe navigation entry point uses intent (hover/focus), bounded unique URLs, same-origin public path prefixes, and speculation-rule prefetch with a `rel=prefetch` fallback. It does not prerender/execute destination pages. Queries, downloads, external links, nofollow links, `data-no-prefetch` ancestors and same-page anchors are excluded. Saving data, slow connections (3g or slower), offline state and hidden documents suppress new requests. The optional nonce permits speculation rules under a compatible CSP; use `strategy:'link'` when your policy does not permit inline speculation rules. Browser policy can still decline a hint. `queued` reports submitted hints, not proof of a completed/cached network request.

Only pass prefixes that contain public, side-effect-free static HTML; this helper is not an authorization or URL-classification mechanism for application APIs. It reads browser globals only at installation and returns an inert controller on the server. `destroy()` removes its listeners, pending timer and injected elements. No metrics, cookies or identifiers are collected.

Static path prefixes can contain dotted version segments such as `/branch/v0.0.4/zeruxjs/`. Empty and dot-only traversal segments remain rejected.


## Implementation sources

- [packages/@zeruxjs/performance/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/README.md)
- [packages/@zeruxjs/performance/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/package.json)
