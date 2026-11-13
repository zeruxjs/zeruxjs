# Performance observations

Collect browser metrics intentionally and audit with an existing Chrome instance.


## Browser ownership

observeWebVitals reports supported LCP, CLS, FCP and navigation TTFB observations. It does not claim spec-accurate INP. Browser lifecycle and support affect accuracy; compare deployment baselines with that context.

## Collect and report

createVitalCollector keeps bounded per-metric samples and percentile summaries. createVitalReporter sends explicitly added batches through fetch and retains retry data only in memory. Consent, allowed destination, lifecycle cleanup and privacy are application choices; import alone does not start telemetry.

## Cleanup

Call the observer stop function, then reporter.destroy and await reporter.whenClosed on page/component teardown. Avoid registering duplicate observers on every route transition. A bounded in-process sample is not a durable metrics backend.

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
npm install @zeruxjs/performance@0.0.4
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

| Field      | Accepted type/value | Optional |
| ---------- | ------------------- | -------- |
| `paths`    | `readonly string[]` | No       |
| `maxPages` | `number`            | Yes      |
| `delayMs`  | `number`            | Yes      |
| `strategy` | `"auto" \| "link"`  | Yes      |
| `nonce`    | `string`            | Yes      |

### VitalObserverOptions

| Field            | Accepted type/value                                                                                                | Optional |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| `onMetric`       | `(metric:PerformanceMetric)=>void`                                                                                 | No       |
| `createObserver` | `(callback:(entries:PerformanceEntry[])=>void)=>{observe(options:PerformanceObserverInit):void;disconnect():void}` | Yes      |
| `navigation`     | `()=>{responseStart:number;requestStart:number}\|undefined`                                                        | Yes      |

### VitalReporterOptions

| Field                        | Accepted type/value                                                                    | Optional |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `url`                        | `string`; mutually exclusive with `send`                                               | Yes      |
| `fetch`                      | `typeof fetch`                                                                         | Yes      |
| `maxBatch`                   | `number`                                                                               | Yes      |
| `signal`                     | `AbortSignal`                                                                          | Yes      |
| `credentials`                | `RequestCredentials`                                                                   | Yes      |
| `send`                       | Trusted `(metrics, {signal}) => Promise<boolean>` transport; required if URL is absent | Yes      |
| `maxQueue` / `maxBatchBytes` | Bounded pending count / serialized UTF-8 bytes                                         | Yes      |
| `maxRetries` / `maxAgeMs`    | Additional transient attempts / admission age ceiling                                  | Yes      |
| `retryBaseMs` / `retryMaxMs` | Explicit-flush exponential backoff bounds; no automatic retry timer                    | Yes      |
| `timeoutMs` / `now`          | Observation deadline / trusted clock; native capacity remains until settlement         | Yes      |

### LighthouseOptions

| Field    | Accepted type/value                                             | Optional |
| -------- | --------------------------------------------------------------- | -------- |
| `port`   | `number`                                                        | Yes      |
| `runner` | `(url:string,options:Record<string,unknown>)=>Promise<unknown>` | Yes      |

### CacheOptions

| Field                  | Accepted type/value | Optional |
| ---------------------- | ------------------- | -------- |
| `maxAge`               | `number`            | Yes      |
| `immutable`            | `boolean`           | Yes      |
| `private`              | `boolean`           | Yes      |
| `noStore`              | `boolean`           | Yes      |
| `mustRevalidate`       | `boolean`           | Yes      |
| `staleWhileRevalidate` | `number`            | Yes      |
| `staleIfError`         | `number`            | Yes      |
| `sMaxAge`              | `number`            | Yes      |

## Explicit hosting response policy

The optional Node-only `@zeruxjs/performance/response` entry delegates to a borrowed
`zhost/compression` owner. Importing performance starts no encoder/server. Hosts
must select one compression layer and derive authenticated classification from
verified server identity. Private is the default; cookies/Authorization/Set-Cookie
conservatively force no-store. Public cache policy remains an explicit host choice.

The zhost owner bounds active encoders, uses identity/406 at capacity and reports
only fixed encoding/outcome/byte/duration fields. Changed representations discard
identity ETags and lengths; ranges, no-transform and existing encodings bypass
transformation. Conditional evaluation stays with the origin; HEAD/304 do not
consume source bodies. Native streaming retains backpressure and disconnect
cleanup. Build-time minification remains in TypeScript tooling.

