import {
  createReportSourceRegistry, createReportSourceHandler,
  type ReportSourceScope,
} from '@zeruxjs/reports/sources';
import {
  createGa4ReportSource, type GoogleReportCredentials,
} from '@zeruxjs/reports/ga4';

// Call once per authorized credential scope/generation. No provider call on setup.
export function reporting(
  binding: ReportSourceScope,
  property: string,
  credentials: GoogleReportCredentials,
  authenticate: (request: Request) => Promise<ReportSourceScope>,
  mayRead: (scope: Readonly<ReportSourceScope>, source: string) => Promise<boolean>,
) {
  const registry = createReportSourceRegistry({authorize: mayRead});
  registry.register('shop-ga4', createGa4ReportSource({
    binding, property, credentials, timeZone: 'UTC',
    schema: {version: 1, fields: [
      {name: 'date', kind: 'dimension', type: 'string'},
      {name: 'eventCount', kind: 'metric', type: 'decimal', unit: 'count'},
    ]},
  }));
  return {
    // Mount explicitly in an authenticated server route. Scope never comes from JSON.
    handler: createReportSourceHandler({registry, resolveScope: authenticate}),
    close: () => registry.close(), // host separately disposes borrowed credentials
  };
}
// POST application/json to that route:
// {"source":"shop-ga4","schemaVersion":1,"dimensions":["date"],
//  "metrics":["eventCount"],"from":"2026-01-01","to":"2026-01-02","limit":50}
