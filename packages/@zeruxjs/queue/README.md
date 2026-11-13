# @zeruxjs/queue

The implementation now lives in [`@zeruxjs/queue-bullmq`](package-queue-bullmq.md); this package preserves its public API through compatibility exports. [`queue-rabbitmq`](package-queue-rabbitmq.md) and [`queue-memcacheq`](package-queue-memcacheq.md) currently provide explicit standalone factories with different capabilities. Legacy framework `queue` configuration still uses BullMQ; the explicit neutral selection below opts into other factories.

BullMQ-backed named job queues, durable Redis storage, optional worker processors, delayed/retried/repeatable jobs, and generation-scoped ZeruxJS startup/shutdown. This is a **Redis-backed queue** and does not use the SQL/Mongo analytics storage as a queue backend.

## Dependencies

Install `@zeruxjs/queue` in the consuming application. This package uses BullMQ v5 and ioredis v5. Repository development uses the committed root npm lockfile.

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

## Scheduled reconciliation of analytics

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

**Deployment qualification:** Injected BullMQ fixtures do not establish live Redis/BullMQ or multi-worker recovery. Use the committed npm lockfile and matching installed dependencies; explicitly configure an isolated `QUEUE_REDIS_URL` for live acceptance. Never point acceptance tests at production.

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

`claimed -> pending` (consent store unavailable _before_ SMTP begins; safe to retry)

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

**Operational limits:** Verify access control, CSRF, TLS/proxy origins, real SMTP recovery, atomic DB CAS, multi-node leases, and production job retention policies in a staging environment before deployment.

## Campaign planning and delivery gates

`enqueueCampaignPlan()` stores only an opaque campaign ID plus monotonic page sequence in BullMQ. `createCampaignPlanningProcessor()` accepts an explicit allowlist of durable planners and a `scheduleNext` callback for remaining pages. Campaign messages continue through `createDurableEmailDeliveryProcessor()`, which now accepts optional `isSuppressed` (hard bounce/complaint) and `campaignGate` (cancel/paused checks) callbacks. A fail-closed check is required again in the trusted SMTP sender. An application must provide durable idempotent mail creation, a versioned delivery store, and scheduled job workers.

## Cluster, certified-test harness and scheduler privileges

`createQueueService()` now accepts `redis:{cluster:{nodes:[{host,port}, ...]}, password?,tls?}`. In Redis Cluster mode, **require a hash-tagged prefix** such as `prefix:'{tenant-a}'` so all BullMQ keys for that service route to the same slot. Standalone `redis.url`, `host`, `port`, `db`, and ioredis `keyPrefix` cannot be combined with cluster mode. The service owns two independently configured ioredis Cluster clients (bounded-failure producers, reconnecting workers) and closes both on shutdown or startup failure; BullMQ may duplicate worker/event connections internally. All shards must be part of a properly configured, reachable Redis Cluster. The per-tenant hash-tag is a Redis key-routing convention, **not an authorization boundary**. Redis ACLs, network/TLS controls and unique prefixes are required. Cross-slot cache operations use per-key operations; cluster queue commands stay in one slot.

Recurring cron/interval jobs use Redis-backed BullMQ v5 Job Schedulers; a distributed scheduler does **not** guarantee exactly-once processor invocation, catch-up of missed offline occurrences, or wall-clock DST semantics different from the configured IANA zone. Schedule IDs are stable across restarts, and upserting an ID replaces that schedule. A one-off `jobId` prevents simultaneous duplicates while the job remains in Redis, but retention or an explicit delete can permit re-adding the same ID. For important side effects use a durable application-level idempotency key and, when applicable, the existing database fencing/outbox package.

Server-internal `service.schedules(queue)` remains an explicitly trusted application API, **not an HTTP/user-controlled surface**. Host-facing operations must call the separately authorized `service.operations.listSchedules`, `scheduleOnce`, `scheduleEvery`, `scheduleCron`, `removeSchedule`, and `cancelOneOff`. The host-provided authorization callback receives `schedule-inspect`, `schedule-create`, or `schedule-remove`, scoped to the exact queue; the optional audit callback records only operation metadata. Administrators cannot create arbitrary executable jobs: tasks still resolve through code-owned `createTaskRegistry()` handlers. Registered task payloads are JSON-bounded at 8 KiB, reject unsafe nested property names and excessive nesting, and must not contain personal data or secrets. Queue/job retry, deduplication, retention and worker lock settings are runtime-validated before contacting Redis.

