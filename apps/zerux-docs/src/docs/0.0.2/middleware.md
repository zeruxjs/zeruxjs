---
{
  "title": "Middleware and controllers",
  "description": "Share request logic without coupling it to a page.",
  "section": "Fundamentals",
  "order": 50,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "introduction",
    "deployment"
  ]
}
---

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

## Type the actual middleware contract

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
type Middleware = Parameters<ZeruxPluginApi['addMiddleware']>[1];
const timing: Middleware = async (context, next) => {
  const started = performance.now();
  try { await next(); }
  finally { context.state.durationMs = performance.now() - started; }
};
```

A finally block runs for downstream success and failure. Store per-request values on context.state; a module variable can mix simultaneous users. Call next once, await it, and avoid writing a second response after a downstream handler has already completed the response.

## Authentication is a server boundary

Resolve and validate the session before accessing a private service or controller. Then authorize the specific tenant/resource/action; an authenticated user is not automatically an administrator. A public browser header or hidden UI link is not a principal. See [authentication/security setup](configuration-auth-security.md) for what is and is not initialized automatically.

Apply body/CSRF/origin policy before unsafe side effects. When integrating a Fetch handler, keep Web Request headers separate from Node IncomingMessage headers. Return a deliberate error through the standard runtime path rather than swallowing failures and continuing with an undefined identity.

## Controllers, composition and cleanup

Controller/composable registration shares code, not permission. A reused controller must receive the already validated context or explicit trusted inputs. Avoid ambiguous basenames in discovery registries and avoid construction of per-request resource pools inside a controller.

Test middleware ordering, early rejection, thrown downstream errors and concurrent requests. If middleware starts timers/listeners, identify who owns teardown. A request completion hook does not replace generation-level service shutdown. The [request lifecycle](request-lifecycle.md), [plugins](plugins.md) and [service lifecycle](service-lifecycle.md) explain the distinct owners.
