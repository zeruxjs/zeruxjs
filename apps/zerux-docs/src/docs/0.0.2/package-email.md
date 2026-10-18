---
{
  "title": "Email delivery, inboxes and campaigns",
  "description": "Separate transport, consent, tracking, scheduling and durable delivery state.",
  "section": "Packages",
  "order": 20,
  "sources": [
    "packages/@zeruxjs/email/README.md",
    "packages/@zeruxjs/email/package.json"
  ],
  "related": [
    "durable-email",
    "package-queue",
    "package-analytics"
  ],
  "package": "@zeruxjs/email"
}
---

## Configure an SMTP manager

```ts
import { createEmailManager } from '@zeruxjs/email';
const mail = createEmailManager({ accounts: [{
  name: 'transactional',
  smtp: { host: 'smtp.example.com', port: 587, requireTLS: true,
    auth: { type: 'password', user: 'sender@example.com', pass: process.env.SMTP_PASSWORD! } },
  defaults: { from: 'Sender <sender@example.com>' }
}] });
await mail.send({ account: 'transactional', to: 'person@example.net',
  subject: 'Receipt', text: 'Your receipt is ready.', tracking: { enabled: false } });
await mail.close();
```

## Consent is not tracking

Marketing sends require an affirmative current subscription from an injected preferences service. Transactional purpose is separate. Neither permission nor an unsubscribe silently changes message tracking. Instrumentation is per-send opt-in and explicit send options can disable it.

## Templates and attachments

Use escaped template variables and the email layout helpers for supported email-safe markup. Converting arbitrary browser HTML/CSS cannot make every mail client support it. Attachments can stream from the files manager with configured bounds; do not accept arbitrary local paths from clients.

## Queues and delivery ambiguity

The built-in transient queue and manager-lifetime idempotency are not durable exactly-once delivery. Use persisted message IDs with the BullMQ adapters and a shared CAS delivery record for restart-safe workflows. SMTP timeout after acceptance can be ambiguous; mark uncertain outcomes for operator reconciliation rather than blindly resending.

## Inbound mail

createEmailReceiver supports configured IMAP/POP3 polling, MIME parsing and attachment policies. Choose package-managed/mapped/custom inbox storage or JSON-only mode. Persist cursors per mailbox and verify access for UI APIs. POP3 cannot mutate IMAP-style flags; JSON-only receive mode does not deduplicate for you.

## Campaigns and governance

Campaign planning, outbox checkpoints, suppression, dashboards and exports are opt-in application integrations. Supply host authorization, consent checks, durable stores and signed provider webhook verification. Archive is not deletion; redaction has retention/legal-hold boundaries. The package README includes the detailed contracts for each subsystem.
