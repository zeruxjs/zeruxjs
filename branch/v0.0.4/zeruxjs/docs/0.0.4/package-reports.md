# Reports and dashboards

Build authenticated views with tenant-isolated definitions and visible query provenance.


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

This package participates in the runtime's **reports** integration. Start with [reports configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reports.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Supply internal analytics, a versioned definition store and an explicit authorization callback. Decide tenant/site scope before exposing the studio or export route. The built-in chart vocabulary describes bounded analytics queries; it is not permission to run arbitrary SQL or JavaScript from a saved chart.

## TypeScript: inputs, results and ownership

```ts
import { createReports } from '@zeruxjs/reports';

type Inputs = Parameters<typeof createReports>;
type Result = Awaited<ReturnType<typeof createReports>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createReports>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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

| Field           | Accepted type/value                                                                    | Optional |
| --------------- | -------------------------------------------------------------------------------------- | -------- |
| `analytics`     | `AnalyticsManager`                                                                     | No       |
| `store`         | `ReportsStore`                                                                         | Yes      |
| `source`        | `AnalyticsReportSource`                                                                | Yes      |
| `prefix`        | `string`                                                                               | Yes      |
| `authorize`     | `(request:Request,action?:ReportAction,resourceId?:string)=>boolean\|Promise<boolean>` | No       |
| `dashboardHost` | `string`                                                                               | Yes      |
| `maxSourceRows` | `number`                                                                               | Yes      |
| `site`          | `string`                                                                               | Yes      |
| `resolveScope`  | `(request:Request)=>Promise<ReportTenantScope>\|ReportTenantScope`                     | Yes      |
| `campaigns`     | `CampaignReportsSource`                                                                | Yes      |

### ChartDefinition

| Field        | Accepted type/value                                                      | Optional |
| ------------ | ------------------------------------------------------------------------ | -------- |
| `id`         | `string`                                                                 | No       |
| `title`      | `string`                                                                 | No       |
| `type`       | `ChartKind`                                                              | No       |
| `groupBy`    | `` 'event'\|'day'\|'source'\|'site'\|'pathname'\|`property:${string}` `` | No       |
| `metric`     | `Metric`                                                                 | No       |
| `valueField` | `string`                                                                 | Yes      |
| `eventName`  | `string`                                                                 | Yes      |
| `source`     | `string`                                                                 | Yes      |
| `site`       | `string`                                                                 | Yes      |
| `since`      | `number`                                                                 | Yes      |
| `until`      | `number`                                                                 | Yes      |
| `limit`      | `number`                                                                 | Yes      |

### AnalyticsReportSource

Native `aggregate`/branch/v0.0.4/`aggregateNumeric` adapters can count persisted facts beyond the raw sampling cap. Custom `events` callbacks still return at most 500 raw rows; display groups and provenance remain independently bounded.

| Field                  | Accepted type/value                        | Optional |
| ---------------------- | ------------------------------------------ | -------- |
| `events`               | `Promise<AnalyticsRow[]>`                  | No       |
| `aggregate`            | `Promise<AnalyticsAggregateResult>`        | Yes      |
| `aggregateNumeric`     | `Promise<AnalyticsNumericAggregateResult>` | Yes      |
| `supportsNumericField` | `boolean`                                  | Yes      |

### ReportsStore

| Field  | Accepted type/value        | Optional |
| ------ | -------------------------- | -------- |
| `load` | `Promise<ReportsDocument>` | No       |
| `save` | `Promise<boolean>`         | No       |

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


## Public entry points

Manifest reference for `@zeruxjs/reports@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./sources": {
      "types": "./dist/sources.d.ts",
      "browser": null,
      "default": "./dist/sources.js"
    },
    "./ga4": {
      "types": "./dist/ga4.d.ts",
      "browser": null,
      "default": "./dist/ga4.js"
    },
    "./adsense": {
      "types": "./dist/adsense.d.ts",
      "browser": null,
      "default": "./dist/adsense.js"
    },
    "./definitions": {
      "types": "./dist/definitions.d.ts",
      "default": "./dist/definitions.js"
    },
    "./view": {
      "types": "./dist/view.d.ts",
      "default": "./dist/view.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {
    "@zeruxjs/analytics": "0.0.4"
  },
  "bin": {}
}
```


## Package README

# @zeruxjs/reports — authenticated report studio

A structured report/page/chart designer over **internal @zeruxjs/analytics events**. Routes: `/_reports` (studio), `/_reports/api` (versioned definition CRUD), `/_reports/query` (chart data). All routes require the host application's `authorize(request)` callback; the standalone factory rejects a missing authorizer.

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

**Important scope:** The built-in `analytics.events()` connector currently returns **at most 500 source rows**; charts report `sampledRows` and `truncated` when hitting their limit. Those charts must not be represented as global totals. The Reports raw-event path keeps the same 500-row ceiling for custom `source.events()` implementations. For larger exact counts or indexed numeric projections, supply the supported `source.aggregate()` / `source.aggregateNumeric()` contracts backed by native bounded aggregation; returning more raw rows is rejected. The report document store is persisted in `analytics_report_documents` when the analytics connection implements conditional update and affectedCount; memory-only mode is for development. Cross-replica changes need a shared DB or atomic `store` adapter. Charts currently render client-side using Canvas (table/KPI use DOM) with a single value series; more advanced multi-series, sharing and scheduled exports remain future capabilities. Optional external sources below use a separate explicit table-query API.

Admin sessions must be protected by your own secure cookies/session middleware; this package intentionally provides no default password, OAuth identity provider or anonymous editor. Never put raw analytics database credentials in a chart definition.

## Exact native count aggregates

For `metric:'count'` grouped by `event`, `source`, `site`, or `pathname`, Reports automatically calls the optional `source.aggregate()` / `analytics.aggregate()` endpoint rather than loading only 500 raw events. UTC `day` grouping also uses exact native counts when the chart specifies both `since` and `until` within a 366-day range. The backend returns exact `total` and bounded chart groups; the dashboard marks hidden groups distinctly from sampled events. Other metrics and `property:` dimensions still use the bounded sample fallback with explicit `queryMode:'sampled'`. A custom AnalyticsReportSource may implement `aggregate(query)` to cover other backends.

`ReportsOptions.site` and ZeruxJS `reports.site` enforce an application-selected site filter that chart authors cannot override. Supply site from your authenticated tenant context, _not_ a user-supplied query string. Protect reports with application auth and tenant authorization.

## Indexed numerical metrics

When `@zeruxjs/analytics` is configured with `numericFields:['value',...]` and a chart uses `metric:'sum'|'average'|'min'|'max'` with a matching `valueField`, Reports uses `analytics.aggregateNumeric()` on the DB-backed numeric fact table for supported built-in dimensions. Report responses include `queryMode:'materialized'`, `matchedFacts`, and `numericCoverage:'indexed-only'`. **The dashboard always warns** that historical/failed numeric facts may be absent. Other fields retain the 500-row sampled fallback. These are not guaranteed complete historical or transactionally consistent financial totals.

## Saved dashboards, scoped exports and campaign views

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

## Explicit read-only sources (server only)

The existing studio, saved chart format, internal analytics and campaign adapters remain unchanged. Optional `@zeruxjs/reports/sources` provides `createReportSourceRegistry` and `createReportSourceHandler`; mount the handler explicitly in a host server route. External source queries are a separate typed table API, not silently mapped onto internal event charts. See [the minimal public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/reports/examples/google-source.ts).

Register server-authored adapters by unique name. Each declares a V1 field schema (dimension/string or metric/decimal plus unit), read-only capabilities, row/day limits, query and disposal. Queries name exactly one registered source and schema version, selected fields, inclusive `YYYY-MM-DD` dates and a row limit. Unknown fields/options, duplicate fields and incompatible schema versions reject before provider work. `validatePlan` checks up to 12 independently typed panels; it does not join or merge sources or equate fields with similar names. Source schemas are explicit, not derived from executable report definitions. Custom adapters must enforce their own underlying tenant predicates.

Every query requires a trusted `{tenant,site,principal,credentialPartition}` and a literal-true `authorize(scope,source)` decision. Resolve these through your host session/auth policy; never accept them from report JSON, forwarded headers or a browser-selected credential. Provider instances additionally match all four fields to their configured binding **before acquiring credentials**. Use a separate source/credential binding for each authorized user grant; a tenant identifier alone does not authorize another user's Google account. Registry registrations and schemas are host-trusted code/configuration, not package discovery.

The default registry admits four actual unsettled queries, a 10-second observation deadline and 1 MiB serialized output (configurable maxima: 64, 60 seconds, 4 MiB). There are at most 32 registrations, 100 schema fields, nine selected dimensions and ten metrics. Provider adapters allow 1000 rows and 366 inclusive days, perform one bounded page and report truncation instead of automatically scanning. Cells are capped at 4096 UTF-8 bytes. Decimal strings preserve large integer/revenue precision; do not coerce them into JavaScript numbers without an application precision policy.

Results carry schema/source versions, selected typed columns/units, query window, time zone and provider/internal coverage. `sampling:'unknown'` does not claim unsampled or complete data. Provider threshold/data-loss/restriction or warning presence is represented without copying private diagnostic text. `totalRows` describes matching groups, not event totals. GA4's `date` remains its documented `YYYYMMDD` dimension value; AdSense `DATE` is `YYYY-MM-DD`. No cross-time-zone aggregation is inferred.

There is **no result cache** here. Results and HTTP responses are `private, no-store`; HTTP varies on Cookie/Authorization. `cacheIdentity` hashes source schema/query plus tenant, site, principal and credential partition for host-owned private caches; it is not authorization. Hosts must reauthorize every hit and include their own entitlement/credential revision and expiry if adding caching. The optional HTTP handler accepts read-only POST JSON, limits bodies to 16 KiB with a ten-second read budget, and emits fixed errors without provider bodies, tokens or stack traces. Host session authentication, HTTP admission and resolver deadlines remain required. Direct registry queries are trusted server APIs.

### GA4 first, AdSense separately

`@zeruxjs/reports/ga4` exports `createGa4ReportSource`: a fixed-property GA4 Data API `v1beta` `runReport` adapter. Supply a reviewed field catalog and the property's expected IANA `timeZone`; mismatched provider metadata rejects. Metric types must agree with count/seconds/milliseconds/ratio/currency units; unsupported units fail closed. Currency metrics must agree with provider currency metadata. A property must belong entirely to the bound application site/permission scope: this adapter does not invent cross-property or per-stream authorization. No realtime, arbitrary filters, user SQL or funnel endpoints are implemented. See Google's [runReport contract](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport) and [quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas).

`@zeruxjs/reports/adsense` exports `createAdSenseReportSource`: a separate AdSense Management API V2 adapter with fixed `pub-...` account and ASCII/punycode domain. Every request applies an exact, server-owned `DOMAIN_CODE` filter. Only `GOOGLE_TIME_ZONE` reporting (`America/Los_Angeles`) is implemented, avoiding guesses about account-zone configuration; account-local reporting remains unsupported. It validates returned dates, field/header units and currency. Count, ratio and currency metrics are supported; other AdSense header types reject. Currency is explicitly requested when a currency field is registered. See Google's [generate contract](https://developers.google.com/adsense/management/reference/rest/v2/accounts.reports/generate), [time-zone rules](https://developers.google.com/adsense/management/timezone) and [filter syntax](https://developers.google.com/adsense/management/reporting/filtering).

### Credentials, retries and ownership

Both modules use fixed HTTPS Google reporting endpoints, bearer headers and `redirect:'error'`. They accept a host-owned `GoogleReportCredentials` provider with explicit expiry/scopes, or optional `createGoogleReportCredentials` for Google's fixed-endpoint OAuth refresh-token exchange. Use only `GA4_READONLY_SCOPE` (`analytics.readonly`) or `ADSENSE_READONLY_SCOPE` (`adsense.readonly`) respectively. The host must first obtain/store a grant using Google's [authorization-code consent flow](https://developers.google.com/identity/protocols/oauth2/web-server), validate OAuth state and redirect allowlists, and protect refresh tokens privately. This package neither implements a login callback nor interprets application login as Google authorization. A supplied grant may carry other permissions; requested reporting operations remain read-only, and hosts should issue minimal grants.

Refresh is on demand, never background. The helper has a ten-second cooperative deadline, four pending exchanges, a 16 KiB response bound, no persisted token cache and no refresh retry. Credentials are **borrowed** by adapters; after `await registry.close()`, the host separately `await credentials.dispose()` when it owns that helper. Registry close aborts active work, drains actual settlement, then disposes sources. Source disposal also aborts/drains its active token acquisition and fetch. Uncooperative custom callbacks retain capacity and can delay close; signals do not force-cancel JavaScript.

Read-only report requests default to at most two attempts (maximum three), retrying only explicit 429/recognized quota errors or 500/502/503/504 responses with bounded exponential delays. Numeric Retry-After up to two seconds is honored; larger/unsupported values stop retry rather than retry early. Transport errors, authorization failures and malformed successful responses are not retried. Errors distinguish `QUOTA`, `UNAVAILABLE`, `DENIED`, `INVALID_QUERY`, `INVALID_RESULT`, `CANCELLED`, `OVERLOAD` and `CLOSED`; raw causes remain non-enumerable trusted detail. There is no discovery, arbitrary outbound URL, account enumeration or automatic API refresh after disposal. Keep deployment egress controls and session authorization in the host.

Focused fixtures exercise schema/tenant denial, fixed destinations, quota/outage, precision, cancellation, refresh and disposal. They do not certify live Google grants, property access, AdSense account eligibility or production quotas. Live acceptance requires enabled APIs, a dedicated authorized property/account/domain, tenant-isolated read-only OAuth grants and approved network access. No browser or live-provider test is implied.

## Versioned layouts and replaceable views

`@zeruxjs/reports/definitions` is a DOM/Node-global-free-on-import entry for validated definitions and definition-only JSON codecs; `@zeruxjs/reports/view` exposes `mountReportChart(host,data,options)`. [The replaceable-view example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/reports/examples/replaceable-view.ts) uses public imports. Source execution remains in the existing authorized report runtime or opt-in source registry; neither browser entry fetches data, resolves credentials or grants permissions.

A page may have `layout:{version:1,columns:1|2|3,timeZone:'UTC',items:[{chartId,span:1|2|3}]}`. Every page chart appears exactly once, in display order, with span no larger than columns. Legacy pages without layout resolve to two columns, UTC, span one. Document `version` remains the optimistic storage revision; **layout version and transfer schema version are independent**. Layout zones are validated IANA display zones, not changes to UTC grouping/filtering. No SQL, JavaScript, HTML expressions, arbitrary expression fields, callbacks, accessors or class instances are accepted in definitions. Authored titles may contain markup characters as inert text and are rendered with textContent.

Definition validation now rejects unknown fields at every document/report/page/chart/layout level. Previously ignored custom fields must move to host-owned storage. Direct validation/import/save boundaries are bounded to 256 KiB, 20,000 visited JSON nodes and nesting depth 12 in addition to existing chart/page limits. The portable envelope is `{format:'zerux-report',schemaVersion:1,document}`. `exportReportDefinition` and `importReportDefinition` validate it; raw historical documents still use `validateReports`. Neither codec transfers results, credentials, components or executable callbacks.

### Controlled import/export and authorization

The built-in studio adds explicit definition import/export. `GET /_reports/definition` requires **export** authorization and downloads the validated envelope. `POST /_reports/definition` requires **edit**, same-origin JSON and a bounded ten-second/256 KiB body read; it validates a candidate without saving, rebinding its revision to the current tenant store revision. Review it and click Save: the normal editor-authorized PUT still performs CAS and can return 409. Import never trusts an imported revision as a storage override. The advanced chart JSON editor also validates a candidate on this endpoint before installing it locally.

Read/run/export and sensitive-property checks remain server-side regardless of visible controls. Existing `/api` PUT keeps its origin/CAS checks and now uses the bounded body reader. Definition and data routes retain `private, no-store`, Cookie/Authorization Vary and fixed client errors. Host authentication, tenant-specific stores, session/CSRF middleware and rate limits remain required. UI permission visibility never acts as authorization.

### Table alternatives, states and customization

Every built-in chart, including KPI/pie charts and optional campaign charts, now retains a labeled semantic table alternative. Canvas is supplementary and hidden from assistive technology. Each view has an explicitly authored chart-title label, caption, row/column headers, live status and native controls. Focus a chart region and use Left/Right/Home/End to move among chart regions in its `data-report-board`; Tab/Shift-Tab remain native and controls do not trap keys. No positive tabindex is used. Date filters remain UTC; the view shows the configured display zone and formats receipt time in it, explicitly distinguishing receipt time from a consistent data snapshot. Date-only UTC buckets are never shifted into another day.

The table provides case-insensitive dimension filtering, stable dimension/value sorting and bounded pagination (25 rows by default, configurable 1–100, at most 500 returned rows). These operations affect **returned groups only**, not missing backend rows or authorization. Existing catalog and campaign cursors remain separate server pagination. CSV/JSON data exports continue to query the authorized server selection, not the local table filter/sort/page: existing 256 KiB, 12-chart and query-work budgets and spreadsheet-formula neutralization remain in force.

Views distinguish empty, unavailable, sampled, materialized and truncated data instead of displaying missing results as zero. Source coverage and sampled-row counts stay visible. Preview replacements cancel/fence stale fetches; view cleanup releases owned listeners and custom component disposers, and pagehide cancels pending preview/campaign work. Back-forward cache restoration re-queries the page preview.

`mountReportChart` accepts a trusted `components.chart(container,data)` callback returning a synchronous disposer. It always retains the shared table and receives a frozen data snapshot. Components never live in saved definitions; the host owns their rendering safety and resources. Call `view.destroy()` on replacement/unmount. It is idempotent and removes only the inserted subtree/listeners. A failed component mount cleans the owned subtree. `data:null` or `state:'unavailable'` gives an honest unavailable view without a source call. Browser imports do not require DOM globals; mounting requires a real DOM host.

For a completely different studio, supply trusted `createReports({...,renderDashboard:({prefix})=>html})`; authorization runs before this host callback and render errors return a private 503. Its output is capped at 512 KiB and retains the runtime's restrictive CSP (hashes for the first inline script/style). This is trusted server code, not an HTML field in imported definitions. Hosts using multiple scripts/styles must supply a compatible separately hosted UI rather than expecting CSP to authorize them automatically.

Built-in CSS exposes `--reports-gap`, `--reports-border`, `--reports-radius`, `--reports-focus` and `--reports-surface`; keep contrast and visible focus when overriding them. The headless view injects no global CSS, so host styles can target `.report-view` within their container. External provider/source registry contracts are unchanged; external table results are not automatically interpreted as internal ChartData or merged into the studio.

Qualification includes jsdom keyboard-event/focus, table controls, stored-XSS text, component failure and teardown fixtures, plus existing authorization/export checks. This is DOM emulation, not live-browser or screen-reader certification. Native keyboard/assistive-technology checks still require a functioning browser and relevant AT; none was started for this task.

## Disposal and maintained source boundaries

The studio facade and memory definition store acquire no separate close owner. The external source registry owns accepted adapters and waits for actual unsettled queries before disposal; credentials stay borrowed and must be disposed separately by their host owner after registry close. Browser views own inserted nodes/listeners/components through `destroy()`. Definition codecs/layout helpers are inert and never authorize, fetch or persist by themselves.

The authored dashboard script, stylesheet and markup remain readable source. Formatting is checked separately against JavaScript structure, CSS declarations and HTML/interpolation structure; the runtime still hashes the exact emitted script/style bytes for CSP. Test fixtures release held work, views, sources, credential helpers and DOM environments in dependency order, even after assertions fail. These checks use synthetic transports and DOM emulation, not live Google grants, browser/AT certification or cross-store transaction guarantees.


## Implementation sources

- [packages/@zeruxjs/reports/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/reports/README.md)
- [packages/@zeruxjs/reports/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/reports/package.json)
