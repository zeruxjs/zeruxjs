# Analytics configuration

Set up analytics with exact runtime options, typed JavaScript/TypeScript examples and lifecycle policies.


## Before you configure it

Install the runtime and the packages used by this feature in the application directory. Keep the dependency lockfile committed. Configure only services the application actually uses; a public package name is not automatic service registration.

```sh
npm install zeruxjs @zeruxjs/analytics
```

## JavaScript application setup

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  analytics: {
  enabled: true,
  analytics: 'reporting',
  table: 'analytics_events',
  collector: { prefix: '/_analytics', allowedOrigins: ['https://app.example.com'],
    maxBodyBytes: 65536, maxEventsPerMinute: 120 },
},
};
```

This example is a server configuration. Supply the referenced environment values through the server process before starting it. The documentation site's static exporter does not start this service merely because it imports a config file.

## What each setting does

The `analytics` string selects an existing named database connection, not a package name or HTTP destination. Configure that slug in `db.connections`. Runtime bootstrap supplies the database manager; standalone `createAnalytics` requires its own database option. Event collection is optional, so omit `collector` when the application records only server-side events.

`enabled: false` skips analytics initialization. When an analytics object is present and enabled is not false, initialization is attempted after database/cache/files/queue setup. Initialization and collector errors are best effort: the service can be degraded without preventing the application from serving requests. Tags and reports depend on the resulting analytics service.

Collector origins, body size, storage timeout, concurrent-read and pending-event limits bound HTTP ingestion. A server token belongs only on server clients. Browser-origin requests must not impersonate trusted server events. Consent, identifying fields, event schemas and retention decisions belong to the application; enabling a collector is not consent management.

## TypeScript configuration

For a TypeScript application, use `zerux.config.ts`. Validate the service object separately so errors point to its option rather than a large application object. `NonNullable` removes the optional top-level absence; it does not invent defaults or validate external data at runtime.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

type Options = NonNullable<ZeruxConfig['analytics']>;
const options = {
  enabled: true,
  analytics: 'reporting',
  table: 'analytics_events',
  collector: { prefix: '/_analytics', allowedOrigins: ['https://app.example.com'],
    maxBodyBytes: 65536, maxEventsPerMinute: 120 },
} satisfies Options;
export default { analytics: options } satisfies ZeruxConfig;
```

In JavaScript, the JSDoc annotation provides editor assistance. In TypeScript, `satisfies` checks the shape while preserving inferred literal values. Neither changes the runtime behavior or establishes a network connection during a typecheck. See [TypeScript application development](/zeruxjs/docs/0.0.3/typescript.md) for strict settings and validation boundaries.

## Lifecycle and failure policy

Check readiness and degraded status before relying on analytics for operational decisions. A failed analytics write must not become an authorization decision or a lost transactional business update. Use the authoritative database for those updates.

Numeric aggregate tables, reconciliation and retention have separate coverage/approval requirements. A truncated raw event page is not a global total. Use server-verified site scope and test any materialized aggregate workflow against the actual database adapter before deploying cross-tenant reports.

## Verify a real integration

1. Start the application with just this feature and its declared dependencies configured.
2. Check service readiness, then perform one operation through the application API.
3. Test a failure path such as unavailable infrastructure or a rejected input.
4. Restart the runtime and verify that owned resources close and state behaves according to the chosen storage model.
5. Repeat with the production build and the real deployment identity; a successful static docs build does not test external services.

## Declared options

The following table is captured from the source contract used by runtime bootstrap. Optional means a property may be omitted; it does not mean every combination is meaningful. Callback and nested adapter shapes must satisfy the full declared type.

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `analytics` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `enabled` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `table` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `indexes` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `numericFields` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `numericUniqueIndexManagedExternally` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `required` | `false` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `collector` | `AnalyticsCollectorStartupConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |

## Continue with the package

- [analytics](/zeruxjs/docs/0.0.3/package-analytics.md)
- [analytics reporting](/zeruxjs/docs/0.0.3/analytics-reporting.md)
- [tags](/zeruxjs/docs/0.0.3/package-tags.md)
- [reports](/zeruxjs/docs/0.0.3/package-reports.md)


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
