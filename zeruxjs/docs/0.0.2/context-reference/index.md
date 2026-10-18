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


## Implementation sources

- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/runtime.ts)
