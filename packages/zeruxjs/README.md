> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# ZeruxJS Framework

**ZeruxJS** is a next-generation, multi-engine meta-framework for Node.js designed to provide a unified developer experience regardless of your frontend choice.

## 🚀 Multi-Engine Support

ZeruxJS is engine-agnostic, allowing you to build applications using your favorite libraries while benefiting from a consistent backend and tooling layer:

- **Zyro**: Native integration with the ZyroJS Library for maximum performance.
- **React**: Full support for React components and hooks.
- **Vue**: Seamless integration with the Vue ecosystem.

## ✨ Key Features

- **Unified CLI**: A single command-line interface (`zcli`) to manage your entire lifecycle.
- **Advanced Server Orchestration**: Powered by `zsrv`, managing both app and dev servers with ease.
- **Hot-Module Replacement**: High-performance watching and reloading via `zwatch`.
- **Built-in Security**: Hardened by default with `@zeruxjs/security`.
- **Performance First**: Native support for Lighthouse reporting, Web-Vitals, and intelligent caching.

## 📦 Getting Started

The easiest way to start a new ZeruxJS project is using the official scaffolder:

```bash
npm create zerux-app@latest
```

## Runtime Workers and Thread Workers

Startup workers run after ZeruxJS finishes bootstrapping the runtime and before the HTTP server starts accepting requests. They are useful for background queues, schedulers, cache warmups, shared workers, and other services that must be ready before routes run.

Thread workers use Node.js `worker_threads` for CPU-heavy or isolated tasks. Set default thread limits in `zerux.config.ts`:

```ts
import type { ZeruxConfig } from "zeruxjs";

const zeruxConfig: ZeruxConfig = {
  worker: {
    minThreads: 1,
    maxThreads: 4
  }
};

export default zeruxConfig;
```

Register workers from a plugin or app entry file:

```ts
import { defineThreadWorker, defineWorker, type ZeruxPluginApi } from "zeruxjs";

export default (api: ZeruxPluginApi) => {
  api.addWorker("queue", defineWorker("queue", async ({ logger, state, env }) => {
    const queueUrl = env.QUEUE_URL;
    if (!queueUrl) {
      throw new Error("QUEUE_URL is required to start the queue worker.");
    }

    state.set("queue", { startedAt: new Date().toISOString() });
    logger.info("Queue worker started");

    return async () => {
      logger.info("Queue worker stopped");
    };
  }));

  api.addThreadWorker("math", defineThreadWorker("math", "workers/math.ts", {
    minThreads: 1,
    maxThreads: 2
  }));
};
```

Thread worker modules export a function:

```ts
export default function mathWorker(payload: { value: number }) {
  return {
    squared: payload.value * payload.value
  };
}
```

Use a thread worker from a route, middleware, or startup worker:

```ts
const math = context.runtime.asPluginApi().getThreadWorker("math");
const result = await math?.run({ value: 12 });
```

Worker helpers:

- `defineWorker(name, handler)`: creates a typed worker object.
- `registerWorker(api, name, worker)`: small helper around `api.addWorker`.
- `api.addWorker(name, worker)`: registers a worker directly.
- `api.removeWorker(name)`: removes a registered worker before startup.
- `api.getWorker(name)` and `api.getWorkers()`: inspect registered workers.
- `defineThreadWorker(name, script, options)`: creates a thread worker pool definition.
- `registerThreadWorker(api, name, worker)`: small helper around `api.addThreadWorker`.
- `api.addThreadWorker(name, worker)`: registers a Node.js worker thread pool.
- `api.getThreadWorker(name)` and `api.getThreadWorkers()`: inspect and run thread pools.

The startup worker handler receives `{ runtime, mode, config, structure, logger, env, state }`. Return a cleanup function when the worker owns intervals, sockets, queues, or other resources. In dev mode cleanup runs before the runtime is rebuilt, then the new worker set starts again. Thread pools are also stopped before dev reloads and restarted with the new runtime.