### Opt-in live release gate

Install matching dependencies from the committed lockfile, use isolated Redis and **explicitly** opt in:

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

## Opt-in neutral backend selection

The legacy `createQueueService` and BullMQ exports are unchanged. `/neutral` adds a small producer/pull-consumer contract; `/backends` adapts explicitly supplied standalone factories. Neither entry scans packages, opens connections on import or loads an optional driver. Install/import only the standalone backend you choose. The facade's existing BullMQ dependency remains for compatibility.

```ts
import {createQueueBackend, selectQueueBackend} from '@zeruxjs/queue/neutral';
import {rabbitMQBackend} from '@zeruxjs/queue/backends';
import {createRabbitMQ} from '@zeruxjs/queue-rabbitmq';

export async function sendReference(url: string) {
  const factory = rabbitMQBackend(createRabbitMQ, ['notifications']);
  const selection = selectQueueBackend(factory, {url, queues: ['notifications']}, {
    requireCapabilities: ['acknowledgement', 'publisherConfirms'], maxBytes: 8192
  });
  const jobs = await createQueueBackend(selection);
  try {
    await jobs.publish('notifications', 'refresh', {recordId: '42'});
    const delivery = await jobs.take('notifications');
    if (delivery) {
      // Perform the authorized, durable, idempotent side effect before ack.
      await delivery.settle!('ack');
    }
  } finally { await jobs.close(); }
}
```

The example publishes/pulls a reference only; it does not implement that business side effect. URL credentials are private server configuration, never job payloads. Authorization, tenant-specific factory/queue allowlists, consent, durable idempotency and uncertain-result reconciliation remain host responsibilities. No API is automatically exposed over HTTP. A queue prefix/name is not permission. Native factory options retain the owning package's inferred types; unknown top-level and known nested backend options reject before startup. `selectQueueBackend` validates synchronously and the framework validates again before opening database/cache resources. Custom validators must be pure synchronous trusted code.

| Adaptation                                    | Publish completion            | Neutral consumption                                                     | Delay/retry                                                        | Scheduler                   |
| --------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------- |
| `bullMQBackend(['jobs'])`                     | Native BullMQ add completes   | `push:true`; configure native `options.workers`, neutral `take` rejects | Native delay/attempts supported                                    | Native typed extension only |
| `rabbitMQBackend(createRabbitMQ, ['jobs'])`   | Broker publisher confirmation | Manual-ack pull; settle `ack`, `discard`, `requeue` once locally        | No delay/automatic retry; explicit requeue can repeat indefinitely | Unsupported                 |
| `memcacheQBackend(createMemcacheQ, ['jobs'])` | Native append response        | Destructive pull; disposition `consumed`, no settle method              | Unsupported                                                        | Unsupported                 |

`publish(queue,name,data,{delay?,attempts?})` rejects unsupported options even when delay is zero or attempts is one. No scheduling, automatic polling/worker loop or acknowledgement is emulated. `require(capability)` provides an explicit runtime guard. Scheduler requests must use the matching native extension; the neutral API has no fake scheduler. BullMQ `acknowledgement:false` means no **manual neutral settlement**; processor completion/failure still uses native BullMQ acknowledgement/retry. `publisherConfirms` specifically describes RabbitMQ broker confirms, not a generic persistence guarantee for every backend.

`jobs.extension(factory)` requires that exact registered factory object and returns its typed native service. BullMQ operations, processors, schedules, events and outbox helpers remain BullMQ-specific. The neutral BullMQ adapter deliberately rejects `dashboard` configuration because it does not mount native dashboard routes; use legacy `createQueueService`/framework configuration for that feature. Extensions are trusted host access: their direct methods retain native validation/ownership and bypass neutral payload/pending limits. Do not close the extension separately or expose raw native jobs to clients. No native extension guarantees portability. Existing outbox/CAS delivery APIs remain unchanged; they are not silently mapped to a destructive queue.

