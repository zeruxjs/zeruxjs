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
