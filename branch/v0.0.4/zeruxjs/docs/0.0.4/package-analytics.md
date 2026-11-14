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

| Query                     | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| Bounded raw events        | A limited event page, not a global total                         |
| Native aggregate/count    | Exact for persisted matching event rows                          |
| Numeric materialization   | Indexed-only facts; historical/failed writes can be missing      |
| Reconciliation completion | A bounded scan exhausted, not a transactional completeness proof |

## Request IDs and control-plane storage

Use the shared database request-ID store for cross-replica day-scoped replay protection. Memory reservations only coordinate one process. Versioned document stores require atomic affected-count CAS semantics. They are not high-volume durable ingestion queues.

## Email activity and retention

Email instrumentation is separately opt-in and can use a rotating key ring. Opens are observed requests that can include scanners/proxies. A clicked download link does not prove bytes were served. Retention APIs are paged and require explicit approval; they do not erase every external or email-related record. Review the full package documentation before enabling deletion or interpreting totals.

## Install and select the integration

```sh
npm install @zeruxjs/analytics@0.0.4
```

This package participates in the runtime's **analytics** integration. Start with [analytics configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-analytics.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

For runtime use, configure the named reporting database and the analytics service. For standalone use, provide the real database manager and explicitly initialize the analytics instance. Register a small event vocabulary, choose the site scope on the server and distinguish web, server, email and system sources. Add a collector only when HTTP ingestion is part of the application.

## TypeScript: inputs, results and ownership

