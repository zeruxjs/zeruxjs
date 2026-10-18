# Caching and streaming

Control cache semantics and large responses explicitly.


## HTTP caching

cached(payload, policy) can set visibility, maxAge, ETag and Vary. A public cache policy must never be applied to personalized data. context.setCache sets policy directly.

```ts
import { cached } from "zeruxjs";
export const GET = () => cached({ products: [] }, {
  visibility: "public", maxAge: 30, etag: true, vary: ["Accept-Language"]
});
```

## Streaming

stream(source, options) accepts a bounded stream source and handles backpressure and client disconnects. Streaming responses use no-store, no-transform. Set contentType and maxBytes deliberately.

```ts
import { stream } from "zeruxjs";
export const GET = () => stream((async function* () {
  yield "first\n";
  yield "second\n";
})(), { contentType: "text/plain", maxBytes: 1048576 });
```

## Uploads

For route.meta.streamBody, consume requestStream incrementally, track total bytes and reject excess input. Do not first accumulate the whole request into memory.

## Design privacy before freshness

A response cache policy answers who may reuse a representation and for how long. A manager cache stores application values; it does not by itself configure HTTP headers. Keep authenticated and public responses separate, and do not reuse a public cache key for user-specific content.

```ts
import type { ZeruxRequestContext } from 'zeruxjs';
export function GET(context: ZeruxRequestContext) {
  context.setCache({ visibility: 'no-store' });
  return { message: 'This response must not be stored by HTTP caches.' };
}
```

The precise cache policy names are versioned API; use the exported type and the [response reference](/zeruxjs/docs/0.0.3/response-reference.md) before adapting this pattern. Conditional requests and an ETag still need the same authorization check as an uncached request. Never let an If-None-Match shortcut reveal the existence of another tenant's private object.

## Stream ownership and cancellation

Use the runtime's bounded stream factory with an iterable/stream source. Keep maximum bytes, cancellation, content type and error handling explicit. A client disconnect should stop downstream work rather than leave a file read or model stream consuming resources. Once headers are sent, a later failure cannot reliably become an unrelated JSON response.

TypeScript can describe StreamResult and response options, but it does not measure emitted bytes or enforce a missing upload quota. Test empty streams, early cancellation, an upstream error, a source that exceeds its limit and a HEAD request through the real HTTP path. For private binary files use the media/files response helpers with their authorization and range policies.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
