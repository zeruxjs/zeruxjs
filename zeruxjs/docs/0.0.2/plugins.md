# Plugins

Register routes and resources against a generation-scoped API.


## Registration

A plugin exports a default registration function (register and plugin are also recognized). Plugins run during runtime creation. The optional application entry module can register additional resources.

```ts
import type { ZeruxPluginApi } from "zeruxjs";

/** Register health endpoint. @param api Runtime API. @returns Nothing. */
export default function register(api: ZeruxPluginApi) {
  api.addRoute({ pattern: "/health", method: "GET",
    handler: () => ({ ok: true }) });
}
```

## Available operations

The API registers and removes routes, middleware and workers; sets controllers and composables; reads config and structure; exposes services, protocols, template variables and load metrics. See API reference for exported runtime interfaces.

## Reload safety

Development stages a replacement runtime before activation. A failed rebuild or worker startup leaves the last activated runtime serving. Return cleanup functions from startup workers and release resources owned by the previous generation.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
