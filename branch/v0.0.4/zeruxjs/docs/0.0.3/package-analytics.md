# Analytics collection and aggregates

Collect opt-in events and interpret each query’s coverage honestly.


## Create an event pipeline

```ts
import { createAnalytics } from '@zeruxjs/analytics';
const analytics = createAnalytics({ analytics: 'reporting',
  database: dbManager, enabled: true });
await analytics.initialize();
await analytics.track({ name: 'page.view', source: 'server', site: 'docs',
  properties: { section: 'routing' } });
```

The database manager is application-provided and must have the named connection. Collection is best effort: unavailable storage, validation or writes can drop events without failing the user request. A 204 collector response is not proof of a committed event.

## Public collection policy

Use explicit origins, bounded body readers, timeouts and concurrency. Browser consent/identity must be configured intentionally; the library does not create tracking cookies or fingerprint users automatically. Bind site by trusted origin for multi-tenant collection and authenticate confidential server events.

## Query coverage

| Query | Meaning |
| --- | --- |
| Bounded raw events | A limited event page, not a global total |
| Native aggregate/count | Exact for persisted matching event rows |
| Numeric materialization | Indexed-only facts; historical/failed writes can be missing |
| Reconciliation completion | A bounded scan exhausted, not a transactional completeness proof |

## Request IDs and control-plane storage

Use the shared database request-ID store for cross-replica day-scoped replay protection. Memory reservations only coordinate one process. Versioned document stores require atomic affected-count CAS semantics. They are not high-volume durable ingestion queues.

## Email activity and retention

Email instrumentation is separately opt-in and can use a rotating key ring. Opens are observed requests that can include scanners/proxies. A clicked download link does not prove bytes were served. Retention APIs are paged and require explicit approval; they do not erase every external or email-related record. Review the full package documentation before enabling deletion or interpreting totals.

## Install and select the integration

```sh
npm install @zeruxjs/analytics@0.0.3
```

This package participates in the runtime's **analytics** integration. Start with [analytics configuration](/branch/v0.0.4/zeruxjs/docs/0.0.3/configuration-analytics.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

For runtime use, configure the named reporting database and the analytics service. For standalone use, provide the real database manager and explicitly initialize the analytics instance. Register a small event vocabulary, choose the site scope on the server and distinguish web, server, email and system sources. Add a collector only when HTTP ingestion is part of the application.

## TypeScript: inputs, results and ownership

