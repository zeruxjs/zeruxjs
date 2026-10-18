# Response API reference

Serialization, redirects, cache policies and bounded stream options.


## Normal return values

| Return | Runtime behavior |
| --- | --- |
| Object/array | JSON serialization |
| HTML-looking string | HTML content type and configured theme processing |
| Other string | Plain text |
| Buffer | Binary bytes |
| undefined | Empty response |
| redirect result | Status and Location |
| cached result | Cache policy applied before serializing its inner value |
| stream result | Disconnect-aware streaming with backpressure |

A Web Response requires the Fetch adapter; do not assume returning a Response from an ordinary file handler is equivalent to createFetchRoute.

## Redirects and errors

```ts
import { redirect, RedirectType } from 'zeruxjs/navigation';
import { HttpError } from 'zeruxjs';
```

`redirect(location, type?)` defaults to Temporary 307. Supported codes are 307, 308, 302 and 303. Validate user-selected destinations against your application allowlist to prevent open redirects. `HttpError(status, message, data?)` carries deliberate HTTP failure state; public data must be sanitized.

## ResponseCachePolicy

| Field | Behavior |
| --- | --- |
| visibility | public, private or no-store; private default |
| maxAge | Browser freshness seconds |
| sharedMaxAge | s-maxage, only emitted for public policy |
| staleWhileRevalidate | Stale-while-revalidate seconds |
| immutable / mustRevalidate | Additional cache directives |
| vary | Validated header field names, merged with existing Vary |
| etag | Strong content-derived validator for non-streaming payloads |

Age values must be safe integers from zero through one year. `cached(value, policy)` creates a wrapped result; `context.setCache(policy)` applies headers directly. Header mutation after headers are sent rejects. Never mark tenant/user-specific responses public.

## Stream options

`stream(source, options)` accepts iterable/async iterable strings or bytes and Node Readable sources. Options are status, headers, contentType and maxBytes. The byte ceiling is validated and enforced while sending. Streaming uses no-store/no-transform and cancellation; it is not a cacheable replay log. Handle producer errors and release owned upstream resources.

## HEAD and conditional requests

The runtime has explicit no-body handling for HEAD. ETag handling can produce 304 for matching GET/HEAD requests. Fetch endpoint helpers have their own status/header contracts; preserve them through the bridge instead of wrapping a completed Response in ordinary JSON.

## Complete declared contract

The following fields/methods are taken from the current source. Method signatures include their parameters; a type describes the interface and does not perform runtime validation or initialize an optional service.

### ResponseCachePolicy

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `visibility` | `'public' \| 'private' \| 'no-store'` | No | Defaults to private; public requires an explicit opt-in. |
| `maxAge` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `sharedMaxAge` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `staleWhileRevalidate` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `immutable` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `mustRevalidate` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `vary` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `etag` | `boolean` | No | Generate a content-derived strong ETag for non-streaming bodies. |

### ResponseStreamOptions

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `status` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `headers` | `Record<string, string>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `contentType` | `string` | No | Streaming responses are never implicitly cacheable. |
| `maxBytes` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |

For strict application checking, option inference, public imports and unknown-data handling, read [TypeScript application development](/branch/v0.0.4/zeruxjs/docs/0.0.3/typescript.md).


## Implementation sources

- [packages/zeruxjs/src/response.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/response.ts)
- [packages/zeruxjs/src/navigation.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/navigation.ts)
- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/runtime.ts)
