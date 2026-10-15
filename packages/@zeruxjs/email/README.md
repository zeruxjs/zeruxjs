# @zeruxjs/email

Multiple independent SMTP connections, Nodemailer transport reuse, password or OAuth2 authentication, optional pooling, DKIM, typed templates, email-safe HTML and tables, recipient suppression, batching, transient retry queues, attachment streams from `@zeruxjs/files`, and opt-in email analytics hooks.

```ts
import {createEmailManager,createEmailLayout,emailRow} from '@zeruxjs/email';
import {createEmailTrackingService} from '@zeruxjs/analytics/email';

const tracking=createEmailTrackingService({
  analytics,baseUrl:'https://events.example.com',secret:process.env.EMAIL_TRACKING_SECRET!
});
const mail=createEmailManager({
  accounts:[
    {name:'transactional',smtp:{host:'smtp.example.com',port:587,requireTLS:true,
      auth:{type:'password',user:'sender@example.com',pass:process.env.SMTP_PASSWORD!}},
      defaults:{from:'Sender <sender@example.com>'}},
    {name:'notifications',smtp:{host:'smtp.example.com',port:465,secure:true,
      auth:{type:'oauth2',user:'alerts@example.com',clientId:process.env.OAUTH_CLIENT_ID!,
        clientSecret:process.env.OAUTH_CLIENT_SECRET!,refreshToken:process.env.OAUTH_REFRESH_TOKEN!}},
      defaults:{from:'Alerts <alerts@example.com>'}}
  ],
  tracking,files // optional named Files manager for attachment streaming
});

await mail.send({account:'transactional',to:'person@example.net',subject:'Order receipt',
  html:createEmailLayout(emailRow(['Item','Price'])),text:'Order receipt',
  tracking:{enabled:false}});

// Marketing/notification tracking is a PER-SEND explicit choice.
await mail.send({account:'notifications',to:'person@example.net',subject:'News',
  html:'<p>View our news</p>',text:'View our news'},
  {tracking:{enabled:true,opens:true,clicks:true,campaign:'october'}});

await mail.close();
```

Tracking **does not run automatically**, even if it appears in an account default. `{tracking:false}` in send options overrides message tracking. Successful delivery is never retried because of tracking instrumentation, database writes, or warning callbacks. The open pixel has approximate accuracy (images can be blocked, cached or prefetched); clicks and opens do not imply explicit human engagement. Tracking links exclude unsubscribe URLs and should be enabled only when lawful and disclosed to recipients.

`convertHtmlToEmail` sanitizes and inlines a supported subset of HTML/CSS, `createEmailLayout`, `emailRow`, `emailButton` produce email-client-friendly table markup, and `createTemplateRegistry` manages reusable templates with escaped variables. Arbitrary CSS Grid/Flex and complex interactivity cannot be made universally compatible across mail clients.

Delivery safeguards include `createRecipientFilter` for allow/block/suppression lists, encrypted-transport policy options, optional `authorize` hook for `@zeruxjs/auth`, bounded batches, idempotency keys scoped to a manager lifetime, and a bounded in-memory transient-error queue. The included `createEmailQueue` is **not durable**; a future marketing/queue package should persist scheduling, suppression, campaign state and send IDs before delivery. Never use open/click telemetry as a substitute for unsubscribe/consent handling.

For file attachments supply `files` when creating the manager and set `attachments:[{filename:'manual.pdf',file:{storage:'object',bucket:'uploads',key:'manual.pdf'}}]`. Streams are bounded by the configured attachment limits. Avoid local path attachments unless explicitly allowed for trusted server code.

## Section 46: Marketing permission is separate from activity tracking

`purpose:'marketing'` requires one recipient and an affirmative subscribed record in an injected `preferences` service. Marketing unsubscribe endpoints are hosted by ZeruxJS and require a POST to modify preference state. `purpose:'transactional'` remains independent of the marketing permission store. Neither an opt-in subscription nor an unsubscribe silently changes `tracking` for any message. Tracking is still off unless explicitly requested *on the send*, and can be overridden by `{tracking:false}`.

