---
{
  "title": "7. Turn a feature into a plugin",
  "description": "Register a small capability against the runtime API and identify its lifecycle owner.",
  "section": "Learning",
  "order": 70,
  "sources": [
    "apps/zerux-docs/src/lib/academy.mjs",
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zlocale/src/index.ts"
  ],
  "related": [
    "learn",
    "solutions",
    "glossary"
  ]
}
---

## Your goal

Add a route from a plugin, without starting a background service when a file is imported. Then explain how a reusable module differs from its host application.

## Register during application preparation

```ts title="plugins/status.ts"
import type { ZeruxPluginApi } from 'zeruxjs';

/** Register a small public feature. @param api Generation-scoped runtime API. @returns Nothing. No global state, environment reads, timers or I/O. */
export default function register(api: ZeruxPluginApi): void {
  api.addRoute({
    pattern: '/feature-status', method: 'GET',
    handler: () => ({ feature: 'status', enabled: true }),
  });
}
```

Use the default plugin directory or configure `structure.plugins` explicitly. Start the application and inspect `/feature-status` using the printed server URL. Plugin registration runs while preparing a runtime generation; it is not a request handler called for every visitor.

**Expected result:** the route returns the named feature. Importing the package should not open a database, start an interval or choose a global user language.

## Keep owned resources owned

A runtime **generation** is one prepared set of application resources. Development reloads may prepare a replacement generation. Unowned global timers, subscriptions or pools can outlive the code that created them and multiply across reloads.

Use managed startup workers/services for long-lived work, with explicit cleanup. Startup workers may return cleanup; ordinary plugin registration is not a general returned-disposer hook. See [workers](workers.md) and [service lifecycle](service-lifecycle.md) before adding a listener or connection.

## Share a contract, not a global application

A module can expose pure message functions or a registration function that receives the plugin API and a host-owned translator. The host chooses settings and request policy. Do not assume a nonexistent `i18n` managed service or reach into another package's private `src` files.

Use public export-map imports and document actual TypeScript parameters. A module path is not a permission boundary: plugin code is trusted application code, so review its dependencies and side effects.

## Add a small verification habit

Start with the public status route. Verify its path and response. Reload the application and ensure it does not multiply work. When adding a worker, verify cleanup and failed-startup behavior separately. Do not return an internal config/environment object as a health response.

## Try it yourself

Change the plugin route's response to include a second public field. Verify it survives a reload. List every resource your plugin owns; for this example the list contains only registration, with no timer/connection to clean up. Explain who would own a catalog loader or request-context facade if you added localization.

**You are done when:** you can distinguish plugin startup from request execution and explain the lifetime of everything you create.