## Navigation

Use `zeruxjs/navigation` when a route handler or middleware needs to return an HTTP redirect:

```ts
import { redirect, RedirectType } from "zeruxjs/navigation";

export const GET = () => {
  return redirect("/dashboard", RedirectType.Temporary);
};
```

`RedirectType` includes `Temporary` (307), `Permanent` (308), `Found` (302), and `SeeOther` (303).

## Multisite Routing

Enable request-scoped multisite routing in `zerux.config.ts`:

```ts
import type { ZeruxConfig } from "zeruxjs";

const zeruxConfig: ZeruxConfig = {
  multisite: true
};

export default zeruxConfig;
```

Register host and path mappings from middleware:

```ts
export default async (context, next) => {
  context.multisiteRegister("*", "main");
  context.multisiteRegister("meow.com", "main");
  context.multisiteRegister("meow.com/apple/cat", "cat");
  context.multisiteRegister("meow.com/apple", "apple");

  await next();
};
```

Use `*` as the host to match any incoming host for that registration, such as local IPs, localhost, or temporary domains. Exact hosts still take priority over wildcard hosts when the path specificity is the same. Zerux sorts registrations by path depth before matching, so `meow.com/apple/cat` is checked before `meow.com/apple`. A match rewrites the internal route pathname to the selected root app folder segment. For example, `meow.com/apple/api/health` with folder `apple` routes through `app/{apple}/api/health/route.ts`.

When multisite is enabled and middleware registers mappings, requests that do not match any mapping are not allowed to fall through into root dynamic routes. This keeps an explicit mapping such as `meow.com` from accidentally serving an unrelated host like `cat.com/something`.

## Protocol registration, cache control, streams and load metrics

ZeruxJS now integrates the ZSRV protocol gateway without importing ZSRV's CLI/dev server. In your application's entry module or plugin registration function:

```ts
import { cached, stream, type ZeruxPluginApi } from 'zeruxjs';

export default function register(api: ZeruxPluginApi) {
  const protocols = api.protocols();
  protocols.rpc('math.add', params => (params as {a:number,b:number}).a + (params as {a:number,b:number}).b);
  protocols.tool('echo', 'Returns a message', {type:'object',properties:{text:{type:'string'}}}, ({text}) => text);
  protocols.connect('Messages', 'Ping', input => input);
  protocols.trpc('health.ping', () => ({ ok: true }));
  // Publish to connected SSE clients at /events: protocols.publish('update', { status: 'ready' });

  api.addRoute({ pattern: '/catalog', method: 'GET', handler: () =>
    cached({ products: [] }, { visibility: 'public', maxAge: 30, etag: true, vary: ['Accept-Language'] })
  });
  api.addRoute({ pattern: '/export', method: 'GET', handler: () =>
    stream((async function* () { yield 'first\n'; yield 'second\n'; })(),
      { contentType: 'text/plain', maxBytes: 1024 * 1024 })
  });
  api.addRoute({ pattern: '/upload', method: 'POST', meta: { streamBody: true },
    handler: async (ctx) => {
      let bytes = 0;
      for await (const part of ctx.requestStream) bytes += part.length;
      return { bytes };
    }
  });
  // Read metrics internally: api.getLoadStatus(30_000).
  // Expose them only behind your own authorization middleware.
}
```

`/rpc`, `/mcp`, `/events`, `/trpc/<name>`, and registered Connect endpoints are routed through the gateway before file routes or the normal 1 MiB buffered-body parser. **They are local-only by default**, and requests containing proxy forwarding headers are rejected unless `protocols.authorize` explicitly authorizes them. For deployments behind ZSRV/Nginx, configure authentication and trusted proxy controls yourself (do not trust `X-Forwarded-*` blindly). Limit `protocols.allowedOrigins` for cross-origin browser clients. MCP provides tools/resources and JSON transport subset, not the complete MCP transport surface.

