# Troubleshooting

Diagnose build, routing, lifecycle and package-integration problems.


## Start is not using the expected build

Run zerux build in the actual application directory, then start from that directory with dependencies installed. The current resolver can fall back to source configuration when a build manifest is absent; check for a valid staged manifest rather than inferring compiled execution from a running process. A docs static export is not a framework server build. Check build logs and configured output/source paths; do not remove a last good build as the first debugging step.

## A route does not match

Check filename conventions and method exports, then routePath/path overrides and dynamic segments. Verify the effective internal pathname after multisite rewriting. A public asset or protocol endpoint can be handled before file-route dispatch. Avoid overlapping plugin/service patterns.

## Middleware did not protect an endpoint

Global application middleware does not wrap every earlier protocol/public path. Protect protocols with gateway authorization and keep confidential files out of public. Optional service dashboards have explicit host authorization and often CSRF requirements.

## A Fetch handler sees an empty body

A stream may already have been consumed by the buffered parser. Register with registerFetchRoutes, or export meta.streamBody alongside createFetchRoute in the file module. Do not combine two readers for the same upload.

## Development still serves old code

Candidate builds activate only after preparation succeeds. Inspect reload errors and worker startup/cleanup failures; the old successful generation may intentionally remain active. Fix the candidate error, then let a new build activate.

## State differs between replicas

Memory caches, token/revocation registries, hook state, local search snapshots and local media are not automatically shared. Use an appropriate authoritative shared store. A cache remember Promise, atomic filesystem rename or local revision counter is not a distributed lock.

## Analytics numbers disagree

Check whether a query uses raw samples, native persisted-row counts or indexed numeric facts. Check dropped events, consent, request-ID reservations and reconciliation status. Tracking requests can be caused by scanners/proxies. Do not compare these measures as though they were identical unique-user counts.

## Duplicate jobs or uncertain email

BullMQ delivery is at-least-once. Use durable idempotency and compare-and-swap state. An SMTP timeout may occur after provider acceptance; reconcile uncertain state rather than automatically replaying a possibly delivered message.

## Module or package import fails

Use exact manifest names and public export paths. db virtual imports require the framework loader. CommonJS require hooks do not install ESM loaders. Browser-only functions still require a DOM even when server imports are safe.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
