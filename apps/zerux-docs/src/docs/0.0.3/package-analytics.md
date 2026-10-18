---
{
  "title": "Analytics collection and aggregates",
  "description": "Collect opt-in events and interpret each query\u2019s coverage honestly.",
  "section": "Packages",
  "order": 19,
  "sources": [
    "packages/@zeruxjs/analytics/README.md",
    "packages/@zeruxjs/analytics/package.json"
  ],
  "related": [
    "analytics-reporting",
    "package-reports",
    "package-tags"
  ],
  "package": "@zeruxjs/analytics"
}
---

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

This package participates in the runtime's **analytics** integration. Start with [analytics configuration](configuration-analytics.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

For runtime use, configure the named reporting database and the analytics service. For standalone use, provide the real database manager and explicitly initialize the analytics instance. Register a small event vocabulary, choose the site scope on the server and distinguish web, server, email and system sources. Add a collector only when HTTP ingestion is part of the application.

## TypeScript: inputs, results and ownership

```ts
import { createAnalytics } from '@zeruxjs/analytics';

type Inputs = Parameters<typeof createAnalytics>;
type Result = Awaited<ReturnType<typeof createAnalytics>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createAnalytics>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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
