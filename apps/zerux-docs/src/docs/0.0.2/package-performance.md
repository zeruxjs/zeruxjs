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
