# BullMQ queue backend

Set up @zeruxjs/queue-bullmq with explicit lifecycle and capability boundaries.



BullMQ-backed named job queues, durable Redis storage, optional worker processors, delayed/retried/repeatable jobs, and generation-scoped ZeruxJS startup/shutdown. This is a **Redis-backed queue** and does not use the SQL/Mongo analytics storage as a queue backend.

## Dependencies

Install `@zeruxjs/queue-bullmq` in the consuming application. This package uses BullMQ v5 and ioredis v5. Repository development uses the committed root npm lockfile.

Redis must be compatible with BullMQ v5. On production Redis use `maxmemory-policy noeviction` and a durable persistence configuration appropriate to your recovery objectives; reserve adequate memory and monitor stalls/lag. BullMQ jobs are **at-least-once**, not exactly-once: handlers must be idempotent, especially for email sends, billing, and analytics checkpoint work. Never place raw secrets in job payloads. Use narrow service accounts and TLS where possible.

```ts
import {createQueueService} from '@zeruxjs/queue-bullmq';

const queues=await createQueueService({
  redis:{url:process.env.REDIS_URL!},
  prefix:'commerce',
  queues:[{name:'emails', defaultJobOptions:{
    attempts:5,backoff:{type:'exponential',delay:1000},
    removeOnComplete:{age:86400,count:2000},removeOnFail:{age:604800,count:3000}
  }}],
  workers:{emails:{concurrency:4,processor:async job => {
    // Use a durable email idempotency key; resolve the current message from DB.
    await deliverByMessageId(job.data.messageId);
  }}}
});
const q=queues.queue('emails');
await q.add('send',{messageId:'mail_123'},{jobId:'mail_123'});
await q.add('send',{messageId:'mail_456'},{delay:30000});
await q.addBulk([{name:'send',data:{messageId:'mail_789'}}]);
console.log(await q.counts('waiting','active','failed','completed'));
console.log(await queues.health());
await queues.close();
```

Producers use `maxRetriesPerRequest:1` and `enableOfflineQueue:false` so app requests fail instead of buffering indefinitely during outages. Worker connections use `maxRetriesPerRequest:null` for BullMQ blocking operations and can recover after disconnects. BullMQ creates additional blocking connections; do not share a single producer connection as a worker connection. The `prefix` property belongs to BullMQ; ioredis `keyPrefix` is explicitly prohibited.

## Framework lifecycle

```ts
// Private server-only zerux configuration (never expose credentials to browsers)
queue: {
  enabled:true,
  required:false,           // optional service degrades if Redis is unavailable
  redis:{url:process.env.REDIS_URL},
  prefix:'proworkspace',
  queues:['emails','analytics-maintenance'],
  workers: {
    // Register only in designated worker processes, not every web replica.
    // 'emails': {processor:sendMailProcessor,concurrency:4}
  }
}
```

Use `runtime.serviceScope.get('queue')` to access the initialized service, or construct it independently in worker processes. Queue shutdown executes before cache/database cleanup. Configuration, worker functions, and Redis credentials are removed from public runtime configuration. Set `required:true` only when the app must refuse startup if Redis is unavailable. Worker handlers are **not** automatically discovered and no queue HTTP/admin routes are exposed.

## Scheduled reconciliation of analytics

```ts
import {createAnalyticsReconciliationProcessor} from '@zeruxjs/queue-bullmq';
const job = analytics.createReconciliationJob('historic_2025', query, {leaseMs:60000});
const processor = createAnalyticsReconciliationProcessor({historic_2025:job});
// Add the worker to the queue service configuration:
const workers = {'analytics-maintenance':{processor,concurrency:1}};
// Schedule a bounded reconciliation page periodically; no automatic restart of completed passes.
await queueService.queue('analytics-maintenance').add(
  'analytics.reconcile', {id:'historic_2025'},
  {repeat:{every:60_000},jobId:'reconcile-historic-2025'}
);
```

The BullMQ worker processes **one bounded page per execution** via `runOnce()`. It relies on the reconciliation store’s durable DB checkpoint and fence. Use a trusted operator to call `restart()` for late events and to adjust deployment policy; recurring jobs do not restart completed reconciliation passes automatically. Consider job polling frequency, lease duration, worker concurrency and job retention together. Do not expose `createReconciliationJob` or `restart()` to untrusted HTTP clients.

## Operational verification

Run `npm test` in `packages/@zeruxjs/queue` and `packages/@zeruxjs/cache-redis` after installing deps. Set `QUEUE_REDIS_URL` to an isolated local Redis URL for the opt-in **real BullMQ integration test**; without that variable, it is skipped. The factory-injected tests check request and retry policies but are **not a substitute** for full multi-node or live-Redis certification. Validate Redis connectivity, worker failover and multi-server load in your deployment environment.

## Operations, QueueEvents, and queued email IDs

A service created with `administration.authorize` can access `service.operations`. If the callback is absent, **all operations are denied**; nothing is mounted on HTTP by default. Each request is checked independently. Use a server-validated authorization context, not user-provided role strings. Inspect operations return a **bounded**, payload-redacted `QueueJobSummary` rather than the full BullMQ Job with private `data`, `returnvalue` and failure stacks. Only a currently failed job can be manually retried, and the underlying BullMQ transition is atomic. Never build a public HTTP endpoint around `service.queue().getJob()`; it returns the raw job with sensitive data.

