---
{
  "title": "RabbitMQ queue backend",
  "description": "Set up @zeruxjs/queue-rabbitmq with explicit lifecycle and capability boundaries.",
  "section": "Packages",
  "order": 1,
  "sources": [
    "packages/@zeruxjs/queue-rabbitmq/README.md",
    "packages/@zeruxjs/queue-rabbitmq/src/index.ts"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/queue-rabbitmq"
}
---

Basic RabbitMQ backend using amqplib: durable named queues, persistent JSON messages, publisher confirms and explicit consumer acknowledgement. Requires Node 20+ and a reachable RabbitMQ server.

```ts
import {createRabbitMQ} from '@zeruxjs/queue-rabbitmq';
const jobs = await createRabbitMQ({
  url: process.env.AMQP_URL!, prefix: 'shop', queues: ['notifications']
});
try {
  await jobs.add('notifications', 'refresh', {recordId: '42'});
  const message = await jobs.take('notifications');
  if (message) {
    try {
      // Persist the actual application side effect idempotently before ack.
      console.log(message.name, message.data);
      message.ack();
    } catch { message.reject(false); }
  }
} finally { await jobs.close(); }
```

`createRabbitMQ(options)` owns a connection, confirm channel and manual-ack pull channel. Only the explicit `queues` allowlist is declared at startup (1–100 queues). `prefix` defaults to `zerux`; queue/job/prefix names match `[A-Za-z0-9][A-Za-z0-9_.-]{0,95}`. Physical names are `prefix.queue`. Provide credentials only through private server configuration. AMQPS uses the normal Node trust store; configure broker permissions and virtual hosts separately. Queue declaration is durable with default broker queue type, not an automatic quorum/durability policy.

`add(queue,name,data)` resolves a generated message ID after the publisher confirmation. Concurrency is bounded by `maxPending` (32, max 1000); buffer backpressure rejects new publishes until drain. `maxBytes` defaults to 65536 (max 1 MiB). `timeoutMs` defaults to 3000 (max 120000); commands exceeding this deadline fail the service and close the connection because their outcomes may be unknown. Startup failures clean up acquired resources. Credentials are never included in wrapper error messages; internal error causes must remain server-side.

`take(queue)` returns undefined when empty, or `{id,name,data,redelivered,ack,reject}`. At most `prefetch` outstanding deliveries/reservations are allowed locally (default 16, max 1000). Each delivery can be disposed once. `reject()` defaults to no requeue; a broker dead-letter policy can capture it, otherwise it is discarded. `reject(true)` explicitly requeues and can loop forever if your application does not bound attempts. Malformed/oversized messages are rejected without requeue. There is no automatic retry policy.

`close()` is idempotent and closes the connection, requeuing unacknowledged messages. Finish processing before closing if graceful draining is required. An interrupted confirmation/ack is ambiguous; use durable application idempotency. Publisher confirmation is not proof of consumer processing. Acknowledgements permit redelivery after crashes, not exactly-once side effects. Unexpected channel/connection failure rejects subsequent calls; reconstruct the service explicitly. There are no automatic reconnect, recurring/delayed scheduler, admin dashboard or consumer loops. `capabilities` exposes these basic guarantees.

Run `npm run build` here. Live broker tests require an isolated RabbitMQ virtual host. Legacy framework queue config still selects BullMQ. Opt in through the facade's explicit [`rabbitMQBackend` selection](../queue/README.md#opt-in-neutral-backend-selection), or use this standalone factory in a startup worker and return `() => jobs.close()`. See the [amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html).

## Opt-in supervised worker service

`createRabbitMQ` above is preserved. The separate `@zeruxjs/queue-rabbitmq/worker` entry (also reexported from root) owns supervised push consumers and never changes a pull client's channels, acknowledgements or reconnect policy. Nothing connects on import. Worker queues require an advertised **RabbitMQ 4.x** server and explicit quorum topology; unsupported/missing broker advertisements fail before declaring topology. The server's declarations must also succeed. This is a deliberately narrow supported contract, not all AMQP servers/versions. Producer-only classic definitions do not require that quorum qualification.

```ts
import {createRabbitMQWorker} from '@zeruxjs/queue-rabbitmq/worker';
import type {RabbitMQWorkerJob, RabbitMQWorkerResult} from '@zeruxjs/queue-rabbitmq/worker';

export function startReferenceWorker(
  url: string, persistIdempotently: (id: string, signal: AbortSignal) => Promise<void>
) {
  return createRabbitMQWorker({url, prefix: 'shop', concurrency: 4,
    timeoutMs: 3000, drainMs: 10000, handlerTimeoutMs: 30000,
    reconnect: {maxAttempts: 3, delayMs: 1000},
    queues: [{name: 'notifications', type: 'quorum', maxAttempts: 3,
      retryDelayMs: 5000, maxLength: 10000,
      handler: async (job: RabbitMQWorkerJob): Promise<RabbitMQWorkerResult> => {
        // Host must enforce tenant/consent authorization at the side-effect boundary.
        await persistIdempotently(job.id, job.signal);
        return 'ack';
      }}]
  });
}
```

Await the returned service, call `service.add('notifications','refresh',{recordId:'42'})`, and `await service.close()` on host teardown. The callback is trusted server code and its durable idempotency/tenant/consent policies remain host-owned; neither an opaque message ID nor a queue prefix grants authorization. No worker HTTP routes, package discovery, environment credentials or framework workers start automatically. The legacy facade's `rabbitMQBackend` still wraps `createRabbitMQ`'s pull basics. This push service is separate; do not pass it off as a pull backend. Use an explicit host startup worker and return its close function when integrating with ZeruxJS.

Each logical queue declares three durable physical queues: `prefix.name`, `prefix.name.retry`, `prefix.name.dead`. All names/suffixes are checked for collisions before connection. Work/dead queues use the selected classic/quorum type and `x-max-length`/`x-overflow:reject-publish`. Work queues dead-letter rejected messages through the default exchange to `.dead`; quorum work queues set `x-delivery-limit:maxAttempts`. Retry queues are classic queues with an explicit per-queue TTL and dead-letter routing back to work. Delay occurs in the broker, never a process delivery timer or an assumed delayed-message plugin. These declarations are explicit immutable queue arguments; do not reuse incompatible existing names. Production operators should review equivalent [broker policies and dead-letter safety](https://www.rabbitmq.com/docs/dlx). This implementation does not dynamically reconcile policies, promise loss-free DLX routing, set up a broker cluster or guarantee replication for classic retry queues. TLS trust/vhosts, users/permissions, storage policies, broker version/availability and quorum membership remain deployment responsibilities.

Handlers return `'ack'`, `'retry'` or `'dead-letter'`; exceptions request retry. At the attempt limit, invalid results or malformed payload/headers, the original consumer channel issues `nack(message,false,false)` to the declared dead-letter path. There is no application `requeue:true` loop or caller-owned ack handle in this API. A retry publishes a persistent mandatory message with the **same message ID**, incremented `x-zerux-attempt`, and awaits its confirmation before acknowledging the original. Its effective attempt includes broker `x-delivery-count`, so quorum redeliveries count toward the bound. Publish backpressure, a return or a broker nack during retry dead-letters the original; it does not spin or silently drop a requested retry into local memory. An unknown outcome retires the generation and leaves the original unacknowledged. Broker redelivery/header enforcement must be qualified on your installed broker; application attempt headers are not authentication or protection against a producer authorized to forge messages.

There is an unavoidable duplicate window between confirmed retry publication and original acknowledgement. A process crash can redeliver the original while a retry exists. Acknowledgements are fire-and-forget AMQP operations, not broker-confirmed commits. Unknown publishes and interrupted acknowledgements require durable application idempotency and reconciliation. Do not resend an unknown side effect automatically. Quorum delivery limits bound broker poison redelivery; they do not provide exactly-once delivery. See [consumer acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms) and [quorum queue delivery limits](https://www.rabbitmq.com/docs/quorum-queues).

Every publish sets `mandatory:true` and correlates returned messages with a private publication header. Confirmed returns reject `UNROUTABLE`; broker confirmation nacks reject `PUBLISH_NACK`. Channel-close/timeout/unknown callback failures reject `PUBLISH_OUTCOME_UNKNOWN` and are **never replayed** after reconnect. The current amqplib broker-nack error signature is recognized conservatively; unrecognized error signatures remain unknown outcomes. Returns are processed before confirmations according to the RabbitMQ contract. Publisher buffer pressure and broker blocked/unblocked events reject new work until cleared; this is distinct from max pending confirmations.

Defaults/hard limits: 1–32 configured logical queues; concurrency 16 (or worker count if greater), maximum 128 and at least the worker count; 32 pending confirmations (maximum 1000); 64 KiB serialized envelope (maximum 1 MiB); 16 JSON nesting levels/8192 nodes. Plain JSON data is snapshotted, unsafe keys/accessors/classes/cycles/non-finite values reject, and incoming envelopes/IDs/attempts are validated before handlers. Queue/name/ID identifiers use `[A-Za-z0-9][A-Za-z0-9_.-]{0,95}`. Attempt limit defaults to 3 (1–20), retry TTL to 1000 ms (100–86400000), queue length to 10000 (1–1000000). Queue capacity is per declared queue, not a service memory limit. Per-consumer prefetch credits divide the service concurrency budget; unsupported quorum global prefetch is never enabled. Old generations' handlers keep their slots until actual settlement.

`timeoutMs` defaults to 3000 (1–120000) for connection/startup/confirmation/resource phases. Handler timeout defaults to 30000 (1–300000); it aborts cooperative job signals, fences acknowledgements and retires the generation. A timeout cannot force-stop arbitrary JavaScript. Reconnect defaults to **disabled** (`maxAttempts:0`); explicit 0–20 attempts are a lifetime service budget, with a fixed 1–30000 ms pause. Process timers implement reconnection pauses and deadlines only, never delayed delivery. No budget resets, automatic publish replay, package reload or app restart occurs. Unproven resource cleanup stops recovery rather than overlapping connections. Failed initial startup cleans acquired resources and rejects; runtime losses retire old channels and wait for actual callback/native settlement before declaring/consuming on a replacement. Noncooperating work can therefore stall recovery indefinitely rather than overlap generations. Recreate the service explicitly after exhausting its budget.

Close rejects new publishes, cancels consumer tags, lets existing handlers/confirmations finish within `drainMs` (default 30000, 1–300000), then aborts signals/fences old ack work and closes consumer → producer → connection. Acknowledgements always use the channel that delivered the message. The caller wait is bounded by drain plus four I/O deadlines; native promises remain owned after that wait. `status()` reports fixed counters/state only: pending handlers/native work/confirmations/timers, generation/reconnect attempts, unknown/returned publishes, dead-letter requests (not proof of DLX arrival), handler/drain deadlines and cleanup failures. `incomplete` means pending native/callback settlement; late settlement can resolve it to `closed` or `failed`. Underlying amqplib close promises are not force-cancelled through private socket internals. All worker errors use stable redacted codes/messages with private non-enumerable causes; do not publish those causes or job data in telemetry.

Focused tests use injected amqplib-shaped connections for return/nack/backpressure, broker TTL declarations, malformed inputs, retry limits, callback deadlines, generation ack fencing, finite reconnect and late cleanup. Simulated disconnect/redelivery is **not live worker crash recovery**. Live acceptance needs a dedicated disposable RabbitMQ 4.x vhost/cluster, quorum support and credentials authorized for these exact declarations; provider failover, process kill, broker disk/network failure and DLX retention still need operational qualification. No live broker is configured for the offline checks. The injected connector is trusted test/host code, must return a fresh service-owned connection for each attempt (never a borrowed/shared connection), and must honor handshake limits; late returned connections are closed, while a never-settling connector can retain incomplete cleanup.

## Ownership and local verification

Keep the basic pull service and supervised push service as separate owners. The basic client has no automatic reconnect or handler drain. The supervised service retains old-generation handlers and native promises after caller deadlines; inspect `status()` for incomplete settlement. Acknowledgements always belong to the original delivering channel. A reconnect, publisher confirmation or successful `close()` receipt cannot certify exactly-once application side effects.

Local tests use fresh injected connections, release held handlers/native callbacks on teardown and compile the public example from the package archive. These checks verify wrapper behavior and exports, not real broker crash recovery, quorum persistence or dead-letter arrival. Host permission, tenant scope, TLS credentials and isolated live-broker acceptance remain separate responsibilities.
