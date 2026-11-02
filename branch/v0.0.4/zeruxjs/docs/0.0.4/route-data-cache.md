# Route data cache

Explicit process-local route data policies and tenant-scoped invalidation.


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


## Implementation sources

- [packages/zeruxjs/src/route-data-cache.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/route-data-cache.ts)
- [packages/zeruxjs/examples/route-data-cache.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/examples/route-data-cache.mjs)
- [packages/zeruxjs/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/README.md)