```ts
import { createAnalytics } from '@zeruxjs/analytics';

type Inputs = Parameters<typeof createAnalytics>;
type Result = Awaited<ReturnType<typeof createAnalytics>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createAnalytics>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.3/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Analytics is best effort and must not decide whether a transaction or permission succeeded. Check initialization/status and result coverage. Keep personal data out of arbitrary event properties, apply consent before collection and design retention/aggregation boundaries. A limited raw-event result is a page or sample, not a global business total.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### AnalyticsConfig

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `analytics` | `string` | Yes |
| `database` | `DatabaseManagerLike` | Yes |
| `enabled` | `boolean` | Yes |
| `onWarning` | `(message:string)=>void` | Yes |
| `table` | `string` | Yes |
| `indexes` | `boolean` | Yes |
| `numericFields` | `string[]` | Yes |
| `numericUniqueIndexManagedExternally` | `boolean` | Yes |
| `webConsent` | `'optional'\|'required'` | Yes |
| `eventSchemas` | `Record<string,{properties:Record<string,'string'\|'number'\|'boolean'\|'null'>;allowAdditionalProperties?:boolean}>` | Yes |
| `approveRetention` | `(scope:{site:string;before:number})=>boolean\|Promise<boolean>` | Yes |
| `filter` | `(input:Readonly<AnalyticsEventInput>)=>AnalyticsEventInput\|null\|Promise<AnalyticsEventInput\|null>` | Yes |

### CollectorOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `analytics` | `AnalyticsManager` | No |
| `requestIdStore` | `RequestIdStore` | Yes |
| `requireRequestId` | `boolean` | Yes |
| `allowTextPlainBeacon` | `boolean` | Yes |
| `dispatch` | `(input:AnalyticsEventInput,context:{requestId:string;utcDay:string;origin?:string})=>Promise<unknown>` | Yes |
| `prefix` | `string` | Yes |
| `allowedOrigins` | `readonly string[]` | Yes |
| `serverToken` | `string` | Yes |
| `maxBodyBytes` | `number` | Yes |
| `bodyTimeoutMs` | `number` | Yes |
| `maxConcurrentReads` | `number` | Yes |
| `maxEventsPerMinute` | `number` | Yes |
| `storageTimeoutMs` | `number` | Yes |
| `maxPendingEvents` | `number` | Yes |
| `siteByOrigin` | `Record<string,string>` | Yes |
| `requireBrowserConsent` | `boolean` | Yes |
| `botPolicy` | `'allow'\|'drop-known'` | Yes |

### AnalyticsSummaryQuery

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | Yes |
| `source` | `string` | Yes |
| `site` | `string` | Yes |
| `since` | `number` | Yes |
| `until` | `number` | Yes |
| `limit` | `number` | Yes |

### AnalyticsAggregateQuery

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `groupBy` | `'event'\|'source'\|'site'\|'pathname'\|'day'` | No |

### AnalyticsNumericAggregateQuery

Values cover successfully materialized numeric facts, not necessarily all historical events.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `metric` | `'sum'\|'average'\|'min'\|'max'` | No |
| `valueField` | `string` | No |

### AnalyticsRetentionQuery

Bounded site-scoped, keyset-paged purge. Rerun from the beginning to catch late historical writes.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `site` | `string` | No |
| `before` | `number` | No |
| `cursor` | `string` | Yes |
| `limit` | `number` | Yes |
| `dryRun` | `boolean` | Yes |
| `numericSidecar` | `'present'\|'absent'` | Yes |

### EmailTrackingOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `analytics` | `AnalyticsManager` | No |
| `baseUrl` | `string` | No |
| `secret` | `string` | Yes |
| `keyRing` | `EmailTrackingKeyRing` | Yes |
| `acceptLegacyHmac` | `boolean` | Yes |
| `path` | `string` | Yes |
| `ttlMs` | `number` | Yes |
| `allowedLinkHosts` | `readonly string[]` | Yes |
| `activityStore` | `EmailActivityStore` | Yes |
| `onEvent` | `(event:EmailActivityEvent)=>void\|Promise<void>` | Yes |
| `enabled` | `boolean` | Yes |
| `telemetryTimeoutMs` | `number` | Yes |
| `maxPendingTelemetry` | `number` | Yes |
| `onWarning` | `(message:string)=>void` | Yes |

### NumericReconciliationJobOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `query` | `NumericReconciliationQuery` | No |
| `store` | `VersionedStore<NumericReconciliationJobDocument>` | No |
| `projectionKey` | `string` | Yes |
| `reconcile` | `(query:NumericReconciliationQuery)=>Promise<NumericReconciliationResult>` | No |
| `leaseMs` | `number` | Yes |
| `now` | `()=>number` | Yes |


## Public entry points

Manifest reference for `@zeruxjs/analytics@0.0.3`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./http": {
      "types": "./dist/http.d.ts",
      "default": "./dist/http.js"
    },
    "./email": {
      "types": "./dist/email-tracking.d.ts",
      "default": "./dist/email-tracking.js"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "default": "./dist/browser.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "@zeruxjs/db": "0.0.3"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/analytics

Lightweight, opt-in, DB-backed application events. Accepts GA4-style event names and scalar property key/value pairs, a Fetch collector for web/server events, and signed server-side email pixels and click redirects. This is a minimal event pipeline, **not** GA4 analytics parity or a marketing automation system.

## Named database connection

```ts
import {createAnalytics,createAnalyticsCollector} from '@zeruxjs/analytics';

const analytics=createAnalytics({
  analytics:'reporting',    // matches the @zeruxjs/db connector name
  database:dbManager,      // an existing initialized database manager
  enabled:true,
  onWarning:message=>logger.warn(message)
});
await analytics.initialize(); // optional explicit schema creation; returns false if unavailable

await analytics.track({name:'page.view',source:'server',site:'site-a',
  properties:{section:'docs',duration_ms:240}});
const collector=createAnalyticsCollector({analytics,allowedOrigins:['https://app.example'],
  serverToken:process.env.ANALYTICS_INGEST_TOKEN});