Neutral defaults: 64 KiB JSON payloads (maximum 1 MiB), depth 16/8192 nodes, 32 pending calls (maximum 1000), 1–100 unique allowed queue names. JSON payloads are snapshotted; unsafe property names, accessors, cycles, classes and non-JSON values reject. Native envelope/response limits also apply and may reject an otherwise valid payload near the boundary. Names use the conservative common ASCII subset, up to 96 characters. Callers own pull scheduling/backoff. Native returned deliveries are validated; malformed destructive reads can already have lost the message. Handler failures never trigger an implicit retry/requeue.

`close()` is idempotent, rejects new work, drains actual pending operation settlement and executes registered cleanup once in reverse order. It does not force-cancel JavaScript or promise a new shutdown deadline: native deadlines govern I/O, BullMQ keeps its existing worker grace/force-close behavior, and noncooperating injected operations can delay close indefinitely. A timeout/disconnect can mean an unknown publish outcome; the wrapper never replays it. Unacknowledged RabbitMQ deliveries requeue when its owned connection closes. MemcacheQ cannot restore popped messages. Native extension/background processor lifetime stays with its backend's close implementation.

Custom backends may implement `QueueBackendFactory<Options,Extension>` with an explicit name, immutable capability/queue snapshots, pure `validate` and `open(options,{onCleanup})`. Register each resource immediately after acquiring it; at most 64 cleanup callbacks are accepted. Cleanup runs on startup failure, including invalid returned handles. An explicit factory is executable trusted host code, not a sandbox or discovered package. Errors use fixed `QueueBackendError.code`/message; private non-enumerable causes must remain in trusted server diagnostics. Neutral limits do not sanitize private job contents for telemetry—never log payloads or credentials.

Framework configuration uses `{queue:{enabled:true,required:true,selection}}`, with the same selection above. Do not mix `selection` with legacy Redis/workers/dashboard keys. Factories and options stay out of public manifests; factory identity is retained per generation. Optional startup failures mark queue degraded and log a fixed message; required failures roll back the generation. Queue cleanup still precedes cache/database cleanup, while the existing startup-worker shutdown remains separate. Configuration changes require an explicit generation/restart policy; nothing restarts an app automatically.

