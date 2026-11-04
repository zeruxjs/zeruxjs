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
} finally { jobs.close(); }
```

`createMemcacheQ` connects lazily. `add(queue,name,data)` appends a JSON object; `take(queue)` returns `{name,data}` or undefined on an empty queue. The caller owns polling, backoff, cancellation and processing. Each call is bounded; no background worker starts. `capabilities` explicitly declares destructive reads and absence of acknowledgements, retry and delay. There are no schedulers, priority, deduplication or dashboard APIs.

`get` permanently pops a message before application processing. A crash, malformed message or response timeout may lose work; writes may have succeeded despite a timeout. Nothing is automatically replayed. Use BullMQ or RabbitMQ when acknowledged recovery is required. Persistence depends on the server's Berkeley DB configuration and does not change destructive-read behavior.

Options match `TextConnectionOptions` in `@zeruxjs/cache-memcache/protocol`: `host`, `port`, `tls`, `timeoutMs`, `maxBytes`, `maxConcurrent`; additionally `prefix` defaults to `zerux`. Default port is 22201. Full prefixed queue keys and job names must be printable ASCII without spaces, at most 250 bytes. Defaults are 3-second absolute deadlines, 1 MiB payload/response budget and 32 concurrent sockets. Configure the budget no higher than your server's message-size setting. No credentials or environment values are read automatically. Use trusted network access; the basic protocol provides no authentication. TLS requires a supporting endpoint or trusted tunnel.

`close` is idempotent, cancels sockets and rejects new work. Build `cache-memcache` first, then run `npm run build` here. Live MemcacheQ acceptance requires a separate disposable server; a text-protocol fixture verifies framing only. Framework queue configuration remains BullMQ; instantiate this adapter explicitly from a startup worker and return its cleanup function.
