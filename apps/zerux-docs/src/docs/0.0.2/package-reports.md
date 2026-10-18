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

Reports query internal analytics, not arbitrary SQL or executable chart code. A host authorize callback is required; missing authorization disables the service. Grant read, edit, export, sensitive-property and campaign access independently where needed.

## Definition ownership

Reports contain pages and charts. Definition updates use same-origin JSON writes and optimistic CAS. For multi-tenant hosts, resolve a trusted tenant scope with a dedicated document store, not merely a site filter over one global document. Never accept tenant scope from an unverified query parameter.

## Query modes

Native count dimensions can query all persisted matching rows. Supported numeric fields use indexed-only materialized facts. Other queries can fall back to a bounded sample (commonly 500 raw rows). Display queryMode, truncation and coverage in every dashboard/export; sampled totals cannot be represented as all-time facts.

## Exports and campaigns

CSV/JSON exports require separate permission and have byte/chart/query-budget caps. They are individual chart queries, not a transactional historical snapshot. Campaign views distinguish SMTP acceptance, provider notifications and observed tracking events; those are different measurements.

## Operations

Use secure host sessions, tenant filters and trusted source adapters. Dashboards do not ship an identity provider or default password. Large reports need warehouse/native aggregation capabilities and independent rate limits; the studio is not a general BI connector platform.