```ts
import { createAnalytics } from '@zeruxjs/analytics';

type Inputs = Parameters<typeof createAnalytics>;
type Result = Awaited<ReturnType<typeof createAnalytics>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createAnalytics>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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

| Field                                 | Accepted type/value                                                                                                   | Optional |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| `analytics`                           | `string`                                                                                                              | Yes      |
| `database`                            | `DatabaseManagerLike`                                                                                                 | Yes      |
| `enabled`                             | `boolean`                                                                                                             | Yes      |
| `onWarning`                           | `(message:string)=>void`                                                                                              | Yes      |
| `table`                               | `string`                                                                                                              | Yes      |
| `indexes`                             | `boolean`                                                                                                             | Yes      |
| `numericFields`                       | `string[]`                                                                                                            | Yes      |
| `numericUniqueIndexManagedExternally` | `boolean`                                                                                                             | Yes      |
| `webConsent`                          | `'optional'\|'required'`                                                                                              | Yes      |
| `eventSchemas`                        | `Record<string,{properties:Record<string,'string'\|'number'\|'boolean'\|'null'>;allowAdditionalProperties?:boolean}>` | Yes      |
| `approveRetention`                    | `(scope:{site:string;before:number})=>boolean\|Promise<boolean>`                                                      | Yes      |
| `filter`                              | `(input:Readonly<AnalyticsEventInput>)=>AnalyticsEventInput\|null\|Promise<AnalyticsEventInput\|null>`                | Yes      |

### CollectorOptions

| Field                   | Accepted type/value                                                                                     | Optional |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| `analytics`             | `AnalyticsManager`                                                                                      | No       |
| `requestIdStore`        | `RequestIdStore`                                                                                        | Yes      |
| `requireRequestId`      | `boolean`                                                                                               | Yes      |
| `allowTextPlainBeacon`  | `boolean`                                                                                               | Yes      |
| `dispatch`              | `(input:AnalyticsEventInput,context:{requestId:string;utcDay:string;origin?:string})=>Promise<unknown>` | Yes      |
| `prefix`                | `string`                                                                                                | Yes      |
| `allowedOrigins`        | `readonly string[]`                                                                                     | Yes      |
| `serverToken`           | `string`                                                                                                | Yes      |
| `maxBodyBytes`          | `number`                                                                                                | Yes      |
| `bodyTimeoutMs`         | `number`                                                                                                | Yes      |
| `maxConcurrentReads`    | `number`                                                                                                | Yes      |
| `maxEventsPerMinute`    | `number`                                                                                                | Yes      |
| `storageTimeoutMs`      | `number`                                                                                                | Yes      |
| `maxPendingEvents`      | `number`                                                                                                | Yes      |
| `siteByOrigin`          | `Record<string,string>`                                                                                 | Yes      |
| `requireBrowserConsent` | `boolean`                                                                                               | Yes      |
| `botPolicy`             | `'allow'\|'drop-known'`                                                                                 | Yes      |

### AnalyticsSummaryQuery

| Field    | Accepted type/value | Optional |
| -------- | ------------------- | -------- |
| `name`   | `string`            | Yes      |
| `source` | `string`            | Yes      |
| `site`   | `string`            | Yes      |
| `since`  | `number`            | Yes      |
| `until`  | `number`            | Yes      |
| `limit`  | `number`            | Yes      |

### AnalyticsAggregateQuery

| Field     | Accepted type/value                            | Optional |
| --------- | ---------------------------------------------- | -------- |
| `groupBy` | `'event'\|'source'\|'site'\|'pathname'\|'day'` | No       |

### AnalyticsNumericAggregateQuery

Values cover successfully materialized numeric facts, not necessarily all historical events. Native reports reject storage failures rather than inventing zero totals. Totals and groups use separate reads and can differ under concurrent writes; they are not a shared transactional snapshot. Group limits default to 100 (maximum 500). Daily queries require explicit bounds spanning at most 366 UTC days, with at most six bucket reads per batch. The host owns authorization and tenant/site binding before calling these borrowed-connection helpers.

| Field        | Accepted type/value              | Optional |
| ------------ | -------------------------------- | -------- |
| `metric`     | `'sum'\|'average'\|'min'\|'max'` | No       |
| `valueField` | `string`                         | No       |

### AnalyticsRetentionQuery

Bounded site-scoped, keyset-paged purge. Rerun from the beginning to catch late historical writes.

| Field            | Accepted type/value   | Optional |
| ---------------- | --------------------- | -------- |
| `site`           | `string`              | No       |
| `before`         | `number`              | No       |
| `cursor`         | `string`              | Yes      |
| `limit`          | `number`              | Yes      |
| `dryRun`         | `boolean`             | Yes      |
| `numericSidecar` | `'present'\|'absent'` | Yes      |

### EmailTrackingOptions

| Field                 | Accepted type/value                               | Optional |
| --------------------- | ------------------------------------------------- | -------- |
| `analytics`           | `AnalyticsManager`                                | No       |
| `baseUrl`             | `string`                                          | No       |
| `secret`              | `string`                                          | Yes      |
| `keyRing`             | `EmailTrackingKeyRing`                            | Yes      |
| `acceptLegacyHmac`    | `boolean`                                         | Yes      |
| `path`                | `string`                                          | Yes      |
| `ttlMs`               | `number`                                          | Yes      |
| `allowedLinkHosts`    | `readonly string[]`                               | Yes      |
| `activityStore`       | `EmailActivityStore`                              | Yes      |
| `onEvent`             | `(event:EmailActivityEvent)=>void\|Promise<void>` | Yes      |
| `enabled`             | `boolean`                                         | Yes      |
| `telemetryTimeoutMs`  | `number`                                          | Yes      |
| `maxPendingTelemetry` | `number`                                          | Yes      |
| `onWarning`           | `(message:string)=>void`                          | Yes      |

### NumericReconciliationJobOptions

| Field           | Accepted type/value                                                        | Optional |
| --------------- | -------------------------------------------------------------------------- | -------- |
| `id`            | `string`                                                                   | No       |
| `query`         | `NumericReconciliationQuery`                                               | No       |
| `store`         | `VersionedStore<NumericReconciliationJobDocument>`                         | No       |
| `projectionKey` | `string`                                                                   | Yes      |
| `reconcile`     | `(query:NumericReconciliationQuery)=>Promise<NumericReconciliationResult>` | No       |
| `leaseMs`       | `number`                                                                   | Yes      |
| `now`           | `()=>number`                                                               | Yes      |

## Browser and collector ownership

Use `@zeruxjs/analytics/browser` for the Node-free runtime client. Root and `/http` exports eagerly load Node server helpers. The typed collection example accepts an explicit endpoint and borrowed Fetch transport and requires consent before sending; it opens no resource on import. Client consent state is not authentication or a server tenant grant.

The collector separately bounds parsing waits and actually unsettled storage dispatches. A body timeout can stop waiting while a reader is still cancelling; a storage timeout can return 204 while its pending slot stays occupied. HTTP acceptance and request-ID reservation do not prove an analytics event committed. Hosts own route registration, tenant/site policy, stores and service shutdown.

## Source and cleanup ownership

The package README maps collection, schemas, native reporting, reconciliation, CAS documents, durable work and email observations to their source owners. Standalone `createAnalyticsAnalysis` and `/durable`'s `createDurableAnalytics` expose `close()`: stop admission and drain actual work before closing borrowed databases/stores. `createAnalytics`, browser clients, registries and email tracking do not expose that disposer. A wait timeout does not forcibly terminate a host callback. Reconciliation job callback errors must be sanitized by the host before their bounded internal messages are persisted or shown in authorized administrative views.


## Public entry points

Manifest reference for `@zeruxjs/analytics@0.0.4`.

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
    },
    "./durable": {
      "types": "./dist/durable.d.ts",
      "default": "./dist/durable.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "@zeruxjs/db": "0.0.4"
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

**Analytics is best-effort.** If the DB name is absent, the connector is disconnected, schema creation fails, a sample is invalid, or a query fails, analytics functions warn once per issue and return `undefined`, `false`, `[]`, or `{}` rather than throwing. `analytics.setEnabled(false)` disables collection; reconnecting a named DB connector allows subsequent events to be stored without rebuilding the analytics service. `analytics.status()` reports recorded/dropped counts. Do not mistake missing results for guaranteed delivery. For stronger guarantees, use the explicit durable-ingestion subpath below with an application-owned ledger and pinned transaction journal.

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

## Encrypted email links and collector upload deadlines

New open/click links have encrypted and authenticated `v2.` tokens, protecting click destinations and campaign/message metadata from simple URL decoding. Legacy HMAC links are accepted until their own expiration as long as the same tracking secret is configured. Keep this secret consistent on every replica; rotate it only with a planned migration. Unsubscribe/opt-out links and anchors marked `data-no-track`, `data-tracking="off"`, or `rel="unsubscribe"` are not rewritten; repeated instrumentation is safe. Newly encrypted URLs still reveal that a tracking endpoint was requested and can be logged by servers or mail clients, so these controls **do not replace consent**.

`createAnalyticsCollector()` (and `analytics.collector` in ZeruxJS config) now accepts `bodyTimeoutMs` (default `3000`; range 10–60000) and `maxConcurrentReads` (default `64`; range 1–1000). A slow body receives 408 after its absolute read deadline, excessive simultaneous body readers receive 429, and an oversized `Content-Length` can be rejected with 413 before consuming the body. These bounds apply per runtime instance; configure reverse-proxy timeouts and distributed abuse controls separately. Browser-origin responses preserve relevant CORS headers on errors. Database write failures still return 204 for fail-soft collection.

## Safe signing-key rotation

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

New links use `v3.<key-id>.<encrypted-payload>` with AES-256-GCM authentication, and the key ID itself is authenticated. Old `v2.` links are tried against the **bounded ring** (the active key plus up to four previous keys); legacy signed HMAC links can be verified during migration unless `acceptLegacyHmac:false`. Prior keys **never sign** new links. Unknown or retired key IDs, malformed tokens, wrong keys, and tampering are rejected. Key identifiers are public metadata; do not put credentials or customer identifiers into them.

**Rollout:** Give all live replicas the same key ring _before_ switching the active key. During any overlap between deployments, every replica must have the verification keys needed for every active signing key; otherwise users can intermittently see 404s. A safe two-phase rollout introduces the new key as a previous/verification key everywhere, then activates it everywhere, and retains the retired signing key in `previous` until all its links expire (at most the 30-day configured token lifetime). Removing a previous key intentionally revokes its old links. `acceptLegacyHmac:false` invalidates all original readable HMAC links but does **not** invalidate encrypted v2/v3 links. Never commit secrets to source, log token contents, or put them in browser configuration. Ingestion, email send, and tracking remain opt-in and best-effort.

## Independent email activity reports

`tracking.getActivity(trackingId)` returns a best-effort summary with `sentAt`, first/last open and click timestamps, counts, per-link hashed IDs and repeat counts, and download-link click counts. Email send results from `@zeruxjs/email` expose the opaque `trackingId` for explicitly instrumented sends. A link marked via `tracking.downloadLinks` or `data-track-download` generates `email.download_click`, **not** a proven download; your authenticated server should call `tracking.recordDownload({id, account, url, bytes})` only after successfully serving a file to generate `email.download`. No server can reliably count downloads of attachments already packaged into an email.

Use `tracking:{enabled:true}` separately on the email send; marketing consent never implicitly enables it. Local aggregation defaults to `createMemoryEmailActivityStore()` (bounded to 10,000 emails, non-durable). Supply an atomic shared `activityStore` to `createEmailTrackingService()` or ZeruxJS `email.tracking` for accurate multi-instance reporting, queue workers, and restart survival. The normal DB-backed analytics event pipeline remains best-effort independently. The reporting counters represent observed tracking requests, not certified human behaviour; opening proxies, link scanners, ad blockers and failed telemetry can under/over-count.

## Request correlation and versioned definitions

Use `createRequestId()` to generate cryptographic 16-character mixed-case alphanumeric IDs; `requestUtcDay()` returns the server UTC day. With a `RequestIdStore`, `createAnalyticsCollector({requestIdStore,requireRequestId:true})` rejects duplicate IDs on the same day with 409, invalid IDs with 422, and unavailable reservation storage with 503; successful requests echo `x-zerux-request-id` / `x-zerux-request-day` headers. The event validator stores the trusted correlation fields as `zRequestId` / `zRequestUtcDay` in properties for existing schemas. To avoid replay collisions across hosts, use `createDatabaseRequestIdStore(connection)` on an atomic, shared DB primary key; `createMemoryRequestIdStore()` is strictly for a single process.

`createDatabaseDocumentStore(connection,table,id,initial)` provides optimistic compare-and-swap saves for published tag containers and report definitions. Connector `update` must report `affectedCount` (or `rowCount`) reliably. This is a durable control-plane document store, **not** a high-volume event queue. The collector remains best-effort for DB telemetry, but request-ID storage failures do not claim successful request uniqueness. Browser tagging and GA4 forwarding now belong in `@zeruxjs/tags`; design/reporting in `@zeruxjs/reports`.

## Native DB COUNT and index management

`await analytics.aggregate({groupBy:'event'|'source'|'site'|'pathname'|'day', name?, source?, site?, since?, until?, limit?})` computes counts on the named DB connector without the 500-row raw-events limit. `day` requires both time bounds and supports up to 366 days. Results include `{groups,total,truncated,mode:'database'}`; truncated means there are more **groups**, not that `total` is sampled. Native failures reject to reporting clients (HTTP 503), while `track()` is unchanged and remains non-throwing best-effort telemetry. The shared DB facade supports this structured query subset in SQL and MongoDB (not arbitrary database expressions).

On schema initialization analytics creates up to four indexes for timestamp/event/site lookup when `connection.createIndex` is supported. `status().indexesReady` tells you whether all succeeded, without preventing ingestion on index errors. Use `indexes:false` if you create your own production indexes in migrations; `indexesReady:false` then means not managed by analytics, not that indexes are missing.

## Opt-in numeric fact materialization

Set `numericFields:['value','duration_ms']` on the analytics config (max eight distinct validated property names). The new per-event numeric sidecar table enables database-side `analytics.aggregateNumeric({metric:'sum'|'average'|'min'|'max',valueField:'value',groupBy:'event',site?,name?,source?,since?,until?,limit?})`. `groupBy:'day'` requires a bounded UTC interval of at most 366 days. `status()` now includes `numericReady`, `numericIndexed`, and `numericDropped`. Use `analytics.supportsNumericField(name)` to detect configured properties. Raw event logging still remains non-throwing if optional numeric writes fail. These aggregates describe **only numeric facts committed to the new table**; old events are not automatically indexed and partial writes can occur. The response includes `coverage:'indexed-only'` and `matchedFacts`.

### Historical reconciliation

`analytics.reconcileNumeric({since,until,site?,cursor?,batchSize?})` repairs missing numeric facts from persisted event properties, one resumable keyset page at a time. It requires a DB-enforced unique `(event_id,property_name)` index. The automatic index is attempted with `indexes:true`; if you manage indexes in migrations, set `indexes:false,numericUniqueIndexManagedExternally:true` **only after provisioning the unique constraint**. Failures reject, conflicts reject, and all reported coverage remains `indexed-only`; neither this API nor a completed page is a transactional completeness guarantee.

### Coordinated durable numeric reconciliation jobs

`analytics.createReconciliationJob('job-id', {since,until,site?,batchSize?}, {leaseMs?})`
returns a trusted administrative handle with `runOnce(workerId)`, `get()`, `restart()`,
and optional manual `acquire/renew/checkpoint/fail` operations. The shared database
atomically versions checkpoint records and fences expired workers; jobs must use a shared
connector with `UPDATE` affected counts and verified unique event/property facts. Each
`runOnce` processes one bounded page. `completed` indicates scan exhaustion, **not**
transactional or historical data completeness. Run again with `restart()` for late events.

## Collection consent, identity, tenant binding and retention

`createAnalytics()` can now use `webConsent:'required'` and a strict `eventSchemas` event/property allowlist; a denied-consent event never persists. Browser session and visitor tokens must be **opaque 16–128-character** IDs and require `consent:'granted'`; no cookies, automatic identifiers, IPs or email addresses are created. Use browser-exported `createAnonymousAnalyticsId()` to generate a cryptographically random token **only after consent**. Set `createEventClient({requireConsent:true})`, call `.setConsent('granted'|'denied'|'unknown')`, and pass `sessionId` or `visitorId` per call. Browser HTTP `204` means accepted for best-effort processing, **not** proof of a committed DB event.

For shared collectors, `siteByOrigin:{'https://app.example':'site-tenant'}` binds a public browser origin to a trusted tenant and blocks forged site overrides; configure `requireBrowserConsent:true`, `botPolicy:'drop-known'` and a proper distributed `requestIdStore` as appropriate. On server-to-server endpoints, a secret bearer token authenticates calls but does not replace tenant authorization. The collector validates payloads before reserving request IDs and preserves deadlines, size caps and nonfatal storage behavior.

`countsWithCoverage()` explicitly marks its results `sampled-page` or `unavailable`; `aggregate()` remains native/exact **only for persisted rows**, and `aggregateNumeric()` remains materialized `indexed-only`. `reconcileNumeric()` and fenced jobs can backfill numeric facts from historical events; they never imply atomic coverage across concurrent writes.

`analytics.purgePage({site,before,limit?,cursor?,dryRun?:true})` is a **trusted administrative** paged retention API requiring a site and cutoff at least 24 hours old. Actual deletion requires `dryRun:false` and an `approveRetention` hook in `createAnalytics()`. It deletes numeric facts before source events and rejects unsafe deletion if the sidecar state is unknown; when numeric fields are not configured, explicitly attest `numericSidecar:'present'|'absent'`. It does not erase email, request-ID, suppression, external sinks, browser or provider records. Review the retention controls and storage boundaries before deleting data.

Opt-in live database parity tests require dedicated disposable PG, MySQL or Mongo databases; the default local suite verifies real SQLite. No live cluster parity or integration registry clean build is claimed until those gates actually run.

## Versioned event schemas, dimensions and units

`createEventSchemaRegistry()` is an opt-in, immutable application-generation catalog, passed as `schemaRegistry` to `createAnalytics`. Existing unregistered collection and `eventSchemas` retain their compatibility behavior; do not combine the two schema options. Invalid/conflicting registry configuration disables collection and cannot be bypassed by `setEnabled(true)`. Use the registry from the same installed analytics package instance. No registry, collector, timer, database or remote service starts on import.

```ts
import {createAnalytics, createEventSchemaRegistry} from '@zeruxjs/analytics';

