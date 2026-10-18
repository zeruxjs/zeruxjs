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
  paths: ['/zeruxjs/'],
  maxPages: 6,
  delayMs: 120,
});

// Dispose when the owning page/application is permanently removed.
navigation.destroy();
```

Install once per document. The controller waits for hover or keyboard focus, submits speculation prefetch rules when supported, and otherwise uses link prefetch hints. It never prerenders or executes a destination page. Browsers may decline hints. Only allow explicitly public paths: prefetch requests still reach your server.

The budget is per document, with a maximum of twenty distinct hints. Same-origin directory URLs are eligible; queries, external URLs, current-page anchors, downloads and opted-out links are excluded. `data-no-prefetch` opts out a link or its containing region. Offline, slow connections and Save-Data suppress new hints. Use `strategy: 'link'` for a restrictive inline-script CSP, or supply an allowed `nonce` for speculation rules. Without a DOM the installer returns a disabled controller.


## Public entry points

Manifest reference for `@zeruxjs/performance@0.0.2`.

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
    "./*": "./*"
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

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.

## Public static-page navigation prefetch

```ts
import {installNavigationPrefetch} from '@zeruxjs/performance/navigation';
const navigation=installNavigationPrefetch({paths:['/zeruxjs/'],maxPages:6,delayMs:120});
// On SPA/component teardown:
navigation.destroy();
```

The browser-safe navigation entry point uses intent (hover/focus), bounded unique URLs, same-origin public path prefixes, and speculation-rule prefetch with a `rel=prefetch` fallback. It does not prerender/execute destination pages. Queries, downloads, external links, nofollow links, `data-no-prefetch` ancestors and same-page anchors are excluded. Saving data, slow connections (3g or slower), offline state and hidden documents suppress new requests. The optional nonce permits speculation rules under a compatible CSP; use `strategy:'link'` when your policy does not permit inline speculation rules. Browser policy can still decline a hint. `queued` reports submitted hints, not proof of a completed/cached network request.

Only pass prefixes that contain public, side-effect-free static HTML; this helper is not an authorization or URL-classification mechanism for application APIs. It reads browser globals only at installation and returns an inert controller on the server. `destroy()` removes its listeners, pending timer and injected elements. No metrics, cookies or identifiers are collected.


## Implementation sources

- [packages/@zeruxjs/performance/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/performance/README.md)
- [packages/@zeruxjs/performance/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/performance/package.json)
