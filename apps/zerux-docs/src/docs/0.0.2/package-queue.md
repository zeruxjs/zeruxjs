---
{
  "title": "Queues and background jobs",
  "description": "Use durable Redis scheduling with explicit workers and at-least-once handling.",
  "section": "Packages",
  "order": 21,
  "sources": [
    "packages/@zeruxjs/queue/README.md",
    "packages/@zeruxjs/queue/package.json"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/queue"
}
---

## Producer and worker roles

A queue service manages named BullMQ queues. Producers add small job payloads; designated worker processes execute processors. Do not register processors on every web replica unless that deployment is intentional.

```ts
import { createQueueService } from '@zeruxjs/queue';
const queues = await createQueueService({
  redis: { url: process.env.REDIS_URL! }, prefix: 'shop',
  queues: ['emails']
});
await queues.queue('emails').add('send', { messageId: 'mail_123' }, { jobId: 'mail_123' });
await queues.close();
```

## Retry policy

BullMQ jobs are at-least-once. Make handlers idempotent through authoritative storage, not only a job ID. Producers fail quickly during Redis outages; worker connections use the blocking-operation retry policy. Delay/repeat schedules need live workers and durable Redis persistence.

## Data and lifecycle

Store identifiers rather than bodies, recipients, credentials or personal data in Redis. Queue cleanup precedes cache/database cleanup. Keep BullMQ prefix separate from cache prefixes and never use ioredis keyPrefix. Use noeviction and a persistence policy appropriate to recovery needs.

## Administration

Operations are denied without administration.authorize. The optional dashboard additionally requires host session authentication and CSRF callbacks. Inspect returns bounded redacted summaries; raw queue job APIs can reveal private data and are trusted server-only. Queue pause is global; worker pause affects one process.

## Durable email and events

The durable email processor uses a host-supplied atomic CAS record and treats sending failures/expired sending leases as uncertain. QueueEvents is a bounded stream, not a permanent audit trail. Persist operational events separately when retention matters and reconcile uncertain sends with provider evidence.

## Install and select the integration

```sh
npm install @zeruxjs/queue@0.0.2
```

This package participates in the runtime's **queue** integration. Start with [queue configuration](configuration-queue.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Configure Redis, named queues, retries/backoff and retention before adding producers. Enable processors only in processes intended to run workers; producer-only processes need not execute jobs. Use durable identifiers and idempotent handlers, and tune concurrency against downstream database/mail limits as well as CPU.

## TypeScript: inputs, results and ownership

```ts
import { createQueueService } from '@zeruxjs/queue';

type Inputs = Parameters<typeof createQueueService>;
type Result = Awaited<ReturnType<typeof createQueueService>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createQueueService>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

A job may run more than once after failure or loss of its lock. Record uncertain external effects rather than blindly resending or charging again. Avoid raw secrets in persisted job data. Keep queue administration authenticated and CSRF-protected, and verify shutdown grace, readiness timeout and Redis persistence with the real deployment.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### QueueJobOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `jobId` | `string` | Yes |
| `delay` | `number` | Yes |
| `priority` | `number` | Yes |
| `attempts` | `number` | Yes |
| `backoff` | `number \| {type:'fixed'\|'exponential';delay:number}` | Yes |
| `removeOnComplete` | `boolean \| number \| {age?:number;count?:number}` | Yes |
| `removeOnFail` | `boolean \| number \| {age?:number;count?:number}` | Yes |
| `repeat` | `{every?:number;pattern?:string;limit?:number;immediately?:boolean}` | Yes |
| `deduplication` | `{id:string;ttl?:number}` | Yes |

### QueueWorkerOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `concurrency` | `number` | Yes |
| `autorun` | `boolean` | Yes |
| `lockDuration` | `number` | Yes |
| `limiter` | `{max:number;duration:number}` | Yes |

### QueueDashboardOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `authorize` | `(request:Request)=>unknown\|Promise<unknown>` | No |
| `verifyCsrf` | `(request:Request,principal:unknown)=>boolean\|Promise<boolean>` | No |
| `csrfToken` | `(request:Request,principal:unknown)=>string\|Promise<string>` | No |
| `prefix` | `string` | Yes |
| `publicOrigin` | `string` | Yes |

### DurableEmailDeliveryOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `store` | `DurableEmailDeliveryStore` | No |
| `isSubscribed` | `(email:string)=>Promise<boolean>` | No |
| `isSuppressed` | `(email:string)=>Promise<boolean>` | Yes |
| `campaignGate` | `(record:Readonly<DurableEmailDeliveryRecord>)=>Promise<'allow'\|'defer'\|'suppress'>` | Yes |
| `send` | `(messageId:string,record:Readonly<DurableEmailDeliveryRecord>)=>Promise<unknown>` | No |
| `onUncertain` | `(messageId:string)=>void\|Promise<void>` | Yes |
| `leaseMs` | `number` | Yes |
| `now` | `()=>number` | Yes |

### TaskScheduleOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `attempts` | `number` | Yes |
| `backoffMs` | `number` | Yes |
| `startDate` | `string\|number\|Date` | Yes |
| `endDate` | `string\|number\|Date` | Yes |
| `limit` | `number` | Yes |
| `timezone` | `string` | Yes |

### QueueServiceConfig

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `enabled` | `boolean` | Yes |
| `redis` | `RedisConnectionSettings` | No |
| `prefix` | `string` | Yes |
| `queues` | `Array<string \| QueueDefinition>` | No |
| `workers` | `Record<string, {processor:JobProcessor} & QueueWorkerOptions>` | Yes |
| `readyTimeoutMs` | `number` | Yes |
| `shutdownGraceMs` | `number` | Yes |
| `onWorkerError` | `(queue:string, error:unknown)=>void` | Yes |
| `events` | `{enabled:true;onEvent?:(event:QueueEventNotice)=>void;onError?:(queue:string,error:unknown)=>void}` | Yes |
| `administration` | `QueueAdministrationPolicy` | Yes |
| `dashboard` | `QueueDashboardOptions` | Yes |

### QueueAdministrationPolicy

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `authorize` | `(action:QueueAdminAction,queue:string,context:unknown)=>boolean\|Promise<boolean>` | No |
| `onAudit` | `(entry:{action:QueueAdminAction;queue:string;jobId?:string;success:boolean;at:string})=>void\|Promise<void>` | Yes |
| `maxPageSize` | `number` | Yes |