const schemaRegistry = createEventSchemaRegistry([{
  name: 'page.view', version: 1,
  properties: {
    section: {kind: 'dimension', type: 'string', values: ['home', 'docs'], maxCardinality: 2, required: true},
    duration_ms: {kind: 'metric', unit: 'milliseconds', min: 0, max: 60000}
  }
}]);
const analytics = createAnalytics({
  analytics: 'reporting', database: dbManager, schemaRegistry,
  numericFields: ['duration_ms'], webConsent: 'required'
});
await analytics.initialize();
await analytics.track(schemaRegistry.event('page.view', {
  source: 'web', site: 'verified-site', consent: 'granted',
  properties: {section: 'docs', duration_ms: 240}
}));
```

The standalone [typed example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/versioned-events.ts) accepts a host-owned database and opens no resources when imported. `registry.event()` infers literal dimension values, required properties and numeric metrics, validates its authored input and pins the latest registered schema version. Network input remains untrusted and is validated again at ingestion. Unknown event names/properties/versions reject rather than being dropped from query groups. The collector returns generic 422 for registered-schema violations **before request-ID reservation**; DB outages remain best-effort 204. Direct `track()` returns `undefined` on rejection/unavailability and keeps fixed, value-free warnings. Its existing filter runs before final schema validation; trusted filters do not grant tenant authorization.

| Property kind | Contract                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dimension`   | Explicit string/number/boolean finite `values`, with `maxCardinality` 1–256; no dynamic distinct-value registry or eviction race |
| `metric`      | Finite numeric value, unit and optional min/max; units are `count`, `milliseconds`, `seconds`, `bytes`, `ratio`, `percent`       |
| `parameter`   | Number, boolean or null; these are not groupable dimensions                                                                      |