`cached(payload, policy)` sets HTTP cache headers and optionally a content SHA-256 ETag. `Cache-Control: public` is an explicit decision: never use it for user-specific responses. `ctx.setCache(policy)` allows routes to manage response headers directly. `stream(...)` streams with backpressure, client-disconnect cancellation, byte ceilings and `no-store, no-transform`; for SSE use `api.protocols().publish` with the built-in replay-capable `/events` endpoint.

`api.getLoadStatus(windowMs)` and `runtime.getLoadStatus(windowMs)` expose bounded in-memory request counts, 1xx–5xx status families, HTTP versions, concurrency and latency. Nothing is publicly served automatically.

## Fetch handlers and content integration (Section 39)

```ts
import { registerFetchRoutes } from 'zeruxjs/fetch-route';
import { createSearchHandler } from '@zeruxjs/search/http';
import { createCrawlerRoutes } from '@zeruxjs/seo/fetch';

export default (api) => {
  registerFetchRoutes(api, [
    { pattern: '/search', handler: createSearchHandler({ index: searchIndex }) },
    ...createCrawlerRoutes({ origin: 'https://example.com', entries: () => sitemapEntries })
  ]);
};
```

Fetch-compatible handlers are registered with the existing plugin API. The adapter streams request/response bodies without mandatory buffering, preserves HTTP statuses and safe end-to-end response headers, and propagates disconnect cancellation. This adapter does **not** automatically authorize new routes; configure middleware, visibility and allowed domains. Use `registerFetchRoutes` after loading the endpoint packages, or `createFetchRoute` to wrap an individual handler.

### Development reload behavior

Development rebuilds now stage new handlers and startup workers before switching the running HTTP handler. If the new application fails to build or start, the last successfully activated runtime stays available. `dev.json` includes the latest `reload` state and error message for diagnostics. Runtime manifests and snapshots use atomic private writes. Workers are rolled back after partial startup failures and thread-pool tasks are rejected during shutdown.

## Application build and runtime-managed services (Section 42)

`zerux build` stages compiled TypeScript/JavaScript routes, handlers, plugins and public assets under `.zerux/build`. On successful completion, `zerux start` uses the build manifest and compiled folders; `zerux dev` continues to use the working sources. A failed build leaves the last good build untouched. Build output is restricted to this project and refuses symbolic links. Run a separate typecheck and install dependencies before production use.

Optional `config.files`, `config.analytics` and `config.email` configure generation-scoped managers after database and cache initialization. Use `api.service('files')`, `api.service('email')` and `api.service('analytics')` inside application plugins, or `context.services.get('files')` in request handlers. Manager resources close in reverse initialization order after requests from the prior generation finish. Analytics remains best-effort and email tracking remains opt-in per send.

See `SECTION_42_BUILD_LIFECYCLE_INTEGRATION.md` at the project root for configuration and known limitations.

## Section 78: accessible frontend progressive enhancement

`zeruxjs/accessibility` exposes `bindAccessibleTabs(tabList)` and `prefersReducedMotion()`. It is safe to **import on the server** (DOM globals are only read inside browser-only functions). For tabs, author actual buttons under `role="tablist"`, give each a unique ID and `aria-controls` pointing to a `role="tabpanel"` element whose `aria-labelledby` points back. The binder enforces matching references, disabled tabs, roving tab index, focus and arrow/Home/End keyboard operation; call `destroy()` on route unmount. Orientation and RTL handling can be supplied explicitly. It never overwrites arbitrary HTML or dynamically generates IDs.

A browser fixture (under `tests/browser/`) covers bridge snapshot projection, explicit subscription teardown, keyboard focus, ARIA panel selection and reduced-motion styles. Run `npm run test:frontend`; opt into live Chromium checks with `npm run test:frontend:browser` when a functioning browser is installed. This does not certify standalone ZyroJS or Zuix; see Sections 81 and 82.
