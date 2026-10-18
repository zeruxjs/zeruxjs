# Security and observability

Inspect behavior without exposing internal state.


## Logs

Use context.logger or the exported Logger/logger APIs. Never log credentials, cookies, personal tokens or complete environment objects. Keep request state isolated and sanitize user-provided fields.

## Metrics

api.getLoadStatus(windowMs) and runtime.getLoadStatus(windowMs) report bounded request counts, status families, HTTP versions, concurrency and latency. No public metrics endpoint is served automatically; authorize any route you add.

## Deployment checks

Validate hosts and origins, set request and stream limits, confirm cleanup behavior, review dependency advisories and exercise authentication failures. A successful build does not certify production security.

## Troubleshooting

If start cannot find its build, run zerux build in the application directory. For failed development reloads, inspect dev.json reload status and logs; the last good generation may still be active. Placeholder scaffolders print help rather than generating files.

## Measure at the owning layer

Use runtime load metrics for the current application process, structured logs for diagnostic events and analytics for product/event reporting. These are not interchangeable. An analytics outage should not hide a service-startup error, and a low average latency does not prove the absence of failing or abandoned requests.

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
export default function register(api: ZeruxPluginApi): void {
  api.addRoute({ pattern: '/internal/load', method: 'GET',
    handler: () => api.getLoadStatus(60000) });
}
```

Protect internal diagnostics with application middleware/host policy before exposing them; this example only demonstrates the API shape. A public endpoint must not leak request identities, database credentials or filesystem paths. The window argument selects the relevant load observation interval, not a cross-instance metrics query.

## TypeScript and operational meaning

Infer the returned shape with ReturnType from the installed API or use the framework's exported metrics types. Missing/degraded/closed service states have different meanings. A type annotation does not prove an external adapter is healthy; include a bounded real readiness check where needed without turning it into an expensive action on every request.

Record duration and a correlation identifier, but avoid complete request bodies, cookies, tokens and raw AI/mail content. When investigating errors, distinguish expected denied/invalid requests from backend faults. Report sampling/truncation and process scope so operators do not read an incomplete metric as a deployment-wide total.

## Verify and deploy

Test a slow request, an error, a cancelled stream and service degradation. Compare development with production output and the actual reverse proxy. Add external monitoring/export with deliberate authentication and retention; an in-process metrics snapshot is not a durable monitoring backend or an automatic alerting system.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