Count/byte metrics require nonnegative safe integers; ratios are 0–1 and percentages 0–100. Other numeric values must be finite, and integer values must fit the safe JavaScript domain. No currency/unit conversion or arbitrary precision is implied. String dimensions are at most 128 UTF-8 bytes and reject controls and email-like `@` values. Free text, arbitrary nested values, unsafe prototype keys and common sensitive property names are unavailable in the versioned API. This minimizes raw personal data by default; it cannot prove that a host-declared enum or number is nonpersonal. Do not register personal identifiers as dimensions. Legacy unregistered string properties retain their earlier behavior and need host minimization policies.

`maxProperties` defaults to 40 (range 1–40) across the declared and submitted event/user/session scopes; `maxBytes` defaults to 6144 (128–7168), measured as UTF-8 JSON for these scopes. The final stored properties, including provenance and existing identity/correlation fields, must still fit 8192 bytes. The catalog holds at most 100 event/version definitions, 4096 total enum values and 1 MiB canonical JSON. Limits reject before insertion. Per-property cardinality is finite by schema across tenants/replicas; it is **not** a total bound on combinations, event volume, site/pathname cardinality or storage. Hosts still own authenticated site/path sanitization and admission limits.

### Evolution, consent and historical coverage

Versions start at 1 and must be contiguous for each event. Supply all retained definitions; order is normalized. Only adding optional properties is compatible. Removing/changing an existing property's type, unit, enum, cardinality, required flag or range, or adding a required property, rejects. Use a new event name for breaking semantics. Omitted `schemaVersion` selects this generation's latest; explicitly registered old versions stay acceptable for gradual client rollout. No defaults/backfill silently invent fields on old events. Retain catalogs for every deployed generation in host-controlled versioned configuration/artifacts.

`userProperties` and `sessionProperties` have separate declared schemas, use the same budgets, and require `consent:'granted'` plus a valid opaque `visitorId` or `sessionId` respectively. They describe **this event's** pseudonymous snapshot; there is no global profile, automatic persistence between events, identifier creation, or inferred consent. Optional browser `track(..., {schemaVersion,userProperties,sessionProperties,...})` forwards these fields only with explicit consent and the matching identifier. Revoking consent prevents future writes; it does not delete old records. Host authorization remains mandatory for reading tenant data.

`analytics.schemaCatalog()` / `registry.describe()` publish `coverageVersion:1`, the deterministic SHA-256 `catalogId`, budgets and immutable definitions. `status()` exposes the catalog ID and coverage version. Stored JSON reserves `zAnalyticsSchema` for `{coverageVersion,schemaVersion,schemaId,catalogId,userProperties,sessionProperties}`. These hashes identify configuration bytes, not authorship, permission or durable delivery. `readEventSchemaCoverage(row)` distinguishes `versioned` from `legacy-unversioned` without returning user/session values; malformed stored metadata rejects with value-free errors. Old rows and original property names remain readable.

Numeric indexing is still explicit through `numericFields`; schema declaration alone creates no sidecar facts. When a registry is configured, numeric reporting verifies the field is a registered metric and returns `schema:{unit,coverageVersion:1,coverage:'mixed-history'}` alongside existing `coverage:'indexed-only'`. Conflicting units across event names require a name filter. Historical/unversioned facts may predate the registry, omit new fields or have different semantics: separate tables/time windows and reconcile deliberately before interpreting them as a single measurement population. No new property-based native grouping, session attribution or GA4 parity is claimed.

### Driver migration and index plan

The schema format is an additive **JSON payload change**, not a table migration. Existing event tables keep their columns, primary IDs and indexes; no application data is rewritten or dropped. Numeric sidecars, unique `(event_id,property_name)` enforcement and explicit reconciliation remain unchanged. Initialize still attempts the existing `id` uniqueness, `occurred_at`, `(event_name,occurred_at)` and `(site,occurred_at)` indexes; no JSON/expression index is silently installed for arbitrary registered dimensions.

| Driver     | Existing structured storage/index plan and rollout limit                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite     | Existing text JSON and ordinary indexes; native disposable SQLite checked. Synchronous transactions remain a distinct connector API; event/fact writes are not promoted to atomic ingestion.                                                                    |
| PostgreSQL | Existing text JSON and structured indexes, no automatic JSONB conversion/expression index or pin around ingestion. Dedicated live DB required for deployment acceptance.                                                                                        |
| MySQL      | Existing text JSON and structured indexes, duplicate-index responses handled as before; no generated-column conversion or assumption of transactional DDL. Dedicated live DB required.                                                                          |
| MongoDB    | Existing document fields with JSON properties string and explicit `id` uniqueness; no arbitrary `$` selectors, wildcard indexing or implicit shard-key selection. Host migration must accommodate deployment shard-key constraints. Dedicated live DB required. |

With `indexes:false`, provision these existing indexes externally before enabling reconciliation's external-unique assertion; never infer an installed definition solely from an existing index name. See [SQLite index semantics](https://www.sqlite.org/lang_createindex.html) and [MongoDB unique index/shard restrictions](https://www.mongodb.com/docs/manual/core/index-unique/). Keep catalog upgrades in host configuration, retain old catalogs and use forward-only deployment review; this API neither owns cross-process migration locks nor reverses production schemas. Ingestion stays best effort, including possible partial numeric materialization; no durable mode/queue is added by schema registration.

