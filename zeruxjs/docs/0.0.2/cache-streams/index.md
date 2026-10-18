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


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
