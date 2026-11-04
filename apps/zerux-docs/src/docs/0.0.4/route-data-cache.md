---
{
  "title": "Route data cache",
  "description": "Explicit process-local route data policies and tenant-scoped invalidation.",
  "section": "Fundamentals",
  "order": 45,
  "sources": ["packages/zeruxjs/src/route-data-cache.ts", "packages/zeruxjs/examples/route-data-cache.mjs", "packages/zeruxjs/README.md"],
  "related": ["plugins"]
}
---

Use the server-only `zeruxjs/route-data-cache` entry after host authorization.
The coordinator borrows a scoped cache manager and defaults result responses to
no-store. Explicit anonymous public policies may produce public HTTP caching;
personalized scopes cannot. Cache only plain JSON with all locale/route/identity
dependencies represented in the key.

Fresh and stale windows are separate. Stale refresh errors never extend expiry.
Tag/path invalidation retires the entry; late refresh writes cannot populate its
replacement. These tags do not refer to the tracking container package.

Coordination and invalidation are process-local, including when storage is Redis.
Distributed requirements reject. Invoke invalidation from an authorized
post-commit action callback. Close the coordinator before its borrowed cache;
cooperative cancellation cannot force a handler or backend to finish.

See the framework README's “Opt-in route data cache” section and
`packages/zeruxjs/examples/route-data-cache.mjs` for exact bounds and public imports.