Focused schema checks use real disposable in-memory SQLite, Fetch fixtures and packed public TypeScript declarations. They cover additive upgrades/history, invalid/unknown properties, finite cardinality across managers, consent, forged sites, numeric units, unavailable DBs and browser import isolation. Live PG/MySQL/Mongo and deployed-browser/proxy checks require separately configured environments; offline success does not establish their parity.

## Tenant-scoped sessions, funnels and UTC cohorts

`analytics.createAnalysis({site,authorize,...limits})` creates an inert, server-owned read scope over the existing named connection. `site` must come from verified host identity; it is fixed for this scope and cannot be overridden in queries. Every call requires `authorize({site,kind,signal})` to resolve **exactly true** before acquiring a connection. Exceptions reject with sanitized error codes and private causes, never fabricated zero results. No public endpoint, reporting definition or automatic cross-site identity is created. Reports UI/definitions remain owned by `@zeruxjs/reports`.

```ts
const analysis = analytics.createAnalysis({
  site: verifiedSite,
  authorize: ({kind}) => kind !== 'indexes' && canReadAnalytics(),
  maxEvents: 5000, pageSize: 200
});
const until = Date.now();
try {
  const result = await analysis.funnel({
    since: until - 86400000, until,
    steps: ['checkout.start', 'purchase'], conversionWindowMs: 3600000
  }, {signal: request.signal});
  // converted/rate can be null; always inspect coverage.
} finally { await analysis.close(); }
```

The [public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/analysis.ts) accepts host identity, authorization and cancellation explicitly. The scope borrows the database: close aborts observations and drains actual outstanding work, never disconnects the database. Close is idempotent and stale calls reject. A noncooperative database/authorizer can delay close; neither an AbortSignal nor a Promise deadline proves native query cancellation. Use the database-owned execution/pool limits as well.

### Plan, paging and limits

These methods implement `plan:'bounded'` only. Site/time filters and an initial native `COUNT(id)` execute inside the connector; ordered calculations then consume bounded ID-keyset pages, sort by **event timestamp then ID**, and never issue an unbounded select. Unsupported COUNT/filter/order/index operations reject; there is no raw-SQL or unbounded fallback. A requested native-only session/window plan rejects because the current shared DSL has no portable contract for it. The database's coarse `nativeAggregation` capability refers to native pipeline support and is not treated as proof of SQL window-function support. No connector capability claims were expanded.

| Limit                    | Default / maximum                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Query interval           | Explicit half-open `[since,until)`, at most 31 days, ending no later than now        |
| Retained/scanned events  | `maxEvents`: 5000 / 10000                                                            |
| Page size                | `pageSize`: 200 / 200, plus one lookahead row                                        |
| Accepted row data        | `maxBytes`: 8 MiB / 32 MiB, minimum 1024; each properties JSON at most 8192 bytes    |
| Concurrent native scopes | `maxConcurrent`: 2 / 16                                                              |
| Observation deadline     | `timeoutMs`: 10000 / 60000 ms; per-call absolute `deadline` can shorten it           |
| Funnel                   | 2–10 steps; conversion interval at most 7 days and no longer than the query interval |
| Cohort                   | At most 31 entry days plus 0–30 retention days                                       |

Budgets reject invalid configuration and byte exhaustion; reaching the event ceiling returns `mode:'sampled-page'`, `truncated:true`. Pages scan in ID order, so a truncated result is **not** a chronological or representative sample. Connection methods receive `{signal,deadline}` separately from query JSON. Cancelled/timed-out callers retain their concurrency slot until the actual native operation settles; subsequent pages do not start. These caps bound application work, not database rows examined or synchronous native CPU time. The SQLite thread cannot be forcibly interrupted by a JS timer.

`initializeIndexes()` is an explicit, separately authorized (`kind:'indexes'`) migration step on an already initialized events table. It provisions `(site,id)` for keyset traversal and `(site,occurred_at,id)` for the range shape, with deterministic names. Production hosts may instead manage the same shapes in external migrations. Existing ID uniqueness is still required; identifier collation/order must agree with the ASCII ID comparison used for continuation checks. Failed index plans reject without disabling ingestion; a partially installed index is not automatically reversed. SQL/Mongo adapters retain their own DDL/shard restrictions, deployment budgets and index verification responsibilities. No query definitions or database schema versions are silently changed.

### Identity, ordering and interpretation

Only rows with persisted `zConsent:'granted'` and valid opaque identifiers participate. Sessions use `session_id`; funnels default to `zVisitorId` with explicit `identity:'session'` available; cohorts use `zVisitorId`. Missing identity, absent consent, invalid JSON and schema coverage are counted separately. No cookies, fingerprinting, automatic identity assignment or visitor/session stitching is added. Rows returned outside the bound site or in invalid keyset order reject the whole result. Results contain aggregate counts, not the underlying identity tokens or raw properties.

- **Sessions:** `sessions({since,until,timeoutMs?,maxDurationMs?})` groups each session token by inactivity. A gap **at least** 30 minutes starts a new session by default; configurable inactivity is 1 minute–24 hours. A session also splits when elapsed duration reaches `maxDurationMs` (default/max 24 hours, at least the inactivity timeout). Equal timestamps do not add duration. Sessions can cross UTC midnight. The result is `observed-window-sessions`: no lookback/lookahead guesses at sessions clipped by the requested interval.
- **Funnels:** steps match in order at **strictly increasing timestamps**. Tied timestamps do not establish causality even though IDs provide deterministic sorting. Default conversion interval is the smaller of one day and the query interval; an attempt expires only when elapsed time is greater than the interval. After expiration a later first-step event can begin another attempt. Each identity contributes at most once to each reached step and once to conversion in the window. Repeated step names require separate later events. `observedConverted` always counts observed qualifying identities; `converted` and `conversionRate` become null when exclusions, truncation or count/scan disagreement make population coverage unknown. A zero eligible denominator also yields a null rate.
- **Cohorts:** `cohort({since,until,entryEvent,returnEvent,retentionDays})` requires entry boundaries at UTC midnight. Membership is the **first matching entry observed inside this interval**, not proven lifetime acquisition. Retention day offsets are UTC calendar days; returns before the actual entry timestamp do not count, and each identity counts once per bucket. Reads extend through the requested retention horizon, capped at the captured current time. Incomplete future/current-day buckets have `observed:null`, `rate:null`, `complete:false`; exclusions/truncation also suppress rates. No activity outside the available interval is invented.

