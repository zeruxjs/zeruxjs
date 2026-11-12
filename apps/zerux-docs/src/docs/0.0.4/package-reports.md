---
{
  "title": "Reports and dashboards",
  "description": "Build authenticated views with tenant-isolated definitions and visible query provenance.",
  "section": "Packages",
  "order": 23,
  "sources": [
    "packages/@zeruxjs/reports/README.md",
    "packages/@zeruxjs/reports/package.json"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/reports"
}
---

## Source and authorization

Reports query internal analytics, not arbitrary SQL or executable chart code. A host authorize callback is required; the standalone factory rejects a missing authorizer. Grant read, edit, export, sensitive-property and campaign access independently where needed.

## Definition ownership

Reports contain pages and charts. Definition updates use same-origin JSON writes and optimistic CAS. For multi-tenant hosts, resolve a trusted tenant scope with a dedicated document store, not merely a site filter over one global document. Never accept tenant scope from an unverified query parameter.

## Query modes

Native count dimensions can query all persisted matching rows. Supported numeric fields use indexed-only materialized facts. Other queries can fall back to a bounded sample (at most 500 raw rows, including custom `source.events()` callbacks). Display queryMode, truncation and coverage in every dashboard/export; sampled totals cannot be represented as all-time facts.

## Exports and campaigns

CSV/JSON exports require separate permission and have byte/chart/query-budget caps. They are individual chart queries, not a transactional historical snapshot. Campaign views distinguish SMTP acceptance, provider notifications and observed tracking events; those are different measurements.

## Operations

Use secure host sessions, tenant filters and trusted source adapters. Dashboards do not ship an identity provider or default password. Large reports need warehouse/native aggregation capabilities and independent rate limits; the studio is not a general BI connector platform.

## Install and select the integration

```sh
npm install @zeruxjs/reports@0.0.4
```

This package participates in the runtime's **reports** integration. Start with [reports configuration](configuration-reports.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Supply internal analytics, a versioned definition store and an explicit authorization callback. Decide tenant/site scope before exposing the studio or export route. The built-in chart vocabulary describes bounded analytics queries; it is not permission to run arbitrary SQL or JavaScript from a saved chart.

## TypeScript: inputs, results and ownership

```ts
import { createReports } from '@zeruxjs/reports';

type Inputs = Parameters<typeof createReports>;
type Result = Awaited<ReturnType<typeof createReports>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createReports>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Report source pages can be truncated. Surface that coverage in the UI and use a suitable aggregate adapter when totals must be complete. Persist definitions across restarts and coordinate optimistic writes across replicas. Verify reader/editor/export/sensitive permissions and cross-tenant access before enabling production administration.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### ReportsOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `analytics` | `AnalyticsManager` | No |
| `store` | `ReportsStore` | Yes |
| `source` | `AnalyticsReportSource` | Yes |
| `prefix` | `string` | Yes |
| `authorize` | `(request:Request,action?:ReportAction,resourceId?:string)=>boolean\|Promise<boolean>` | No |
| `dashboardHost` | `string` | Yes |
| `maxSourceRows` | `number` | Yes |
| `site` | `string` | Yes |
| `resolveScope` | `(request:Request)=>Promise<ReportTenantScope>\|ReportTenantScope` | Yes |
| `campaigns` | `CampaignReportsSource` | Yes |

### ChartDefinition

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `title` | `string` | No |
| `type` | `ChartKind` | No |
| `groupBy` | `` 'event'\|'day'\|'source'\|'site'\|'pathname'\|`property:${string}` `` | No |
| `metric` | `Metric` | No |
| `valueField` | `string` | Yes |
| `eventName` | `string` | Yes |
| `source` | `string` | Yes |
| `site` | `string` | Yes |
| `since` | `number` | Yes |
| `until` | `number` | Yes |
| `limit` | `number` | Yes |

### AnalyticsReportSource

Native `aggregate`/`aggregateNumeric` adapters can count persisted facts beyond the raw sampling cap. Custom `events` callbacks still return at most 500 raw rows; display groups and provenance remain independently bounded.

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `events` | `Promise<AnalyticsRow[]>` | No |
| `aggregate` | `Promise<AnalyticsAggregateResult>` | Yes |
| `aggregateNumeric` | `Promise<AnalyticsNumericAggregateResult>` | Yes |
| `supportsNumericField` | `boolean` | Yes |

### ReportsStore

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `load` | `Promise<ReportsDocument>` | No |
| `save` | `Promise<boolean>` | No |


## Explicit external sources and browser views

The framework reports configuration above enables the internal studio. External `/sources`, `/ga4` and `/adsense` contracts are separately registered server APIs: no configuration label discovers providers, credentials or arbitrary endpoints. Registries require fresh host tenant/site/principal/credential-partition authorization for every query. GA4 and AdSense use distinct fixed read-only endpoints, explicit field/unit/timezone catalogs and honest quota/unavailable/coverage states. Their results are not automatically joined or converted into internal event charts.

Use `/definitions` for bounded inert V1 definition transfer/layouts and `/view` for replaceable browser views. Imported definitions never contain rendering callbacks or bypass a current storage revision. A view receives an already authorized result and retains a labeled semantic table alongside supplementary charts:

```ts
import { mountReportChart } from '@zeruxjs/reports/view';
import type { ChartData } from '@zeruxjs/reports/definitions';

export function showAuthorizedChart(host: HTMLElement, data: ChartData) {
  return mountReportChart(host, data, { pageSize: 20, timeZone: 'UTC' });
}
// The host retains the returned view and calls view.destroy() on replacement.
```

The studio facade borrows sources/stores. External registry `close()` drains actual work before disposing accepted adapters; host-owned credentials have a separate `dispose()`. `mountReportChart` owns only its inserted subtree/listeners/custom components, so destroy it before its DOM owner disappears. Filtering/sorting/paging affects returned groups only. UTC grouping is separate from display zones, and empty, unavailable, sampled, materialized and truncated states must stay distinguishable.

Public source/view examples are included in the package. Focused checks use injected transports and jsdom; live Google grants, browser keyboard defaults and assistive-technology acceptance remain separate host prerequisites.
