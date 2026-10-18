---
{
  "title": "Plugin API reference",
  "description": "Registration methods, service access and generation ownership.",
  "section": "API reference",
  "order": 30,
  "sources": [
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zeruxjs/src/bootstrap/runtime.ts"
  ],
  "related": [
    "plugins",
    "workers",
    "context-reference"
  ]
}
---

## Registration methods

| Method | Purpose |
| --- | --- |
| `addRoute(route)` | Register pattern, method, handler, middleware and optional metadata |
| `removeRoute(pattern, method?)` | Remove a registered method or route |
| `addMiddleware(name, handler)` / `removeMiddleware(name)` | Manage named middleware |
| `setController(name, value)` | Register a controller |
| `setComposable(name, value)` | Register a composable value |
| `addWorker`, `removeWorker`, `getWorker`, `getWorkers` | Startup worker definitions |
| `addThreadWorker`, `removeThreadWorker`, `getThreadWorker`, `getThreadWorkers` | Thread pools and task execution |

Register routes while creating the generation. The runtime seals routing before serving. Reserved service endpoint collisions are rejected rather than silently overriding application endpoints.

## Read-only application access

`getConfig()` and `getStructure()` inspect prepared configuration and resolved source structure. `service<T>(name)` returns an initialized manager typed by the application; a generic type assertion does not validate the underlying value. Handle disabled/degraded services explicitly.

## Protocols and variables

`protocols()` exposes registration for RPC/MCP/Connect/tRPC and SSE publication. `variables()` returns a generation-local template variable registry. Avoid global registration objects when data or secrets differ by application instance.

## Metrics

`getLoadStatus(windowMs?)` returns internal bounded metrics. Do not mount an anonymous route returning the whole plugin API or runtime. Expose only an allowlisted, authorized operational view.

## Plugin pattern

Keep registration synchronous where possible and await explicit preparation where required. Put long-lived services in workers with cleanup or framework-managed service slots. Avoid an unowned interval or database connection started by importing a module. See [workers](workers.md) for lifecycle-aware startup.