Persisted duplicate primary IDs violate the scan contract. Distinct IDs remain distinct events even if their payloads/timestamps match; ingestion retries are not retrospectively identified as the same business event. Funnel/cohort identity-level conversion deduplication is separate from event idempotency. Insertion order is never used as occurrence order. Late arrivals/concurrent changes can alter subsequent runs, and no resumable partial funnel state or snapshot transaction is implied.

Every result publishes coverage version 1: the native **exact persisted COUNT at its read time**, scanned/identified/excluded rows, versioned versus legacy-unversioned schema counts, `windowExhausted`, `countMatchesScan`, truncation and explicit `snapshot:false`, `historicalIdentity:'unknown'`, `ingestion:'best-effort'`, `boundary:'window-clipped'`. Count/scan agreement is not proof of a stable snapshot. Persisted counts do not measure lost ingestion or successful identity backfill; no unknown rows are synthesized as nonconverters. Existing `aggregate()` remains the database-side count API, and numeric materialization retains its separate indexed-only coverage.

Focused checks use disposable native SQLite and injected failed/hanging connections for session boundaries, duplicate/out-of-order events, ordered conversions, UTC/future cohorts, tenant denial, sampling, absent identity and cancellation/drain cleanup. No connector code changed. Dedicated PostgreSQL/MySQL/Mongo deployments and their index/execution plans were not exercised; real browser or live service acceptance is not claimed.

## Explicit durable ingestion

`@zeruxjs/analytics/durable` is a separate opt-in server API. It does not change nonthrowing best-effort `track()`, the existing 204 collector, request-ID reservation or numeric backfill jobs. The subpath imports the database transaction **types**; selecting async atomic operations requires an explicitly installed/configured `@zeruxjs/db` pin. Core/browser imports still do not pull a queue/driver or require those types. Nothing starts on import. This is a workflow over a host-provided durable primary, not a shipped production SQL/Mongo ledger adapter or BullMQ persistence implementation.

```ts
import {createEventSchemaRegistry} from '@zeruxjs/analytics';
import {createDurableAnalytics} from '@zeruxjs/analytics/durable';

const durable = createDurableAnalytics({
  store: hostDurableStore, // shared analytics-durable-v1 contract, defined below
  schemaRegistry: createEventSchemaRegistry([{
    name: 'sale', version: 1,
    properties: {amount: {kind:'metric', unit:'count', required:true}}
  }]),
  numericFields: ['amount'],
  authorize: (action, reference, principal) => hostAuthorize(action, reference.site, principal)
});
const accepted = await durable.accept({
  name:'sale', site:verifiedSite, source:'server', consent:'granted',
  occurredAt:originalOccurrenceTime, properties:{amount:1}
}, originalOpaqueIdempotencyKey, verifiedPrincipal);
// Persist through a real async pin in a separate worker:
const outcome = await durable.persist(databaseFacade, hostJournal, accepted, verifiedWorker);
await durable.close(); // host closes its DB/queue/store afterward
```

The [minimal public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/durable.ts) deliberately requires host storage and authorization rather than substituting a Map for durable storage. All durable events require explicit granted consent, a registered schema, nonempty authorized site, a caller-supplied occurrence timestamp and a 16–128-character opaque idempotency key. Existing schema/JSON/scalar/property bounds run before storage. Consent is an input to host policy, not proof: the HTTP boundary must authenticate the principal, bind the site, verify consent/origin/CSRF where applicable, validate method/body/deadline, and call the durable API explicitly. Do not route durable acceptance through the fail-soft collector's timed 204 dispatch and claim it is a commit acknowledgement. There is no new public HTTP endpoint or built-in framework configuration for this workflow.

### Acknowledgements and uniqueness

| State       | Meaning                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `accepted`  | The unique validated record is committed to the application ledger; event/facts may not yet exist                        |
| `persisted` | A journal transaction reported commit of event, configured facts and terminal ledger status together                     |
| `uncertain` | Materialization/commit acknowledgement is unavailable; inspect/reconcile the ledger before concluding success or failure |
| `dead`      | Permanent/age/attempt policy stopped automatic processing; private payload remains subject to approved retention         |
| `purged`    | Approved coordinated deletion removed event/facts/private ledger payload; dedup tombstone remains                        |

Acceptance insert failures throw `ACCEPTANCE_UNCERTAIN`: the caller must retain its original key and payload and reconcile, not assign a fresh key. `commit` failures throw `COMMIT_UNCERTAIN` because native commit/cleanup can itself be ambiguous. `confirm` rechecks durable state after fresh inspection authorization; processing state is reported uncertain there. A lost response after commit is not proof of failure, and native fsync/replication/durability remain deployment policies.

Dedup identity is a SHA-256-derived 128-bit site/key reference, not a credential or authorization token. The payload digest includes deterministic row/fact content; catalog provenance IDs alone do not make an otherwise identical old-schema replay a conflict. The original event/schema identity is retained across compatible catalog rollout; keep old definitions available. Different data, correlation fields or numeric projection under one key reject. Repeat requests must preserve the original timestamp/key/input. Bind keys to verified principal/purpose in the host when site-level scope is too broad; this library does not silently join identities.

`dedupMs` defaults to 30 days (maximum 90, at least maxAge). An existing expired key rejects rather than silently starting another operation; use a new logical event/key deliberately. Never evict/reset live dedup state. Purge keeps payload-free tombstones through that lifetime; expired terminal/tombstone cleanup is a separate host-approved migration/retention responsibility. If the host physically removes a key afterward, library deduplication no longer spans that removal. Event hashes verify byte/semantic consistency, not authorship, consent or permissions.

### Durable store and transaction journal ownership

`DurableAnalyticsStore` declares `contract:'analytics-durable-v1'` and provides unique `insert`, `get`, revision-fenced `cas`, and stable ascending-ID `page(site,{cursor,limit,before?})`. These must be linearizable shared durable operations on the **same primary/database domain** as materialization. CAS includes site+ID+exact revision and preserves immutable payload/identity. Page filters are host-owned indexed site/occurrence/ID operations; the service validates tenant, order, count and hashes. Do not implement this using ordinary cache get/set, process memory, a replica-lagging read or queue job storage. Store rows/facts are private; protect them with access, encryption, backup and retention controls. Implement store-level timeouts and pending-operation bounds; a generic wrapper cannot forcibly stop an uncooperative database.

`DurableAnalyticsJournal` is trusted host code, not a callback that may choose any connection:

