# @zeruxjs/queue

BullMQ-backed named job queues, durable Redis storage, optional worker processors, delayed/retried/repeatable jobs, and generation-scoped ZeruxJS startup/shutdown. This is a **Redis-backed queue** and does not use the SQL/Mongo analytics storage as a queue backend.

## Dependencies

Install workspace packages and run `npm install` in `apps/proworkspace` on a machine with npm registry access. The package uses BullMQ v5 and ioredis v5. The npm lockfile from Section 51 must be regenerated with new third-party dependencies (this Section 52 build environment cannot access the registry).

Redis must be compatible with BullMQ v5. On production Redis use `maxmemory-policy noeviction` and a durable persistence configuration appropriate to your recovery objectives; reserve adequate memory and monitor stalls/lag. BullMQ jobs are **at-least-once**, not exactly-once: handlers must be idempotent, especially for email sends, billing, and analytics checkpoint work. Never place raw secrets in job payloads. Use narrow service accounts and TLS where possible.

```ts
import {createQueueService} from '@zeruxjs/queue';

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

## Scheduled reconciliation of Section 51 analytics

```ts
import {createAnalyticsReconciliationProcessor} from '@zeruxjs/queue';
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

The BullMQ worker processes **one bounded page per execution** via `runOnce()`. It relies on the durable DB checkpoint and fence from Section 51. Use a trusted operator to call `restart()` for late events and to adjust deployment policy; recurring jobs do not restart completed reconciliation passes automatically. Consider job polling frequency, lease duration, worker concurrency and job retention together. Do not expose `createReconciliationJob` or `restart()` to untrusted HTTP clients.

## Operational verification

Run `npm test` in `packages/@zeruxjs/queue` and `packages/@zeruxjs/cache-redis` after installing deps. Set `QUEUE_REDIS_URL` to an isolated local Redis URL for the opt-in **real BullMQ integration test**; without that variable, it is skipped. The factory-injected tests check request and retry policies but are **not a substitute** for full multi-node or live-Redis certification. A complete npm registry install, true Redis execution, full framework workspace typecheck, worker failover, and multi-server load testing remain outstanding in this delivery.

## Section 53: Operations, QueueEvents, and queued email IDs

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

## Section 54: authenticated queue operations dashboard

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

## Section 54: conservative durable email dispatch

`createDurableEmailDeliveryProcessor({store,isSubscribed,send,onUncertain,leaseMs})` implements a CAS-protected delivery state machine over a **host-supplied persistent per-message store**. Store operations must use atomic, version-checked `UPDATE ... WHERE version = ...` (or equivalent Mongo compare-and-swap). The in-memory test store is **not for multi-server production**. Queue payloads remain only `{messageId}`. A marketing message is screened against fresh consent before delivery, and the trusted SMTP sender must independently recheck at the actual send boundary.

State transitions:

`pending -> claimed -> sending -> sent`

`pending -> claimed -> suppressed` (marketing opted out)

`claimed -> pending` (consent store unavailable *before* SMTP begins; safe to retry)

`sending -> uncertain` (SMTP error, timeout, crash, or expired sending lease; **never resend automatically**)

The sender receives the durable ID and its server-side record; it must load the full saved email through trusted storage and use `@zeruxjs/email` with the previously saved per-email tracking options, rather than serializing recipients, attachments, credentials or message content to Redis. Tracking remains independently opt-in; marketing consent is a separate send permission. Provider acceptance may be ambiguous after a timeout, so the durable state machine deliberately trades automated retry for avoiding a likely duplicate send. An operator may use `resolveUncertainEmailDelivery()` to mark provider-verified outcomes. It does not retry SMTP, and the application must keep a durable audit trail of the operator's evidence.

