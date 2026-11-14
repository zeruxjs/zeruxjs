# Production deployment checklist

Validate a specific application and infrastructure rather than treating a build as certification.


## Establish the deployable unit

A normal Zerux application ships compiled .zerux/build output, package dependencies, Node and a process runner. This documentation site ships only dist static files. Do not deploy source secrets or a repository checkout as public assets.

## Build and types

Run zerux build from the application directory and a separate TypeScript check. Exercise the built start path, not only the development handler. Keep a lockfile and choose supported runtime/driver versions. A transpile succeeding does not establish types, authorization or service connectivity.

## Requests and security

- Configure allowed hosts and trusted proxy handling at the edge.
- Authenticate and authorize sensitive routes, including protocol and service endpoints.
- Use secure cookies, origin/CSRF checks for unsafe cookie-authenticated methods, and a suitable CSP.
- Bound bodies, streams, query fields and outbound calls.
- Keep public assets public and private storage outside web roots.

Global application middleware is not a universal perimeter: protocol/public handling precedes it. Review each endpoint's explicit authorization contract.

## Shared state and jobs

Use shared durable stores where restart survival and multi-instance coordination matter. Treat memory cache/token stores/local indexes as process-owned. Queue processors must be idempotent; SMTP ambiguity needs an uncertain state and reconciliation. Verify real Redis/database/object-provider behavior, not only injected test doubles.

## Shutdown and reload

Return cleanup from startup workers and close standalone managers. Plan graceful request draining and maximum shutdown duration. Ensure rolling deployments share required verification keys and compatible data schemas. Test failed startup and rollback, not only the happy path.

## Operations and recovery

Define health/readiness checks, sanitized logs, internal metrics, backups and restoration drills. Protect debugging ports and dashboards. Keep retention, consent, unsubscribe and deletion policies separate from analytics convenience. Review dependency advisories again at release time; a previous clean audit is not permanent evidence.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