- `append(pin, record)` inserts the unique ledger record on the supplied pin and returns true only for that insertion. `durable.commit(db,journal,input,key,principal,business,options?)` invokes append and business work in the same negotiated transaction. Existing matching records skip business work; concurrent conflicts roll back. No remote side effects/queue publish belong in the callback, and it is never automatically replayed.
- `materialize(pin,{record,next})` must lock/recheck exact revision, unexpired lease/token and immutable identity **inside the transaction**, insert the deterministic event ID plus all configured unique numeric facts, and CAS the ledger to `next` on that same pin. Check every result/count and throw on any mismatch/failure; returning false makes the pin roll back. Event/fact existence conflicts require exact data reconciliation, never silent overwrite. DML tables/indexes are provisioned beforehand; no transactional-DDL assumption is made.
- `purge(pin,plans)` must fence every revision/lease, delete only those exact site/event numeric facts, then source events, and replace ledger payloads with the supplied tombstones in the same transaction. Check counts/conflicting facts before deleting; stale/failed writes must throw so the whole page rolls back. This is what prevents an old worker from resurrecting approved deleted work.

Async helpers require `transaction` and negotiated capabilities from the existing database facade; unsupported adapters/isolation/timeouts reject **before claiming work**. Transaction settings are database-owned, bounded and combined with shutdown cancellation. Materialization timeouts must be shorter than the lease. Database/journal declarations are trusted contracts, not runtime proof that arbitrary injected code uses one connection; qualify each production implementation.

SQLite stays distinct. Await `prepare()` or `prepareMaterialization()` **before** entering the connector's actual `transactionSync`; inside its callback synchronously append business+ledger or apply the materialization plan using that callback's `SqliteSyncTransaction`. Check every native result and lease/revision; no awaits/thenables may cross BEGIN/COMMIT. After it commits, `confirm()` reads authoritative state. `preparePurge()` similarly performs fresh approval/conflict preparation outside BEGIN; the host applies those plans through a fenced synchronous journal inside `transactionSync`. Preparation alone acknowledges no write. The async facade is not emulated for SQLite, and these preparation methods never grant a client access to private plan bodies/lease tokens.

### Bounded retries, recovery and queue handoff

States progress `pending → processing → persisted`; a claim CAS owns an opaque expiring lease. Confirmed rolled-back transient failures can use `settleFailure(reference,token,'transient',worker)` to persist bounded exponential backoff. Permanent failures use `'permanent'` and become dead. **Never settle failure after an ambiguous commit**; the generic async persist helper conservatively returns uncertain and leaves the lease for authoritative recovery. A persisted ledger record makes replay a no-op. An expired processing lease becomes eligible only after its bounded backoff; a new revision fences the old worker. This replay is safe only because the host atomically commits event/facts/terminal status; ordinary separate writes cannot satisfy the contract.

Defaults: 5 attempts (1–20), max age 7 days (1 second–30 days), lease 60 seconds (1 second–5 minutes), backoff 1 second capped at 60 seconds (configured positive bounds up to one day), and 16 active operations (1–128). Age starts at durable acceptance, independently of event occurrence time. Recovered claims count toward attempts; exhausted/aged records CAS to dead. There is no autonomous timer, scheduler, jitter generator, infinite retry or callback replay. `inspect()` returns only fixed status/attempt/code/timing metadata after authorization; raw rows/facts/lease tokens stay private. Dead records are not automatically redriven or erased.

`dispatch(site,principal,publisher,{cursor?,limit?})` visits at most 50 ledger records per call (default 20) and publishes only due opaque `{site,id}` references. Continue the returned cursor and rerun from the beginning for later work. It requires explicit `acknowledgement:true,destructiveRead:false`; unknown/destructive-read MemcacheQ adapters reject. Bridge an explicitly selected neutral queue only after checking its capabilities; BullMQ's native worker completion is a distinct host adapter, not an inferred neutral manual-ack guarantee. A worker acknowledges its job only after durable persisted/dead/purged status; accepted or uncertain is not completion. Duplicate/lost queue notifications are recovered by ledger scanning, and queue publication is not a database transaction. No BullMQ/RabbitMQ/MemcacheQ import, worker or scheduler is added to analytics. Existing email outboxes and numeric checkpoint jobs retain their separate ownership and guarantees.

### Retention previews and conflicts

Every manager sharing these event tables must set `createAnalytics({durableRetention:true,...})`. This explicitly blocks legacy `purgePage` (including its incomplete event-only preview), directing administrators to the durable ledger workflow. Closing a workflow does not remove persistent work or make legacy deletion safe. Raw DB access, old replicas and unrelated retention jobs remain privileged host responsibilities; the library cannot detect an undisclosed external ledger.

`previewPurge(site,before,principal,{cursor?,limit?})` returns a bounded metadata-only page, unprocessed count, event/numeric-fact candidate counts and deterministic hash, with a cutoff at least 24 hours old. Candidate counts come from the atomic ledger projection, not a fresh sidecar audit; the journal must verify actual rows/counts at deletion. The preview is not a signed approval or stable snapshot. Destructive `purge`/branch/v0.0.4/`preparePurge` requires fresh `purge` authorization, an unchanged revision/status page, and explicit `'reject-unprocessed'` or `'cancel-unprocessed'` policy. The first refuses pending/processing/dead work; the second allows the transaction journal to cancel/fence it and retain dedup tombstones. A worker claim between preview/preparation/commit must cause the journal fence to reject and roll back, requiring a fresh preview. Newly accepted historical records outside that bounded page are not silently included. Cursor continuation and a later full pass are required; this is not a global erase certificate.

Validation uses a disposable real SQLite/WAL ledger fixture for reopen/recovery, event/fact rollback, simultaneous duplicate acceptance, consent/site denial, bounded failures, approved purge and sidecar deletion. The shared async pinned executor is separately exercised for connection identity, business rollback and lost commit acknowledgement. The fixture is reference test code, not a shipped production ledger adapter. Dedicated durable-store/journal qualification, live acknowledged broker/crash tests and actual database HA/persistence settings remain prerequisites; no live PostgreSQL/MySQL/Mongo/broker acceptance is claimed. Store/queue/database handles remain host-owned; `close()` rejects new work, asks active pins to cancel and drains actual settlement, which can exceed deadlines for noncooperative callbacks.

## Collection source ownership

`browser.ts` is the explicit Node-free runtime entry; import browser helpers from `@zeruxjs/analytics/browser`, not the root entry that also exports Node collection/storage helpers. The [typed browser example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/collection.ts) requires an explicit endpoint and borrowed transport, starts no request on import/construction, and requires granted consent before sending. The host owns actual consent verification and identifier persistence; `.setConsent()` is an input switch, not authentication.

`types.ts` defines the structural borrowed database facade and public event/query fields. `validation.ts` constructs bounded scalar/identity rows and optional registered provenance without inserting them. `http.ts` separately owns method/origin/site checks, request-body admission, correlation reservation and best-effort dispatch. Allowlisted origins permit public collection, never administration or confidential tenant authorization.

The collector's body timeout releases its parsing wait; a noncooperative underlying reader may still be cancelling. Storage wait deadlines have a different owner: the pending dispatch counter remains occupied until the actual storage/pipeline promise settles, even after returning 204. No collector close handle, forced JavaScript cancellation, retry or durability guarantee is added by these helpers. Database, request-ID stores, route registration and service shutdown remain host-owned.

