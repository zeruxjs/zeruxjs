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
