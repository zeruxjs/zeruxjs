---
{
  "title": "Performance observations",
  "description": "Collect browser metrics intentionally and audit with an existing Chrome instance.",
  "section": "Packages",
  "order": 24,
  "sources": [
    "packages/@zeruxjs/performance/README.md",
    "packages/@zeruxjs/performance/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/performance"
}
---

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
  paths: ['/zeruxjs/'],
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

There is no automatic `performance` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Use browser-safe entry points for navigation and explicit observers only when metrics are needed. Choose known public static paths for prefetching; the helper submits bounded intent-driven hints and browsers decide whether to perform them. Web-vital observation, resource hints and server cache directives solve different problems and should not be enabled as an undifferentiated switch.

## TypeScript: inputs, results and ownership

```ts
import { installNavigationPrefetch } from '@zeruxjs/performance';

type Inputs = Parameters<typeof installNavigationPrefetch>;
type Result = Awaited<ReturnType<typeof installNavigationPrefetch>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof installNavigationPrefetch>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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