```ts
const service=await createQueueService({
  redis:{url:process.env.REDIS_URL!},queues:['emails'],
  administration:{
    authorize:async (action,queue,identity) => await permissions.can(identity,'queue.'+action,queue),
    onAudit:record => auditWriter.write(record), // best-effort; use a durable auditer if required
    maxPageSize:50
  },
  events:{enabled:true,onEvent:info => metrics.observe(info),onError:(queue,err)=>log.warn(queue,err)}
});
const operator=await authenticateHostRequest(request);
const status=await service.snapshot(); // trusted internal use
const failures=await service.operations.inspect('emails',{states:['failed'],limit:20},operator);
await service.operations.retryFailed('emails','email-mail_123',operator);
await service.operations.pauseQueue('emails',operator); // affects every worker
await service.operations.pauseWorker('emails',operator); // this process only
```

Optional `QueueEvents` creates a dedicated Redis-stream consumer connection per configured queue and emits only type, queue, timestamp and job ID (no job data). Events are a **bounded, auto-trimmed stream**, not a permanently durable audit record; for long-term analytics send these notices to persistent storage. Event streams close during managed shutdown. `snapshot()` reads Redis job counts per queue. Do not poll it too aggressively across hundreds of queues.

Queued mail uses `enqueueEmailById(queue,messageId,{delay,attempts})` and the `createEmailDeliveryProcessor` worker adapter. Redis contains only `{messageId}`, not email addresses, bodies, attachments, SMTP credentials or provider tokens. The worker loads the current message and checks **fresh marketing consent** before dispatch. An unsubscribed recipient is durably suppressed before the job is acknowledged, while a consent-store error rejects the job for retry. Transactional email does not require marketing opt-in. Tracking remains **independently opted-in on the saved email message**—a queued job does not switch it on or off.

```ts
const processor=createEmailDeliveryProcessor({
  load: async id => await mailStore.getDescriptor(id),
  isSubscribed: async recipient => await preferences.isSubscribed(recipient),
  suppress: async (id,reason) => await mailStore.suppress(id,reason),
  deliver: async id => await emailDelivery.deliverIdempotently(id)
});
// In a dedicated worker process: workers:{emails:{processor,concurrency:4}}
await enqueueEmailById(service.queue('emails'),'mail_123',{delay:30_000});
```

**Delivery contract:** `deliver()` must atomically claim an ID in a shared durable store, recheck consent at the send boundary via the email manager for marketing, and return `'sent'`, `'already-sent'` or `'suppressed'`. BullMQ is at-least-once; an SMTP acceptance followed by a crash before marking sent remains ambiguous, so neither BullMQ nor this adapter can promise exactly-once delivery. Provider idempotency where available, a transactional outbox, an explicit uncertain-delivery state, and manual reconciliation are recommended. Do not retry unknown SMTP outcomes blindly. Queue worker errors and operations callbacks do not govern optional email tracking.

**Deployment status:** Unit tests use injected BullMQ classes. Live Redis/BullMQ and multi-worker recovery were not exercised without installed dependencies and `QUEUE_REDIS_URL`. Reinstall with network access and regenerate the npm lockfile before `npm ci` or production rollout.

## Authenticated queue operations dashboard

Optional `queue.dashboard` mounts a same-origin operator console under `/_queue/admin`, plus its API and static JS/CSS routes. It is **off by default**. A dashboard will not start without both a host session authenticator and the `administration.authorize` callback. CSRF protection requires a host-provided per-session token generator and a separate verifier; every modifying request also requires a matching Origin and CSRF header. All API responses use `Cache-Control: no-store`, framing restrictions, a strict Content Security Policy, and no job payload/body/error details. Inspect and status queries are reauthorized per queue, so unauthorized queue names are omitted.

```ts
queue: {
  enabled: true,
  redis: {url: process.env.REDIS_URL!},
  queues: ['emails', 'analytics-maintenance'],
  administration: {
    authorize: (action, queue, principal) => permissions.can(principal, `queue.${action}`, queue),
    onAudit: (notice) => auditStore.write(notice)
  },
  dashboard: {
    prefix: '/_queue/admin',
    publicOrigin: 'https://admin.example.com',
    authorize: (request) => sessionService.requireOperator(request),
    csrfToken: (request, principal) => csrfService.tokenFor(principal),
    verifyCsrf: (request, principal) => csrfService.verify(request, principal)
  }
}
```

The `permissions`, `sessionService`, `csrfService` and `auditStore` names above are integration placeholders **provided by the application**. Use an HTTPS-only, same-site session cookie and configure trusted reverse-proxy URL handling. Do not expose the raw queue service, `getJob()` or stored email content to operator HTTP handlers. Worker pause is local to this process; queue pause is global. Route registration is generation-scoped and rolls back on failure. Dashboard routes share the application's existing HTTP host and middleware, not a second server or default password.

## Conservative durable email dispatch