The packed browser regression check parses executable syntax rather than treating words in comments/string literals as imports. It still rejects actual module loading and Node-global references, then imports the extracted public entry in an isolated consumer. These local checks do not certify deployed browsers, proxies or live database/broker behavior.

## Reporting source ownership

`aggregation.ts` owns persisted event counts; `numeric.ts` owns native metrics over the opt-in numeric sidecar. Both borrow the supplied connection and use structured database expressions. They neither close it nor authorize a caller. The host must bind tenant/site filters before exposing reports; an omitted `site` deliberately queries all sites accessible through that connection.

Group limits default to 100 and accept 1–500. Daily grouping requires explicit bounds covering at most 366 UTC days and schedules at most six bucket reads per batch. Returned groups can be truncated while the total still covers the full query. Totals and groups are separate reads, so concurrent writes may make them differ; these helpers do not acquire a shared transactional snapshot. A failed or malformed database response rejects instead of returning a fabricated zero. Numeric results retain `coverage:'indexed-only'` and `matchedFacts`, including when an earlier sidecar write failed.

`reconciliation.ts` repairs one bounded historical source page using stable event/property IDs. Its low-level public function borrows the connection and requires the host to validate tables/fields, authorize the site and provision the unique event/property index; the manager checks index readiness before delegating. A failed page can leave earlier facts committed. An ambiguous insert is read back and accepted only when all dimensions and values match, including compatible legacy IDs; this helper does not blindly replay the insert. Callers own durable cursor checkpoints. `windowExhausted` describes the source read, not a global completeness guarantee.

## Schema registry source ownership

`schemas.ts` owns detached, deeply frozen catalog definitions, canonical hashes and validation before persistence. Versions start at one and remain contiguous. Existing properties cannot be removed or changed; additions must be optional in every scope. Finite dimension values enforce cardinality at ingestion without a shared mutable counter. User/session properties still require granted consent plus their respective opaque identifier, and catalog membership is not tenant authorization.

The registry creates no timer, network connection or durable storage handle. Keep one explicitly configured registry per application generation. Its identity hashes describe definitions and budgets, not authorship, permission or evidence that a historical row contains later fields. The [versioned event example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/versioned-events.ts) uses public imports and borrowed database ownership; the host must verify real site/consent inputs before collection. Error messages contain fixed validation codes rather than submitted property values.

## Manager source ownership

`manager.ts` validates configuration before resolving the explicitly named borrowed database. Invalid table/schema/consent policy cannot be bypassed by calling `setEnabled(true)`. `initialize()` coalesces current migration work and releases the in-flight promise after settlement so a later explicit call can retry a failure. Core table readiness, optional indexes and numeric sidecar readiness are separate status fields.

`track()` and legacy recent-page reads absorb failures; native aggregation, reconciliation and retention can reject. A returned event ID confirms the core insert, not an atomic event/sidecar transaction. `countsWithCoverage()` preserves its compatibility label based on connection lookup availability; that label alone cannot distinguish an empty successful read from a later storage failure. Use native reports when failures must be explicit. This manager has no close method: the host owns database shutdown and any separately created analysis scope. Reporting/retention APIs still require host authorization and trusted site binding.

## Readable source map and lifecycle limits

| Owner                                    | Responsibility and limit                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request-id.ts`                          | Atomic shared day/ID reservation contract; memory stays process-local. Optional old-day cleanup is opportunistic and does not establish event persistence.                                                    |
| `documents.ts`                           | Borrowed CAS document adapter; correctness requires atomic conditional updates with affected-row counts. Domain owners validate their own payload schema.                                                     |
| `jobs.ts`                                | Revision/lease-fenced scan checkpoints with an active-run heartbeat. The internal bounded `lastError` can contain a callback message: sanitize host callback errors and authorize administrative reads.       |
| `retention.ts`                           | Preview-first site/cutoff pages, numeric-first deletion and explicit partial-failure receipts. No transaction across deletes or global erasure certificate is implied.                                        |
| `analysis.ts`                            | Disposable authorized bounded count/keyset scans and consented identity analysis. Cancellation stops waiting cooperatively; `close()` drains actual work and never closes the borrowed DB.                    |
| `durable.ts`                             | Separate disposable acceptance/materialization workflow. Real pinned journal operations are required for atomic business/event/fact work; queues carry opaque references only.                                |
| `email-activity.ts`, `email-tracking.ts` | Observed per-message activity plus explicitly opted-in encrypted links/pixels. Existing key derivations/wire formats remain compatible; there is no human-engagement certification or HTML sanitization here. |

The public [analysis example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/analysis.ts) owns `close()` in `finally`; the [durable example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/durable.ts) returns a coordinator that the host must close during shutdown. Database/store and HTTP route lifetimes remain with the host. The email tracking facade has no close handle; timed-out callbacks can remain unresolved and keep consuming its finite pending budget. Production hosts must provide bounded cooperative callbacks and own their shared stores.

Offline regression checks exercise injected failures and synthetic SQLite state. The dedicated `live-databases.test.ts` is a separate opt-in acceptance path requiring disposable PostgreSQL/MySQL/MongoDB installations; an offline pass does not qualify those engines or live multi-process recovery.


## Implementation sources

- [packages/@zeruxjs/analytics/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/README.md)
- [packages/@zeruxjs/analytics/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/package.json)
- [packages/@zeruxjs/analytics/src/browser.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/browser.ts)
- [packages/@zeruxjs/analytics/src/http.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/http.ts)
- [packages/@zeruxjs/analytics/src/aggregation.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/aggregation.ts)
- [packages/@zeruxjs/analytics/src/numeric.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/numeric.ts)
- [packages/@zeruxjs/analytics/src/reconciliation.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/reconciliation.ts)
- [packages/@zeruxjs/analytics/src/schemas.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/schemas.ts)
- [packages/@zeruxjs/analytics/src/manager.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/manager.ts)
- [packages/@zeruxjs/analytics/src/analysis.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/analysis.ts)
- [packages/@zeruxjs/analytics/src/durable.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/durable.ts)
- [packages/@zeruxjs/analytics/src/request-id.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/request-id.ts)
- [packages/@zeruxjs/analytics/src/documents.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/documents.ts)
- [packages/@zeruxjs/analytics/src/jobs.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/jobs.ts)
- [packages/@zeruxjs/analytics/src/retention.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/retention.ts)
- [packages/@zeruxjs/analytics/src/email-tracking.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/src/email-tracking.ts)
- [packages/@zeruxjs/analytics/examples/versioned-events.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/versioned-events.ts)
- [packages/@zeruxjs/analytics/examples/collection.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/analytics/examples/collection.ts)
