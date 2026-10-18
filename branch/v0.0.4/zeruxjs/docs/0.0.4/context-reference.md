# Request context reference

The request-scoped fields and helpers passed to handlers and middleware.


## Identity, URL and payload

| Property | Contract |
| --- | --- |
| `req`, `res` | Node IncomingMessage and ServerResponse; direct access is server-only |
| `method` | Normalized HTTP method |
| `url` | Parsed URL, updated by multisite rewrite where applicable |
| `pathname` | Internal route pathname |
| `params` | Matched route parameters; do not assume populated before route selection |
| `query` | URLSearchParams; validate before use |
| `body` | Buffered parsed body, or request stream for a streaming route |
| `requestStream` | Original request stream; single consumption |

## Request state

`state` is request-local mutable state. `env` is the process environment and must never be serialized wholesale. `config` is runtime configuration after private service redaction. `logger` is the runtime logger, not automatic log redaction.

```ts
import type { ZeruxRequestContext } from 'zeruxjs';

/** Read a bounded pagination query. @param context Request query. @returns Validated page size. No globals. */
export function GET(context: ZeruxRequestContext) {
  const raw = context.query.get('limit') ?? '20';
  const limit = Math.min(100, Math.max(1, Number(raw) || 20));
  return { limit };
}
```

## Services and runtime

`services.get(name)` returns a generation-scoped initialized manager or undefined. `services.controllers` and `services.composables` expose discovered modules. `runtime` gives trusted server code the runtime object; it is not a public response model.

## Response helpers

`setCache(policy)` applies cache headers. `stream(source, options)` creates the bounded streaming result. `multisiteRegister(url, folderName)` registers request mappings when multisite is enabled. Return payloads through the handler contract rather than exposing these objects to the client.

## Stability and ownership

Do not retain an entire context in a background job: it carries sockets, environment values and generation-scoped managers. Persist a minimal authorized identifier and resolve current services in the designated worker. For Fetch handlers, request and runtime context are separate arguments.

## Complete declared contract

The following fields/methods are taken from the current source. Method signatures include their parameters; a type describes the interface and does not perform runtime validation or initialize an optional service.

### ZeruxRequestContext

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `req` | `IncomingMessage` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `res` | `ServerResponse` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `method` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `url` | `URL` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `pathname` | `string` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `params` | `Record<string, string>` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `query` | `URLSearchParams` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `body` | `unknown` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `requestStream` | `IncomingMessage` | Yes | Original request stream; use route.meta.streamBody to prevent pre-buffering. |
| `setCache` | `setCache(policy: import("../response.js").ResponseCachePolicy): void;` | Yes | Cache policy for the current response; defaults to private when explicitly called. |
| `stream` | `stream(source: import("../response.js").StreamResult['source'], options?: import("../response.js").ResponseStreamOptions): import("../response.js").StreamResult;` | Yes | Convenience factory for a bounded streaming response. |
| `multisiteRegister` | `multisiteRegister(url: string, folderName: string): void;` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `logger` | `Logger` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `config` | `ZeruxConfig` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `runtime` | `ZeruxRuntime` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `state` | `Record<string, unknown>` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `env` | `NodeJS.ProcessEnv` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `services` | `{ get(name: import("./services.js").ServiceName): unknown; controllers: Record<string, unknown>; composables: Record<string, unknown>; }` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |

For strict application checking, option inference, public imports and unknown-data handling, read [TypeScript application development](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).


## Implementation sources

- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/runtime.ts)
