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


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