```ts
import {createDurableEmailDeliveryProcessor,enqueueEmailCampaignBatch} from '@zeruxjs/queue';

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

**Operational limits:** No live BullMQ/ioredis+Redis integration was possible in the offline test environment. The broader framework compile still has unresolved workspace imports. Verify access control, CSRF, TLS/proxy origins, real SMTP recovery, atomic DB CAS, multi-node leases, and production job retention policies in a staging environment before deployment.

## Section 55 — Campaign planning and delivery gates

`enqueueCampaignPlan()` stores only an opaque campaign ID plus monotonic page sequence in BullMQ. `createCampaignPlanningProcessor()` accepts an explicit allowlist of durable planners and a `scheduleNext` callback for remaining pages. Campaign messages continue through `createDurableEmailDeliveryProcessor()`, which now accepts optional `isSuppressed` (hard bounce/complaint) and `campaignGate` (cancel/paused checks) callbacks. A fail-closed check is required again in the trusted SMTP sender. An application must provide durable idempotent mail creation, a versioned delivery store, and scheduled job workers. See root `SECTION_55_MARKETING_CAMPAIGNS_SUPPRESSION.md`.

## Section 75 — cluster, certified-test harness and scheduler privileges

`createQueueService()` now accepts `redis:{cluster:{nodes:[{host,port}, ...]}, password?,tls?}`. In Redis Cluster mode, **require a hash-tagged prefix** such as `prefix:'{tenant-a}'` so all BullMQ keys for that service route to the same slot. Standalone `redis.url`, `host`, `port`, `db`, and ioredis `keyPrefix` cannot be combined with cluster mode. The service owns two independently configured ioredis Cluster clients (bounded-failure producers, reconnecting workers) and closes both on shutdown or startup failure; BullMQ may duplicate worker/event connections internally. All shards must be part of a properly configured, reachable Redis Cluster. The per-tenant hash-tag is a Redis key-routing convention, **not an authorization boundary**. Redis ACLs, network/TLS controls and unique prefixes are required. Cross-slot cache operations use per-key operations; cluster queue commands stay in one slot.

Recurring cron/interval jobs use Redis-backed BullMQ v5 Job Schedulers; a distributed scheduler does **not** guarantee exactly-once processor invocation, catch-up of missed offline occurrences, or wall-clock DST semantics different from the configured IANA zone. Schedule IDs are stable across restarts, and upserting an ID replaces that schedule. A one-off `jobId` prevents simultaneous duplicates while the job remains in Redis, but retention or an explicit delete can permit re-adding the same ID. For important side effects use a durable application-level idempotency key and, when applicable, the existing database fencing/outbox package.

Server-internal `service.schedules(queue)` remains an explicitly trusted application API, **not an HTTP/user-controlled surface**. Host-facing operations must call the separately authorized `service.operations.listSchedules`, `scheduleOnce`, `scheduleEvery`, `scheduleCron`, `removeSchedule`, and `cancelOneOff`. The host-provided authorization callback receives `schedule-inspect`, `schedule-create`, or `schedule-remove`, scoped to the exact queue; the optional audit callback records only operation metadata. Administrators cannot create arbitrary executable jobs: tasks still resolve through code-owned `createTaskRegistry()` handlers. Registered task payloads are JSON-bounded at 8 KiB, reject unsafe nested property names and excessive nesting, and must not contain personal data or secrets. Queue/job retry, deduplication, retention and worker lock settings are runtime-validated before contacting Redis.

### Opt-in live release gate

Install dependencies with a repaired registry-backed lockfile, use isolated Redis and **explicitly** opt in:

```bash
# Real standalone, two BullMQ service instances, delayed/retry/concurrent workers:
QUEUE_REDIS_URL=redis://127.0.0.1:6379 node --test packages/@zeruxjs/queue/test/section75-live-certification.test.mjs
# Standalone namespace safety:
CACHE_REDIS_URL=redis://127.0.0.1:6379 node --test packages/@zeruxjs/cache-redis/test/section75-live-redis.test.mjs
# Real Redis Cluster masters, e.g. ephemeral ports (never production):
QUEUE_REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002 node --test packages/@zeruxjs/queue/test/section75-live-certification.test.mjs
CACHE_REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002 node --test packages/@zeruxjs/cache-redis/test/section75-live-redis.test.mjs
```

Use dedicated throwaway test Redis instances, correct authentication and TLS as appropriate. Live tests do not intentionally stop Redis: a full outage/restart and worker crash-injection rehearsal, DST boundary verification, cluster resharding, and long-running load/retention/ACL testing are **separate operational gates**. In an offline environment these suites are intentionally skipped; mocked tests are not live certification. The Section 66 `npm ci` gate is also not satisfied by locally generated `dist` files.
