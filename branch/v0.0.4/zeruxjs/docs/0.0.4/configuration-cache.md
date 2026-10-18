# Cache configuration

Set up cache with exact runtime options, typed JavaScript/TypeScript examples and lifecycle policies.


## Before you configure it

Install the runtime and the packages used by this feature in the application directory. Keep the dependency lockfile committed. Configure only services the application actually uses; a public package name is not automatic service registration.

```sh
npm install zeruxjs @zeruxjs/cache
```

## JavaScript application setup

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  cache: {
  connector: 'memory',
  options: { maxEntries: 2000 },
  prefix: 'catalog:v1',
  defaultTtlSeconds: 60,
  startupTimeoutMs: 3000,
  required: false,
},
};
```

This example is a server configuration. Supply the referenced environment values through the server process before starting it. The documentation site's static exporter does not start this service merely because it imports a config file.

## What each setting does

Runtime setup uses `connector`, whereas standalone `createCacheManager` uses `helper`. For memory caching, set `connector: 'memory'`. For Redis, install the adapter and use `connector: '@zeruxjs/cache-redis'` with `options: { url: process.env.REDIS_URL }`. An in-memory cache is isolated to one process and disappears on restart; Redis infrastructure is managed by the deployment.

`prefix` separates logical namespaces and data revisions. Application keys remain unprefixed at the call site; include a server-verified tenant or permission boundary when values depend on identity. `defaultTtlSeconds` uses seconds, not milliseconds. Set an explicit TTL on entries whose freshness differs from the namespace default. A cache miss returns `undefined`; it is not the same as a cached null value.

The default startup timeout is 3,000 milliseconds. Only `required: true` makes connector startup/timeout failure fatal. An optional cache may be unavailable, so a cache-backed application must still be able to fetch authoritative data. An import failure or invalid manager export is outside that optional connector failure handler and can still reject startup.

## TypeScript configuration

For a TypeScript application, use `zerux.config.ts`. Validate the service object separately so errors point to its option rather than a large application object. `NonNullable` removes the optional top-level absence; it does not invent defaults or validate external data at runtime.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

type Options = NonNullable<ZeruxConfig['cache']>;
const options = {
  connector: 'memory',
  options: { maxEntries: 2000 },
  prefix: 'catalog:v1',
  defaultTtlSeconds: 60,
  startupTimeoutMs: 3000,
  required: false,
} satisfies Options;
export default { cache: options } satisfies ZeruxConfig;
```

In JavaScript, the JSDoc annotation provides editor assistance. In TypeScript, `satisfies` checks the shape while preserving inferred literal values. Neither changes the runtime behavior or establishes a network connection during a typecheck. See [TypeScript application development](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for strict settings and validation boundaries.

## Lifecycle and failure policy

The runtime owns a configured cache manager; do not close it after each response. A standalone manager must be closed when its owner stops. Cache initialization runs after database initialization.

Namespace clearing is not a transaction. In Redis, namespace clearing scans matching keys and can race with concurrent writes. Never treat a prefixed clear as a substitute for tenant authorization. Avoid unprefixed clearing on shared Redis, and do not enable `allowFlushDb` except with a deliberately dedicated instance.

## Verify a real integration

1. Start the application with just this feature and its declared dependencies configured.
2. Check service readiness, then perform one operation through the application API.
3. Test a failure path such as unavailable infrastructure or a rejected input.
4. Restart the runtime and verify that owned resources close and state behaves according to the chosen storage model.
5. Repeat with the production build and the real deployment identity; a successful static docs build does not test external services.

## Declared options

The following table is captured from the source contract used by runtime bootstrap. Optional means a property may be omitted; it does not mean every combination is meaningful. Callback and nested adapter shapes must satisfy the full declared type.

| Option | Accepted value | Runtime behavior |
| --- | --- | --- |
| `connector` | `string` | Runtime adapter name; absent means unconfigured |
| `options` | `Record<string, unknown>` | Forwarded to the adapter |
| `prefix` | `string` | Cache manager namespace |
| `defaultTtlSeconds` | `number` | Default entry TTL in seconds |
| `startupTimeoutMs` | `number` | Positive timeout; otherwise 3000 ms |
| `required` | `boolean` | Exactly true makes connector startup failure fatal |

## Continue with the package

- [cache](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-cache.md)
- [cache redis](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-cache-redis.md)
- [cache invalidation](/branch/v0.0.4/zeruxjs/docs/0.0.4/cache-invalidation.md)
- [cache streams](/branch/v0.0.4/zeruxjs/docs/0.0.4/cache-streams.md)


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