See the package README and `examples/response.mjs` for exact limits, lifecycle and
HTTP semantics. Local identity/gzip/Brotli measurements are workload observations,
not evidence of general latency gains or production/CDN/browser qualification.

## Actual disposal and validation boundaries

Reporters and analytics adapters separate `destroy()` from `whenClosed()`: cancellation ends waiting but an uncooperative native transport retains its slot until actual settlement. Consent/identity changes fence late failures so old samples cannot requeue. Recovery contains only known queued scalar observations; an active outcome remains unknown. The optional web-vitals 5 source is page-owned and has no public native observer unsubscribe; bridge detach is not full source cancellation.

The weak ETag helper is length/FNV-1a, not a cryptographic integrity check. Resource-hint relations and credential-mode unions are trusted typed host inputs; serialization does not authorize destinations. Callback measurement helpers preserve results/failures and emit no automatic telemetry. Keep cache classification, native compression, collector authorization and build minification with their actual owners.


## Public entry points

Manifest reference for `@zeruxjs/performance@0.0.4`.

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
    "./LICENSE-APACHE": "./LICENSE-APACHE",
    "./analytics": {
      "import": {
        "types": "./dist/browser/analytics.d.ts",
        "default": "./dist/browser/analytics.js"
      },
      "require": {
        "types": "./dist/analytics.d.ts",
        "default": "./dist/analytics.js"
      }
    },
    "./response": {
      "types": "./dist/response.d.ts",
      "import": "./dist/response.js",
      "require": "./dist/response.js"
    }
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

## Consent-aware analytics and operational adapters

`@zeruxjs/performance/analytics` adds an opt-in ESM browser entry (and a CommonJS require target) without Node globals, Lighthouse or an automatic web-vitals import. Importing it opens no observers, listeners, timers, storage or network connections. The browser bundle is separately compiled with no Node ambient types. Existing root/navigation and legacy `dist/*` imports remain available; navigation prefetch remains independent of telemetry and reads no analytics identities.

```ts
import {createBrowserPerformanceAnalytics, performanceAnalyticsSchemas} from '@zeruxjs/performance/analytics';

const metrics = createBrowserPerformanceAnalytics({
  site: verifiedPublicSiteLabel,
  consent: 'granted', // only after the host has obtained the required consent
  send: (events, {signal}) => hostAuthorizedMetricTransport(events, signal),
  reporter: {maxQueue:100, maxBatch:25, retryBaseMs:1000, maxRetries:3, maxAgeMs:60000}
});
metrics.start();
// Explicit consent changes, including identity removal:
metrics.setConsent('denied');
// On component/page-owner teardown:
metrics.destroy();
await metrics.whenClosed();
```

The [public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/examples/browser.ts) requires an explicit transport and consent state. No cookies, storage, fingerprint, visitor/session ID or marketing profile is created. Unknown/denied consent prevents startup, metric admission and sending. `setConsent` revocation disconnects owned native observers, removes lifecycle listeners, clears samples/queues/identity and aborts active delivery. Already transmitted bytes cannot be recalled. Granting consent or changing session identity requires an explicit new `start()`; a new identity clears the old scope rather than reusing its samples. Optional `sessionId` is an opaque 16–128-character token, accepted only for explicitly granted collection; the host owns identity creation/persistence and verified site mapping.

Site labels are bounded safe identifiers, not URLs. Browser events contain only event/source/site/consent, an explicitly supplied consented session ID and approved scalar metric fields. Raw paths, queries, URL-bearing observer entry names, DOM nodes/selectors, library entries/attribution, native metric IDs, cookies and arbitrary extra properties are never copied into payloads. Safe syntax cannot detect every personal value in a host-chosen label: keep labels public/nonpersonal and authorize the collector tenant independently. These helpers do not authenticate a browser's site or consent assertion, and do not replace origin/CSRF, body/read limits or server authorization.

`performanceAnalyticsSchemas()` returns data compatible with `@zeruxjs/analytics.createEventSchemaRegistry`; it starts no sink. The `performance.vital.v1` schema has fixed metric/unit/coverage dimensions, `sample_size`, `duration_ms` and `layout_shift_score`. Millisecond values are registered metrics in 0–3600000. CLS is a nonnegative **score parameter**, with unit label `score`, because analytics' current ratio metric is constrained to 0–1 and valid CLS can exceed 1. CLS therefore is not offered as an indexed-unit numeric aggregate; do not clamp it into a probability or silently claim analytics has an unbounded score-unit contract. Native/maintained algorithm provenance is retained as `coverage:'native-observation'|'web-vitals-5'`. Each observation event has sample_size 1; this is not a count of unique people or complete page loads.

