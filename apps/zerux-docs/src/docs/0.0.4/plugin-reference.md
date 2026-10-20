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

## Complete declared contract

The following fields/methods are taken from the current source. Method signatures include their parameters; a type describes the interface and does not perform runtime validation or initialize an optional service.

### ZeruxPluginApi

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `service` | `service<T = unknown>(name: import("./services.js").ServiceName): T \| undefined;` | Yes | Get an initialized generation-scoped database/cache/files/analytics/email manager. |
| `variables` | `variables(): import('../variables.js').VariableRegistry;` | Yes | Template variables are isolated to this runtime generation. |
| `protocols` | `protocols(): import("../protocols.js").ZeruxProtocols;` | Yes | Register MCP, JSON-RPC, Connect, tRPC and SSE handlers before server startup. |
| `getLoadStatus` | `getLoadStatus(windowMs?: number): import("../metrics.js").ApplicationHttpStatus;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `addRoute` | `addRoute(route: RegisteredRouteInput): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `removeRoute` | `removeRoute(pattern: string, method?: string): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `addMiddleware` | `addMiddleware(name: string, middleware: MiddlewareFunction): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `removeMiddleware` | `removeMiddleware(name: string): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `addWorker` | `addWorker(name: string, worker: ZeruxWorkerInput): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `removeWorker` | `removeWorker(name: string): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `getWorker` | `getWorker(name: string): ZeruxWorker \| undefined;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `getWorkers` | `getWorkers(): ZeruxWorker[];` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `addThreadWorker` | `addThreadWorker(name: string, worker: ZeruxThreadWorkerInput): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `removeThreadWorker` | `removeThreadWorker(name: string): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `getThreadWorker` | `getThreadWorker(name: string): ZeruxThreadWorkerPool \| undefined;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `getThreadWorkers` | `getThreadWorkers(): ZeruxThreadWorkerPool[];` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `setComposable` | `setComposable(name: string, value: unknown): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `setController` | `setController(name: string, value: unknown): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `getConfig` | `getConfig(): ZeruxConfig;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `getStructure` | `getStructure(): ResolvedStructure;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |

### RegisteredRouteInput

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `pattern` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `method` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `handler` | `RouteHandler` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `middleware` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `meta` | `Record<string, unknown>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `source` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |

For strict application checking, option inference, public imports and unknown-data handling, read [TypeScript application development](typescript.md).