`createDurableEmailDeliveryProcessor({store,isSubscribed,send,onUncertain,leaseMs})` implements a CAS-protected delivery state machine over a **host-supplied persistent per-message store**. Store operations must use atomic, version-checked `UPDATE ... WHERE version = ...` (or equivalent Mongo compare-and-swap). The in-memory test store is **not for multi-server production**. Queue payloads remain only `{messageId}`. A marketing message is screened against fresh consent before delivery, and the trusted SMTP sender must independently recheck at the actual send boundary.

State transitions:

`pending -> claimed -> sending -> sent`

`pending -> claimed -> suppressed` (marketing opted out)

`claimed -> pending` (consent store unavailable *before* SMTP begins; safe to retry)

`sending -> uncertain` (SMTP error, timeout, crash, or expired sending lease; **never resend automatically**)

The sender receives the durable ID and its server-side record; it must load the full saved email through trusted storage and use `@zeruxjs/email` with the previously saved per-email tracking options, rather than serializing recipients, attachments, credentials or message content to Redis. Tracking remains independently opt-in; marketing consent is a separate send permission. Provider acceptance may be ambiguous after a timeout, so the durable state machine deliberately trades automated retry for avoiding a likely duplicate send. An operator may use `resolveUncertainEmailDelivery()` to mark provider-verified outcomes. It does not retry SMTP, and the application must keep a durable audit trail of the operator's evidence.

```ts
import {createDurableEmailDeliveryProcessor,enqueueEmailCampaignBatch} from '@zeruxjs/queue-bullmq';

const processor=createDurableEmailDeliveryProcessor({
  store: deliveryRecords,        // durable atomic CAS adapter per message
  isSubscribed: recipient => preferences.isSubscribed(recipient),
  send: async id => {
    // Must *also* recheck marketing consent at SMTP time.
    await emailDelivery.sendPersistedMessage(id);
  },
  onUncertain: id => alerts.flagForManualReconciliation(id)
});

// Register processor ONLY in trusted designated worker processes.
// workers:{emails:{processor,concurrency:4}}

// Each ID is already persisted and consent-validated as a marketing message.
// Bounded 1..200 IDs; schedule is a UTC Unix-millisecond timestamp.
await enqueueEmailCampaignBatch(queueService.queue('emails'),
  ['mail_101', 'mail_102'], {sendAt:Date.parse('2026-11-01T14:00:00Z')});
```

`enqueueEmailCampaignBatch()` is **one scheduled batch**, not yet a full campaign builder, recipient segmentation system or long-running batch orchestrator. No in-process timer is required: delay is stored in BullMQ. Queue scheduling is at-least-once and requires persistent email records; the callback must implement actual transport delivery. Do not assume BullMQ job IDs are a permanent deduplication record after job cleanup.

**Operational limits:** Verify access control, CSRF, TLS/proxy origins, real SMTP recovery, atomic DB CAS, multi-node leases, and production job retention policies in a staging environment before deployment.

## Campaign planning and delivery gates

`enqueueCampaignPlan()` stores only an opaque campaign ID plus monotonic page sequence in BullMQ. `createCampaignPlanningProcessor()` accepts an explicit allowlist of durable planners and a `scheduleNext` callback for remaining pages. Campaign messages continue through `createDurableEmailDeliveryProcessor()`, which now accepts optional `isSuppressed` (hard bounce/complaint) and `campaignGate` (cancel/paused checks) callbacks. A fail-closed check is required again in the trusted SMTP sender. An application must provide durable idempotent mail creation, a versioned delivery store, and scheduled job workers.

## Cluster, certified-test harness and scheduler privileges

`createQueueService()` now accepts `redis:{cluster:{nodes:[{host,port}, ...]}, password?,tls?}`. In Redis Cluster mode, **require a hash-tagged prefix** such as `prefix:'{tenant-a}'` so all BullMQ keys for that service route to the same slot. Standalone `redis.url`, `host`, `port`, `db`, and ioredis `keyPrefix` cannot be combined with cluster mode. The service owns two independently configured ioredis Cluster clients (bounded-failure producers, reconnecting workers) and closes both on shutdown or startup failure; BullMQ may duplicate worker/event connections internally. All shards must be part of a properly configured, reachable Redis Cluster. The per-tenant hash-tag is a Redis key-routing convention, **not an authorization boundary**. Redis ACLs, network/TLS controls and unique prefixes are required. Cross-slot cache operations use per-key operations; cluster queue commands stay in one slot.

Recurring cron/interval jobs use Redis-backed BullMQ v5 Job Schedulers; a distributed scheduler does **not** guarantee exactly-once processor invocation, catch-up of missed offline occurrences, or wall-clock DST semantics different from the configured IANA zone. Schedule IDs are stable across restarts, and upserting an ID replaces that schedule. A one-off `jobId` prevents simultaneous duplicates while the job remains in Redis, but retention or an explicit delete can permit re-adding the same ID. For important side effects use a durable application-level idempotency key and, when applicable, the existing database fencing/outbox package.

Server-internal `service.schedules(queue)` remains an explicitly trusted application API, **not an HTTP/user-controlled surface**. Host-facing operations must call the separately authorized `service.operations.listSchedules`, `scheduleOnce`, `scheduleEvery`, `scheduleCron`, `removeSchedule`, and `cancelOneOff`. The host-provided authorization callback receives `schedule-inspect`, `schedule-create`, or `schedule-remove`, scoped to the exact queue; the optional audit callback records only operation metadata. Administrators cannot create arbitrary executable jobs: tasks still resolve through code-owned `createTaskRegistry()` handlers. Registered task payloads are JSON-bounded at 8 KiB, reject unsafe nested property names and excessive nesting, and must not contain personal data or secrets. Queue/job retry, deduplication, retention and worker lock settings are runtime-validated before contacting Redis.