### INP algorithm and browser ownership

The existing `observeWebVitals` still measures only native LCP/CLS/FCP/navigation-response timing. It never relabels an event duration as INP. Native observation is a limited approximation, not complete Chrome/CrUX parity: TTFB retains the existing responseStart–requestStart definition, unsupported entry types are skipped/reported, and prerender/BFCache/frame/soft-navigation semantics are not automatically normalized.

For actual INP, explicitly use the installed optional **web-vitals 5.x** maintained `onINP` algorithm. Configure `webVitals:{version:'5.2.0',inpSupported:actualBrowserCapability}` and pass its callback to `metrics.receiveWebVital`. The bridge only accepts INP/name/value/id/rating from this declared source and drops entries/attribution. Check both Event Timing interactionId support and supported observer types using the maintained library/browser; unsupported means no INP observation, not zero. Other major versions reject until separately qualified. The [page-owned source example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/examples/inp.ts) imports the actual maintained public `onINP` API; it is not a replacement algorithm or production browser acceptance test.

**web-vitals 5.2 exposes no public unsubscribe/disconnect for onINP.** The host must register one source per document, after consent, and own its page lifetime. The example's detach removes the bridge callback, not the library's observers. This package never starts that source implicitly; bridge destroy/revocation gates subsequent values, while the library's page-owned observers may continue locally. Do not register another library observer on every SPA mount. If policy requires stopping all underlying observation on revocation, leave this optional source disabled or use a separately qualified source with real cancellation; do not patch browser globals or pretend a void onINP return value is a disposer. See the maintained [API/browser coverage](https://github.com/GoogleChrome/web-vitals#api) and [v5 onINP implementation](https://github.com/GoogleChrome/web-vitals/blob/v5.2.0/src/onINP.ts).

Native buffered APIs and a maintained source can report earlier page timing after an explicitly consented start. The host must decide whether that buffered history is permitted; the bridge does not certify a pre-consent time cutoff. Repeated same-ID/same-value INP updates and unchanged native values are suppressed, while actual value changes remain observation updates. These are observation-weighted percentiles, not final per-page or population Core Web Vitals p75 statistics.

### Reporter bounds, retries and disposal

`createVitalReporter` now supports either its existing explicit `url`/fetch transport or a trusted `send(metrics,{signal})` callback. It serializes only approved scalar `PerformanceMetric` fields. Endpoint URLs reject credentials, queries and fragments; fetch defaults to omitted credentials, no-store, redirect error and keepalive. Keepalive is a browser hint, not proof of delivery after page exit. Fetch response bodies are canceled and native work remains owned until cancellation settles. Host callbacks own authentication, destination policy and actual persistence; `true` means that transport reported success, not a database commit.

| Bound                    | Default / allowed range                        |
| ------------------------ | ---------------------------------------------- |
| maxBatch                 | 50 / 1–500 observations per explicit flush     |
| maxQueue                 | maxBatch / 1–2000 observations                 |
| maxBatchBytes            | 32768 / 256–60000 UTF-8 JSON bytes             |
| maxRetries               | 3 / 0–20 **additional** attempts               |
| maxAgeMs                 | 60000 / 1–3600000 ms from queue admission      |
| retryBaseMs / retryMaxMs | legacy 0 / 60000; each 0–60000 and max >= base |
| timeoutMs                | 3000 / 1–60000 ms observation deadline         |

Analytics/operational adapters opt into a 1000ms base by default; legacy reporter explicit immediate-flush retries remain compatible. No timer automatically retries or starts a network loop. `flush()` sends only due items, returns 0 during backoff, and preserves the bounded exponential retry/age budget. HTTP 408/429/5xx, network failure or callback false may retry; permanent HTTP denials drop. Retry-After is not interpreted. Queue overflow drops oldest pending observations and increments diagnostics, preserving the legacy newest-sample behavior. Expired/exhausted observations are discarded visibly. Server-side storage loss or lost acknowledgements can still duplicate observations on retry: there are no durable idempotency receipts, exact-delivery guarantees or automatic marketing conversions.