Focused qualification covers injected backend semantics, legacy BullMQ calls, strict selection, cleanup/draining, framework rollback and public export/type consumers. This does not certify live RabbitMQ confirms/redelivery, MemcacheQ persistence/loss or Redis worker recovery. Use dedicated disposable services for that acceptance. Semantics follow the official [amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html), [BullMQ worker shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown) and [MemcacheQ protocol](https://github.com/stvchu/memcacheq); no complete backend parity is promised.

## Durable opt-in webhooks

`@zeruxjs/queue/webhooks` adds an application-owned `webhook-cas-v1` outbox workflow. It imports no framework runtime, starts no timer/worker/exporter on import, and leaves all existing email helpers unchanged. The queue facade depends one-way on BullMQ, database types and security primitives; BullMQ never imports the facade. There is no default in-memory production store.

```ts
import {createWebhookWorkflow, createWebhookHttpsTransport} from '@zeruxjs/queue/webhooks';
import type {WebhookWorkflowOptions, WebhookInput, WebhookRecord} from '@zeruxjs/queue/webhooks';
import type {DatabaseFacade, TransactionDatabase} from '@zeruxjs/db';

export function configureWebhooks(
  host: Pick<WebhookWorkflowOptions, 'store' | 'authorize' | 'destination'>,
  approveAddress: (hostname: string, address: string) => boolean
) {
  const transport = createWebhookHttpsTransport({
    allowedOrigins: ['https://hooks.example.com'], approveAddress
  });
  const workflow = createWebhookWorkflow({...host, transport,
    policy: {maxAttempts: 5, maxAgeMs: 86400000, baseDelayMs: 1000,
      maxDelayMs: 60000, retryAfterMaxMs: 60000,
      transientStatuses: [429, 500, 502, 503, 504], retryNotSent: true}});
  return {workflow, async close() { await workflow.close(); await transport.close(); }};
}

export async function commitBusinessEvent(
  workflow: ReturnType<typeof createWebhookWorkflow>,
  db: Pick<DatabaseFacade, 'transaction' | 'transactionCapabilities'>,
  append: (pin: TransactionDatabase, record: WebhookRecord) => Promise<void>,
  event: WebhookInput, principal: unknown
) {
  return workflow.commit(db, {insert: append}, event, async pin => {
    const result = await pin.insert({table: 'business_events', values: {id: event.eventId}});
    if (!result.ok) throw new Error('Business write failed');
  }, principal);
}
```

The host supplies the actual durable store, journal writer, authenticated principal, destination registry and egress approval. The example domain is illustrative, not a live integration. `append` must insert on **that exact pin** into a tenant+delivery-ID unique journal; it must not use an unrelated connection, publish a queue job or perform an HTTP side effect inside the business transaction. Configure/migrate tables separately. `commit` negotiates the existing async database transaction facade and propagates its options/signals; unsupported facades reject. A native commit error can itself have an indeterminate outcome; reconcile by the unique journal key rather than blindly re-executing business work. No independent transaction implementation is introduced.

SQLite has a distinct supported path: await `workflow.prepare(event, principal)` **before** entering the connector's public `transactionSync`. Inside its synchronous callback perform the business insert and outbox insert using that callback's `SqliteSyncTransaction`, with no await/thenable. Preparation checks authorization, destination and active signing configuration but writes nothing; the host owns insertion and synchronous pinning. Async `commit` deliberately does not masquerade as SQLite `transactionSync`. Tests use the existing SQLite connector against an owned disposable WAL file for rollback; the shipped workflow does not include a production SQLite/SQL journal adapter.

A stored V1 record includes tenant, delivery ID, event ID, destination **reference**, application schema version, immutable serialized event body/hash, revision, delivery state, attempt count, timestamps, lease and bounded redacted history. The signed JSON body is `{eventId,schemaVersion,data}`. The SHA-256 digest detects byte changes, not authorship/permissions. Store bodies as private data under host retention/encryption/access policy; no client inspection returns bodies, URLs or signing keys. `WebhookStore.get/cas/due` are host-owned, linearizable durable operations: CAS must compare the **tenant+delivery ID and exact revision**, preserve immutable event fields and update indexed state/lease/due fields atomically. An ordinary cache get/set, process-local Map, local catalog revision or queue job ID is not this store.

States: `pending → sending → delivered`; declared transient responses return to `pending` with persisted `nextAt`; permanent HTTP/redirect, transport address-denial and limit outcomes become `dead`. Pre-claim authorization/destination/credential failures reject without sending and leave pending records available for host policy repair. Lost acknowledgements, interrupted HTTP after TLS establishment and **expired sending leases** become `uncertain`, never an automatic resend. Claims use durable CAS; competing workers cannot both claim a pending revision. A process crash after claim but before bytes are sent can conservatively become uncertain too. A successful side effect followed by failed journal settlement remains sending until reconciliation—do not infer failure from a missing response. A receiver still needs durable idempotency; this is not exactly-once processing.

`dispatch(tenant, principal, publisher, {cursor?,limit?})` publishes at most 50 sorted due references per call (default 20). The store must page pending due records and expired sending leases, with a stable ascending delivery-ID continuation. The host invokes this periodically; nothing starts a scheduler. Dispatch fails visibly on a policy/dependency failure; earlier references in that page may already have been published, so page retries must tolerate duplicates and operators must resolve blocked references. Queue payloads are only `{tenant,deliveryId}` under `webhook.deliver`, never bodies or credentials. Duplicate dispatches are possible, and durable CAS is authoritative. Use `createAcknowledgedWebhookPublisher` for the neutral RabbitMQ confirmed/manual-ack contract; destructive MemcacheQ and unknown capability claims reject. `createBullMQWebhookPublisher` explicitly uses native BullMQ completion acknowledgement, which differs from neutral manual-ack metadata. `createWebhookProcessor(workflow, workerPrincipal)` validates the opaque job reference. A pull worker acknowledges only after the processor durably records its outcome; a BullMQ processor resolves at that same boundary. These helpers do not start workers, grant tenant permissions, promise broker crash recovery or make queue publication atomic with database commit.

Every enqueue/delivery/dispatch/inspect/redrive requires a fresh host `authorize(action,reference,principal)` decision. Worker principals must be authenticated service identities authorized for the record tenant; request IDs/forwarded headers are not authorization. `destination(tenant,ref)` must return a matching `{tenant,ref,url,enabled:true,consumerIdempotency:true,keys}` from a private explicit registry. Resolve it on every operation so revocation/rotation takes effect. The idempotency flag is a host declaration requiring receiver qualification, not remote proof. `inspect` returns fixed metadata/history only, after rechecking destination/key policy. `redrive` requires fresh privileged authorization, current destination approval and active credentials; uncertain redrive additionally needs `{confirmedUncertain:true}` based on external reconciliation evidence. It preserves total age/attempt counts—expired/exhausted records cannot bypass caps. Reopening a known permanent rejection after a corrected policy is explicit; no redrive is automatic.

Policy is explicit: 1–20 attempts, age 1 second–30 days, base/max backoff 1 ms–1 day, bounded Retry-After 0–1 day, and at most 16 declared transient statuses (408/425/429/5xx). Other HTTP errors are permanent; all redirects are denied. Exponential backoff uses bounded half-to-full jitter. Retry-After seconds/date hints can increase the delay only within the declared cap; the remaining total age still wins. `retryNotSent` explicitly governs transport failures known to precede an HTTP write. HTTP 2xx requires a complete bounded response. Neither an unknown transport failure nor a lost acknowledgement is transparently retried. Injected `now`/`random` support deterministic checks; synchronize production clocks. An acknowledgement can follow a committed receiver side effect even on a 5xx, so declared response retries also require durable receiver idempotency.

Requests use the existing security package's native HMAC-SHA-256 authenticator with its exact 32-byte keys and current/previous key IDs, not homemade crypto or an asymmetric signature. Resolve active host-owned keys each attempt; temporary keyring copies are destroyed afterward. V1 headers are `x-zerux-webhook-id`, `x-zerux-webhook-timestamp` (Unix seconds) and `x-zerux-webhook-signature:v1.kid.tag`. The authenticated security context is JSON `["zerux.webhook.v1",tenant,destination,deliveryId,timestamp]` plus the exact UTF-8 body, using security's documented domain-separated MAC framing. `x-zerux-webhook-schema` is only a hint; the **signed body** is authoritative. This is a ZeruxJS-specific shared-MAC envelope, not RFC HTTP Message Signatures, JOSE, Stripe/GitHub compatibility or a token authorization scheme.

`verifyWebhook` verifies exact body bytes, key selection, tenant/destination scope and a bounded timestamp window (default five minutes, max one hour; future timestamps reject). Those scope values must come from trusted receiver configuration, not unverified headers. It does not consume replay state. `verifyAndConsumeWebhook` additionally requires a host `webhook-replay-v1` linearizable unique claim and explicit retention (up to 30 days), returning `verified`, `duplicate` or `invalid`. Retention must cover the sender's retry/redrive horizon. The receiver must coordinate that claim with durable business/idempotency state in its own transaction: a standalone pre-handler consume can burn an event if business work fails. Handle a previously committed duplicate with the receiver's documented success acknowledgement, not a second side effect. Keys, auth tokens, private bodies and raw error causes never belong in attempt telemetry.

The default Node HTTPS transport uses an exact HTTPS-origin allowlist, rejects credentials/query/fragment URL fields, disables pooling (`agent:false`) and checks DNS through the connection's lookup callback **for every connection**. All returned IPv4 addresses (maximum 32) must pass built-in special/private/loopback/link-local/multicast denial **and** synchronous host egress approval before an approved answer is pinned to that connection. Literal addresses receive the same checks. TLS certificate/hostname verification stays enabled, redirects are never followed and no proxy credentials/environment transport are inferred. IPv6, mapped and transition addresses are deliberately unsupported/fail-closed. This is not a complete IANA/routing policy: deployment firewalls/DNS/network egress controls must also prevent SSRF, rebinding/proxy bypass and access to sensitive globally routed services. Host `resolve`/`request` hooks are explicitly trusted testing/deployment injection; a replacement connector can bypass these guarantees and needs separate qualification. No public HTTP input may choose them.

Bodies are plain JSON ≤64 KiB, nesting ≤16, visited values ≤8192. HTTP headers/responses are bounded (8 KiB by default; response-body max 64 KiB). Default workflow/transport concurrency is 16, hard maximum 128. HTTP deadlines are 1–30000 ms (workflow default 10000); leases default 60000 ms, must exceed HTTP deadline by at least one second, and cap at five minutes. Fixed `WebhookError.code`/messages and redacted history contain no payload, key, cookie, token URL or private stack. Private non-enumerable causes remain for trusted diagnostics; do not serialize them. No global logger/tracer or diagnostic routes start on import. A host can map codes into its existing sanitized application envelope without exposing causes.

Close the workflow before its host-owned transport/store. `workflow.close()` rejects new work, aborts active HTTP signals and awaits actual in-flight work; `transport.close()` closes its own requests and awaits outstanding DNS/native settlement. Noncooperating host callbacks/DNS/database work can delay closure; slots remain occupied instead of starting unbounded replacement work. Abort does not prove remote rollback. The workflow borrows its store/transport/signing source and never closes the application's database, queue or credential vault.

Qualification includes synthetic pinned commit/rollback, actual disposable SQLite rollback, CAS/replayed jobs, expired leases, signature rotation/replay-store claims, 429/5xx/permanent/redirect outcomes, total caps, SSRF/DNS/egress denial and HTTP cancellation/cleanup through an injected Node-request fixture. These are not live receiver, TLS/DNS infrastructure or broker/process-crash acceptance. That needs a dedicated acknowledged broker, production-quality durable CAS/journal/replay stores, qualified HTTPS receivers with idempotency, active credentials and deployment egress policy. See the official [Node HTTPS API](https://nodejs.org/docs/latest-v24.x/api/https.html), [DNS lookup API](https://nodejs.org/docs/latest-v24.x/api/dns.html#dnslookuphostname-options-callback) and [Retry-After semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). Existing email outbox/recovery helpers stay unchanged and retain their own boundaries.

## Ownership at each boundary

| Public contract                                  | Owner and cleanup                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Legacy root `createQueueService`                 | BullMQ owns producer/worker/events/Cluster cleanup; await service close and inspect incomplete shutdown counters when relevant      |
| Root or `/neutral` `createQueueBackend`          | Wrapper drains actual admitted calls, then invokes registered cleanup once in reverse order; native extensions share this lifecycle |
| `/backends` descriptors and `selectQueueBackend` | Inert trusted configuration; no connection or cleanup handle until the selected factory opens                                       |
| `/webhooks` workflow                             | Close before its borrowed transport/store; admitted HTTP work remains owned through actual settlement                               |
| `/webhooks` HTTPS transport                      | Close requests and await outstanding DNS/native settlement; borrowed connector/resolver policy remains host-owned                   |
| Publisher/processor/signing helpers              | Borrow existing owners or create short-lived key copies; no worker, scheduler or network loop starts                                |

`prepare()` is asynchronous authorization/signing preparation. Await it before SQLite `transactionSync`, then insert the returned record and business mutation on that callback's exact synchronous pin without awaiting. The separate async `commit()` requires the existing negotiated pinned transaction contract. Neither API turns independent queue publication/HTTP effects into a database transaction.

Native extension calls are trusted access and bypass the neutral wrapper's payload/pending policy. Manual acknowledgements stay on their original delivery channel; closing/replacing a connection cannot transfer them. A lost publish or receiver acknowledgement remains an uncertain external effect, not permission for an automatic replay. Runtime tenant authorization, consent, durable idempotency and reconciliation remain authoritative despite static lint ownership hints.