### Opt-in live release gate

Install dependencies with a repaired registry-backed lockfile, use isolated Redis and **explicitly** opt in:

```bash
# Real standalone, two BullMQ service instances, delayed/retry/concurrent workers:
QUEUE_REDIS_URL=redis://127.0.0.1:6379 node --test packages/@zeruxjs/queue/test/live-redis-integration.test.mjs
# Standalone namespace safety:
CACHE_REDIS_URL=redis://127.0.0.1:6379 node --test packages/@zeruxjs/cache-redis/test/live-redis.test.mjs
# Real Redis Cluster masters, e.g. ephemeral ports (never production):
QUEUE_REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002 node --test packages/@zeruxjs/queue/test/live-redis-integration.test.mjs
CACHE_REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002 node --test packages/@zeruxjs/cache-redis/test/live-redis.test.mjs
```

Use dedicated throwaway test Redis instances, correct authentication and TLS as appropriate. Live tests do not intentionally stop Redis: a full outage/restart and worker crash-injection rehearsal, DST boundary verification, cluster resharding, and long-running load/retention/ACL testing are **separate operational gates**. In an offline environment these suites are intentionally skipped; mocked tests are not live certification. The clean `npm ci` check is also not satisfied by locally generated `dist` files.

## Compatibility and development

This package owns the extracted BullMQ implementation. `@zeruxjs/queue` reexports its existing API for backward compatibility; there is no dependency back to the facade. Historical queue test paths remain in `packages/@zeruxjs/queue/test`. Build this package before the facade and run the focused existing facade tests to check compatibility. This package does not implement RabbitMQ or MemcacheQ.


## Public entry points

Manifest reference for `@zeruxjs/queue-bullmq@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./reporting": {
      "types": "./dist/reporting.d.ts",
      "default": "./dist/reporting.js"
    },
    "./history": {
      "types": "./dist/history.d.ts",
      "default": "./dist/history.js"
    },
    "./campaigns": {
      "types": "./dist/campaigns.d.ts",
      "default": "./dist/campaigns.js"
    },
    "./recovery": {
      "types": "./dist/recovery.d.ts",
      "default": "./dist/recovery.js"
    },
    "./outbox": {
      "types": "./dist/outbox.d.ts",
      "default": "./dist/outbox.js"
    },
    "./dashboard": {
      "types": "./dist/dashboard.d.ts",
      "default": "./dist/dashboard.js"
    },
    "./scheduling": {
      "types": "./dist/scheduling.d.ts",
      "default": "./dist/scheduling.js"
    },
    "./performance": {
      "types": "./dist/performance.d.ts",
      "default": "./dist/performance.js"
    },
    "./trends": {
      "types": "./dist/trends.d.ts",
      "default": "./dist/trends.js"
    },
    "./delivery": {
      "types": "./dist/delivery.d.ts",
      "default": "./dist/delivery.js"
    },
    "./history-gaps": {
      "types": "./dist/history-gaps.d.ts",
      "default": "./dist/history-gaps.js"
    }
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@zeruxjs/cache-redis": "0.0.4",
    "bullmq": "^5.61.0",
    "ioredis": "^5.4.0"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/queue-bullmq

BullMQ-backed named job queues, durable Redis storage, optional worker processors, delayed/retried/repeatable jobs, and generation-scoped ZeruxJS startup/shutdown. This is a **Redis-backed queue** and does not use the SQL/Mongo analytics storage as a queue backend.

## Dependencies

Install `@zeruxjs/queue-bullmq` in the consuming application. This package uses BullMQ v5 and ioredis v5. Repository development uses the committed root npm lockfile.

Redis must be compatible with BullMQ v5. On production Redis use `maxmemory-policy noeviction` and a durable persistence configuration appropriate to your recovery objectives; reserve adequate memory and monitor stalls/lag. BullMQ jobs are **at-least-once**, not exactly-once: handlers must be idempotent, especially for email sends, billing, and analytics checkpoint work. Never place raw secrets in job payloads. Use narrow service accounts and TLS where possible.

```ts
import {createQueueService} from '@zeruxjs/queue-bullmq';