A delivery timeout/cancellation stops waiting and signals the transport; an uncooperative operation retains its single in-flight slot until actual settlement, so repeat flushes cannot grow native work. Hidden visibility and pagehide listeners request a bounded best-effort flush and absorb delivery errors; they do not create a periodic background sender. A browser may terminate that work. `destroy()` removes owned listeners/observers, aborts delivery and discards pending data by default. `destroy({unsent:'recover'})` returns only known queued samples plus `inFlightOutcome:'unknown'|'none'`; it never hands ambiguous in-flight data back as safe-to-retry. Recovery contains only approved metric scalars and deliberately omits the former session mapping. Repeated destroy returns no recovery data. Await `whenClosed()` for actual native cleanup; noncooperative transports may delay it. `clear()` fences old in-flight failures so they cannot requeue samples after consent/identity changes. Recovery is host-owned, not automatically persisted or replayed.

`createVitalCollector` preserves bounded percentile snapshots and adds coverageVersion, sampleSize, totalObserved, truncation, consent provenance and units. It allows at most 32 metric labels by default (1–128) and retains at most maxPerMetric values (default 200, 1–10000). Custom metric labels must be safe identifiers, not URL/path strings. Invalid fields/cardinality reject at direct boundaries; old arbitrary object spreads no longer leak extra fields into reports. Snapshots are retained observation samples, not a full-population, user, final-page or historical completeness claim. Empty observations, unsupported APIs, telemetry loss and denied consent are not synthesized as zero-duration samples.

### Server request metrics stay operational

`createServerPerformanceAdapter({routes,send,...})` accepts the existing framework's completed request-span **subset** `{durationMs,status,outcome}` plus a host-selected approved route label. It never imports the framework or starts a tracer. Routes are at most 32 unique safe labels (55 characters); unlisted labels reject, and the fixed `other` label is available. No URL parsing, raw request-path grouping or dynamic per-user route cardinality is inferred. Duration is bounded to one hour; long streams outside that bound reject rather than being silently reported as ordinary requests.

```ts
import {createServerPerformanceAdapter} from '@zeruxjs/performance/analytics';
const operational = createServerPerformanceAdapter({
  routes:['catalog','checkout'], send:privateOperationalBatchSink
});
// Explicitly inject into zeruxjs observability's owned adapter, for example:
const tracingAdapter = {export(span) { operational.record(span, 'other'); }};
// The host schedules explicit flushes and closes this adapter with its generation.
```

The existing zeruxjs request observer owns once-per-terminal span emission; choose one integration point, not both end and export. Performance copies only duration, bounded status class and completed/error/disconnected outcome into `request.<label>` observations. Request/trace/span/application/generation IDs, authorization, cookies, body, tenant-sensitive fields, URLs and marketing identifiers are discarded even if present on the input span. Operational snapshots identify `scope:'operational-only'`, `consent:'not-applicable'`, coverageVersion and sample size. That marker is a data-classification boundary, not permission to ignore privacy law or authenticate an input: use this adapter only with trusted server telemetry and a private authorized operational sink.

`requestPerformanceAnalyticsSchema(routes,eventName?)` supplies approved duration/count/status/outcome/route fields for a deliberately separate operational analytics namespace if a host chooses one. It neither sends events nor enables marketing. Declare the complete finite route vocabulary in advance; changing it requires a new event namespace or compatible owning-schema migration. Source/system site authorization, retention, aggregates and schema/coverage handling remain owned by analytics/the host. No operational trace identifier is automatically joined to consented web sessions.

Verification builds both performance and analytics and uses observer/lifecycle/Fetch fixtures for consent denial, storage outage, retry/age/overload, unsupported entry types, hidden/pagehide flush, revocation races, transport cleanup and sanitized server fields. Packed public imports compile with no Node ambient types and run without DOM globals; the browser ESM dependency graph excludes Node, Lighthouse and automatic web-vitals imports. These are fixture/type checks, not real browser INP, CrUX equivalence, deployed collector, proxy or native transport acceptance. Real browser/library combinations and a host's authorized metrics backend remain explicit prerequisites; none were installed, started or exercised as live acceptance here.

## Hosting response integration

`@zeruxjs/performance/response` is an optional Node-only entry with
`forwardPerformanceResponse(owner, request, source, response, policy)`.
It borrows a hosting owner: no zlib implementation, codec pool, request-time
minifier or dependency on zhost is imported. Explicitly pass
`createCompressionOwner` from `zhost/compression`, as in
[the public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/examples/response.mjs). Importing either entry starts
no server or remote connection. The host closes the compression owner after
stopping admission. Do not apply this adapter after headers commit, or combine it
with another compression middleware on the same response.

