# zeruxjs

ZeruxJS is a Node.js application framework with file-based routing, middleware, plugin registration, runtime services, startup workers and worker-thread pools. Its hosting and protocol integration uses `zhost`; shared commands, file watching and development tools use `zclivo`, `zlook` and `zforge`.

## Getting started

Use the repository's [installation guide](../../apps/zerux-docs/src/docs/0.0.4/installation.md) and [tutorial](../../apps/zerux-docs/src/docs/0.0.4/tutorial.md), or inspect `apps/zeruxjs-app` for a development example. `zclivo create` provides a minimal starter. The separate `create-zerux-js` CLI now supplies validated HTML-only SSR starters.

React/Vue observable adapters are available as separate packages. Opt-in static renderer factories are described below; the state adapters do not install UI runtimes or a general SSR hydration pipeline. Configure authentication, trusted proxies and service credentials explicitly for each application.

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

ZeruxJS now integrates the ZHOST protocol gateway without importing ZHOST's CLI/dev server. In your application's entry module or plugin registration function:

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

`/rpc`, `/mcp`, `/events`, `/trpc/<name>`, and registered Connect endpoints are routed through the gateway before file routes or the normal 1 MiB buffered-body parser. **They are local-only by default**, and requests containing proxy forwarding headers are rejected unless `protocols.authorize` explicitly authorizes them. For deployments behind ZHOST/Nginx, configure authentication and trusted proxy controls yourself (do not trust `X-Forwarded-*` blindly). Limit `protocols.allowedOrigins` for cross-origin browser clients. MCP provides tools/resources and JSON transport subset, not the complete MCP transport surface.

`cached(payload, policy)` sets HTTP cache headers and optionally a content SHA-256 ETag. `Cache-Control: public` is an explicit decision: never use it for user-specific responses. `ctx.setCache(policy)` allows routes to manage response headers directly. `stream(...)` streams with backpressure, client-disconnect cancellation, byte ceilings and `no-store, no-transform`; for SSE use `api.protocols().publish` with the built-in replay-capable `/events` endpoint.

`api.getLoadStatus(windowMs)` and `runtime.getLoadStatus(windowMs)` expose bounded in-memory request counts, 1xx–5xx status families, HTTP versions, concurrency and latency. Nothing is publicly served automatically.

## Fetch handlers and content integration

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

## Application build and runtime-managed services

`zerux build` stages compiled TypeScript/JavaScript routes, handlers, plugins and public assets under `.zerux/build`. On successful completion, `zerux start` uses the build manifest and compiled folders; `zerux dev` continues to use the working sources. A failed build leaves the last good build untouched. Build output is restricted to this project and refuses symbolic links. Run a separate typecheck and install dependencies before production use.

Optional `config.files`, `config.analytics` and `config.email` configure generation-scoped managers after database and cache initialization. Use `api.service('files')`, `api.service('email')` and `api.service('analytics')` inside application plugins, or `context.services.get('files')` in request handlers. Manager resources close in reverse initialization order after requests from the prior generation finish. Analytics remains best-effort and email tracking remains opt-in per send.

## Accessible frontend progressive enhancement

`zeruxjs/accessibility` exposes `bindAccessibleTabs(tabList)` and `prefersReducedMotion()`. It is safe to **import on the server** (DOM globals are only read inside browser-only functions). For tabs, author actual buttons under `role="tablist"`, give each a unique ID and `aria-controls` pointing to a `role="tabpanel"` element whose `aria-labelledby` points back. The binder enforces matching references, disabled tabs, roving tab index, focus and arrow/Home/End keyboard operation; call `destroy()` on route unmount. Orientation and RTL handling can be supplied explicitly. It never overwrites arbitrary HTML or dynamically generates IDs.

A browser fixture (under `tests/browser/`) covers bridge snapshot projection, explicit subscription teardown, keyboard focus, ARIA panel selection and reduced-motion styles. Run `npm run test:frontend`; opt into live Chromium checks with `npm run test:frontend:browser` when a functioning browser is installed. Standalone ZyroJS and Zuixs have separate test suites.

## Project generator

[`create-zerux-js`](../create/create-zerux-app/README.md) generates private ZyroJS (default), React or Vue HTML-only SSR projects through the shared zclivo engine, with explicit flags/dry-run and no automatic install/start. Browser hydration and registry/source-version qualification remain separate; see its README.


## Validated configuration and custom services

`resolveApplicationConfig({ defaults, file, environment, overrides })` merges in that order: later defined values win, plain objects merge recursively, and arrays replace. `loadConfig(rootDir, mode, layers)` chooses the first existing `.ts`, `.js`, `.mjs`, `.cjs` configuration file; CLI port overrides are applied before validation. Runtime defaults then fill omitted values. Environment layers are explicit typed values, not automatic coercion of `process.env`. The existing env loader preserves process values and uses first-defined values across its ordered env files.

Loading, building and service startup validate framework-owned shapes before calling connector factories. Unknown root/core service keys and unregistered `services` namespaces fail. Migrate ad hoc root settings into a registered namespace, or into `publicSettings` only when intentionally public. Invalid enabled report/dashboard authorization now fails preflight instead of waiting for optional startup degradation. Provider-specific option semantics remain the owning package's responsibility. Configuration modules, schemas and service factories are trusted executable code; schemas should be pure and may run more than once.

```ts
import { defineService, createApplicationLifecycle } from 'zeruxjs';
import { object, string } from '@zeruxjs/validator/schemas';

const greeting = defineService({
  name: 'custom:greeting', namespace: 'greeting',
  schema: object({ label: string() }),
  reloadable: ['label'], publicFields: ['label'],
  start({ settings, signal, onDispose }) {
    // Register cleanup immediately after acquiring any resource.
    onDispose(() => { /* release this instance's resources */ });
    return { value: { label: settings.label, signal } };
  }
});
const app = await createApplicationLifecycle({
  rootDir: process.cwd(),
  config: { serviceDefinitions: [greeting],
    services: { greeting: { settings: { label: 'Hello' } } } }
});
try {
  console.log(app.runtime().serviceScope.get('custom:greeting'));
} finally {
  await app.close();
}
```

Install the optional schema package explicitly when using this example. Any compatible Standard Schema v1 object can be supplied; schema types remain owned by its package. Definitions are explicitly registered before runtime plugins load; there is no package discovery. `dependencies` names built-ins or `custom:*` services; cycles and missing declarations fail before initialization. Factories can access only declared dependencies through `get`. Configured namespaces default to enabled; absent namespaces are disabled. `required` defaults to true; false records degraded status on failure. Dependencies must be ready. Settings must validate to a bounded JSON object; private clients, credentials and callbacks belong in `privateOptions`.

`publicFields` selects JSON settings for browser manifests. `publicSettings` is an explicit application-owned JSON projection. Credentials, private options, callbacks and worker metadata are excluded; sensitive key names are rejected in public projections. Hosts must never deliberately publish secrets under innocent field names. Raw causes are available internally through scope `errors()` or thrown errors; public reload status uses generic diagnostics. The legacy `redactManifestConfig` helper remains available internally for compatibility, but runtime manifests use the explicit projection.

Factories return `{ value, dispose?, routes? }`; absent `dispose`, a value's `close()` is used. `onDispose` callbacks run in reverse registration order after the instance disposer, including failed startup, and its signal is aborted first. Return cleanup or register it immediately: arbitrary promises cannot be forcibly cancelled. Route registration retains the existing overlap and authorization boundaries. Custom services initialize sequentially in dependency order (maximum 64) and close before their dependencies. Optional failures retain internal causes and do not grant dependent services access to unavailable instances.

`createApplicationLifecycle` owns handlers and service generations; it does not bind a server, start worker entrypoints, or restart applications. Route hosts through `handle`, and call `close` to drain requests and release services. `reload(config)` validates and stages a complete replacement before activation; failed preparation leaves the old generation usable. Only explicitly listed top-level custom settings fields are reloadable. Built-in options, private options, enabled state and executable definitions require an explicit manual restart (`RestartRequiredError.fields`). Reuse the same definition objects across programmatic reloads; newly evaluated executable definitions are conservatively restart-required. The CLI applies the same checks during development rebuilds. Database/cache global compatibility APIs publish at activation; staged managers must expose their non-publishing `create*Manager` factory. Prefer scoped services over process-global clients, especially with concurrent applications.

## Request correlation, API errors and optional tracing

