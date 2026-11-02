# Routing

Map files and HTTP methods to request handlers.


## File conventions

app/page.ts maps to /. app/api/health/route.ts maps to /api/health. Directory parameters such as app/blog/[slug]/page.ts become named route parameters. A [...path] segment captures the remaining path. Reserved layout/loading/template/error names do not provide a React-style layout engine.

## HTTP handlers

Export GET, POST and other method handlers, or a default handler. The request context exposes params, query, body, state, config, logger and services.

```ts
import type { ZeruxRequestContext } from "zeruxjs";

/** Return the requested slug. @param context Request context. @returns JSON payload. */
export function GET(context: ZeruxRequestContext) {
  return { slug: context.params.slug, query: context.query.get("q") };
}
```

## Explicit routes

A module may export routePath or path to override its inferred path. Plugins can register routes through api.addRoute. Static path segments sort ahead of competing dynamic paths.

## Request bodies

Normal requests use the buffered body parser with a bounded size. Upload routes that need streaming must explicitly export meta = { streamBody: true } and consume context.requestStream with their own limits.

## Design the request contract first

Choose methods, input limits, authentication, status codes and response caching before writing a handler. A route parameter is a string from an untrusted URL, not a validated database key. Query parameters can repeat; use URLSearchParams deliberately rather than assuming one scalar value per name.

```ts title="app/api/items/[id]/route.ts"
import { HttpError, type ZeruxRequestContext } from 'zeruxjs';
export function GET(context: ZeruxRequestContext) {
  const id = context.params.id;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, 'Invalid item identifier');
  const limitText = context.query.get('limit') ?? '20';
  const limit = Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'Invalid limit');
  return { id, limit };
}
```

This validates format, not ownership. Resolve the authenticated principal and authorize the item before reading private data. Do not place a complete service config or environment object in the returned JSON.

## Buffered versus streamed bodies

Ordinary handlers use the runtime's bounded buffered parser. If a route exports streamBody metadata, consume the original request stream exactly once under an explicit byte/time/cancellation policy. Do not attempt a buffered parse and then expect the original bytes to remain unread. Fetch adapters operate on Web Request; the route context also exposes Node request/response objects with different APIs.

## Ambiguity, errors and production verification

Static paths win against competing dynamic paths, but avoid overlapping registrations that depend on subtle ordering. Explicit path overrides and plugin routes need the same method and authorization review as file routes. Test a wrong method, malformed parameter, repeated query, oversized body, deliberate HttpError and an unknown path.

TypeScript context types document fields but do not narrow body from unknown automatically. Use schema parsing or explicit guards, and test the compiled route after build. Reserved layout/loading/template names are not proof of a component renderer or automatic frontend loading state.

## Opt-in progressive navigation

`api.navigationManifest({ basePath, assets, boundaries })` projects only actual
GET/ALL routes with `meta.navigation`. Public IDs, parameter patterns, structural
layout IDs and manifest-selected client assets share the server's matcher; handlers,
source paths and arbitrary metadata stay private. The optional
`zeruxjs/browser-navigation` entry consumes that snapshot and the normal authorized
HTML response. It does not create an alternative authentication layer.

Marked documents identify the route, opaque current principal/session scope and
host shell-policy generation. Scope/policy mismatch, authorization denial or an
incompatible response falls back to ordinary document navigation. Links remain
usable without JavaScript. Eligible clicks, history, hash anchors, focus/scroll and
polite announcements are managed explicitly; form submission remains native.
Common structural layouts may retain their outlets, while optional authored page
modules hydrate only detached page roots and own cleanup. Route splitting and
bounded asset-only intent prefetch use emitted manifest URLs/integrity, never
inferred filenames. Loader memoization is navigation/scope-local and never bypasses
server reauthorization. See the framework README's complete public-import example,
limits, module-loader ownership and real-browser qualification limits.


## Explicit server mutations

`zeruxjs/actions` allowlists server callbacks; arbitrary exports and client directives
never create remote functions. Every POST checks verified principal/tenant permission,
configured origin, session-bound CSRF and validator schemas. The initial transport
accepts bounded URL-encoded forms, rejects duplicate fields and permits zero files.
Native forms receive a sanitized error or a post-commit 303. The optional
`zeruxjs/action-form` enhancement owns pending buttons, disposable ARIA feedback,
error focus and explicit optimistic rollback without automatic retries.

Protected writes require a host-provisioned durable unique-key journal.
`zeruxjs/action-stores` consumes real database pins; its separate `/sqlite` helper
keeps SQLite writes synchronous. A durable claim precedes the business transaction,
whose completion record shares the write's connection/session. Pending/uncertain
claims stay blocked, including after a lost acknowledgement. Freshly authorized
committed replays rerun only idempotent revalidation. Signed keys expire, and journal
retention includes the declared clock-skew bound. Cache invalidation runs after
confirmed persistence; a committed invalidation failure is distinct from an uncertain
write. External effects still need an outbox/reconciler. See the framework README's
public-import plugin, journal prerequisites and browser/live-backend limits.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