// Register collector.path + collector.handler through your ZeruxJS Fetch route bridge.
```

**Analytics is best-effort.** If the DB name is absent, the connector is disconnected, schema creation fails, a sample is invalid, or a query fails, analytics functions warn once per issue and return `undefined`, `false`, `[]`, or `{}` rather than throwing. `analytics.setEnabled(false)` disables collection; reconnecting a named DB connector allows subsequent events to be stored without rebuilding the analytics service. `analytics.status()` reports recorded/dropped counts. Do not mistake missing results for guaranteed delivery. For stronger guarantees, a future persistent analytics queue is required.

Browser `createEventClient()` uses uncredentialed requests, has an explicit enabled switch, and returns `false` on network failure. Untrusted origins are not sufficient to authenticate confidential server events; configure bearer tokens and strict origin allowlists for the HTTP collector, and apply reverse-proxy rate limits. Web clients cannot claim to send server or email events.

## Email tracking (opt-in)

```ts
import {createEmailTrackingService} from '@zeruxjs/analytics/email';
const tracking=createEmailTrackingService({
  analytics,baseUrl:'https://events.example.com',
  secret:process.env.EMAIL_TRACKING_SECRET!,
  allowedLinkHosts:['app.example.com'],
  enabled:true
});
// Pass tracking to createEmailManager({tracking,...}) in @zeruxjs/email.
// For each email: tracking:{enabled:true,opens:true,clicks:true,campaign:'launch'}
// Or turn off per send with send(message,{tracking:false}).
```

Email tracking requires no JavaScript in mail clients: a tiny invisible GIF records optional opens, and signed expiring redirects record optional clicks. If analytics storage is unavailable, pixel responses and click-through redirects **still work** and no email send is interrupted. HEAD does not create events. Treat all open statistics as approximate because privacy proxies/preloaders may fetch tracking pixels. Do not track recipients without appropriate notice/consent; disable per message or globally when required.

For future marketing, events carry opaque message IDs, the sending account and an optional campaign marker, without raw recipient addresses in stored tracking properties. Campaign suppression, opt-outs, bounce/complaint handling, scheduling, aggregation and durable queues are future package responsibilities.

## Section 44: encrypted email links and collector upload deadlines

New open/click links have encrypted and authenticated `v2.` tokens, protecting click destinations and campaign/message metadata from simple URL decoding. Existing Section 43 HMAC links are accepted until their own expiration as long as the same tracking secret is configured. Keep this secret consistent on every replica; rotate it only with a planned migration. Unsubscribe/opt-out links and anchors marked `data-no-track`, `data-tracking="off"`, or `rel="unsubscribe"` are not rewritten; repeated instrumentation is safe. Newly encrypted URLs still reveal that a tracking endpoint was requested and can be logged by servers or mail clients, so these controls **do not replace consent**.

`createAnalyticsCollector()` (and `analytics.collector` in ZeruxJS config) now accepts `bodyTimeoutMs` (default `3000`; range 10–60000) and `maxConcurrentReads` (default `64`; range 1–1000). A slow body receives 408 after its absolute read deadline, excessive simultaneous body readers receive 429, and an oversized `Content-Length` can be rejected with 413 before consuming the body. These bounds apply per runtime instance; configure reverse-proxy timeouts and distributed abuse controls separately. Browser-origin responses preserve relevant CORS headers on errors. Database write failures still return 204 for fail-soft collection.

## Section 45: safe signing-key rotation

Single-secret configurations are still supported and **continue emitting `v2.` links**. To rotate a key without breaking previously delivered encrypted links, replace `secret` with `keyRing` (do **not** supply both):

```ts
const tracking = createEmailTrackingService({
  analytics,
  baseUrl: 'https://events.example.com',
  keyRing: {
    current: { id: '2026_nov', secret: process.env.EMAIL_TRACKING_NEW_SECRET! },
    previous: [{ id: '2026_oct', secret: process.env.EMAIL_TRACKING_OLD_SECRET! }]
  },
  // Only when all pre-Section-44 HMAC links have expired:
  acceptLegacyHmac: false
});
```

New links use `v3.<key-id>.<encrypted-payload>` with AES-256-GCM authentication, and the key ID itself is authenticated. Old `v2.` links are tried against the **bounded ring** (the active key plus up to four previous keys); existing Section 43 signed HMAC links can be verified during migration unless `acceptLegacyHmac:false`. Prior keys **never sign** new links. Unknown or retired key IDs, malformed tokens, wrong keys, and tampering are rejected. Key identifiers are public metadata; do not put credentials or customer identifiers into them.

**Rollout:** Give all live replicas the same key ring *before* switching the active key. During any overlap between deployments, every replica must have the verification keys needed for every active signing key; otherwise users can intermittently see 404s. A safe two-phase rollout introduces the new key as a previous/verification key everywhere, then activates it everywhere, and retains the retired signing key in `previous` until all its links expire (at most the 30-day configured token lifetime). Removing a previous key intentionally revokes its old links. `acceptLegacyHmac:false` invalidates all original readable HMAC links but does **not** invalidate encrypted v2/v3 links. Never commit secrets to source, log token contents, or put them in browser configuration. Ingestion, email send, and tracking remain opt-in and best-effort.

## Section 46: Independent email activity reports

`tracking.getActivity(trackingId)` returns a best-effort summary with `sentAt`, first/last open and click timestamps, counts, per-link hashed IDs and repeat counts, and download-link click counts. Email send results from `@zeruxjs/email` expose the opaque `trackingId` for explicitly instrumented sends. A link marked via `tracking.downloadLinks` or `data-track-download` generates `email.download_click`, **not** a proven download; your authenticated server should call `tracking.recordDownload({id, account, url, bytes})` only after successfully serving a file to generate `email.download`. No server can reliably count downloads of attachments already packaged into an email.

Use `tracking:{enabled:true}` separately on the email send; marketing consent never implicitly enables it. Local aggregation defaults to `createMemoryEmailActivityStore()` (bounded to 10,000 emails, non-durable). Supply an atomic shared `activityStore` to `createEmailTrackingService()` or ZeruxJS `email.tracking` for accurate multi-instance reporting, queue workers, and restart survival. The normal DB-backed analytics event pipeline remains best-effort independently. The reporting counters represent observed tracking requests, not certified human behaviour; opening proxies, link scanners, ad blockers and failed telemetry can under/over-count.


## Section 47: Request correlation and versioned definitions

Use `createRequestId()` to generate cryptographic 16-character mixed-case alphanumeric IDs; `requestUtcDay()` returns the server UTC day. With a `RequestIdStore`, `createAnalyticsCollector({requestIdStore,requireRequestId:true})` rejects duplicate IDs on the same day with 409, invalid IDs with 422, and unavailable reservation storage with 503; successful requests echo `x-zerux-request-id` / `x-zerux-request-day` headers. The event validator stores the trusted correlation fields as `zRequestId` / `zRequestUtcDay` in properties for existing schemas. To avoid replay collisions across hosts, use `createDatabaseRequestIdStore(connection)` on an atomic, shared DB primary key; `createMemoryRequestIdStore()` is strictly for a single process.

`createDatabaseDocumentStore(connection,table,id,initial)` provides optimistic compare-and-swap saves for published tag containers and report definitions. Connector `update` must report `affectedCount` (or `rowCount`) reliably. This is a durable control-plane document store, **not** a high-volume event queue. The collector remains best-effort for DB telemetry, but request-ID storage failures do not claim successful request uniqueness. Browser tagging and GA4 forwarding now belong in `@zeruxjs/tags`; design/reporting in `@zeruxjs/reports`.

## Section 48: Native DB COUNT and index management

`await analytics.aggregate({groupBy:'event'|'source'|'site'|'pathname'|'day', name?, source?, site?, since?, until?, limit?})` computes counts on the named DB connector without the 500-row raw-events limit. `day` requires both time bounds and supports up to 366 days. Results include `{groups,total,truncated,mode:'database'}`; truncated means there are more **groups**, not that `total` is sampled. Native failures reject to reporting clients (HTTP 503), while `track()` is unchanged and remains non-throwing best-effort telemetry. The shared DB facade supports this structured query subset in SQL and MongoDB (not arbitrary database expressions).

On schema initialization analytics creates up to three read indexes for timestamp/event/site lookup when `connection.createIndex` is supported. `status().indexesReady` tells you whether all succeeded, without preventing ingestion on index errors. Use `indexes:false` if you create your own production indexes in migrations; `indexesReady:false` then means not managed by analytics, not that indexes are missing. Read the root `SECTION_48_NATIVE_ANALYTICS_AGGREGATION.md` for snapshot consistency and deployment caveats.

## Section 49: Opt-in numeric fact materialization

Set `numericFields:['value','duration_ms']` on the analytics config (max eight distinct validated property names). The new per-event numeric sidecar table enables database-side `analytics.aggregateNumeric({metric:'sum'|'average'|'min'|'max',valueField:'value',groupBy:'event',site?,name?,source?,since?,until?,limit?})`. `groupBy:'day'` requires a bounded UTC interval of at most 366 days. `status()` now includes `numericReady`, `numericIndexed`, and `numericDropped`. Use `analytics.supportsNumericField(name)` to detect configured properties. Raw event logging still remains non-throwing if optional numeric writes fail. These aggregates describe **only numeric facts committed to the new table**; old events are not automatically indexed and partial writes can occur. The response includes `coverage:'indexed-only'` and `matchedFacts`. Consult the root `SECTION_49_MATERIALIZED_NUMERIC_ANALYTICS.md` before using metrics for decisions requiring certified totals.

### Section 50 — Historical reconciliation

`analytics.reconcileNumeric({since,until,site?,cursor?,batchSize?})` repairs missing numeric facts from persisted event properties, one resumable keyset page at a time. It requires a DB-enforced unique `(event_id,property_name)` index. The automatic index is attempted with `indexes:true`; if you manage indexes in migrations, set `indexes:false,numericUniqueIndexManagedExternally:true` **only after provisioning the unique constraint**. Failures reject, conflicts reject, and all reported coverage remains `indexed-only`; neither this API nor a completed page is a transactional completeness guarantee. See `SECTION_50_NUMERIC_BACKFILL_RECONCILIATION.md` at the project root.


### Section 51: coordinated durable numeric reconciliation jobs

`analytics.createReconciliationJob('job-id', {since,until,site?,batchSize?}, {leaseMs?})`
returns a trusted administrative handle with `runOnce(workerId)`, `get()`, `restart()`,
and optional manual `acquire/renew/checkpoint/fail` operations. The shared database
atomically versions checkpoint records and fences expired workers; jobs must use a shared
connector with `UPDATE` affected counts and verified unique event/property facts. Each
`runOnce` processes one bounded page. `completed` indicates scan exhaustion, **not**
transactional or historical data completeness. Run again with `restart()` for late events.
See root `SECTION_51_DURABLE_RECONCILIATION_JOBS.md` for safe operations and limits.

## Section 71: Collection consent, identity, tenant binding and retention

`createAnalytics()` can now use `webConsent:'required'` and a strict `eventSchemas` event/property allowlist; a denied-consent event never persists. Browser session and visitor tokens must be **opaque 16–128-character** IDs and require `consent:'granted'`; no cookies, automatic identifiers, IPs or email addresses are created. Use browser-exported `createAnonymousAnalyticsId()` to generate a cryptographically random token **only after consent**. Set `createEventClient({requireConsent:true})`, call `.setConsent('granted'|'denied'|'unknown')`, and pass `sessionId` or `visitorId` per call. Browser HTTP `204` means accepted for best-effort processing, **not** proof of a committed DB event.

For shared collectors, `siteByOrigin:{'https://app.example':'site-tenant'}` binds a public browser origin to a trusted tenant and blocks forged site overrides; configure `requireBrowserConsent:true`, `botPolicy:'drop-known'` and a proper distributed `requestIdStore` as appropriate. On server-to-server endpoints, a secret bearer token authenticates calls but does not replace tenant authorization. The collector validates payloads before reserving request IDs and preserves deadlines, size caps and nonfatal storage behavior.

`countsWithCoverage()` explicitly marks its results `sampled-page` or `unavailable`; `aggregate()` remains native/exact **only for persisted rows**, and `aggregateNumeric()` remains materialized `indexed-only`. `reconcileNumeric()` and fenced jobs can backfill numeric facts from historical events; they never imply atomic coverage across concurrent writes.

`analytics.purgePage({site,before,limit?,cursor?,dryRun?:true})` is a **trusted administrative** paged retention API requiring a site and cutoff at least 24 hours old. Actual deletion requires `dryRun:false` and an `approveRetention` hook in `createAnalytics()`. It deletes numeric facts before source events and rejects unsafe deletion if the sidecar state is unknown; when numeric fields are not configured, explicitly attest `numericSidecar:'present'|'absent'`. It does not erase email, request-ID, suppression, external sinks, browser or provider records. Read the full [Section 71 technical guide](https://github.com/zeruxjs/zeruxjs/SECTION_71_ANALYTICS_COLLECTION_IDENTITY_RETENTION.md) before deploying or deleting data.

Opt-in live database parity tests require dedicated disposable PG, MySQL or Mongo databases; the default local suite verifies real SQLite. No live cluster parity or Section 66 registry clean build is claimed until those gates actually run.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.


## Implementation sources

- [packages/@zeruxjs/analytics/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/analytics/README.md)
- [packages/@zeruxjs/analytics/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/analytics/package.json)
