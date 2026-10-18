# Reports and dashboards

Build authenticated views with tenant-isolated definitions and visible query provenance.


## Source and authorization

Reports query internal analytics, not arbitrary SQL or executable chart code. A host authorize callback is required; missing authorization disables the service. Grant read, edit, export, sensitive-property and campaign access independently where needed.

## Definition ownership

Reports contain pages and charts. Definition updates use same-origin JSON writes and optimistic CAS. For multi-tenant hosts, resolve a trusted tenant scope with a dedicated document store, not merely a site filter over one global document. Never accept tenant scope from an unverified query parameter.

## Query modes

Native count dimensions can query all persisted matching rows. Supported numeric fields use indexed-only materialized facts. Other queries can fall back to a bounded sample (commonly 500 raw rows). Display queryMode, truncation and coverage in every dashboard/export; sampled totals cannot be represented as all-time facts.

## Exports and campaigns

CSV/JSON exports require separate permission and have byte/chart/query-budget caps. They are individual chart queries, not a transactional historical snapshot. Campaign views distinguish SMTP acceptance, provider notifications and observed tracking events; those are different measurements.

## Operations

Use secure host sessions, tenant filters and trusted source adapters. Dashboards do not ship an identity provider or default password. Large reports need warehouse/native aggregation capabilities and independent rate limits; the studio is not a general BI connector platform.

## Install and select the integration

```sh
npm install @zeruxjs/reports@0.0.2
```

This package participates in the runtime's **reports** integration. Start with [reports configuration](/zeruxjs/docs/0.0.2/configuration-reports.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Supply internal analytics, a versioned definition store and an explicit authorization callback. Decide tenant/site scope before exposing the studio or export route. The built-in chart vocabulary describes bounded analytics queries; it is not permission to run arbitrary SQL or JavaScript from a saved chart.

## TypeScript: inputs, results and ownership

```ts
import { createReports } from '@zeruxjs/reports';

type Inputs = Parameters<typeof createReports>;
type Result = Awaited<ReturnType<typeof createReports>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createReports>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.2/typescript.md) for the complete NodeNext checker configuration.

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

Custom aggregate adapters remove the built-in 500-row query limit.

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


## Public entry points

Manifest reference for `@zeruxjs/reports@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "@zeruxjs/analytics": "0.0.2"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/reports — authenticated report studio

A structured report/page/chart designer over **internal @zeruxjs/analytics events**. Routes: `/_reports` (studio), `/_reports/api` (versioned definition CRUD), `/_reports/query` (chart data). All routes require the host application's `authorize(request)` callback; missing auth disables the service.

```ts
export default {
  analytics: {analytics:'reporting',enabled:true},
  reports: {
    enabled:true,
    prefix:'/_reports',
    dashboardHost:'reports.example.com', // optional; proxy this domain to Zerux
    authorize: async request => await sessionHasRole(request,'reports_editor')
  }
}
```

Reports contain pages; pages contain charts. Chart types: `bar`, `horizontal-bar`, `line`, `area`, `pie`, `doughnut`, `scatter`, `stacked-bar`, `table`, and `kpi`. Grouping supports event name, UTC day, source, site, pathname, or `property:<name>`; metrics include count, sum, average, minimum, maximum, distinct. Data is only internal analytics, never arbitrary SQL or JavaScript. The studio has page/chart controls and an advanced JSON editor; data and layouts are escaped in the browser and pages are not exposed anonymously. PUT requires same-origin request and optimistic versioning. Host access control decides which users may read, publish or both.

**Important scope:** The built-in `analytics.events()` connector currently returns **at most 500 source rows**; charts report `sampledRows` and `truncated` when hitting their limit. Those charts must not be represented as global totals. For production-scale reporting, supply `source.events()` backed by your analytics warehouse/materialized aggregation, or extend the core analytics query layer with DB-native aggregate queries. The report document store is persisted in `analytics_report_documents` when the analytics connection implements conditional update and affectedCount; memory-only mode is for development. Cross-replica changes need a shared DB or atomic `store` adapter. Charts currently render client-side using Canvas (table/KPI use DOM) with a single value series; more advanced multi-series, sharing, scheduled exports and rich data-source connectors are future capabilities.

Admin sessions must be protected by your own secure cookies/session middleware; this package intentionally provides no default password, OAuth identity provider or anonymous editor. Never put raw analytics database credentials in a chart definition.

## Section 48: Exact native count aggregates

For `metric:'count'` grouped by `event`, `source`, `site`, or `pathname`, Reports automatically calls the optional `source.aggregate()` / `analytics.aggregate()` endpoint rather than loading only 500 raw events. UTC `day` grouping also uses exact native counts when the chart specifies both `since` and `until` within a 366-day range. The backend returns exact `total` and bounded chart groups; the dashboard marks hidden groups distinctly from sampled events. Other metrics and `property:` dimensions still use the bounded sample fallback with explicit `queryMode:'sampled'`. A custom AnalyticsReportSource may implement `aggregate(query)` to cover other backends.

`ReportsOptions.site` and ZeruxJS `reports.site` enforce an application-selected site filter that chart authors cannot override. Supply site from your authenticated tenant context, *not* a user-supplied query string. Protect reports with application auth and tenant authorization.

## Section 49: Indexed numerical metrics

