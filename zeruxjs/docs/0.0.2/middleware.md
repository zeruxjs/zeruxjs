# Middleware and controllers

Share request logic without coupling it to a page.


## Global middleware

Middleware discovered in configured middleware folders runs globally. Call and await next() to continue the chain. Keep per-request data in context.state rather than a module-level mutable object.

```ts
import type { ZeruxRequestContext } from "zeruxjs";

/** Add request state. @param context Request context. @param next Next handler. @returns Completion. */
export default async function middleware(context: ZeruxRequestContext, next: () => Promise<void>) {
  context.state.startedAt = Date.now();
  await next();
}
```

## Controllers and composables

The loader registers modules by their relative key and basename. A route can reference a controller export, and request handlers can use context.services.controllers and context.services.composables. Prefer distinct basenames to avoid ambiguous registrations.

## Authorization

Authorize sensitive operations before the handler accesses private data. Returning a UI page or hiding a navigation link does not protect a route. Do not trust user-controlled headers as an identity.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
