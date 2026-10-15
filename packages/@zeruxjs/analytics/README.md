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