const queues=await createQueueService({
  redis:{url:process.env.REDIS_URL!},
  prefix:'commerce',
  queues:[{name:'emails', defaultJobOptions:{
    attempts:5,backoff:{type:'exponential',delay:1000},
    removeOnComplete:{age:86400,count:2000},removeOnFail:{age:604800,count:3000}
  }}],
  workers:{emails:{concurrency:4,processor:async job => {
    // Use a durable email idempotency key; resolve the current message from DB.
    await deliverByMessageId(job.data.messageId);
  }}}
});
const q=queues.queue('emails');
await q.add('send',{messageId:'mail_123'},{jobId:'mail_123'});
await q.add('send',{messageId:'mail_456'},{delay:30000});
await q.addBulk([{name:'send',data:{messageId:'mail_789'}}]);
console.log(await q.counts('waiting','active','failed','completed'));
console.log(await queues.health());
await queues.close();
```

Producers use `maxRetriesPerRequest:1` and `enableOfflineQueue:false` so app requests fail instead of buffering indefinitely during outages. Worker connections use `maxRetriesPerRequest:null` for BullMQ blocking operations and can recover after disconnects. BullMQ creates additional blocking connections; do not share a single producer connection as a worker connection. The `prefix` property belongs to BullMQ; ioredis `keyPrefix` is explicitly prohibited.

## Framework lifecycle

```ts
// Private server-only zerux configuration (never expose credentials to browsers)
queue: {
  enabled:true,
  required:false,           // optional service degrades if Redis is unavailable
  redis:{url:process.env.REDIS_URL},
  prefix:'proworkspace',
  queues:['emails','analytics-maintenance'],
  workers: {
    // Register only in designated worker processes, not every web replica.
    // 'emails': {processor:sendMailProcessor,concurrency:4}
  }
}
```

Use `runtime.serviceScope.get('queue')` to access the initialized service, or construct it independently in worker processes. Queue shutdown executes before cache/database cleanup. Configuration, worker functions, and Redis credentials are removed from public runtime configuration. Set `required:true` only when the app must refuse startup if Redis is unavailable. Worker handlers are **not** automatically discovered and no queue HTTP/admin routes are exposed.

## Scheduled reconciliation of analytics

```ts
import {createAnalyticsReconciliationProcessor} from '@zeruxjs/queue-bullmq';
const job = analytics.createReconciliationJob('historic_2025', query, {leaseMs:60000});
const processor = createAnalyticsReconciliationProcessor({historic_2025:job});
// Add the worker to the queue service configuration:
const workers = {'analytics-maintenance':{processor,concurrency:1}};
// Schedule a bounded reconciliation page periodically; no automatic restart of completed passes.
await queueService.queue('analytics-maintenance').add(
  'analytics.reconcile', {id:'historic_2025'},
  {repeat:{every:60_000},jobId:'reconcile-historic-2025'}
);
```

The BullMQ worker processes **one bounded page per execution** via `runOnce()`. It relies on the reconciliation store’s durable DB checkpoint and fence. Use a trusted operator to call `restart()` for late events and to adjust deployment policy; recurring jobs do not restart completed reconciliation passes automatically. Consider job polling frequency, lease duration, worker concurrency and job retention together. Do not expose `createReconciliationJob` or `restart()` to untrusted HTTP clients.

## Operational verification

Run `npm test` in `packages/@zeruxjs/queue` and `packages/@zeruxjs/cache-redis` after installing deps. Set `QUEUE_REDIS_URL` to an isolated local Redis URL for the opt-in **real BullMQ integration test**; without that variable, it is skipped. The factory-injected tests check request and retry policies but are **not a substitute** for full multi-node or live-Redis certification. Validate Redis connectivity, worker failover and multi-server load in your deployment environment.

## Operations, QueueEvents, and queued email IDs

A service created with `administration.authorize` can access `service.operations`. If the callback is absent, **all operations are denied**; nothing is mounted on HTTP by default. Each request is checked independently. Use a server-validated authorization context, not user-provided role strings. Inspect operations return a **bounded**, payload-redacted `QueueJobSummary` rather than the full BullMQ Job with private `data`, `returnvalue` and failure stacks. Only a currently failed job can be manually retried, and the underlying BullMQ transition is atomic. Never build a public HTTP endpoint around `service.queue().getJob()`; it returns the raw job with sensitive data.

```ts
const service=await createQueueService({
  redis:{url:process.env.REDIS_URL!},queues:['emails'],
  administration:{
    authorize:async (action,queue,identity) => await permissions.can(identity,'queue.'+action,queue),
    onAudit:record => auditWriter.write(record), // best-effort; use a durable auditer if required
    maxPageSize:50
  },
  events:{enabled:true,onEvent:info => metrics.observe(info),onError:(queue,err)=>log.warn(queue,err)}
});
const operator=await authenticateHostRequest(request);
const status=await service.snapshot(); // trusted internal use
const failures=await service.operations.inspect('emails',{states:['failed'],limit:20},operator);
await service.operations.retryFailed('emails','email-mail_123',operator);
await service.operations.pauseQueue('emails',operator); // affects every worker
await service.operations.pauseWorker('emails',operator); // this process only
```

Optional `QueueEvents` creates a dedicated Redis-stream consumer connection per configured queue and emits only type, queue, timestamp and job ID (no job data). Events are a **bounded, auto-trimmed stream**, not a permanently durable audit record; for long-term analytics send these notices to persistent storage. Event streams close during managed shutdown. `snapshot()` reads Redis job counts per queue. Do not poll it too aggressively across hundreds of queues.

Queued mail uses `enqueueEmailById(queue,messageId,{delay,attempts})` and the `createEmailDeliveryProcessor` worker adapter. Redis contains only `{messageId}`, not email addresses, bodies, attachments, SMTP credentials or provider tokens. The worker loads the current message and checks **fresh marketing consent** before dispatch. An unsubscribed recipient is durably suppressed before the job is acknowledged, while a consent-store error rejects the job for retry. Transactional email does not require marketing opt-in. Tracking remains **independently opted-in on the saved email message**—a queued job does not switch it on or off.

```ts
const processor=createEmailDeliveryProcessor({
  load: async id => await mailStore.getDescriptor(id),
  isSubscribed: async recipient => await preferences.isSubscribed(recipient),
  suppress: async (id,reason) => await mailStore.suppress(id,reason),
  deliver: async id => await emailDelivery.deliverIdempotently(id)
});
// In a dedicated worker process: workers:{emails:{processor,concurrency:4}}
await enqueueEmailById(service.queue('emails'),'mail_123',{delay:30_000});
```

**Delivery contract:** `deliver()` must atomically claim an ID in a shared durable store, recheck consent at the send boundary via the email manager for marketing, and return `'sent'`, `'already-sent'` or `'suppressed'`. BullMQ is at-least-once; an SMTP acceptance followed by a crash before marking sent remains ambiguous, so neither BullMQ nor this adapter can promise exactly-once delivery. Provider idempotency where available, a transactional outbox, an explicit uncertain-delivery state, and manual reconciliation are recommended. Do not retry unknown SMTP outcomes blindly. Queue worker errors and operations callbacks do not govern optional email tracking.

**Deployment status:** Unit tests use injected BullMQ classes. Live Redis/BullMQ and multi-worker recovery were not exercised without installed dependencies and `QUEUE_REDIS_URL`. Use the committed npm lockfile and explicitly qualify the installed driver/backend before production rollout.

## Authenticated queue operations dashboard

Optional `queue.dashboard` mounts a same-origin operator console under `/_queue/admin`, plus its API and static JS/CSS routes. It is **off by default**. A dashboard will not start without both a host session authenticator and the `administration.authorize` callback. CSRF protection requires a host-provided per-session token generator and a separate verifier; every modifying request also requires a matching Origin and CSRF header. All API responses use `Cache-Control: no-store`, framing restrictions, a strict Content Security Policy, and no job payload/body/error details. Inspect and status queries are reauthorized per queue, so unauthorized queue names are omitted.

```ts
queue: {
  enabled: true,
  redis: {url: process.env.REDIS_URL!},
  queues: ['emails', 'analytics-maintenance'],
  administration: {
    authorize: (action, queue, principal) => permissions.can(principal, `queue.${action}`, queue),
    onAudit: (notice) => auditStore.write(notice)
  },
  dashboard: {
    prefix: '/_queue/admin',
    publicOrigin: 'https://admin.example.com',
    authorize: (request) => sessionService.requireOperator(request),
    csrfToken: (request, principal) => csrfService.tokenFor(principal),
    verifyCsrf: (request, principal) => csrfService.verify(request, principal)
  }
}
```

The `permissions`, `sessionService`, `csrfService` and `auditStore` names above are integration placeholders **provided by the application**. Use an HTTPS-only, same-site session cookie and configure trusted reverse-proxy URL handling. Do not expose the raw queue service, `getJob()` or stored email content to operator HTTP handlers. Worker pause is local to this process; queue pause is global. Route registration is generation-scoped and rolls back on failure. Dashboard routes share the application's existing HTTP host and middleware, not a second server or default password.

## Conservative durable email dispatch

`createDurableEmailDeliveryProcessor({store,isSubscribed,send,onUncertain,leaseMs})` implements a CAS-protected delivery state machine over a **host-supplied persistent per-message store**. Store operations must use atomic, version-checked `UPDATE ... WHERE version = ...` (or equivalent Mongo compare-and-swap). The in-memory test store is **not for multi-server production**. Queue payloads remain only `{messageId}`. A marketing message is screened against fresh consent before delivery, and the trusted SMTP sender must independently recheck at the actual send boundary.

State transitions:

`pending -> claimed -> sending -> sent`

`pending -> claimed -> suppressed` (marketing opted out)

`claimed -> pending` (consent store unavailable *before* SMTP begins; safe to retry)

`sending -> uncertain` (SMTP error, timeout, crash, or expired sending lease; **never resend automatically**)

The sender receives the durable ID and its server-side record; it must load the full saved email through trusted storage and use `@zeruxjs/email` with the previously saved per-email tracking options, rather than serializing recipients, attachments, credentials or message content to Redis. Tracking remains independently opt-in; marketing consent is a separate send permission. Provider acceptance may be ambiguous after a timeout, so the durable state machine deliberately trades automated retry for avoiding a likely duplicate send. An operator may use `resolveUncertainEmailDelivery()` to mark provider-verified outcomes. It does not retry SMTP, and the application must keep a durable audit trail of the operator's evidence.

```ts
import {createDurableEmailDeliveryProcessor,enqueueEmailCampaignBatch} from '@zeruxjs/queue-bullmq';

