# Fetch-compatible handlers

Bridge Web Request/Response handlers into the Zerux request lifecycle.


Many ecosystem packages expose handlers accepting a standard Web `Request` and returning a `Response`. Register them explicitly with the framework adapter.

## Register a handler

```ts title="plugins/http.ts"
import { registerFetchRoutes } from 'zeruxjs/fetch-route';
import type { ZeruxPluginApi } from 'zeruxjs';

/** Register a Web API endpoint. @param api Runtime registration API. @returns Nothing. No globals. */
export default function register(api: ZeruxPluginApi) {
  registerFetchRoutes(api, [{
    pattern: '/api/ping',
    handler: () => Response.json({ ok: true }, {
      headers: { 'cache-control': 'no-store' }
    })
  }]);
}
```

`registerFetchRoutes` registers an `ALL` route and marks its body as streamed. Your Fetch handler must enforce its supported methods. Ecosystem endpoint factories generally do this; a handwritten handler should return 405 with an Allow header for unwanted methods.

## Access the runtime context

The handler receives `(request, context)`. Use the second argument for route params, authenticated request state and services. The adapter uses a neutral local origin for the Web Request URL; do not derive a public canonical domain or trusted tenant from that synthetic origin.

## Wrap one route

`createFetchRoute(handler)` returns a normal Zerux route handler. When using it in a file module that accepts uploads, export `meta = { streamBody: true }` so a buffered parser does not consume the stream first.

```ts title="app/api/ping/route.ts"
import { createFetchRoute } from 'zeruxjs/fetch-route';
export const meta = { streamBody: true };
export const GET = createFetchRoute(() => Response.json({ ok: true }));
```

## Streaming and cancellation

The bridge converts Node request bodies to Web streams and pipes response bodies back with backpressure. Disconnect cancellation propagates to the pipeline. Hop-by-hop response headers are removed. HEAD, 204 and 304 do not send response bodies.

## Compose package endpoints

Use this adapter for validator handlers, search HTTP handlers, feed endpoints, crawler routes and file responses. It preserves their status/header contracts; it does not provide authentication, tenant binding, rate limiting or write permission. Configure those policies before exposing a route.


## Implementation sources

- [packages/zeruxjs/src/fetch-route.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/fetch-route.ts)
