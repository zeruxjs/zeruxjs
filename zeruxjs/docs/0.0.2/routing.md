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


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
