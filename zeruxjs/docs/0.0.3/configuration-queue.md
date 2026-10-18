# Queue configuration

Set up queue with exact runtime options, typed JavaScript/TypeScript examples and lifecycle policies.


## Before you configure it

Install the runtime and the packages used by this feature in the application directory. Keep the dependency lockfile committed. Configure only services the application actually uses; a public package name is not automatic service registration.

```sh
npm install zeruxjs @zeruxjs/queue @zeruxjs/cache-redis
```

## JavaScript application setup

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  queue: {
  enabled: true,
  required: true,
  redis: { url: process.env.REDIS_URL },
  prefix: 'application-jobs',
  queues: [{ name: 'maintenance', defaultJobOptions: {
    attempts: 3, backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 }, removeOnFail: { count: 3000 },
  } }],
},
};
```

This example is a server configuration. Supply the referenced environment values through the server process before starting it. The documentation site's static exporter does not start this service merely because it imports a config file.

## What each setting does

Queues start only with `enabled: true`. They use Redis/BullMQ, not the SQL/Mongo analytics database and not the in-memory cache connector. Installing the cache Redis adapter alone does not create queues. Use a separate queue prefix and do not supply ioredis `keyPrefix` to BullMQ connections.

`queues` lists the names callers may use. Queue-level `defaultJobOptions` sets retry/backoff, retention and repeat options; a job can provide its own supported options. Retry counts are bounded work policy, not exactly-once delivery. Treat processors as idempotent and pass record IDs rather than credentials or entire private documents in job payloads.

`workers` is optional. A producer-only process can configure queues without running processors. For workers, supply a processor under the exact queue name, then tune concurrency, lock duration and any limiter against actual workload. CPU work in the same event loop can prevent lock renewal; move CPU work to a suitable worker strategy.

## TypeScript configuration

For a TypeScript application, use `zerux.config.ts`. Validate the service object separately so errors point to its option rather than a large application object. `NonNullable` removes the optional top-level absence; it does not invent defaults or validate external data at runtime.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

type Options = NonNullable<ZeruxConfig['queue']>;
const options = {
  enabled: true,
  required: true,
  redis: { url: process.env.REDIS_URL },
  prefix: 'application-jobs',
  queues: [{ name: 'maintenance', defaultJobOptions: {
    attempts: 3, backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 }, removeOnFail: { count: 3000 },
  } }],
} satisfies Options;
export default { queue: options } satisfies ZeruxConfig;
```

In JavaScript, the JSDoc annotation provides editor assistance. In TypeScript, `satisfies` checks the shape while preserving inferred literal values. Neither changes the runtime behavior or establishes a network connection during a typecheck. See [TypeScript application development](/zeruxjs/docs/0.0.3/typescript.md) for strict settings and validation boundaries.

## Lifecycle and failure policy

`required: true` propagates queue initialization failure; an optional queue failure marks the service degraded. A producer must distinguish unavailable delivery infrastructure from successful enqueueing. `readyTimeoutMs` and `shutdownGraceMs` control readiness and shutdown timing.

Redis persistence and eviction policy are deployment decisions. Use durable storage, sufficient memory, credentials and TLS where needed. Queue dashboards require explicit authorization and CSRF callbacks. Administrative permissions should be narrower than ordinary producer permissions. Stop the owning service during application shutdown so connections, event streams and workers are released.

## Verify a real integration

1. Start the application with just this feature and its declared dependencies configured.
2. Check service readiness, then perform one operation through the application API.
3. Test a failure path such as unavailable infrastructure or a rejected input.
4. Restart the runtime and verify that owned resources close and state behaves according to the chosen storage model.
5. Repeat with the production build and the real deployment identity; a successful static docs build does not test external services.

## Declared options

The following table is captured from the source contract used by runtime bootstrap. Optional means a property may be omitted; it does not mean every combination is meaningful. Callback and nested adapter shapes must satisfy the full declared type.

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `required` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `redis` | `{url?:string;host?:string;port?:number;username?:string;password?:string;db?:number;tls?:Record<string,unknown>;cluster?:{nodes:Array<{host:string;port:number}>};keyPrefix?:never}` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `queues` | `Array<string \| {name:string;defaultJobOptions?:Record<string,unknown>}>` | Yes | Passed using this declared shape; omission is allowed only when marked optional. |
| `workers` | `Record<string,{processor:(job:unknown)=>Promise<unknown>\|unknown;concurrency?:number;autorun?:boolean;lockDuration?:number;limiter?:{max:number;duration:number}}>` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `readyTimeoutMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `shutdownGraceMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `onWorkerError` | `(queue:string,error:unknown)=>void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `events` | `{enabled:true;onEvent?:(event:{queue:string;type:string;jobId?:string;at:string})=>void;onError?:(queue:string,error:unknown)=>void}` | No | Optional Redis-stream job lifecycle events; payloads are never forwarded to callbacks. |
| `dashboard` | `{ authorize:(request:Request)=>unknown\|Promise<unknown>; verifyCsrf:(request:Request,principal:unknown)=>boolean\|Promise<boolean>; csrfToken:(request:Request,principal:unknown)=>string\|Promise<string>; prefix?:string; publicOrigin?:string; }` | No | Host-validated operations authorization. Queue management is never exposed as public routes. |
| `administration` | `{ authorize:(action:'inspect'\|'retry'\|'pause-queue'\|'resume-queue'\|'pause-worker'\|'resume-worker'\|'schedule-inspect'\|'schedule-create'\|'schedule-remove',queue:string,context:unknown)=>boolean\|Promise<boolean>; onAudit?:(entry:{action:string;queue:string;jobId?:string;success:boolean;at:string})=>void\|Promise<void>; maxPageSize?:number; }` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |

## Continue with the package

- [queue](/zeruxjs/docs/0.0.3/package-queue.md)
- [durable email](/zeruxjs/docs/0.0.3/durable-email.md)
- [thread workers](/zeruxjs/docs/0.0.3/thread-workers.md)
- [service lifecycle](/zeruxjs/docs/0.0.3/service-lifecycle.md)


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/services.ts)
