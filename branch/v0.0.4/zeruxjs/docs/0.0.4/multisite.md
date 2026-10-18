# Multisite

Resolve hosts and path prefixes into application folders.


## Enable mappings

Set multisite: true in configuration, then register mappings from middleware using context.multisiteRegister(hostAndPath, folder). More-specific path prefixes match first. Exact hosts take priority over wildcard hosts at equal specificity.

## Request mapping

A mapping example.com/shop to shop resolves example.com/shop/api/health against app/shop/api/health/route.ts. Use * to register a host wildcard. Unmatched hosts do not fall through into unrelated root dynamic routes when mappings are registered.

## Tenant boundaries

Host routing chooses an application folder. It does not replace database tenant filters, authentication, authorization or a trusted proxy configuration.

## Separate routing from data authorization

A host/path mapping selects application content; it does not select a trusted tenant automatically. Resolve the tenant from an authenticated/server-verified mapping and enforce its data scope independently. Never pass an arbitrary query field as a folder name, storage prefix or database slug just because multisite routing is enabled.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  multisite: true,
  server: { allowedDomains: ['app.example.com', '*.tenant.example.com'] },
} satisfies ZeruxConfig;
```

The wildcard does not include the apex automatically. Host policy, routing mappings and service data isolation are three separate checks. A single runtime can share infrastructure across sites, but each database/file/cache operation must still use the appropriate verified scope.

## Register trusted mappings

Use the runtime's documented mapping registration with application-owned URL/folder constants. Registration is not a dynamic filesystem browser. Review folder discovery and path semantics in the actual deployed project; adding a domain does not create DNS, TLS or a reverse-proxy entry.

## TypeScript and tests

The public request context describes multisiteRegister; use the real context type rather than a custom object with unchecked any fields. A typecheck cannot prove an external hostname maps to the intended tenant. Test exact hosts, wildcard subdomains, unknown hosts, malformed authority, overlapping mappings and cross-tenant resource IDs.

Include cache-key/asset-prefix scope in those tests. A cached response for one site must not be returned to another site simply because both hit the same route pattern. See [tenant data](/branch/v0.0.4/zeruxjs/docs/0.0.4/tenant-data.md) for database restrictions and [server configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-server.md) for hostname matching behavior.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
