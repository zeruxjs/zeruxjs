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


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.