The trusted server policy requires `authenticated:boolean`. Output defaults to
`private, no-store`; explicitly anonymous `public:true` preserves the source's
public policy. Authenticated plus public rejects. Authorization/Cookie request
headers and Set-Cookie responses conservatively force private/no-store even if
misclassified public. Private policy removes Expires/Surrogate-Control/
CDN-Cache-Control, preserves no-transform, and never creates a shared cache.
This cannot erase data previously cached by another owner. Authorization, cookie
creation and secret-safe body construction remain the host's responsibility.

Compression is owned by zhost's existing proxy implementation: weighted gzip/
Brotli negotiation, Vary merging, existing Content-Encoding passthrough and
unacceptable-encoding 406 behavior remain there. Changed representations remove
Content-Length, origin ETag (weak **and** strong), Content-MD5, Digest,
Content-Digest, Repr-Digest and Accept-Ranges. They use streaming transfer framing; no false
compressed length or identity validator is invented. Unchanged representations
retain validators. Ranges, If-Range, 206/Content-Range, no-transform, SSE and
already encoded content bypass transformation. HEAD/204/205/304 consume no source
body and preserve identity metadata; this adapter does not synthesize 304 or
negotiate a compressed validator. Conditional request evaluation stays with the
origin/cache owner; use representation-aware validators there. Strong identity
validators must not be reused for encoded bytes. See
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html).

The explicit compression owner defaults to eight active native encoders (1–128),
Brotli quality 4 and zlib level 5. It queues nothing: saturation delegates identity
with Vary: Accept-Encoding, or 406 if identity is forbidden. `status()` exposes
only active/overloaded counts. `onMeasure` receives encoding, outputBytes,
durationMs and completed/cancelled/error only: no URLs, principals or raw errors.
Hooks are isolated and should be synchronous/lightweight. Destroy/close cancels
owned streams and awaits encoder close; client disconnect destroys source and
encoder. No automatic retry or forced cancellation of arbitrary JS is inferred.
Native zlib uses shared runtime resources; bounded encoder count/quality limits
work admission, not a hard CPU quota. Use deployment CPU limits and request/byte/
time admission for hard workload budgets. The legacy proxy still owns its own
admission configuration; this optional owner does not replace or silently retune
an existing proxy. [Node zlib guidance](https://nodejs.org/api/zlib.html) discusses
threadpool and memory costs.

Minification remains the explicit `buildTypescript({minify:true,...})` build option
in `@zeruxjs/typescript`; do not minify private runtime HTML/JSON in this adapter.
Performance cache/hint helpers remain standalone and browser-safe; legacy
`createCacheHeaders` retains its explicit existing public default, so it should
not be used to classify authenticated responses automatically.

The focused response fixture compares ten sequential loopback requests each for
identity/gzip/Brotli over the same 1000-record JSON buffer and records output
bytes/elapsed milliseconds with the Node version. These measurements describe
that workload only, not a speed gain, production capacity, CDN behavior or browser
qualification. Deployment TLS/CDN/HTTP2 and real slow-client capacity need separate
qualification; none is started by this package.

## Ownership checklist

| API                                              | Lifetime and teardown                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Cache/header/hint/schema builders and collector  | Inert data helpers; collector `clear()` releases retained samples                                                |
| `observePerformance`, `observeWebVitals`         | Invoke the returned disconnect function; no observation starts on import                                         |
| `installNavigationPrefetch`                      | One explicit public-page scope; `destroy()` removes owned hints/listeners/timer, not browser caches              |
| Reporter, browser analytics, operational adapter | `destroy()` stops admission/signals transport; await `whenClosed()` for actual settlement                        |
| Optional maintained INP source                   | One host-owned source per document; bridge detach cannot disconnect web-vitals 5 library observers               |
| `forwardPerformanceResponse`                     | Borrows one native hosting owner; host stops admission then closes that owner                                    |
| Lighthouse                                       | Explicit audit against an existing private Chrome port; host controls target/egress and borrowed runner lifetime |

The lightweight `createETag` is a compatible weak length/FNV-1a validator, not a cryptographic content-integrity digest. Resource hints escape attributes but their typed relation/credential modes are trusted host configuration, not an arbitrary JavaScript input-validation or destination-authorization boundary. Measurement helpers invoke the callback once and return its result/duration; their compatible `name` argument does not emit telemetry.


## Implementation sources

- [packages/@zeruxjs/performance/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/README.md)
- [packages/@zeruxjs/performance/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/package.json)
- [packages/@zeruxjs/performance/src/response.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/performance/src/response.ts)
- [packages/zhost/src/compression.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zhost/src/compression.ts)
