---
{
  "title": "Durable email jobs",
  "description": "Persist message identity, recheck consent and reconcile ambiguous SMTP outcomes.",
  "section": "Data and services",
  "order": 50,
  "sources": [
    "packages/@zeruxjs/queue/README.md",
    "packages/@zeruxjs/email/README.md"
  ],
  "related": [
    "package-email",
    "package-queue",
    "package-analytics"
  ]
}
---

## Why retry is not enough

A worker can crash after an SMTP server accepts a message but before your database records success. Retrying that job can send a duplicate. A durable queue prevents some task loss; it cannot make an external SMTP transaction exactly-once.

Use a persisted message descriptor plus a shared per-message delivery record. Queue only the opaque message ID. Resolve recipients, bodies, credentials and attachments from trusted storage at delivery time.

## Delivery state machine

| Transition | Meaning |
| --- | --- |
| pending → claimed | One worker acquires the versioned delivery record |
| claimed → suppressed | Current marketing consent forbids delivery |
| claimed → pending | A failure before SMTP begins can be retried safely |
| claimed → sending | The worker is about to contact the sender |
| sending → sent | The sender reports acceptance and state is durably recorded |
| sending → uncertain | Error, timeout, crash or expired sending lease leaves outcome ambiguous |

The host store must provide atomic compare-and-swap across all workers. A module-local Map or process-local mutex cannot protect a multi-server delivery record.

## Construct the processor

```ts
import { createDurableEmailDeliveryProcessor } from '@zeruxjs/queue';
const processor = createDurableEmailDeliveryProcessor({
  store: deliveryRecords,
  isSubscribed: recipient => preferences.isSubscribed(recipient),
  send: async id => { await emailDelivery.sendPersistedMessage(id); },
  onUncertain: id => alerts.flagForManualReconciliation(id)
});
```

All four resources are application-supplied services. The send implementation must recheck marketing permission at the actual send boundary and use the saved per-email tracking choices. Register the processor only on designated worker processes with explicit concurrency.

## Consent and tracking remain separate

A marketing recipient can unsubscribe between enqueue and dispatch. Recheck current consent; a preferences-store outage is not permission to send. Transactional messages have a separate purpose contract. An opted-in recipient does not automatically opt into activity tracking, and a queued job must not change the saved tracking policy.

## Operations and reconciliation

Investigate uncertain outcomes using provider evidence, transport logs and your durable audit record. resolveUncertainEmailDelivery records the operator's verified decision; it does not safely guess an SMTP resend. Provider idempotency or an explicit outbox can help but does not justify blind retry of every unknown outcome.

## Scheduling and privacy

BullMQ delays need persistent Redis and available workers. Set retention for job/event history and keep Redis payloads free of message content. A scheduled batch is not a whole campaign system: use the campaign planner/outbox/suppression APIs for paging and campaign ownership. Track SMTP acceptance, provider notifications and observed opens as different measurements.
