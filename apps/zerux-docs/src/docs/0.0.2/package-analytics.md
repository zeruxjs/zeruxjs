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