When `@zeruxjs/analytics` is configured with `numericFields:['value',...]` and a chart uses `metric:'sum'|'average'|'min'|'max'` with a matching `valueField`, Reports uses `analytics.aggregateNumeric()` on the DB-backed numeric fact table for supported built-in dimensions. Report responses include `queryMode:'materialized'`, `matchedFacts`, and `numericCoverage:'indexed-only'`. **The dashboard always warns** that historical/failed numeric facts may be absent. Other fields retain the 500-row sampled fallback. These are not guaranteed complete historical or transactionally consistent financial totals; see `SECTION_49_MATERIALIZED_NUMERIC_ANALYTICS.md`.

## Section 73: saved dashboards, scoped exports and campaign views

The studio now includes optional **UTC date-range filtering** (without mutating the saved chart), read-only CSV/JSON export and an opt-in marketing campaign panel. The package also exposes a paginated report catalog and separates viewer, editor, export, sensitive-property and campaign permissions. Each exporter must be explicitly authorized by the host session. Saved report documents continue to use a versioned CAS store; a report shown to a viewer is always freshly queried, not an immutable historical snapshot.

### Single-tenant reporting configuration

```ts
const reports = createReports({
  analytics,
  store: analytics.createDocumentStore('analytics_report_documents','shop',{version:1,reports:[]}),
  site:'shop',
  authorize: async (request,action,resourceId) => {
    const session = await getSession(request); // implement in the host application
    if (!session?.sites?.includes('shop')) return false;
    if (action==='edit') return session.roles.includes('reports_editor');
    if (action==='export') return session.roles.includes('reports_exporter');
    if (action==='sensitive') return session.roles.includes('reports_sensitive_reader');
    if (action==='campaign') return session.roles.includes('campaign_reporting');
    return session.roles.includes('reports_reader');
  }
});
```

**Tenant scope must come from trusted application authorization**, never from a `?site=` query parameter. For multi-tenant hosts, supply `resolveScope(request)` returning `{site,store,source?}` where the store is **dedicated to that verified tenant**. In this mode, the direct `reports.query()` function is disabled because it lacks a request identity; use the authenticated HTTP routes instead. A single global store with only `site`-based query filtering is **not** enough to isolate saved reports between tenants. Per-report sharing/invites are not implemented; share viewer access only through host-managed tenant roles or separate approved tenant scopes. Do not expose a multi-tenant report studio with blanket `authorize:()=>true`.

### HTTP endpoints

- `GET /_reports` — authenticated studio; static CSP hashes (no unsafe-inline).
- `GET /_reports/api` — versioned report definition document; `PUT /_reports/api` — editor-only same-origin JSON write (256 KiB cap) with CAS conflict `409`.
- `GET /_reports/catalog?limit=20&cursor=version:offset` — stable, bounded 1–50 report metadata page; stale version cursor returns `409`.
- `GET /_reports/query?report=...&page=...&chart=...&since=...&until=...` — role-checked one-chart request; both optional epoch-millisecond UTC times must be present and span no more than 366 days. The request filter overrides **only that query**, not the saved chart definition.
- `GET /_reports/export?report=...&page=...&format=json|csv[&chart=...]` — separate export permission; a `property:` dimension additionally requires `sensitive` permission. CSV formula cells are escaped as text, exports are capped at 256 KiB, 12 charts and a 500-unit estimated database query budget. JSON contains each chart's `queryMode`, `truncated`, `coverage` and numeric-fact coverage where relevant.
- `GET /_reports/campaign?code=...&kind=delivery|performance|daily|activity[&from=YYYY-MM-DD&to=YYYY-MM-DD]` — requires independent `campaign` permission **and** an opt-in `campaigns` adapter. `delivery` supports an encoded `cursor` and 1–200 records per page; `daily` and `activity` require a bounded UTC date window. Missing report providers return `404`, not fictional zero counts.

The optional `campaigns` adapter has `report(code,{cursor,limit,site})` and optional `performance(code,site)`, `dailyTrends(code,from,to,site)` and `activity(code,from,to,site)` methods. Use the existing `@zeruxjs/email` marketing `report` method for the delivery-page callback; wrap it with your own authorization and tenant checks. The others should return the documented reports/campaign snapshot types. **Reports never makes itself a source of truth for SMTP or provider notifications.** Campaign delivery bars distinguish `smtpAccepted` (transport accepted, not inbox confirmed), provider events are **reported notifications, not unique deliveries**, and activity bars report **observed tracking events**, not unique users. Archived campaigns can be queried only as long as the underlying authorized archive/reporting data is retained. Consent and tracking setup remain independent.

### Query provenance and scale

Native COUNT on supported columns is exact for persisted matching events; supported indexed numeric metrics cover **only materialized numeric facts**, not necessarily historical rows that missed indexing. Unsupported dimensions and metrics query **up to 500 raw rows** and are labeled bounded samples; a sampled average uses only valid numeric values. Non-native samples cannot be interpreted as all-time totals. Date grouping is limited to 366 days, while the multi-chart export has a stricter overall query budget. Per-report export is built from individual chart queries and is **not a transactionally consistent multi-query snapshot**. Explicit external rate limits, host authentication/CSRF-session hardening, database migrations, real-engine parity tests, and a production egress perimeter remain deployer responsibilities.

After building the DB/Analytics/Reports packages, run `node --test tests/integration/reports-sqlite.test.mjs`. This covers two SQLite connections, tenant report-document isolation, exact counts above the raw sampling cap, and optimistic-CAS conflicts. Real PostgreSQL/MySQL/MongoDB concurrency, long-running load and the clean npm registry installation are not certified by this test.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/reports/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/reports/README.md)
- [packages/@zeruxjs/reports/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/reports/package.json)