const processor=createDurableEmailDeliveryProcessor({
  store: deliveryRecords,        // durable atomic CAS adapter per message
  isSubscribed: recipient => preferences.isSubscribed(recipient),
  send: async id => {
    // Must *also* recheck marketing consent at SMTP time.
    await emailDelivery.sendPersistedMessage(id);
  },
  onUncertain: id => alerts.flagForManualReconciliation(id)
});

// Register processor ONLY in trusted designated worker processes.
// workers:{emails:{processor,concurrency:4}}

// Each ID is already persisted and consent-validated as a marketing message.
// Bounded 1..200 IDs; schedule is a UTC Unix-millisecond timestamp.
await enqueueEmailCampaignBatch(queueService.queue('emails'),
  ['mail_101', 'mail_102'], {sendAt:Date.parse('2026-11-01T14:00:00Z')});
```

`enqueueEmailCampaignBatch()` is **one scheduled batch**, not yet a full campaign builder, recipient segmentation system or long-running batch orchestrator. No in-process timer is required: delay is stored in BullMQ. Queue scheduling is at-least-once and requires persistent email records; the callback must implement actual transport delivery. Do not assume BullMQ job IDs are a permanent deduplication record after job cleanup.

**Operational limits:** Verify access control, CSRF, TLS/proxy origins, real SMTP recovery, atomic DB CAS, multi-node leases, and production job retention policies in a staging environment before deployment.

## Campaign planning and delivery gates

`enqueueCampaignPlan()` stores only an opaque campaign ID plus monotonic page sequence in BullMQ. `createCampaignPlanningProcessor()` accepts an explicit allowlist of durable planners and a `scheduleNext` callback for remaining pages. Campaign messages continue through `createDurableEmailDeliveryProcessor()`, which now accepts optional `isSuppressed` (hard bounce/complaint) and `campaignGate` (cancel/paused checks) callbacks. A fail-closed check is required again in the trusted SMTP sender. An application must provide durable idempotent mail creation, a versioned delivery store, and scheduled job workers.

## Cluster, certified-test harness and scheduler privileges

`createQueueService()` now accepts `redis:{cluster:{nodes:[{host,port}, ...]}, password?,tls?}`. In Redis Cluster mode, **require a hash-tagged prefix** such as `prefix:'{tenant-a}'` so all BullMQ keys for that service route to the same slot. Standalone `redis.url`, `host`, `port`, `db`, and ioredis `keyPrefix` cannot be combined with cluster mode. The service owns two independently configured ioredis Cluster clients (bounded-failure producers, reconnecting workers) and closes both on shutdown or startup failure; BullMQ may duplicate worker/event connections internally. All shards must be part of a properly configured, reachable Redis Cluster. The per-tenant hash-tag is a Redis key-routing convention, **not an authorization boundary**. Redis ACLs, network/TLS controls and unique prefixes are required. Cross-slot cache operations use per-key operations; cluster queue commands stay in one slot.

Recurring cron/interval jobs use Redis-backed BullMQ v5 Job Schedulers; a distributed scheduler does **not** guarantee exactly-once processor invocation, catch-up of missed offline occurrences, or wall-clock DST semantics different from the configured IANA zone. Schedule IDs are stable across restarts, and upserting an ID replaces that schedule. A one-off `jobId` prevents simultaneous duplicates while the job remains in Redis, but retention or an explicit delete can permit re-adding the same ID. For important side effects use a durable application-level idempotency key and, when applicable, the existing database fencing/outbox package.

Server-internal `service.schedules(queue)` remains an explicitly trusted application API, **not an HTTP/user-controlled surface**. Host-facing operations must call the separately authorized `service.operations.listSchedules`, `scheduleOnce`, `scheduleEvery`, `scheduleCron`, `removeSchedule`, and `cancelOneOff`. The host-provided authorization callback receives `schedule-inspect`, `schedule-create`, or `schedule-remove`, scoped to the exact queue; the optional audit callback records only operation metadata. Administrators cannot create arbitrary executable jobs: tasks still resolve through code-owned `createTaskRegistry()` handlers. Registered task payloads are JSON-bounded at 8 KiB, reject unsafe nested property names and excessive nesting, and must not contain personal data or secrets. Queue/job retry, deduplication, retention and worker lock settings are runtime-validated before contacting Redis.

### Opt-in live release gate

Install dependencies with a repaired registry-backed lockfile, use isolated Redis and **explicitly** opt in:

```bash
# Real standalone, two BullMQ service instances, delayed/retry/concurrent workers:
QUEUE_REDIS_URL=redis://127.0.0.1:6379 node --test packages/@zeruxjs/queue/test/live-redis-integration.test.mjs
# Standalone namespace safety:
CACHE_REDIS_URL=redis://127.0.0.1:6379 node --test packages/@zeruxjs/cache-redis/test/live-redis.test.mjs
# Real Redis Cluster masters, e.g. ephemeral ports (never production):
QUEUE_REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002 node --test packages/@zeruxjs/queue/test/live-redis-integration.test.mjs
CACHE_REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002 node --test packages/@zeruxjs/cache-redis/test/live-redis.test.mjs
```

Use dedicated throwaway test Redis instances, correct authentication and TLS as appropriate. Live tests do not intentionally stop Redis: a full outage/restart and worker crash-injection rehearsal, DST boundary verification, cluster resharding, and long-running load/retention/ACL testing are **separate operational gates**. In an offline environment these suites are intentionally skipped; mocked tests are not live certification. The clean `npm ci` check is also not satisfied by locally generated `dist` files.

## Compatibility and development

This package owns the extracted BullMQ implementation. `@zeruxjs/queue` reexports its existing API for backward compatibility; there is no dependency back to the facade. Historical queue test paths remain in `packages/@zeruxjs/queue/test`. Build this package before the facade and run the focused existing facade tests to check compatibility. This package does not implement RabbitMQ or MemcacheQ.

## Bounded enqueue and shutdown diagnostics

```ts
import {createQueueService, QUEUE_JOB_LIMITS} from '@zeruxjs/queue-bullmq';

