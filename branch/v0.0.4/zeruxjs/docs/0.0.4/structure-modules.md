# Explicit module structure

Use registered controllers and providers without inventing file discovery.


## Registered code

`zeruxjs/modules` is an opt-in module/controller/provider API. It works through trusted plugin/entry registration; placing a file in an arbitrarily named folder does not register it. Inspect the public export map and module contracts before choosing this style.

Generation-singleton, request and transient providers have distinct ownership. Guards and schema input pipes run before provider resolution. Request resources live through response stream completion, then dispose. Plugin cleanup also runs when generation preparation fails. Exact route collisions and captive provider scopes reject.

## Limits

No decorators, package discovery, cross-generation container or browser-supplied registration code is inferred. Keep tenant authorization in verified server guards and underlying data queries. See [plugin API](/branch/v0.0.4/zeruxjs/docs/0.0.4/plugin-reference.md) for the registration entry and [request lifecycle](/branch/v0.0.4/zeruxjs/docs/0.0.4/request-lifecycle.md) for response ownership.


## Implementation sources

- [packages/zeruxjs/src/modules.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/modules.ts)
- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
