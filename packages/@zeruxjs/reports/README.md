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