Every runtime handler gets server-generated request/trace/span IDs and application/generation correlation through `getRequestCorrelation()`. Managed application lifecycles and CLI reloads keep the application ID stable and generate a new generation ID. IDs are bounded opaque strings, never authorization, tenant identity or deduplication keys. Incoming `x-request-id` is ignored. `trustTraceParent: true` explicitly accepts only valid version-00 `traceparent` parents with nonzero IDs; other versions/malformed/duplicate values start a new trace. Local sampling is independent of caller flags. No baggage, tracestate, URLs, request bodies, headers, cookies or tenant attributes are exported. This is a limited [W3C Trace Context](https://www.w3.org/TR/trace-context/) interface, not full OpenTelemetry compatibility.

```ts
import { createApplicationLifecycle, getRequestCorrelation, ApplicationError } from 'zeruxjs';

const app = await createApplicationLifecycle({
  rootDir: process.cwd(),
  config: { observability: {
    applicationId: 'shop', sampleRate: 0.1, maxQueue: 128,
    exportTimeoutMs: 1000, shutdownTimeoutMs: 2000,
    createAdapter: () => ({
      // Supply an explicitly configured exporter here. This example stays local.
      export(span, signal) { if (!signal.aborted) console.log(span); },
      shutdown(signal) { /* release this generation's exporter resources */ }
    })
  } }
});
app.runtime().asPluginApi().addRoute({
  pattern: '/example',
  handler() {
    const correlation = getRequestCorrelation();
    if (!correlation) throw new ApplicationError(503);
    return { requestId: correlation.requestId };
  }
});
// Your host calls app.handle(req, res). This API never binds a port.
await app.close();
```

Tracing is inert without an injected adapter. Prefer `createAdapter` for reloadable hosts: each runtime owns one new adapter, calls optional `start`/`end` once for each admitted sampled span, and shuts it down on disposal. A direct `adapter` is generation-owned; managed reload rejects it with restart-required diagnostics. Use `createAdapter` to reload safely. Factory/start/end hooks are trusted synchronous code and must not block; exporter/shutdown promises receive cancellation signals. Exporter errors never change HTTP results. Only one export is in flight, with at most `maxQueue` pending/in-flight exports and `maxQueue` active spans (default 128; maximum 4096 each). Saturation drops telemetry, not requests. Response finish/close owns completion, including streamed responses; errors/disconnects cannot end a span twice. Exporters ignoring abort stall that generation's queue instead of creating more in-flight work. Shutdown aborts export, discards queued records, ends active spans, calls shutdown and returns by its deadline; it cannot force arbitrary promises to stop. `getTelemetryStatus()` reports counts, drops, failures and export timeouts without payloads. Export deadlines default to 5 seconds; budgets accept 1–60000 ms.

Zhost's existing proxy telemetry owns its response counters; the application observer owns application spans only. Do not wrap `app.handle` a second time. A separately instrumented proxy must create its own proxy span and explicitly propagate its span ID as the application's parent. Existing zhost forwards ordinary trace headers but does not create tracing spans or grant trust to caller headers. No host telemetry exporter is enabled automatically.

For framework-generated API errors, send an `Accept` header preferring `application/json` (or `application/problem+json`), or set file-route `meta.api = true`. Explicit JSON preference wins ties with HTML; missing/wildcard Accept preserves legacy shape. JSON responses use `application/json` and this envelope:

```json
{"error":{"code":"VALIDATION_FAILED","message":"Validation failed","requestId":"server-generated-id"}}
```

`ApplicationError(status, cause)` and existing `HttpError` statuses map to the exported `APPLICATION_ERROR_CODES`: BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, METHOD_NOT_ALLOWED, REQUEST_TIMEOUT, CONFLICT, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, VALIDATION_FAILED, RATE_LIMITED, INTERNAL_ERROR and UNAVAILABLE. Unknown 4xx/5xx statuses use BAD_REQUEST/INTERNAL_ERROR. Throw `ApplicationError(422, cause)` for validation failures; malformed JSON is 400. The framework never serializes raw exception messages, attached data, causes or stacks into these envelopes, even in development. Explicit package-owned `Response` objects keep their own contracts. Already-flushed streams are closed rather than overwritten. Existing non-API shapes remain, with stack/data disclosure removed and fixed safe error messages; custom HTML/template responses are not rewritten.

Framework log entries carry request correlation automatically, bound/control-clean messages, replace URL/bearer text and redact arbitrary arguments/error objects by default. Do not interpolate private values into log messages. `observability.onError(error, correlation)` is an explicit trusted private sink for original errors and causes, not a public reporter; its exceptions are contained. Implement storage/access/retention policy in that sink. Observability callbacks/options never enter browser manifests.

`runtime.getHealthStatus()` separates liveness from readiness: a live generation remains live with degraded dependencies, while readiness is false if any configured service reports degraded/closed. This is a startup-status snapshot, not a live dependency probe. `createHealthHandler(() => runtime.getHealthStatus(), { authorize, diagnostics })` returns a Fetch handler taking `(request, 'liveness' | 'readiness' | 'diagnostics')`. Hosts explicitly mount it using their existing routes; no paths are reserved or opened automatically. Public liveness/readiness return only `{status:'ok'|'unavailable'}` with 200/503 and no-store. Diagnostics are 403 unless the host's authorizer returns exactly true. Supply only an intentional diagnostic projection; never return raw managers, scope errors or credentials. No authorization is inferred from request/trace IDs.

Database configuration accepts the database-owned `db.execution` policy (`maxPending`, `maxBatch`, `shutdownGraceMs`, `onMetric`). Framework preflight validates it before provider initialization and keeps callbacks out of public manifests. Request correlation may be read explicitly inside an application-owned metric hook; the database package stays independent of framework tracing.

### Cache policy and generations

`cache.policy` accepts the `CachePolicy` type owned by `@zeruxjs/cache`: bounded bulk/producer/key/value/depth settings, `requireCapabilities` and `ownHelper`. Core configuration validates these fields before service factories; the cache manager negotiates required adapter capabilities during startup. Unknown metadata is not atomicity. Prefer retaining generation-scoped managers; active global cache convenience exports remain a compatibility layer. A conditional void set does not report whether its condition matched, and cooperative producer cleanup can exceed a deadline. See [cache policy and ownership](../@zeruxjs/cache/README.md).

### Server lifecycle hooks

Configure a host-owned `lifecycleHooks: createServerLifecycleHooks()` instance from `@zeruxjs/hooks/lifecycle`. It is executable private configuration, excluded from browser manifests, and must be reused across reloads. The framework dispatches request/route/commit/error/terminal and generation phases exactly once; dispose the host's bus after `await app.close()`. See [hook phases and the public-import example](../@zeruxjs/hooks/README.md#zeruxjs-lifecycle-integration) for ordering, errors, mutation limits and disconnect cleanup.

Only `response:before` exposes bounded header/status setters. Other phases contain observation snapshots, not raw HTTP/identity payloads. Routes can propagate `context.requestLifecycle?.signal` to cooperative dependencies. A request's owned context/state and effect cleanup persist until response finish/close, including streaming handlers that have already returned. Disconnect invalidates that scope; later continuations cannot resume hook/context use. This does not forcibly cancel arbitrary application promises or frontend hooks.

`runtime.activateServices()` is the lifecycle-aware activation entry; managed programmatic and CLI reloads use it. Direct `serviceScope.activate()` remains compatible low-level behavior but does not emit the new runtime activation event. `generation:ready` means prepared, not listening. Failed preparation rolls back the candidate and leaves the current generation usable. Request/terminal observations do not grant tenant permissions or bypass existing middleware/service route checks.

### Explicit modules, controllers and providers

`zeruxjs/modules` (also exported from `zeruxjs`) adds an opt-in registration layer
over the existing plugin routes. It requires no decorators, reflection or package
scanning. Register once from an application entry/plugin function; do not retain
its container across runtime generations. The existing file router, middleware,
service endpoints and request lifecycle hooks remain authoritative.

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { createProviderToken, defineProvider, defineController, registerModule }
  from 'zeruxjs/modules';
import { object, string } from '@zeruxjs/validator/schemas';

const Greeting = createProviderToken<{ hello(name: string): string }>('Greeting');
export default async function register(api: ZeruxPluginApi) {
  await registerModule(api, {
    name: 'greetings',
    providers: [defineProvider({ token: Greeting, scope: 'request', dependencies: [],
      create: () => ({ hello: (name: string) => `Hello ${name}` }) })],
    controllers: [defineController({ path: '/greeting', method: 'POST',
      schema: object({ name: string() }),
      async handle(input, _context, providers) {
        return { message: (await providers.get(Greeting)).hello(input.name) };
      } })],
  });
}
```

Install the optional validator package explicitly for this example. `schema` is a
Standard Schema v1 input pipe; validator transformations determine the handler's
output type through `defineController`. No schema/auth implementation or public
types move into the framework. Guards use the application's existing auth/session
verification and authorization policy; a client-supplied user/tenant object is not
verified identity. For cookie-authenticated writes retain configured origin/CSRF
and rate-limit checks in the HTTP boundary. The example is a public greeting,
not an authenticated enrollment or account operation.

Provider tokens have object identity, a typed value and a bounded diagnostic name.
`defineProvider` infers the factory's declared dependency tuple. Dependencies must
be registered in the same module; no hidden global service locator is introduced.
Use a factory closure over an explicitly acquired `api.service(...)` for a borrowed
framework service; its owner still controls disposal. Missing dependencies,
cycles and singleton-to-request/transient captures reject before constructors run.
Cycle errors carry the bounded token-name chain in `ModuleError.code`.

Scopes are `singleton` (one per module registration/generation), `request` (one per
matched invocation) and `transient` (one per resolution). Concurrent singleton or
request resolution shares its in-flight construction. Providers are lazy unless a
singleton declares `eager: true`. Factories receive `{ signal, request?, onDispose }`;
singleton factories never receive a request. Register partial-resource cleanup
immediately with `onDispose`; throwing construction runs those callbacks in reverse
order. Successful construction retains `dispose(value)` and callbacks until scope
teardown. Dispose dependents before dependencies, including transient instances;
cleanup errors are aggregated without skipping remaining disposers.

The actual request sequence is existing request hooks/body parsing/global
middleware, route resolution, existing route middleware, module guards in order,
schema validation, module middleware, then controller. Module guards must return
exactly `true`. Neither guards nor schema pipes receive a provider resolver, so a
denial/invalid input cannot instantiate a privileged controller provider. The
handler gets validated/transformed `input`; `context.body` remains the original
parsed body. Middleware must call/await `next` at most once; a started downstream
continuation is also awaited before returning. Existing hook phase ordering and
response mutation rules are unchanged.

An optional controller `filter(error, context)` handles guard/pipe/middleware/handler
errors. It may return a normal handler result, explicitly write/end a native
response, or throw an existing `ApplicationError` for the framework's sanitized
envelope. Setting `res.statusCode` alone does not change the framework's normal
result status. Unhandled module guard/input errors become fixed 403/400 envelopes;
internal causes, input values and dependency errors stay private. Disposal failures
are reported internally, not passed to a response filter after headers commit.

Request providers reuse the real lifecycle cancellation signal and remain alive
until both handler settlement and response completion/disconnect. Streamed results
retain their providers through their last byte. Escaped resolvers reject after
scope closure. Generation cleanup aborts/drains owned request scopes, then releases
singletons before framework services. `api.onDispose(cleanup)` also supports explicit
plugin-owned generation cleanup on normal close and failed preparation; returned
plugin values are not automatically treated as disposers. Factories/handlers must
cooperate with cancellation: shutdown waits for their actual settlement and never
claims to forcibly stop arbitrary promises.

Registration supports canonical static paths only (no duplicate/trailing slashes),
explicit HTTP methods, 128 providers/controllers per module, 32 dependencies,
guards/middleware and construction disposers, 256 acquisitions per scope, and 128
plugin disposers per generation. `api.hasRoute(path, method)` checks an exact
existing match. Module registration rejects existing same-path/method routes,
rolls back its own additions on failure, and startup detects later-discovered
file collisions. Reserved service/public endpoint collision checks remain intact;
dynamic file routes retain the router's existing specificity ordering. An explicit
module `close()` is idempotent and leaves its registered routes unavailable (503)
until that generation is replaced. Provider values/factories never enter browser
manifests. This is a small server module layer, not NestJS or browser hook parity.

### Multiple service endpoints and service calls

`zeruxjs/service-endpoints` (also exported from the root) provides explicit endpoint
groups over `zhost/protocols`. No listeners start on import or registration. Every
endpoint requires a name, numeric-IP bind, full message/concurrency/deadline limits
and an authorization callback. HTTP endpoints own a distinct `ProtocolGateway`;
WebSocket endpoints own a path, origin allowlist and message handler. No transport
implementation moves into the framework and native gRPC registration is not added.

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { registerServiceEndpoints } from 'zeruxjs/service-endpoints';
import { createProtocolGateway, type TransportAuthorization } from 'zhost/protocols';

export function registerEndpoints(api: ZeruxPluginApi, authorize: TransportAuthorization) {
  const gateway = createProtocolGateway({ authorize: () => true });
  gateway.connect.register('app.Status', 'Read', (_input, context) => {
    context.signal?.throwIfAborted();
    return { ready: true };
  });
  return registerServiceEndpoints(api, [{
    name: 'status', transport: 'http', gateway, authorize,
    bind: { host: '127.0.0.1', port: 0 },
    limits: { maxMessageBytes: 65536, maxConcurrent: 16, timeoutMs: 5000 },
  }]);
}
```

Call this from an explicit entry/plugin with real host authentication. The returned
handle has `start`, `close`, `health` and `address(name)`. CLI startup workers start
the group and return its teardown; generation `onDispose` is a second idempotent
ownership boundary, including failed preparation. Programmatic application owners
must explicitly call `start()` or run their startup workers: creating an application
lifecycle does not implicitly bind ports. Register at most 32 endpoints in one group;
`{ name }` optionally selects its worker name. Existing worker-name, endpoint-name,
fixed-port, duplicate-gateway and gateway-path conflicts reject. Port zero supports
independent disposable listeners. HTTP paths remain the gateway's real registered
RPC/Connect/MCP/SSE paths; WebSocket paths are configured independently. This is not
an arbitrary HTTP-router remounting or universal RPC abstraction.

Group startup and rollback use zhost's real adapter registry: a failed listener
closes previously acquired listeners in reverse order. Close stops admission,
signals handlers, closes streams/sockets and drains actual work. Replacements
requiring an already occupied fixed port fail safely; this layer does not invent
socket transfer, shared ports or automatically restart an application. Use the
existing host rolling/fleet boundary when needed. Protocol handlers enforce tenant,
method/tool and resource permissions after endpoint authentication. Forwarding
headers are not identity. Endpoint definitions, authorization and handlers are
executable private plugin state, not browser configuration.

The typed JSON POST client `createServiceClient<Input, Output>` requires a fixed
endpoint, `transport(Request)`, an exact host `allowDestination(URL)` decision,
response Standard Schema, `timeoutMs`, `maxPayloadBytes`, `maxConcurrent` and
`retry: { maxAttempts, idempotent }`. Input is a caller-declared type and bounded
JSON; output is validated/transformed by its schema. It is a JSON endpoint client,
not a generated Connect/JSON-RPC/WS/gRPC client. JSON-RPC envelopes, if used, belong
to the declared input/output types and schema.

Transport injection is deliberate: the host owns egress, DNS rebinding protection,
TLS and connection policy. A URL/origin predicate is not a DNS/IP firewall. For
native Node Fetch use an explicitly configured transport/dispatcher under that
policy; see [Node Fetch](https://nodejs.org/api/globals.html#fetch). Redirects are
requested as errors, and redirected/mismatched response URLs are refused. Never
accept destinations or outbound credentials from request payloads. Optional
`headers()` supplies host-owned authentication without logs; hop-by-hop, authority
and forwarding overrides are refused. No external network request occurs until
`call(input, { signal?, deadline? })`.

The earliest caller deadline and local timeout applies to headers, all attempts,
body reads and validation. `x-zerux-deadline` carries that absolute Unix-ms deadline;
zhost validates it and caps it at its local request policy before exposing
`RpcContext.deadline`/`signal`. A caller can shorten the budget, never extend it or
gain authorization. Expired/malformed values yield 408/400. Connect/RPC/MCP handlers
must pass the signal/deadline to their actual database/provider operations. This is
a small propagation convention, not an authenticated distributed clock protocol.
Established SSE and WebSocket lifetimes keep their zhost-specific ownership rules.

Request/response payloads have 16 MiB maximum configurable byte limits, JSON depth
16 and 10000-node limits before dispatch (response bytes are bounded before its
schema runs); concurrency is at most 1024 and local timeout at most 120 seconds.
Use plain JSON data without getters/toJSON hooks or executable values. Failed,
oversized and cancelled response readers are cancelled/released. `close()` rejects
new calls, aborts active calls and drains real settlement. Uncooperative transports,
header callbacks, schemas or handlers can delay settlement; cancellation does not
claim to forcibly kill JavaScript, undo a remote write or free pending work early.

Retries are explicit: 1–3 attempts, with more than one allowed only when the caller
declares the operation idempotent. Transient transport failure and 502/503/504 may
retry within the same total deadline. All other statuses, schema failures, body
limits and cancellation do not retry. There is no automatic idempotency-key store
or non-idempotent replay; an unknown write outcome remains unknown. Retries have no
background queue or unbounded backoff and retain the same concurrency slot.

### Pinned transactional outbox hook

`createTransactionalOutbox<Event>(database, { enqueue(transaction, event, context) })`
requires the database facade's real `transaction` and `transactionCapabilities()`.
Unsupported connectors reject before work. `run((transaction, enqueue) => ..., options)`
passes through database-owned `TransactionOptions`, including cancellation, deadline,
isolation and timeout negotiation. Business operations and the writer must use that
exact callback `TransactionDatabase`; the hook never starts an independent journal
transaction or publishes external messages. Do not perform provider/network side
effects inside the transactional callback.

The host's writer inserts a durable outbox row on the supplied pin, with application
idempotency/event schema and tenant policy. Events are snapshotted as bounded plain
JSON (64 KiB, depth 16); at most 64 enqueues are accepted per callback and writes
serialize. All enqueues settle before the callback can commit, including unawaited
calls. Any enqueue failure makes the callback fail even if application code catches
it; rollback/commit/release remain owned by the connector contract. Escaped enqueue
functions reject after callback completion. A separate explicitly owned relay is
needed for delivery, acknowledgement, retries and retention. This hook supplies no
DDL/journal schema, distributed delivery guarantee or automatic callback replay.

### Opt-in GraphQL

Import `registerGraphQL` and its types from **`zeruxjs/graphql`**, not the root.
The integration declares optional `graphql@16.14.2` (GraphQL.js, MIT) and
`graphql-sse@2.6.3` (MIT). Dependency loading happens only during explicit
registration; missing dependencies reject clearly. No schema, listener, registry,
publisher or telemetry starts on import. A deployment omitting optional packages
must install these versions when enabling GraphQL.

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { registerGraphQL, type GraphQLOptions, type GraphQLResolver }
  from 'zeruxjs/graphql';

type Policy = Pick<GraphQLOptions,
  'authenticate' | 'authorizeField' | 'authorizeData' | 'protectMutation'>;
const me: GraphQLResolver<unknown, Record<string, never>, string> =
  (_source, _args, context) => context.principal.subject;

export function registerGraph(api: ZeruxPluginApi, policy: Policy) {
  return registerGraphQL(api, {
    name: 'account-graph', path: '/graphql', ...policy,
    typeDefs: 'type Query { me: String! }',
    resolvers: { Query: { me } },
    introspection: false,
    persisted: { required: false, operations: {} },
    limits: { maxDepth: 6, maxComplexity: 500, maxAliases: 16,
      maxConcurrent: 16, timeoutMs: 3000 },
  });
}
```

Supply real host policies before calling this from an awaited entry/plugin. SDL
and resolver functions are server-owned and validated before route registration;
clients cannot supply schemas or executable resolvers. The endpoint is an explicit
POST controller registered through the module layer and served by the existing
zhost/framework HTTP owner. File/service-route conflict checks, middleware and
request/provider disposal remain active. `providers` accepts module-local provider
definitions; resolvers receive their request-scoped `context.providers` resolver.
There is no separate GraphQL container, JSON-RPC/MCP bridge or automatic port bind.
The returned `close()` drains owned operations and closes its module; it is also
registered with generation teardown.

Authentication must return a **server-verified** `{ subject, tenant, expiresAt }`
with absolute Unix-ms expiry, or null. Do not construct this identity from raw
client/forwarding claims. The integration snapshots those fields per operation.
`authorizeField(context, info, source, args)` must return exactly true for each
registered object field, including nested subscription results. `authorizeData`
receives principal, loader name, key and optional returned row; it runs before
cache lookup and again for newly loaded rows. These hooks must enforce actual
field/resource/tenant policy, and data sources must bind queries to the verified
tenant. The library cannot infer database tenant columns or grant permissions.
See [GraphQL.js authorization](https://www.graphql-js.org/docs/authorization-strategies/).

`protectMutation(request, principal)` is required and runs before all mutation
execution. Wire it to existing origin/CSRF controls such as the security package's
session-bound CSRF verifier and configured origin checks. Explicit bearer-only
policies remain application-owned; POST alone is not CSRF protection. Queries
must remain free of side effects. Authentication/policy callbacks receive no
resolver-provider access before guard approval.

The endpoint accepts one JSON operation envelope: `query`, `variables`,
`operationName`, `extensions`. HTTP batch arrays are disabled (batch size one),
as are GET operations and multipart uploads. GraphQL.js parses/coerces/validates
operations; validation errors, resolver errors and causes never expose input,
SQL, stacks, paths or private extensions to clients. Initial policy/validation
failures use 400/403, capacity refusal 503, execution expiry 504, and valid GraphQL
field-error results remain HTTP 200 with fixed messages/null propagation. Optional
`onError` receives internal causes for trusted diagnostics; its exceptions cannot
interrupt cleanup. Response headers are private `no-store`.

| Limit | Default | Maximum |
| --- | --- | --- |
| Selection depth | 8 | 32 |
| Conservative field complexity | 1000 | 10000 |
| Expanded aliases | 32 | 256 |
| Query UTF-8 bytes | 32768 | 131072 |
| Variables UTF-8 bytes | 32768 | 262144 |
| Response/event UTF-8 bytes | 1048576 | 16777216 |
| Active operations/connections | 32 | 256 |
| Initial authentication/query execution time, ms | 5000 | 120000 |
| List items per resolved field | 100 | 1000 |

All configured limits are positive integers. Parser tokens are capped at 4096,
validation issues at 20, variable structure at depth 16/2048 nodes, serialized
responses at 100000 nodes and active field resolvers at 64 per operation.
Complexity counts expanded fields/fragments and conservatively multiplies schema
list selections by `maxListItems`, regardless of runtime directives/page arguments.
Queries with expensive lists can therefore require explicit policy tuning. Actual
list results require arrays and cap every nested list layer separately; arbitrary
iterable list results reject so an unbounded generator cannot bypass collection
limits. Nested list layers also multiply the static cost. The framework's existing bounded HTTP body
parser remains the outer request limit. These bounds do not measure resolver CPU,
SQL cost or provider work automatically.

`introspection` is required explicitly. False blocks schema introspection while
preserving `__typename`. Persisted-operation maps contain at most 256 SHA-256
hex IDs mapped to server-registered documents. IDs/documents are checked at startup.
Clients use `extensions.persistedQuery: { version: 1, sha256Hash }`; unknown hashes
fail closed and never populate a dynamic APQ cache. With `required: true`, raw
queries without a registered hash reject. If both hash and query are sent, the
query must equal the registered document. There is exactly one operation definition
per document; fragments are allowed.

`context.load<T>(name, key, batch)` is a request/connection-owned batching helper,
not a global DataLoader. Use one stable batch function per loader name; changing
its identity rejects instead of mixing data sources. Up to 16 loaders retain
256 keys each, with at most 64 keys in a microtask batch. Every row is authorized
before resolution, failures evict affected keys, and concurrent principals never
share cached rows. Loaders, field jobs and provider resources stay owned until
actual operation settlement. See [GraphQL.js caching guidance](https://www.graphql-js.org/docs/caching-strategies/).

Subscriptions are disabled unless configured with
`subscriptions: { maxDurationMs, reauthorizeMs, reauthorize }`. The maintained
[graphql-sse distinct-connections protocol](https://the-guild.dev/graphql/sse/guides/recipes)
is used over the same authenticated POST endpoint with `Accept: text/event-stream`.
Use a graphql-sse client in its default distinct mode. Single-connection token
multiplexing, WebSocket protocols, incremental defer/stream, federation, custom
scalars, interface/union type resolvers and generated schema/client code are not
implemented. Built-in scalars/enums/object SDL and explicitly registered field
resolvers are supported; default object fields read own data properties only.

Connection duration is 10–120000ms and reauthorization interval 10–30000ms.
Expiry always caps the configured duration; reauthorization cannot change the
principal or renew that original expiry. Each interval must check current session/
permission state. Denial, expiry, disconnect or generation close aborts the resolver
signal, terminates the native response and returns the owned subscription iterator.
Backpressure gates the maintained protocol's producer to one outstanding data
frame; its 12-second heartbeat queue is also bounded by the 120-second connection
lifetime (at most ten heartbeat frames). Response/event bytes remain bounded.
External brokers/sources must bound their own queues and support cancellation;
this integration supplies no cross-instance pubsub bus.

GraphQL.js 16 execution is cooperative through the supplied context signal; it does
not force-stop resolver promises or synchronous CPU. The deadline may end the
client response while the operation's capacity/provider scope remains retained
until native work actually settles. Subscription sources must unblock pending
`next()` on cancellation so `return()` can finish. Live database/broker identity,
revocation and distributed delivery acceptance remain deployment prerequisites;
local fake resolver success does not certify them.

Module controllers may additionally supply `onDispose(context, error?)`: an observation-only
callback after an accepted request's providers finish disposal, even when a provider
disposer fails. Callback failures join cleanup diagnostics and cannot alter a
committed response. GraphQL uses this boundary to retain operation capacity through
asynchronous provider disposal. Schema directives do not install authorization
policies automatically; the required explicit policy callbacks remain authoritative.

### Renderer registry and module boundaries

`zeruxjs/renderers` (also exported from the root) defines a generation-owned
renderer registry, typed registration tokens, render contexts/results and stable
`RendererError` codes. Register through `api.renderers()` during an entry/plugin;
`context.render(token, view, feature?)` is the request dispatch path. No filename,
package scan, loader alias or directive registers a renderer implicitly.

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { createZyroRenderer } from 'zeruxjs/renderers';
import { h, renderToString } from 'zyrojs/dom';

export default function register(api: ZeruxPluginApi) {
  const zyro = api.renderers().register(createZyroRenderer(renderToString));
  api.addRoute({ pattern: '/welcome', method: 'GET',
    handler: context => context.render(zyro, h('h1', {}, 'Welcome')) });
}
```

The application must declare/install `zyrojs` for this example. The framework
injects no UI runtime or request props into a browser payload. ZyroJS's own static
encoder supplies HTML escaping; trusted renderer implementations own destination
encoding and must not turn arbitrary request strings into raw HTML. Existing
string/JSON/buffer/cache/redirect/stream route results remain supported. Rendered
HTML has an explicit HTML result marker, so text-only render output is still sent
as HTML. Existing string-route theme behavior is unchanged; renderer HTML is not
automatically rewritten into a different runtime's tree.

| Framework factory/contract | Static HTML | Streaming | Hydration | Client-only |
| --- | --- | --- | --- | --- |
| `createZyroRenderer(renderToString)` | yes, injected Zyro function | no | no | no |
| `createReactRenderer(renderToString)` | yes, injected React server function | no | no | no |
| `createVueRenderer(renderToString)` | yes, injected Vue server function | no | no | no |
| `createZyroDocumentRenderer` | yes, injected Zyro SSR | document chunks | explicit V1 client asset; no generic hydration dispatch | no |
| Explicit custom registry adapter | declared HTML capability | declared bounded async iterable | unsupported | unsupported |

Core React/Vue store and hook entries remain independent adapters and are not
installed by these factories. `@zeruxjs/react/server` optionally supplies native
React SSR through matching host peers; its browser/hydration entries still require
explicit application ownership. `@zeruxjs/vue/server` similarly supplies opt-in compiler-free native Vue SSR; its
runtime-only browser entry and public-state delivery remain host-owned. A host
may inject [React's `react-dom/server` `renderToString`](https://react.dev/reference/react-dom/server/renderToString)
or [Vue's `vue/server-renderer` `renderToString`](https://vuejs.org/api/ssr.html#rendertostring).
Create fresh Vue apps/request stores per request and never give different DOM
runtimes ownership of the same client root. The three static factories perform no JSX/SFC
compilation, suspense coordination, hydration bootstrap, client mount or asset
injection. ZyroJS static output has no hydration markers. Native React/Vue SSR
acceptance requires those runtimes to be installed separately; injected-function
checks are not live runtime/browser certification.

A registry snapshots adapter methods/capabilities, rejects duplicate names and
foreign tokens, and seals registration on first dispatch. `get(name)` selects an
already registered token; it does not discover code. Tokens may be disposed before
sealing; generation close disposes remaining adapters in reverse registration
order. Unsupported features throw `RENDERER_FEATURE_UNSUPPORTED` with trusted
renderer/feature details, never silently switch runtimes. `RendererError.cause`
retains native failures internally; normal framework client errors remain sanitized.

Each dispatch receives its own `{requestId, pathname, feature, signal, locals, onDispose}`.
No process-global request data or UI state store is created. Request completion or
disconnect aborts the context and runs bounded LIFO cleanup after actual renderer/
source settlement. Custom streams use the existing response byte limit and
backpressure implementation; unused streams are also returned during teardown.
Generation close drains render work before dependent framework services close.
Default limits are 16 registered adapters, 32 active renders, 32 per-render cleanup
callbacks, 1 MiB output and 30 seconds initial rendering. Standalone
`createRendererRegistry({maxBytes,maxActive,timeoutMs})` supports up to 16 MiB,
1024 active renders and 120 seconds. Streaming lifetime remains owned by the
request/drain signal. Cancellation is cooperative and never claims to force-stop
native promises or synchronous UI code.

#### Build-time server/client classification

`buildProjectSources`/`zerux build` now parse module syntax with installed TypeScript
before publishing staged output. They classify server, client and shared modules,
following relative imports, re-exports and literal dynamic imports transitively.
A directive is recognized only as an exact unescaped `'use client'`/`"use client"`
or `'use server'`/`"use server"` string in the leading directive prologue (comments
and earlier directives are fine). Strings/comments/templates after executable
statements do not declare a boundary. `.client.*` and `.server.*` filenames are
explicit conventions; conflicting declarations reject. Entry/plugin/controller/
middleware roles and HTTP/default route exports remain server-owned. Browser
entries are excluded from server route execution, including explicit directive
entries during development discovery.

Unmarked helpers used by both partitions are shared. Client-only modules and
helpers emit only as browser assets, while shared helpers retain their private
server output too. Tracked relative server-to-client entry imports reject because no RSC/island
cross-runtime protocol is implemented. Build classifications are not authentication
or authorization, and `use server` creates no RPC/action endpoint. Development is
still the Node module loader; full transitive browser checks and browser assets
belong to the staged build, not an implied dev frontend bundler.

Client graphs reject Node built-ins/globals, server-only module labels, server
service imports, unresolved/out-of-build relative imports and nonliteral dynamic
imports. Explicit type-only imports are erased and do not authorize a runtime
import. The current browser emitter supports a **closed local ESM graph**; bare
packages, import aliases, JSON/CSS/SFC loaders and external URLs require a separate
verified bundler contract and reject here. In particular React/Vue/Zyro browser
package imports are not automatically bundled. Server JSX keeps the prior compiler
behavior; Vue/other JSX compilation requires an explicit host transform. There is
no automatic JSX-runtime selection based on a renderer name.

`ProjectBuildOptions.transform(source, file, {environment})` remains an optional
trusted compiler seam. Browser transforms must emit ESM JavaScript. Their output
is checked again for server globals/imports, so an injected Node import cannot
bypass the source graph check. The checks are a conservative static policy, not
a sandbox for malicious JavaScript, a typecheck, a proof of dependency publication
or a detector for arbitrary hardcoded secret strings. Keep credentials in explicitly
server-only modules/configuration and never put them in public sources. Existing
HTTP auth/tenant/consent boundaries still apply independently.

Diagnostics carry `ModuleBoundaryError.code` and the actual project-relative import
`chain`, for example `components/page.client.ts -> lib/shared.ts -> lib/db.server.ts`.
No credential values or absolute build paths are included. Module parsing is bounded
at 5000 script inputs, 64 MiB total script source, 1 MiB per script and import depth 64; existing
non-code build file/total budgets still apply. Install TypeScript in the application
when building; development/test environments may use the framework's installed
compiler fallback. Transpilation remains distinct from a separate typecheck.

Successful builds atomically publish these deterministic artifacts together:

- `build-manifest.json`: existing source counts/digest/directories plus renderer
  manifest pointers; old schema-1 production manifests remain accepted.
- `server-manifest.json`: **private**, mode 0600 inside the private build tree;
  module source hashes, partition labels, local edges, private server-file paths
  and optional client-asset URLs. It contains no source text or request data.
- `public-assets.json`: a safe projection with only module entry URLs and
  asset URL/integrity/byte/kind records. It contains no server configuration,
  module import chains, local source paths or automatic hydration data.

Browser modules are emitted under the first configured public directory at
`/_zerux/client/<graph hash>/<opaque module id>.js`. Local imports are rewritten to
actual emitted ESM assets; hashes include compiled graph content. The existing
public-file handler serves them after production structure resolution. Static
asset projection respects configured public-directory precedence. Generated-path
collisions reject, and client-only app files are not imported by staged route
discovery. Neither manifest is automatically injected into HTML or exposed as a
diagnostic endpoint. A failed compile/boundary check removes its staging directory
and retains the previous complete build. This is an extension/static HTML and
local ESM foundation, not React Server Components or full Next.js compatibility.

### Zyro documents, streamed responses and client assets

`createZyroDocumentRenderer` from `zeruxjs/renderers` wraps the existing injected
renderer contract with a trusted layout, pre-commit error boundary, manifest
assets and one security-policy response per request. It imports no UI runtime.
This minimal application plugin emits useful HTML without JavaScript:

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { createZyroDocumentRenderer } from 'zeruxjs/renderers';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import { defineComponent, h } from 'zyrojs/component';
import { renderToHydratable } from 'zyrojs/server';

const Welcome = defineComponent<{ name: string }>(props =>
  () => h('h1', {}, props.name));
const validateProps = (value: unknown): { name: string } => {
  if (!value || typeof value !== 'object' ||
      !('name' in value) || typeof value.name !== 'string') {
    throw new TypeError('Invalid public props');
  }
  return { name: value.name }; // Project public fields; never serialize credentials.
};
const policy = createSecurityPolicy({ mode: 'production', https: true });

export default function register(api: ZeruxPluginApi) {
  const document = api.renderers().register(createZyroDocumentRenderer({
    security: () => policy.createResponse(),
    render(props: { name: string }, context) {
      const { html } = renderToHydratable(Welcome, props, {
        validateProps, idPrefix: 'welcome', signal: context.signal
      });
      return { html }; // Deliberately omit data when hydration is disabled.
    },
    layout: () => ({
      before: '<!doctype html><html><head><title>Welcome</title></head><body><main>',
      after: '</main></body></html>'
    }),
    errorBoundary: () => ({ html: '<p>Temporarily unavailable</p>' })
  }));
  api.addRoute({ pattern: '/welcome', method: 'GET',
    handler: context => context.render(document, { name: 'Welcome' }, 'streaming') });
}
```

The host must declare `zyrojs` and `@zeruxjs/security`. Layout/error-boundary HTML
is authored trusted markup, not a sanitizer for request values. An explicit
boundary owns its fallback content; it does not automatically change HTTP status.
The document adapter supports `staticHtml` and `streaming`: document streaming
writes the layout, already-rendered component HTML and footer with backpressure;
it does not incrementally execute Zyro components or claim suspense support.
Other injected React/Vue factories retain their existing optional static behavior.

Hydration is opt-in using Zyro's version-1 protocol and an application-owned client
entry. Build a browser ESM bundle containing `zyrojs/hydrate` and the same authored
component/props validator. Include a leading `'use client';` in that bundle (for
example, an [esbuild banner](https://esbuild.github.io/api/#banner)), put it in `public/hydrate.js`, then call:

```ts
import { readFile } from 'node:fs/promises';
import { buildProjectSources } from 'zeruxjs';
import { createRenderAssets } from 'zeruxjs/renderers';

await buildProjectSources({ rootDir, clientEntries: { welcome: '/hydrate.js' } });
const assets = createRenderAssets(JSON.parse(
  await readFile(`${rootDir}/.zerux/build/public-assets.json`, 'utf8')));
```

Supply `assets` and `clientEntry: 'welcome'` to the document adapter and return the
**whole** `renderToHydratable` result instead of `{html}`. The adapter emits the
root `#zyro-root`, inert JSON `#zyro-root-data`, and a module script with the
manifest's exact URL/integrity and this response's CSP nonce. The host policy must
include that nonce in `script-src`. No request header supplies the nonce. With the
same component/validator, the authored client entry owns hydration and teardown:

```ts
import { hydrate } from 'zyrojs/hydrate';
// Import Welcome and validateProps from your shared, browser-safe component module.
const root = document.getElementById('zyro-root');
const data = document.getElementById('zyro-root-data');
if (!root || !data?.textContent) throw new Error('Missing hydration document');
const mounted = hydrate(Welcome, root, { data: data.textContent, validateProps });
// Your navigation/mount owner calls mounted.dispose() before replacing this root.
```

`rootId` may select another HTML-safe identifier; its data element is `${rootId}-data`.
Missing assets, malformed payloads and mismatched nonce policies fail before
commitment. Hydration uses the exact validated public props/ID prefix from SSR;
Zyro owns mismatch and form-state semantics. No selective hydration or generic
registry `hydration`/`clientOnly` dispatch is added. The current compiler checks a
closed local ESM graph; it does **not** bundle bare package imports. Use an explicit
host bundler first. A named entry can also target a leading-client source path,
for example `components/welcome.client.ts`; only the public URL is published.
There are at most 32 named entries. Arbitrary static/CJS files are not client
entries. Asset references are never derived from private server paths.

Renderer HTML is `no-store`; streams enforce `no-store, no-transform` even if a
stream header bag requests public caching. The complete response header bag is
validated before mutation. `sendStream` now returns a completion promise: direct
callers must await/catch it. It checks the first nonempty chunk and its byte budget
before applying stream headers. Before the first write, the framework can return
its normal sanitized error. The first write commits status/CSP/headers; a later
producer failure terminates the connection and is available to trusted error
reporting, never appended to HTML as a stack or recovery document. Direct stream
callers own that post-commit error handling. See Node's
[stream backpressure contract](https://nodejs.org/api/stream.html#buffering).
HEAD closes the source without executing its body. Disconnect returns the iterator
once, propagates the lifecycle signal, and releases resources after actual source
settlement; noncooperative JavaScript cannot be forcibly cancelled.

Production build staging and application generation replacement remain atomic:
a failed compile/entry lookup or candidate initialization leaves the last good
build/generation active. Register documents and resolve their assets during
candidate preparation, before serving requests. The docs application remains its
own static exporter; this HTTP renderer is not a general static-site exporter.

### Progressive browser navigation

`zeruxjs/browser-navigation` is an optional, DOM-independent-on-import browser
entry. Importing the framework does not start a router. `api.navigationManifest()`
projects the **real registered GET/ALL routes** with `meta.navigation` into one
version-1 public schema: base path, public route IDs/patterns/parameters, structural
layout IDs, optional manifest asset URL/integrity, and not-found/error boundary IDs.
Handlers, source paths, arbitrary metadata and configuration are excluded. Existing
file routes can export `meta.navigation`; plugin routes use the same metadata.
The shared matcher retains server static/dynamic/catch-all precedence. Serialized
route order is authoritative; parameters keep the server's encoded string semantics.
The snapshot is generation-specific; publish it after the intended routes have
registered and replace the document when route/shell policy generations change.
It is not a second authorization registry.

This minimal public-page plugin uses the existing Zyro document renderer. First
prebundle the browser entry below as `public/navigation.js` with a leading
`'use client';` directive and no remaining bare imports, then build its named entry:

```ts
import { buildProjectSources } from 'zeruxjs';
await buildProjectSources({ rootDir, clientEntries: { navigation: '/navigation.js' } });
```

```ts
import type { ZeruxPluginApi } from 'zeruxjs';
import { readFile } from 'node:fs/promises';
import { createRenderAssets, createZyroDocumentRenderer } from 'zeruxjs/renderers';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
import { defineComponent, h } from 'zyrojs/component';
import { renderToHydratable } from 'zyrojs/server';

const Page = defineComponent<{ name: string }>(props => () =>
  h('main', {}, h('h1', {}, props.name), h('a', { href: '/app/next' }, 'Next')));
const validateProps = (input: unknown): { name: string } => {
  if (!input || typeof input !== 'object' || !('name' in input) ||
      typeof input.name !== 'string') throw new TypeError('Invalid public props');
  return { name: input.name };
};
// This application explicitly permits its own module assets. No request grants CSP access.
const policy = createSecurityPolicy({ mode: 'production', https: true,
  resources: { 'script-src': ["'self'"] } });

export default async function register(api: ZeruxPluginApi) {
  const assets = createRenderAssets(JSON.parse(await readFile(
    `${api.getStructure().rootDir}/.zerux/build/public-assets.json`, 'utf8')));
  const bootstrap = assets.entry('navigation');
  const page = api.renderers().register(createZyroDocumentRenderer({
    security: () => policy.createResponse(),
    render(view: { id: string; name: string }, context) {
      return { html: renderToHydratable(Page, { name: view.name }, {
        validateProps, idPrefix: 'page', signal: context.signal
      }).html };
    },
    layout: view => ({
      before: `<!doctype html><html><head><title>Pages</title></head><body>` +
        `<div id="app" data-zerux-route="${view.id}" ` +
        `data-zerux-scope="public" data-zerux-policy="pages-v1">`,
      after: `</div><script type="module" src="${bootstrap.url}" ` +
        `integrity="${bootstrap.integrity}" crossorigin="anonymous"></script></body></html>`
    })
  }));
  for (const [path, id] of [['/app', 'home'], ['/app/next', 'next']] as const) {
    api.addRoute({ pattern: path, method: 'GET', meta: { navigation: { id } },
      handler: context => context.render(page, { id, name: id }, 'streaming') });
  }
  api.addRoute({ pattern: '/app/routes.json', method: 'GET',
    handler: () => api.navigationManifest({ basePath: '/app', assets }) });
}
```

The browser entry uses public imports. If loading it or its manifest fails, ordinary
links still work. The host owns the returned router and calls `close()` on teardown:

```ts
import { createBrowserRouter } from 'zeruxjs/browser-navigation';
const root = document.getElementById('app');
if (!root) throw new Error('Missing navigation root');
const response = await fetch('/app/routes.json', {
  credentials: 'same-origin', cache: 'no-store'
});
if (!response.ok) throw new Error('Navigation manifest unavailable');
export const router = createBrowserRouter({
  root, manifest: await response.json(), scope: () => 'public'
});
```

The literal scope and route IDs above are for public pages only. Authenticated
applications must generate `data-zerux-scope` from the verified principal/tenant
and session revision, using a bounded opaque non-secret identifier. Supply the
same current scope through `scope()`. These values only partition client state;
**every server request and data source must still authenticate and authorize**.
Scope changes, 401/403, missing markers or shell-policy changes force normal
document navigation. Do not put credentials or bearer tokens in these attributes.
`data-zerux-policy` is a host-owned shell/CSP generation token; change it when the
shell's styles, security policy or bootstrap compatibility changes. Fetched CSP
headers cannot replace the active document's CSP. The HTML adapter never executes
scripts from fetched HTML, changes head assets or weakens CSP after errors. It
accepts trusted server-authored HTML, not arbitrary unsanitized input; active
embeds, inline handlers and foreign SVG/MathML content fall back to document
navigation. Applications needing other DOM formats must own a separate explicit
renderer policy.

Each navigation fetches the normal same-origin HTML URL with credentials and
`cache: 'no-store'`; server redirects propagate through the final URL/history.
Cross-origin destinations, unsupported responses and failures use normal document
navigation. Only eligible same-origin links inside the configured base are enhanced:
modifier keys, non-left buttons, downloads, external/other targets, editable regions
and `data-zerux-reload` keep native behavior. Keyboard-generated clicks work;
forms are never intercepted. Hash navigation and same-document Back/Forward retain
form nodes. Other history traversals re-request authorized HTML, restore bounded
scroll/focus records and do not promise browser BFCache/form-value restoration.
A focus target is selected from the saved element, hash anchor,
`[data-zerux-focus]`, heading or root, with temporary tabindex and no forced smooth
motion. A disposable polite status region announces the title/heading.

For nested reuse, declare `layouts: ['shell', 'section']` in route metadata and
render the same structural chain inside the navigation root:

```html
<section data-zerux-layout="shell"><div data-zerux-outlet>
  <section data-zerux-layout="section"><div data-zerux-outlet>
    <!-- page component root and its hydration data -->
  </div></section>
</div></section>
```

The HTML adapter preserves the common layout prefix and replaces only its outlet.
Layouts are structural host-owned DOM, not hydrated component roots; page modules
must not own them. Changing their IDs forces replacement. Boundary IDs reference
registered routes; the server must actually return a matching marked HTML document
with 404/5xx status. A normal JSON 404 remains a full document navigation. No client
boundary replaces an authorization denial.

Route splitting uses `meta.navigation.clientEntry`, resolved from the production
asset manifest passed to `navigationManifest({ assets })`. The optional
`createDocumentNavigationRenderer({ loadModule })` receives only that validated
`{url, integrity}`. The host's explicit module loader owns code loading and its
integrity/CSP enforcement; a plain dynamic `import(url)` does not itself enforce
SRI. Modules export `prepare(root, context)` returning an idempotent disposer.
For Zyro, hydrate only the detached component subtree and its exact SSR data:

```ts
// An authored route module, prebundled as browser ESM with its component/validator.
import { hydrate } from 'zyrojs/hydrate';
export function prepare(root: HTMLElement, context: { signal: AbortSignal }) {
  const container = root.querySelector<HTMLElement>('#zyro-root');
  const state = root.querySelector('#zyro-root-data');
  if (!container || !state?.textContent) throw new Error('Missing hydration data');
  // Page and validateProps are the same authored component/validator used during SSR.
  return hydrate(Page, container, {
    data: state.textContent, validateProps, signal: context.signal
  });
}
```

Static documents need no route modules. Already-hydrated initial pages supply
`initialOwner` to transfer their teardown explicitly. Preparation happens detached;
stale/cancelled results are disposed before they can commit. The previous page
remains owned until replacement. Module `context.load(key, producer)` memoizes at
most 16 promises within this navigation's captured authenticated scope, then clears
them; no authenticated loader result is reused across navigations or principals.
Use its signal for cooperative fetches. `context.onDispose()` registers at most
32 LIFO cleanups, including rollback after a preparation failure.

Defaults are 1 MiB HTML, 10000 document elements, four active unsettled navigations, 10-second cooperative
deadlines and no prefetch. Limits cap at 16 MiB, 100000 elements, 32 active jobs and 120 seconds. Manifests allow at most 1024 routes and eight layout IDs per route.
Optional `prefetch: true` warms only declared module assets, never private HTML or
loaders: two unsettled fetches, eight remembered assets by default (maximum 32),
100ms pointer/focus intent delay, 30-second bookkeeping expiry, 512 KiB per asset,
SRI, omitted credentials and rejected redirects. The browser's own HTTP cache owns
bytes. Pending work keeps slots until actual settlement; AbortSignal does not
force-cancel arbitrary JavaScript. `close()` removes listeners/announcements,
restores scroll-restoration ownership and drains work before releasing the root.
There is one router per window. Error callbacks receive fixed codes, not URLs,
response bodies or private causes. APIs follow the
[History](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface)
and [Fetch](https://fetch.spec.whatwg.org/#request-class) contracts; local jsdom checks
are not a real-browser navigation/CSP qualification.

### Registered server actions and forms

`zeruxjs/actions` is an opt-in **server-only** entry. Explicitly register an
allowlisted schema, authorization callback and database write; exported functions
are never discovered as remote calls. `attach(api)` installs exact opaque routes
and generation cleanup, preflighting collisions and rolling back partial attachment.
References are HMAC-derived for this application's origin/path/name. Shared instances
must use the same private 32-byte application key and registration names. References
are not authorization. Importing this entry from a client graph is already rejected
by the compiler's server-service boundary. Only HTML form URLs and signed hidden
fields cross the boundary; no closure, server source or credential is serialized.

Declare the optional `@zeruxjs/validator` and `@zeruxjs/security` peers when using
actions. `zeruxjs/action-stores/sqlite` exposes a separate SQLite helper using the optional
`@zeruxjs/db-sqlite` peer; it imports no native driver on its own. Core/browser
navigation do not import these optional server entries.

The host must supply verified identity and a **durable** action journal. This minimal
plugin is complete at the framework boundary: its arguments are private host-owned
services, not values accepted from the browser. `authenticate` should map an existing
`createSharedAuth().verifySession(...)` result (or another verified session) to the
principal; resolve its account binding server-side, never from submitted tenant data.

```ts
import type { ZeruxPluginApi, ZeruxRequestContext } from 'zeruxjs';
import type { TransactionDatabase } from '@zeruxjs/db';
import type { CsrfTokenManager } from '@zeruxjs/security';
import { escapeHtmlAttribute } from '@zeruxjs/security/encoding';
import { strictObject, string, pipe, minLength } from '@zeruxjs/validator/schemas';
import { createFetchRoute } from 'zeruxjs/fetch-route';
import { createActionRegistry, renderActionFields,
  type ActionStore, type ActionPrincipal } from 'zeruxjs/actions';

export function registerNoteActions(api: ZeruxPluginApi, host: {
  key: Uint8Array;
  csrf: CsrfTokenManager;
  store: ActionStore<TransactionDatabase>;
  authenticate(request: Request, context?: ZeruxRequestContext): Promise<ActionPrincipal | null>;
  canWrite(principal: Readonly<ActionPrincipal>): Promise<boolean>;
  invalidateTenant(tenant: string, signal: AbortSignal): Promise<void>;
}) {
  const actions = createActionRegistry({
    origin: 'https://app.example', key: host.key, csrf: host.csrf,
    store: host.store, authenticate: (request, context) => host.authenticate(request, context)
  });
  const save = actions.register('save-note', {
    schema: strictObject({ tenant: string(), note: pipe(string(), minLength(1)) }),
    authorize: async (input, context) => input.tenant === context.principal.tenant &&
      await host.canWrite(context.principal),
    async write(tx, input, context) {
      const result = await tx.insert({ table: 'notes', values: {
        tenant: context.principal.tenant, note: input.note
      }});
      if (!result.ok) throw new Error('Persistence failed');
    },
    successRedirect: '/notes/new',
    invalidate: context => host.invalidateTenant(context.principal.tenant, context.signal)
  });
  actions.attach(api);
  api.addRoute({ pattern: '/notes/new', method: 'GET', handler: createFetchRoute(
    async (request, context) => {
      const principal = await host.authenticate(request, context);
      if (!principal) return new Response('Authentication required', { status: 401 });
      const form = actions.form(save, principal);
      return new Response(`<!doctype html><html><head><title>New note</title></head><body>
        <form id="note-form" action="${form.action}" method="post">
          ${renderActionFields(form)}
          <input type="hidden" name="tenant" value="${escapeHtmlAttribute(principal.tenant)}">
          <label>Note<input name="note" id="note"></label>
          <span id="note-error"></span><button>Save</button>
        </form></body></html>`, { headers: {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'
        }});
    }) });
  return { actions, save };
}
```

This form works without JavaScript: successful persistence and invalidation return
303 to the registered local redirect. Failed forms return sanitized HTML with
status 4xx/5xx, fixed messages and schema-declared field paths; private values are
not echoed. Keep existing host CSP/security headers on the form page. The configured
origin is independent of Host/forwarded headers. Every invocation, including a
committed replay, authenticates, verifies exact origin and session-bound CSRF,
validates input and authorizes the tenant/operation before consulting persistence.
Use `createCsrfProtection` from security or another host-owned manager with that
public contract. Never accept the principal/session ID from the form.

The initial transport deliberately accepts only POST URL-encoded forms. JSON and
multipart/file requests return 415; the file allowance is **zero**. Repeated fields,
including reserved hidden fields, reject instead of silently selecting a value.
Schemas control unknown fields/coercion; use `strictObject` when extras must reject.
Defaults are 32 KiB body and 128 KiB canonical data, 64 fields including the two hidden fields,
32 unsettled operations and a 10-second cooperative deadline. Body limits can rise
to 128 KiB, fields to 200, active operations to 1024 and deadlines to 60 seconds.
Validated output must be inert bounded JSON (24 levels/2000 nodes); it is cloned and
frozen before authorization/writing. Dates, files, class instances/functions and
cyclic transform outputs are unavailable. Validator HTTP adapters own reader and
issue sanitization. Error responses use framework codes without raw causes/values.

`zeruxjs/action-form` optionally enhances an authored form. Prebundle it as browser
code through your existing explicit client asset pipeline; it never imports server
registries, Node crypto or transaction drivers:

```ts
import { enhanceActionForm } from 'zeruxjs/action-form';
const form = document.getElementById('note-form');
const control = document.getElementById('note');
const description = document.getElementById('note-error');
if (!(form instanceof HTMLFormElement) || !control || !description) {
  throw new Error('Missing form controls');
}
export const enhancement = enhanceActionForm(form, {
  resolveField: path => path === 'note' ? { control, description } : undefined
});
// Mount/navigation owner calls await enhancement.close() before releasing the form.
```

It owns pending/aria-busy state and submit-button disabling, ignores duplicate
submissions while pending, restores ARIA/disabled state, and focuses the first
resolved invalid control or its own alert. It reuses validator's disposable ARIA
feedback; no frontend framework is embedded. Submitter overrides remain native.
Forms must be same-origin POST/URL-encoded forms. `optimistic: { apply, rollback,
commit? }` is explicit: failed or uncertain responses roll back; confirmed commits
call `commit` and never rerun the write. Optimistic/field callbacks must be synchronous. Navigation handoff promises are observed but not awaited, so a navigation owner can dispose the form without a dependency cycle. A confirmed
write whose cache invalidation fails returns 503 with `outcome: 'committed'`; the
enhancer keeps the optimistic result and asks for refresh. An ambiguous write returns
`outcome: 'uncertain'`; network errors are also treated as uncertain. No mutation is
retried automatically. The original hidden idempotency key is retained for deliberate
reconciliation/replay. A new intended mutation needs a fresh server-issued form/key; never mint one automatically to retry an uncertain operation. UI disabling is **not** idempotency or authorization.

#### Durable action journal and transaction ownership

`createPinnedActionStore({ transaction, journal })` consumes the existing
`@zeruxjs/db` `DatabaseTransaction`, not a second transaction system. Unsupported
connectors must reject before use; use their negotiated pin. The journal explicitly declares `durable: true` (including physical persistence, not an in-memory SQLite database) and implements:

- `reserve(tx, claim)`: atomic create-if-absent on the unique hashed key, or return
  `pending`, `committed` or `conflict` after comparing the exact input digest.
- `finish(tx, claim)`: exact-owner/digest pending-to-committed CAS with an exact
  affected count. It must run on the supplied pin, together with the business write.

The first transaction durably reserves the claim. A separate transaction runs the
business write and completion record on **one connection/session**. A concurrent
claim never enters the write. If the second transaction fails or its commit is
indeterminate, the durable reservation stays blocked; it is never automatically
reclaimed/retried. A lost acknowledgement may have left a committed record: a
freshly authorized replay confirms that record and reruns only idempotent cache
invalidation, not the mutation. Same key with different validated input conflicts.

`createSqliteActionStore({ transactionSync, journal })` from `zeruxjs/action-stores/sqlite` instead consumes the existing
SQLite `SqliteConnector.transactionSync`. Both journal methods and the action write
must be synchronous; declared async writes reject during registration, and returned
thenables reject inside the guarded transaction. There is no await across BEGIN/
COMMIT and no conversion of SQLite's unsupported async transaction capability into
a claimed supported feature. Both factories borrow the transaction/journal; registry
shutdown never closes the host's database. Journal types stay with this framework
integration; driver/pin types stay owned by their database packages.

Production journals are an explicit prerequisite: create their unique constraints
through host migrations, enforce bounded row quotas, retain records until signed
key expiry, and own durable storage/backup/cleanup. Ordinary cache get/set or an
in-memory map does not satisfy `action-atomic-v1`. Journal expiry includes the declared maximum inter-instance clock skew (default five seconds, configurable 0–60 seconds); never purge earlier. Keys are HMAC-bound to application,
action, principal, tenant and nonce; stored fingerprints contain no submitted values.
Default signed-key lifetime is 15 minutes (configurable 1 second–24 hours). Expired
keys reject before dispatch even if the journal has purged them. Pending/uncertain
records may be reconciled only with durable proof; never reuse their signed key to
repeat an uncertain external effect. Keep clock differences within that declared bound. Changing the private
application key invalidates references/forms; coordinate changes across instances.

Writes are database-only. External email/payment effects require a real transactional
outbox/host reconciliation contract, not an awaited network call inside this write.
Invalidation runs only after confirmed persistence, has its own bounded cooperative
signal (at most five seconds), and must be idempotent because committed replays can
repeat it. A crash between commit and invalidation still needs an outbox/reconciler
or cache expiry; this helper does not promise durable cache delivery. Cancellation
retains active slots until actual callbacks/driver work settle. No Promise timeout
claims forced cancellation or rollback. The native disposable SQLite/WAL checks and
simulated acknowledgement failure do not establish live PostgreSQL/MySQL/provider
or real-browser acceptance.

### Explicit static export

`zeruxjs/static-export` adds `exportStaticSite`, separate from the Node
`buildProjectSources`/`zerux build` pipeline and the docs application's exporter.
Nothing is exported by default; it does not bootstrap applications, connect
services, execute file-route handlers or discover remotely callable functions.
Install/declare the optional `parse5@7.3.0` and `@zeruxjs/security` peers when using
this entry. Normal Node builds/start behavior is unchanged.

A minimal request-free ZyroJS build script uses public imports:

```ts
import { exportStaticSite } from 'zeruxjs/static-export';
import { createZyroRenderer } from 'zeruxjs/renderers';
import { h, renderToString } from 'zyrojs/dom';

export async function buildPublic(rootDir: string) {
  return exportStaticSite<{ heading: string }>({
    rootDir, origin: 'https://example.test', basePath: '/catalog',
    outDir: '.zerux/static',
    renderer: () => createZyroRenderer<{ heading: string }>(view =>
      renderToString(h('main', {}, h('h1', {}, view.heading)))),
    routes: [
      { path: '/catalog', access: 'public',
        view: () => ({ heading: 'Welcome without JavaScript' }) },
      { path: '/catalog/posts/:slug', access: 'public',
        params: () => [{ slug: 'first' }, { slug: 'second' }],
        view: params => ({ heading: params.slug }) },
      { path: '/catalog/old', access: 'public',
        redirect: '/catalog/', status: 308 }
    ],
    notFound: { access: 'public', view: { heading: 'Page not found' } }
  });
}
```

Run this function from your authored build script after compiling it with your
configured TypeScript tooling. It writes deployment-root files including
`catalog/index.html`, `catalog/posts/first/index.html`, `catalog/404.html` and
`static-export.json`. Canonicals use the exact configured origin and normalized
base path, with trailing-slash directory URLs. Route patterns include the mount;
base paths are not blindly prepended to routes. No JavaScript/hydration is needed.
The existing static-HTML-only renderer contract is the registration authority (streaming/hydration/client-only capabilities must be false). A fresh
export-owned adapter is disposed once after successful rendering or failure;
render-scoped callbacks are drained through the registry. Factory failures own
any resources acquired before returning their adapter.

All selected pages and the 404 must explicitly declare `access: 'public'`.
Authenticated/private declarations, unsupported route properties, missing dynamic
enumeration, extra/missing parameter names, duplicates and traversal reject. Dynamic
values are decoded URL-safe ASCII segments (`A-Z`, `a-z`, digits, `.`, `_`, `~`, `-`;
never `.` or `..`). Terminal `:rest*` values may join such segments with `/`.
Every selected route must enumerate at least one instance. No optional parameters,
implicit wildcard fallback or filesystem route discovery is inferred.

Each page's `view(params, context)` receives only a signal/deadline, pathname,
canonical URL and approved asset resolver. Requests, cookies, headers, environment,
services and action helpers are unavailable through that context. Public view data
is cloned/frozen bounded JSON; private-key names reuse the framework's manifest
redaction policy, and classes/functions/getters/cycles reject. HTML is a **fragment**;
the exporter owns document framing and canonical metadata. Request-owned response
headers, forms, actions, scripts (including hydration bootstrap), active embeds and
responsive `srcset` are unsupported. Static/HTTP-renderer capabilities are not
interchangeable: the HTTP document factory's no-store/CSP-nonce response rejects.
The output checks use [parse5](https://parse5.js.org/functions/parse5.parseFragment.html),
not a regular-expression action parser.

This is not a sandbox or universal secret scanner. View/render callbacks are
trusted build code: do not read request/private services, put credentials under
innocuous field names, or mark protected data public. Module classification and
public declarations never grant authorization. Each instance is rendered twice to
catch unstable output; deterministic callbacks/data remain the author's contract.
There are no timestamps, request data or random IDs in the emitted manifest.

#### Public assets and hosting

To include existing built assets, pass an explicit selection from the actual
`public-assets.json` produced by `buildProjectSources`:

```ts
// Additional exportStaticSite options; manifest is the parsed public-assets.json.
assets: {
  directory: '.zerux/build/public', manifest, include: ['/logo.png', '/site.css']
}
// A view may use context.asset('/logo.png') to obtain '/catalog/logo.png'.
```

The source directory must be a project-relative real directory. Selected assets
must match their manifest byte counts and SHA-256 integrity. Only declared
CSS/images/fonts/text/XML files are copied; JavaScript, source maps, application
modules and private server manifests are not copied. Files retain public relative
paths under the mount, and every emitted HTML/asset file has a content hash in
`static-export.json`. HTML resource URLs must resolve to a selected asset;
external hyperlinks remain links. The exporter does not bundle/rewrite CSS or
inspect its dependency graph: prebuild CSS for the mount and select its referenced
assets explicitly. Non-root absolute URLs inside CSS remain the asset author's
responsibility. Source paths/configuration do not enter the public manifest.

Apply `manifest.hosting` in your hosting configuration. It declares the physical
404 file and **404 status**, explicit local redirects and canonical slash redirects.
Missing URLs must return that 404, not an index page with status 200. Redirects are
metadata, not a JavaScript/meta-refresh substitute; full-static targets must resolve
to an exported page/redirect/404, and cycles reject. Targets stay within the mount.
No hosting vendor configuration is guessed or deployed automatically.

`mode: 'mixed'` exports the same selected public pages but marks unlisted URLs as
`node-server-required`. Configure the host to serve those files and route remaining
requests to the existing Node application, where authentication/actions still run.
A file-only host cannot run those functions. The real 404 artifact remains available;
the Node application's own errors and hosting precedence remain host-owned. There
is no universal SPA fallback and no serialization of a server runtime into HTML.

#### Budgets, staging and failure behavior

Defaults: 1000 concrete routes/redirects (plus the 404), 32 MiB total output,
1 MiB per HTML page, 30 seconds per export and 5 seconds per enumeration/render.
Limits cap at 10000 instances, 512 MiB total, 16 MiB per page, five minutes total
and 30 seconds per route operation. There are at most 256 route definitions,
1000 selected assets, 5000 public-data nodes and 24 public-data levels. Callbacks
are sequential, signals are cooperative, and iterators/scoped cleanup drain before
release; a Promise timeout never claims forced JavaScript cancellation.

Output is staged **inside the project** under the output parent. Shared build path
guards reject source/output overlap and symlinked parents; file reads reject links
and validate integrity. An exclusive per-output lock rejects concurrent exports.
Only an owned, unedited previous export may be replaced. Enumeration, validation,
render, resource-disposal and budget failure leave it intact; staging/locks are
removed on normal failure. Completed candidates are promoted with the existing
same-filesystem rename/backup/rollback pattern, not published or deployed. This is
not a crash-atomic deployment transaction; readers should consume completed output,
and a crash may require inspecting/removing a stale lock/backup manually. Project
files must have a trusted exclusive writer; this is not isolation against a hostile
process racing filesystem changes. Normal `zerux build/start` and the docs exporter
remain separate.

## Explicit queue backend selection

Legacy `queue:{enabled:true,redis,queues,workers}` remains BullMQ-specific. Opt in to the backend-neutral facade with `queue:{enabled:true,required:true,selection}` from `selectQueueBackend` in `@zeruxjs/queue/neutral`. Construct the selection with a trusted explicit factory from `@zeruxjs/queue/backends`; see the [queue example and capability matrix](../@zeruxjs/queue/README.md#opt-in-neutral-backend-selection). No packages are scanned or loaded from request configuration. Backend options/required capabilities validate before database/cache connections, and mixing selection with legacy queue settings rejects. All options/factories remain private.

Each generation owns the selected backend. Partial startup runs its registered cleanup in reverse order; a required failure rolls back cache/database too. An optional failure degrades with a fixed, secret-free warning and retains the cause only in trusted scope diagnostics. On shutdown queue resources close before cache/database. Native processor settlement/grace policies remain backend-owned; no forced JavaScript cancellation or automatic restart is inferred. The neutral BullMQ path does not mount dashboards; use the unchanged legacy configuration for native dashboard routes.

### Explicit named search service

Set `search: { enabled: true, registration }`, where `registration` comes from
`registerSearchService` in `@zeruxjs/search/adapters`. Search is a supported built-in
service and a valid custom-service dependency; it is not a root index-signature
extension. Registration validates before provider acquisition, starts inside the
generation, and closes in reverse service order. Enabled search failure rolls back
the candidate. Search callbacks/endpoints/credentials remain private; no HTTP route
or active global manager is installed. Register only trusted factories, authorize
each operation from verified host identity, and propagate request cancellation.
See [search adapter contracts and example](../@zeruxjs/search/README.md#explicit-external-adapters-and-named-services).

### Opt-in route data cache

`zeruxjs/route-data-cache` exports `createRouteDataCache` and
`routeDataCacheKey`; imports allocate no cache or listeners. See
[the executable public-import example](examples/route-data-cache.mjs).
A host owns one coordinator per application generation and borrows a scoped
`CacheManager`. Close the coordinator before the manager. This entry is server-only;
it does not automatically cache routes, responses, headers or cookies.

Keys hash application, verified tenant, optional verified principal, registered
route ID, exact path, sorted parameters and locale. Supply every data dependency
in these fields; do not cache permission-dependent data without a principal.
The host must derive scope after authentication/authorization. Query strings,
headers and cookies are deliberately not inferred as trusted cache dimensions.
Cached values must be bounded plain JSON; no class instances/accessors/functions.
Never put secrets in an explicitly public result. Public opt-in rejects principals.
`result.response()` uses existing `cached`/ETag handling, defaults to no-store and
only permits public max-age for explicitly anonymous public data. Stale output is
no-store, so it cannot reset a shared freshness window. HTTP validators remain
content-derived. Route authorization always runs before this helper.

`freshMs` is 1–86400000; `staleMs` is an additional 0–86400000 window.
At the fresh boundary a stale read starts one process-local refresh and returns
old data; a failed refresh never extends freshness. At the stale boundary readers
await a refresh. Cache outages reject without silently invoking the producer.
Default bounds: 1024 metadata entries, 16 unsettled reads/refreshes, 1 MiB JSON,
32 levels and 32 tags. Evicted metadata disconnects its storage key; entries have
backend TTLs rounded up to seconds, while exact freshness uses stored timestamps.
Policies changing for a key retire the old entry. Set `development:true` to bypass
reads deterministically; writes/invalidation and budgets retain the same rules.

`invalidate({tenant,tag})` or `invalidate({tenant,path})` matches exact paths/tags
within this application's verified tenant. These are **cache tags**, unrelated to
`@zeruxjs/tags` tracking containers. Invalidation retires local metadata before
returning. In-flight reads/refreshes reject if retired; each entry has a unique
storage address, so a late backend write cannot populate its replacement. Old
bytes expire naturally; invalidation does not promise physical erasure. Use the
existing action definition's post-commit `invalidate` callback; do not invalidate
before confirmed persistence. No management HTTP endpoint is installed: hosts own
fresh authorization, CSRF/origin controls and rate limits at that boundary.

Coordination is explicitly process-local even with Redis backing. Each coordinator
uses a private random namespace: no cross-process reuse, distributed invalidation,
locks or durability are claimed. `coordination:'distributed'` rejects because the
cache contract has no atomic fencing primitive; conditional set/counters alone do
not prove eviction-safe invalidation. `capabilities` exposes borrowed provider
metadata without upgrading unknown guarantees. Memory remains volatile.

Caller cancellation stops that caller waiting, without aborting a coalesced job
needed by another caller. Producers receive a coordinator deadline/AbortSignal;
timeout and close signal cancellation but cannot force JavaScript or native cache
operations to settle. Slots remain occupied until actual settlement, and close
awaits all owned work, preserving borrowed cache ownership. Noncooperative work
can therefore delay close. No background timer/scheduler or production Redis/live
browser qualification is implied.

HTTP policy terminology follows [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html).
Application data invalidation does not purge a browser/CDN response already cached
under an explicit public policy; choose a conservative HTTP max-age separately.

## Coordinated privacy operations

`zeruxjs/privacy` is an opt-in Node-only headless coordinator for host-authorized
subject exports/erasure. Importing it starts no jobs, routes, service discovery or
provider calls. [Public example](examples/privacy.mjs) injects private stores and
participants. Register it as an explicitly declared custom service, return `close`
as its disposer, and declare service dependencies so it drains before those stores.
No new root config key, automatic HTTP API or global manager is introduced.

The host must supply a verified account-linkage resolver, per-operation tenant/
subject authorization, approval-evidence verification and a versioned privacy
policy. Email alone, caller roles, hashes or a job ID never prove identity. The
resolver returns opaque tenant/subject references; authorization runs on create,
inspect, preview, approve, resume and download. Check HTTP authentication and
Origin/CSRF at the host write boundary; callbacks are not a substitute for it.
Hashes/linkable references remain personal data under applicable host policies.

### Existing service coverage and explicit participants

| Owner inspected | Existing public contract | Required host binding / exclusions |
| --- | --- | --- |
| Analytics | Versioned schemas; site/cutoff retention; durable ledger preview/pinned purge and numeric sidecars | Verified subject index and lawful scope; never substitute an all-site purge for subject erasure. Coordinate unprocessed work and sidecars through analytics policies. |
| Email contacts/inbound | Versioned contact delete, dry-run retention, local inbox erase | Host subject/account mapping and holds. Suppression/consent/audit records may need retention; remote IMAP/POP3 mail and attachment objects are separate. |
| Auth | Fresh-authorized session/challenge revocation in host CAS stores | Account index and provider/passkey policy. Revocation is not account/provider erasure; never export token digests, keys or challenges. |
| Files/media/assets | Authorized object operations, named providers and explicit catalogs | Host-owned subject/object index, version/ownership checks and receipt journal. Borrowed/shared binary references are not automatically deletable. Multipart journals, backups and provider versions require explicit coverage. |
| Tags | Versioned governed documents and controlled provider dispatch | Tenant-bound document edits through governance; published releases/destination records and remote provider data are separate. No universal subject-record API. |
| Reports | Versioned CAS documents, tenant-authorized source registry | Subject/document association is host-owned. GA4/AdSense adapters are read-only reporting, not remote erasure APIs. |

No built-in participant guesses these missing mappings. Explicit `PrivacyParticipant`
adapters consume the owning service's public APIs and declare versioned find/export/
erase capabilities, record categories and outside-scope codes. Use inert, nonpersonal
codes, not payloads or signed URLs. A participant that cannot find or perform the
operation is `unsupported`; external/provider/backups are never reported erased.
Missing subject indexes must be reported, not replaced with unbounded scans or
email matching. The coordinator owns orchestration types, not package-specific data.

### Preview, approval and crash behavior

Create a tenant/subject-bound job, then call `preview` repeatedly (one participant
page per call). Preview calls only read-only discovery; it never invokes execute or
writes export data. Counts are bounded live observations, not a database snapshot.
Show the complete plan/holds/limitations before approval. Approval binds job, scope,
operation, policy version, participant versions and preview summary by hash; the
host verifier returns only an opaque evidence reference, actor and expiry. Evidence
bodies and deleted payloads never enter checkpoints. Expired approval/jobs fail
closed; this initial API does not silently renew approval or reset an uncertain job.

After approval, each `resume` processes at most one page. `PrivacyJobStore` must
provide current tenant-keyed reads, linearizable create/CAS with unique revisions
and an atomically retained metadata-only revision journal. It must be durable,
private and subject to host retention/hold policy; no in-memory production fallback
is supplied. Store checkpoints/cursors privately: opaque cursors can be linkable.
Preview failures retain `failed/UNAVAILABLE`; effect/checkpoint uncertainty retains
`running` or `uncertain` without advancing the cursor. Error messages/codes are fixed;
private causes exist only for restricted host diagnostics.

**Participant receipt requirement:** `execute` must atomically persist a durable,
idempotent page receipt with its local effects under `pageKey`. It must recheck
subject/tenant authorization and retention holds immediately before modifying data.
`recover` returns that exact completed receipt or null for unresolved/in-flight work;
it must not repeat effects. A crash after commit but before coordinator checkpoint
therefore recovers the same page. A null recovery stays uncertain indefinitely until
host reconciliation establishes its outcome. Ordinary cache get/set, a local Set,
or an external API success without a durable receipt cannot implement this contract.
Do not declare a participant capable if its store/provider cannot supply it. Distinct
stores do not share a transaction; no global atomic erasure or automatic legal
compliance is claimed. Concurrent invocations contend on checkpoints, not on
arbitrary process locks. No expired lease is guessed safe to steal.

Each page rechecks authorization; revoked access stops further dispatch/download.
Successfully processed records, retained holds, unsupported providers and uncertain
work remain distinguishable. A job finishes `partial` if holds or outside-scope
records remain, even when all local operations finished. Hold evaluation belongs to
the participant and declared host policy. New/concurrent records can change counts;
approval authorizes the bounded subject scope, not a frozen list of record IDs.

### Private portable exports and resource budgets

Exports are JSON Lines with `{participant,record}` envelopes. A required host
projection approves export fields; a bounded JSON encoder rejects secret key names,
non-JSON objects, excessive nesting and oversized values. This cannot detect a
secret intentionally hidden under an innocent field name. Export only authorized
subject data and redact third-party information. Erasure receipts cannot carry
payloads; checkpoints store only scope, approval, coverage, cursors, counts and codes.
For optional host CSV views use `privacyCsvCell` to quote and neutralize formulas;
JSONL itself does not interpret spreadsheet content or HTML.

`PrivacyExportStore.putPage` privately persists immutable, idempotent page bytes
before checkpointing; same key/different bytes must fail. Participants' recovered
export receipts must preserve the same data. The export store independently enforces
tenant/job access, expiry and private cleanup/retention, and returns ordered bytes
through `read`, never public URLs. Downloads require a terminal completed/partial
export, check access/expiry for every chunk and cap total bytes. Host responses must
use private/no-store, attachment disposition, nosniff and the JSONL content type.
Already delivered bytes cannot be revoked or recalled.

Defaults: 16 participants maximum, 50 records/page (maximum 100), 1000 pages per
participant (maximum 10000), 4 pending operations (maximum 16), 5-second cooperative
operation/download deadline, 24-hour job lifetime, 1-hour export expiry and 10 MiB
export ceiling (maximum 100 MiB). Export pages/chunks cap at 256 KiB. Jobs expire
within 7 days. Limits are validated and no unbounded background scan/retry is started.
Streams follow consumer backpressure. Callers must close/return download iterators
on disconnect. Signals cannot force-stop arbitrary adapters or roll back committed
writes; slots and `close()` wait for actual settlement. `close()` aborts owned scopes
and drains them, but never closes borrowed job/export stores or participant services.

Synthetic checks: `node --test test/privacy.test.mjs` after building. They exercise
preview-only behavior, holds/tenant separation, approval/revocation, lost checkpoints,
uncertain recovery, private export/expiry, secret rejection and cleanup. No real user
data was deleted. Production durable stores/receipts, account proof, legal policies,
provider/backups reconciliation and host HTTP/browser integration remain prerequisites.

Loader integration: standard `file:`, `node:` and `data:` imports delegate to Node resolution before custom path aliases. Alias validation still rejects unsafe custom names; standard URLs are not private registry keys.
