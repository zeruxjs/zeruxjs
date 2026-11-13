---
{
  "title": "MemcacheQ FIFO backend",
  "description": "Set up @zeruxjs/queue-memcacheq with explicit lifecycle and capability boundaries.",
  "section": "Packages",
  "order": 1,
  "sources": [
    "packages/@zeruxjs/queue-memcacheq/README.md",
    "packages/@zeruxjs/queue-memcacheq/src/index.ts"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/queue-memcacheq"
}
---

Basic FIFO producer and destructive consumer for an actual [MemcacheQ server](https://github.com/stvchu/memcacheq). An ordinary Memcached server is not a queue and is not compatible with these delivery semantics. Requires Node 20+.

```ts
import {createMemcacheQ} from '@zeruxjs/queue-memcacheq';
const jobs = createMemcacheQ({host: '127.0.0.1', port: 22201, prefix: 'shop'});
try {
  await jobs.add('notifications', 'refresh', {recordId: '42'});
  const message = await jobs.take('notifications');
  if (message) console.log(message.name, message.data);
} finally {
  jobs.close();
  await jobs.whenClosed();
}
```

`createMemcacheQ` connects lazily. `add(queue,name,data)` appends a JSON object; `take(queue)` returns `{name,data}` or undefined on an empty queue. The caller owns polling, backoff, cancellation and processing. Each call is bounded; no background worker starts. `capabilities` explicitly declares destructive reads and absence of acknowledgements, retry and delay. There are no schedulers, priority, deduplication or dashboard APIs.

`get` permanently pops a message before application processing. A crash, malformed message or response timeout may lose work; writes may have succeeded despite a timeout. Nothing is automatically replayed. Use BullMQ or RabbitMQ when acknowledged recovery is required. Persistence depends on the server's Berkeley DB configuration and does not change destructive-read behavior.

Options match `TextConnectionOptions` in `@zeruxjs/cache-memcache/protocol`: `host`, `port`, `tls`, `timeoutMs`, `maxBytes`, `maxConcurrent`; additionally `prefix` defaults to `zerux`. Default port is 22201. Full prefixed queue keys and job names must be printable ASCII without spaces, at most 250 bytes. The protocol has 3-second absolute deadlines and 32 concurrent sockets by default; see the versioned-envelope/body limits below. Configure the budget no higher than your server's message-size setting. No credentials or environment values are read automatically. Use trusted network access; the basic protocol provides no authentication. TLS requires a supporting endpoint or trusted tunnel.

`close` is idempotent, cancels sockets and rejects new work. Build `cache-memcache` first, then run `npm run build` here. Live MemcacheQ acceptance requires a separate disposable server; a text-protocol fixture verifies framing only. Legacy framework queue configuration remains BullMQ. Opt in through the facade's explicit [`memcacheQBackend` selection](package-queue.md#explicit-neutral-backends-and-durable-webhooks), or instantiate this adapter from a startup worker and return its cleanup function.

## Opt-in polling worker

```ts
import {createMemcacheQWorker} from '@zeruxjs/queue-memcacheq/worker';
import type {MemcacheQWorkerJob} from '@zeruxjs/queue-memcacheq/worker';

export function startReferenceWorker(
  host: string, serverRecordBytes: number,
  processReference: (job: MemcacheQWorkerJob) => Promise<void>
) {
  return createMemcacheQWorker({
    connection: {host, port: 22201, prefix: 'shop',
      serverMaxBytes: serverRecordBytes, maxBytes: serverRecordBytes},
    queues: [{name: 'notifications', handler: processReference}],
    concurrency: 2, processingMs: 10000, drainMs: 5000,
    idle: {minMs: 25, maxMs: 1000, factor: 2, jitter: 0.2},
    onError: notice => { console.warn(notice.code, notice.phase); }
  });
}
```

The host must supply its actual approved fixed-record size, at most 65500 bytes, not a guessed server default. The example processes references only; durable side effects, tenant/consent authorization and idempotency remain host responsibilities. `job.signal` permits cooperative cancellation. No job data, queue names, private causes or raw server responses enter error notices. No background worker starts until this explicit factory is called. The root also reexports the worker; basic imports/creation do not start polling.

Call `await worker.close()` to stop admission and observe bounded drain; `await worker.closed` additionally waits for actual handler, socket and error-hook settlement. `close()` immediately forbids new pops, aborts pending socket reads, closes the owned client and cancels idle timers. Existing handlers get the configured grace; after grace their signals abort. A record already popped or whose response is cancelled can be permanently lost, including a shutdown race before handler delivery. There is no way to put it back safely. Never use this backend for work requiring acknowledged recovery.

The basic producer now writes `{version:1,name,data}` envelopes, while `take` still returns only `{name,data}`. For compatibility the basic client accepts old unversioned records by default; set `acceptLegacy:false` for V1-only reads. Workers default to V1-only and allow an explicit `connection.acceptLegacy:true` migration window. Unknown versions, invalid UTF-8/JSON, unexpected envelope keys, wrong reply keys/counts and unsafe/non-JSON data reject without echoing values. Such a failure can occur **after** a destructive pop; it is not a recoverable validation queue. Plain JSON data is snapshotted, bounded to 16 levels/8192 values, and rejects cycles, accessors, classes, unsafe property names and non-finite values. Shared text framing/byte parsing remains owned by cache-memcache, not reimplemented here.

The [upstream MemcacheQ protocol](https://github.com/stvchu/memcacheq#readme) stores fixed-length Berkeley DB records, pads short bodies with spaces, and documents a ceiling below 64 KiB. `serverMaxBytes` is an explicit host declaration, never remotely discovered or guaranteed by this library. It defaults to 65500 for basic-client compatibility and is **required** for workers; `maxBytes` defaults to min(32768, serverMaxBytes). Both are positive integers, maxBytes cannot exceed serverMaxBytes, and the hard ceiling is 65500. This deliberately replaces the old generic 1 MiB default. Set limits no higher than the actual installed server's record/body setting. Returned padding counts against the read budget, so choose a read budget that accommodates the entire fixed record. A smaller application budget can reject an already-popped padded record. Production acceptance must check your actual server/fork; not every implementation shares the same limits.

Basic `add`/`take` accept an optional final `{signal,deadline}` request argument, forwarded to the existing text transport. `close()` retains its synchronous API; `whenClosed()` waits for actual socket release and `activeSocketCount` exposes a path-free count. Unsupported delay, priority, acknowledgement, retry and unknown request/config keys reject before sockets. Set expiry stays zero; the original MemcacheQ protocol ignores that field, so it is not a delayed-delivery mechanism. Network append/pop failures report fixed `MEMCACHEQ_WRITE_UNKNOWN` / `MEMCACHEQ_POP_UNKNOWN` errors with private non-enumerable causes; a lost response does not prove the operation failed. Already-cancelled signals and expired/invalid request deadlines reject before dispatch rather than claiming an unknown network outcome. No failed write/pop is replayed. Known rejection and malformed popped envelopes have separate error codes. The neutral facade accepts the new size/legacy options and awaits the native close barrier when available; older injected basic factories remain supported.

Workers have 1–32 unique configured queues and 1–64 processing lanes (default four). Each lane owns at most one pop or actual handler execution, and requests rotate across the allowlist. Socket concurrency must be at least the lane count. Empty reads and read failures pause with per-lane exponential backoff; defaults 25–1000 ms, factor 2, jitter ±20%, clamped to the configured minimum/maximum. min/max must be integer 1–30000 ms, factor 1–8, jitter 0–1. Only a received job resets that lane's backoff. `random` may inject a deterministic [0,1] source for tests; invalid/throwing sources stop the worker safely. Error backoff means a later pop of the next record, not replay of the failed destructive request. This is simple round-robin polling, not a fairness/latency guarantee across queues.

`processingMs` defaults to 30000 (1–300000). On expiry the result is classified as timed out, a redacted notice is emitted and the signal aborts. It does **not** force-cancel JavaScript or free the lane early: the lane remains occupied until actual settlement. A noncooperating handler can therefore stall that lane indefinitely, with no replacement pop. A rejected or timed-out handler never reinserts the message; success has no ack to send. The handler cannot request retry/priority/delay/ack through this API. Local button disabling, a handler promise or an AbortController cannot provide durable job recovery.

`drainMs` defaults to 30000 (1–300000). `status()` distinguishes `running`, `closing`, `incomplete`, `closed` and fatal `failed`, with fixed counters for active reads/handlers/sockets/timers/error hooks, real empty polls, failures/timeouts and selected idle delay. `incomplete` means actual work still owns resources after the close wait. `closed` is a settlement barrier, not forced termination. Error callbacks are trusted host code: synchronous exceptions and async rejections are isolated, at most one async notice is pending, and additional notices increment `droppedNotices` rather than building an unbounded queue. A stalled async hook can keep actual `closed` pending. Synchronous host code cannot be preempted.

Capabilities remain `destructiveRead:true`, `acknowledgement:false`, `retry:false`, `delay:false`; workers additionally expose `priority:false`/`push:true`. The neutral facade continues rejecting acknowledged-delivery requirements. Use a separate worker per tenant/authorized queue scope, protect server access, and keep payloads free of secrets. There is no automatic fallback from an acknowledged backend, no application restart, no reinsert-on-failure or crash-recovery claim.

Focused tests use an ephemeral loopback FIFO protocol fixture, covering V1/legacy handling, byte limits, empty polling/jitter, blocked reads, cancellation, noncooperating handler drain, malformed popped messages, callback failures and capability denial. Packed consumers compile this public-import example and existing basic imports. A FIFO fixture is not a real MemcacheQ/Berkeley DB server. Live broker acceptance requires an isolated actual MemcacheQ instance with known record sizing/TLS configuration; no such server is configured here. Persistent crash/loss behavior, server forks and production network failures remain unqualified.

## Cleanup and inspection

The basic client owns socket requests and needs both `close()` and `whenClosed()` for a full teardown. The worker owns its basic client, polling timers and handler signals; retain its `closed` promise separately from the bounded `close()` receipt. Error hooks and noncooperating handlers can keep that actual-settlement barrier pending. Host handlers remain trusted application code: inert JSON validation is not a sandbox or authorization policy.

The focused tests always release held synthetic handlers/error hooks and observe actual worker settlement during teardown. Their ephemeral FIFO fixture exercises protocol framing and cancellation only; no Berkeley DB persistence or crash recovery is certified.
