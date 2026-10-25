# @zeruxjs/queue-rabbitmq

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

Run `npm run build` here. Live broker tests require an isolated RabbitMQ virtual host. Framework queue config still selects BullMQ; use this standalone factory in a startup worker and return `() => jobs.close()`. See the [amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html).