export async function enqueueReferences(redisUrl: string) {
  const service = await createQueueService({redis: {url: redisUrl}, queues: ['emails']});
  try {
    await service.queue('emails').addBulk([
      {name: 'email.deliver', data: {messageId: 'mail_123'}},
      {name: 'email.deliver', data: {messageId: 'mail_456'}}
    ]);
    return QUEUE_JOB_LIMITS.maxBulk;
  } finally {
    await service.close();
    // Trusted path/payload-free counters; not a worker crash-recovery claim.
    const status = service.shutdownStatus();
    if (status.state !== 'closed') throw new Error('Queue shutdown needs host reconciliation');
  }
}
```

Direct enqueue now validates and snapshots **plain JSON objects** before calling BullMQ: maximum 64 KiB UTF-8 JSON, 32 levels and 8192 visited values. Classes, cycles, accessors, functions, non-finite numbers, unsafe property names and sparse/extended arrays reject rather than invoking serialization hooks or silently dropping values. Existing typed `QueueJobOptions` remain supported; unrecognized top-level job option names reject. Names and job options still receive their existing validation. Do not put secrets/PII in payloads, names or IDs. These fixed limits are public through `QUEUE_JOB_LIMITS`, not mutable runtime configuration.

`addBulk` accepts at most 256 entries and 1 MiB aggregate **data JSON**, with each item subject to the individual limit. Empty arrays remain accepted. The complete batch validates before a native call, so a bad later item cannot enqueue earlier items through the wrapper. This is input prevalidation, not a new cross-queue/Redis transaction or a guarantee about ambiguous network outcomes. Job names/options/protocol overhead are outside the aggregate data-byte budget and retain their own validation. At most 256 configured queues are accepted before connection allocation.

The service's one-off scheduler and recurring template path use the same enqueue guard. The existing task registry retains its stricter 8 KiB payload bound and 32-level nesting rule, now checked before serialization. Incoming processor data is also checked before application code runs; invalid jobs fail using native BullMQ retry/failure policy. Old oversized or non-JSON jobs need host migration/reconciliation. Native processors still receive the original BullMQ Job object/token; no wrapper replaces its methods or changes the durable email consent/CAS/uncertain-delivery state machine.

`shutdownStatus()` returns a fresh record of `state`, `activeProcessors`, `pendingClosures`, `workerDeadlines`, `forceCloseAttempts`, `cleanupDeadlines` and `cleanupFailures`. No queue, job, tenant, Redis endpoint or error text is included. State is `open`, `draining`, `closed`, `incomplete` or `failed`. Counts track actual processor/native-close Promise settlement even after a caller's close deadline. Late settlement can move `incomplete` to `closed`; `failed` retains a failed cleanup outcome. A force-close **attempt** is not proof a processor stopped. Native BullMQ may reuse an already-pending close Promise, and arbitrary JavaScript cannot be force-cancelled by a Promise timeout.

The existing per-worker grace (default 30 seconds, 1–300000 ms) and native force-close fallback remain; auxiliary close deadlines are at most five seconds each. These are per-resource bounds, not one global drain deadline. Shutdown rejects new facade enqueue/scheduler work, attempts workers → events → queues → owned Cluster clients, and reports failed cleanup through the existing AggregateError. Cluster quit failure/deadline additionally calls native `disconnect` when available; injected clients without that method retain their stated limitations. Acquired workers are registered before listeners, so listener failure participates in startup rollback. Events and Cluster resources remain owned through startup failure and shutdown. Raw error callbacks/causes remain trusted server diagnostics and may contain native details; do not forward them to clients.

The extraction keeps a one-way dependency: queue facade → queue-bullmq → cache-redis. All twelve extracted modules were inspected for their imports/public contracts. Reporting, history, recovery and ledger logic use local types; cross-module references to the root Job/queue interfaces are erased type imports. Existing public subpaths already let consumers import these utilities without importing the facade. They remain in their owning package to preserve imports; moving them into the facade would introduce a reverse edge. No backend-independent outbox system or new transaction mechanism is introduced. Archive qualification checks every declared root/subpath JS/declaration target and packaged licenses with a real packed consumer; no API snapshots or versions are regenerated.

Focused injected checks cover whole-batch rejection, source snapshotting, UTF-8/depth/unsafe input, worker deadline/late settlement, listener/event startup rollback and Cluster cleanup failure, alongside existing admin authorization, scheduler and dashboard checks. Real Redis acceptance still requires isolated `QUEUE_REDIS_URL` (and separate Cluster configuration). Worker crash/restart, stalled-job redelivery, network partition and durable SMTP recovery are not proved by a compile, injected fixture or archive test. Native semantics follow [BullMQ graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown) and its [bulk enqueue API](https://docs.bullmq.io/guide/queues/adding-bulks).


## Implementation sources

- [packages/@zeruxjs/queue-bullmq/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/queue-bullmq/README.md)
- [packages/@zeruxjs/queue-bullmq/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/queue-bullmq/src/index.ts)
