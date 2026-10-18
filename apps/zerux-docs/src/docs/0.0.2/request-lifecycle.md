---
{
  "title": "Request lifecycle",
  "description": "Understand dispatch order, middleware scope, body parsing and handler ownership.",
  "section": "Fundamentals",
  "order": 25,
  "sources": [
    "packages/zeruxjs/src/bootstrap/runtime.ts",
    "packages/zeruxjs/src/fetch-route.ts"
  ],
  "related": [
    "routing",
    "middleware",
    "fetch-handlers"
  ]
}
---

## Dispatch order

The order in the current HTTP runtime matters:

1. Begin bounded request metrics and check allowed hosts.
2. Give enabled protocol gateway endpoints a chance to handle the request.
3. Serve matched public assets.
4. Determine whether the application route needs a streamed body; otherwise parse the bounded body.
5. Create `ZeruxRequestContext` with fresh request state.
6. Execute global middleware and apply multisite registrations.
7. Resolve the route/method, attach params, and execute its middleware and handler.
8. Serialize the result or route a thrown error through exception handling.

Public assets and gateway endpoints are not ordinary application route handlers. A global middleware check is therefore not a universal security perimeter. Gate gateway endpoints through protocol authorization and never put confidential files in `public/`.

## Request state and shared state

`context.state` is a fresh object for one request. Controllers, plugin-created objects and module globals can be shared by many requests in a process. Store authenticated identity in request state after verification, not in a mutable singleton.

## Route middleware

Export `middleware` as registered middleware keys on a route, or provide them in a plugin route registration. Global middleware comes from configured middleware directories. Call `await next()` once to continue. Avoid sending a response and then continuing to a second writer.

## Buffered and streamed bodies

The default body reader bounds application requests. JSON content is parsed; other buffered content becomes text. A route with `meta.streamBody` gets the original request stream instead. Once a stream is consumed it cannot be read again. Use the Fetch adapter for package HTTP helpers rather than mixing two body readers.

Multisite routing has special streamed-body constraints because the final application route may be selected after middleware. Do not assume all upload routes keep their pre-match metadata under host/path rewrites; verify the target deployment and use explicit endpoint registration.

## Output ownership

Return serializable payloads for normal handlers. `createFetchRoute` owns sending its Fetch response. If trusted custom code writes directly to `context.res`, it must finish or abort correctly and avoid returning a second payload. Disconnect-aware streaming is preferable to manually accumulating large output.

## Error boundaries

Throw `HttpError(status, message, data?)` for intentional HTTP failures. Avoid putting stack traces, raw SQL, credentials or rejected request payloads in public error data. Log sanitized diagnostics internally.
