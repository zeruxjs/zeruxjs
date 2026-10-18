# From events to trustworthy reports

Choose consent, tenant scope, aggregate coverage and report permissions before building charts.


## Start with an event contract

Choose allowed event names, scalar properties and tenant/site ownership before mounting a collector. The analytics pipeline is opt-in and best effort. Public browser origins must bind to trusted sites, and confidential server events require authentication. An Origin header alone is not an authenticated principal.

## Request identity is not user identity

Request IDs support day-scoped deduplication/correlation. Use a shared atomic reservation store to coordinate replicas. Opaque browser visitor/session IDs must be created only under the intended consent policy. Do not infer a person from an IP address, request ID or observed open pixel.

## Select the correct query path

| Need | Query path | Interpretation |
| --- | --- | --- |
| Recent event inspection | Bounded raw event page | A sample/page, not a global total |
| Counts over supported dimensions | Native aggregate | Exact for persisted matching rows |
| Numeric sum/average/min/max | Configured materialized numeric facts | Indexed-only coverage |
| Historical numeric repair | Reconciliation pages/jobs | Resumable repair, not a transactional completeness proof |

Before comparing a chart to another system, compare its time window, tenant filter, dimensions, persisted-row coverage and ingestion loss policy.

## Numeric facts and backfill

Configure numericFields before expecting native numeric metrics. Old events are not automatically materialized. Reconciliation requires a database-enforced unique event/property constraint and a trusted execution policy. A completed pass can still miss later-arriving events; restart only through an approved administrative path when necessary.

## Report access and definitions

The Reports service needs host authorization. Viewer, editor, export, sensitive-property and campaign privileges are distinct. For multiple tenants use a verified scope with a dedicated definition store. Query filtering by site does not isolate saved documents if every tenant reads one shared report definition envelope.

## Exports

Keep queryMode, truncated and coverage information with every exported chart. Multi-chart exports execute separate bounded queries and are not an immutable transactional snapshot. A custom warehouse source can extend scale, but it must preserve tenant authorization and honest coverage metadata.

## Retention and privacy

Analytics retention deletes are bounded administrative operations with explicit approval. They do not erase every email, suppression, external-provider or browser record. Align retention with a broader data inventory. Email open/click/download-click observations should not be labeled confirmed unique human engagement or completed downloads.

## TypeScript event and query contracts

```ts
import type { AnalyticsEventInput } from '@zeruxjs/analytics';
const event = {
  name: 'page_view', source: 'web', site: 'public',
  properties: { pathname: '/guide' },
} satisfies AnalyticsEventInput;
```

The event type checks value shapes; the server must still validate unknown browser events, consent, origins and site scope. A client must not mark its event source as trusted server data. Use the analytics package's actual summary/aggregate query types and preserve coverage/truncation metadata in the caller's result.

When comparing reports, identify whether each number is a raw event page, a database-native count or an indexed numeric aggregate. Consent drops, deduplication reservations, failed writes and reconciliation windows can make those numbers differ without a chart bug. A typed result does not guarantee complete source coverage.

Choose retention and deletion policy before collecting events. Check cross-site source filtering, aggregate fact updates and restart behavior with a real database. Rebuild or reconcile derived data according to its own contract rather than assuming a chart refresh repairs stored facts. See [analytics configuration](/zeruxjs/docs/0.0.3/configuration-analytics.md) and [report configuration](/zeruxjs/docs/0.0.3/configuration-reports.md) for the complete startup and adapter inputs.


## Implementation sources

- [packages/@zeruxjs/analytics/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/analytics/README.md)
- [packages/@zeruxjs/reports/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/reports/README.md)
- [packages/@zeruxjs/tags/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/tags/README.md)