For tracked deliveries, `EmailResult.trackingId` identifies activity reports (an opaque UUID), but is only supplied when tracking is requested and a tracking service is injected. `message.tracking` accepts `opens`, `clicks`, `downloads`, and a list of exact HTTPS `downloadLinks`. For per-email first/last timestamps and counts call `tracking.getActivity(result.trackingId)` in `@zeruxjs/analytics`. A link click is **not** a proven completed download. Attachments are not trackable after delivery. See root `SECTION_46_EMAIL_CONSENT_AND_ACTIVITY.md`.

## Section 55 — Marketing campaigns

Use `createCampaignPlanner` for persistent, segmented recipient paging and stage-before-enqueue checkpoints, `createDatabaseCampaignStore` for atomic multi-node document CAS, `createMarketingSuppressionService` with a shared store for hard/soft bounce and complaint handling, and `createCampaignDashboard`/`createMarketingFeedbackEndpoint` for *opt-in* authenticated routes. `createCampaignAnalyticsReporter` can emit best-effort operational events for internal Reports. Never assume memory stores provide restart/multi-server safety; provider webhooks must verify raw-body signatures.

For full configuration, queue-worker integration, privacy controls, and deployment restrictions, see the project root `SECTION_55_MARKETING_CAMPAIGNS_SUPPRESSION.md`.


## Receiving email (IMAP/POP3)

`createEmailReceiver({accounts,store})` supports IMAP/POP3 TLS inbox polling, deduplicated message storage, MIME parsing, optional attachment storage and explicit IMAP read-flag updates. Configure combined SMTP/incoming accounts through ZeruxJS `email.accounts[].receive` plus `email.receive.database`, or use `email.receive.accounts` for receive-only applications. Incoming HTML is sanitized and no public inbox endpoints are enabled. See the project-level `SECTION_63_INBOUND_IMAP_POP3.md`.

## Section 65 — Inbox storage choice and UI APIs

The package-managed inbox table remains available: `createDatabaseInboxStore(db, table)` creates the table lazily, deduplicates by remote message identity and supports paginated `get/page` reads. Use `createMappedDatabaseInboxStore(db,{table,columns,createTable:false})` to write to an **existing application-owned table** with mapped identity, payload and optional metadata columns without creating schema. For completely custom schemas, inject your own `InboundStore`.

Alternatively `createEmailReceiver({accounts,mode:'json',onMessage})` returns the parsed message payloads directly and does not require an inbox database. This mode does not deduplicate for you.

Build private inbox UIs using `createInboxApi({store,receiver,authorize,canErase})`: `list`, `search`, `get`, `folders`, `markSeen`, `markUnread`, `setFlagged`, `poll` and `eraseLocal`. Authentication/authorization is mandatory for API creation, list/search pages are summary-only, search scans at most a configured number of rows, and deletion needs explicit retention approval. IMAP mutations check UIDVALIDITY; POP3 cannot set remote read/flag state. Refer to root `SECTION_65_INBOX_STORAGE_UI_API.md` for detailed configuration, function calls and known limits.


## Section 67 — Multiple IMAP mailboxes and stronger inbound validation

Use `IncomingAccount.mailboxes` as an allowlist for additional IMAP folders and
`receiver.poll(name,{mailbox,cursor})` for folder-scoped receiving. Returned
`nextCursor.mailbox` must be persisted and reused only for the same mailbox.
`receiver.pollConfiguredMailboxes()` is a convenience **without durable cursors**;
for multi-server jobs, create one `createDatabaseMailboxSync({...,mailbox})`
coordinator per configured folder. The old `poll()` default-folder API remains.

POP3 UIDL entries are validated for uniqueness; invalid MIME attachment metadata
is rejected, and oversized attachment binary is not exposed or stored. The Inbox
API `poll(account,mailbox?)` passes the selected mailbox to `authorize` before
network access. The package-managed inbox table, host-owned mapped tables and
JSON-only mode remain supported. See `SECTION_67_IMAP_MULTI_MAILBOX_HARDENING.md`
for test-server setup, replay/authorization requirements and production limits.
