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
