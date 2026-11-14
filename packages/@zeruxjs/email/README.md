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
      defaults:{from:{ name: 'Sender', address: 'sender@example.com' }}},
    {name:'notifications',smtp:{host:'smtp.example.com',port:465,secure:true,
      auth:{type:'oauth2',user:'alerts@example.com',clientId:process.env.OAUTH_CLIENT_ID!,
        clientSecret:process.env.OAUTH_CLIENT_SECRET!,refreshToken:process.env.OAUTH_REFRESH_TOKEN!}},
      defaults:{from:{ name: 'Alerts', address: 'alerts@example.com' }}}
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

Delivery safeguards include `createRecipientFilter` for allow/block/suppression lists, encrypted-transport policy options, optional `authorize` hook for `@zeruxjs/auth`, bounded batches, idempotency keys scoped to a manager lifetime, and a bounded in-memory transient-error queue. The included `createEmailQueue` is **not durable**; use the existing durable queue/outbox integration to persist scheduling, suppression, campaign state and send IDs before delivery. Never use open/click telemetry as a substitute for unsubscribe/consent handling.

For file attachments supply `files` when creating the manager and set `attachments:[{filename:'manual.pdf',file:{storage:'object',bucket:'uploads',key:'manual.pdf'}}]`. Streams are bounded by the configured attachment limits. Avoid local path attachments unless explicitly allowed for trusted server code.

## Marketing permission is separate from activity tracking

`purpose:'marketing'` requires one recipient and an affirmative subscribed record in an injected `preferences` service. Marketing unsubscribe endpoints are hosted by ZeruxJS and require a POST to modify preference state. `purpose:'transactional'` remains independent of the marketing permission store. Neither an opt-in subscription nor an unsubscribe silently changes `tracking` for any message. Tracking is still off unless explicitly requested _on the send_, and can be overridden by `{tracking:false}`.

For tracked deliveries, `EmailResult.trackingId` identifies activity reports (an opaque UUID), but is only supplied when tracking is requested and a tracking service is injected. `message.tracking` accepts `opens`, `clicks`, `downloads`, and a list of exact HTTPS `downloadLinks`. For per-email first/last timestamps and counts call `tracking.getActivity(result.trackingId)` in `@zeruxjs/analytics`. A link click is **not** a proven completed download. Attachments are not trackable after delivery.

## Marketing campaigns

Use `createCampaignPlanner` for persistent, segmented recipient paging and stage-before-enqueue checkpoints, `createDatabaseCampaignStore` for atomic multi-node document CAS, `createMarketingSuppressionService` with a shared store for hard/soft bounce and complaint handling, and `createCampaignDashboard`/`createMarketingFeedbackEndpoint` for _opt-in_ authenticated routes. `createCampaignAnalyticsReporter` can emit best-effort operational events for internal Reports. Never assume memory stores provide restart/multi-server safety; provider webhooks must verify raw-body signatures.

See the [durable email guide](../../../apps/zerux-docs/src/docs/0.0.4/durable-email.md) for queue integration and delivery controls.

## Receiving email (IMAP/POP3)

`createEmailReceiver({accounts,store})` supports IMAP/POP3 TLS inbox polling, deduplicated message storage, MIME parsing, optional attachment storage and explicit IMAP read-flag updates. Configure combined SMTP/incoming accounts through ZeruxJS `email.accounts[].receive` plus `email.receive.database`, or use `email.receive.accounts` for receive-only applications. Incoming HTML is sanitized and no public inbox endpoints are enabled.

## Inbox storage choice and UI APIs

The package-managed inbox table remains available: `createDatabaseInboxStore(db, table)` creates the table lazily, deduplicates by remote message identity and supports paginated `get/page` reads. Use `createMappedDatabaseInboxStore(db,{table,columns,createTable:false})` to write to an **existing application-owned table** with mapped identity, payload and optional metadata columns without creating schema. For completely custom schemas, inject your own `InboundStore`.

Alternatively `createEmailReceiver({accounts,mode:'json',onMessage})` returns the parsed message payloads directly and does not require an inbox database. This mode does not deduplicate for you.

Build private inbox UIs using `createInboxApi({store,receiver,authorize,canErase})`: `list`, `search`, `get`, `folders`, `markSeen`, `markUnread`, `setFlagged`, `poll` and `eraseLocal`. Authentication/authorization is mandatory for API creation, list/search pages are summary-only, search scans at most a configured number of rows, and deletion needs explicit retention approval. IMAP mutations check UIDVALIDITY; POP3 cannot set remote read/flag state.

## Multiple IMAP mailboxes and stronger inbound validation

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
JSON-only mode remain supported. See the [email guide](../../../apps/zerux-docs/src/docs/0.0.4/package-email.md) for configuration and storage boundaries.

## Function-based campaign completion

`createMarketingCampaignService` includes `schedule`, `report`, `finalize`, `exportPage`, `archive` and opt-in archival `redactArchived` in addition to existing create/preview/import/queue/paused operations. Configure `renderer:createVariableRegistry()` for globally registered subject/HTML/text variables; `segment` supports the supported `all`/`any` primitive conditions. Require durable `onAudit:createDatabaseMarketingAuditLog(db).record` for PII-free audit trails, real `verifyMissingJob`/`queue.getJob` before redrive, and consent/suppression policies both at queue and SMTP boundaries. Use the durable outbox for Redis outage recovery. The dashboard presents paginated, privacy-limited reports/exports with per-action host authorization and CSRF.

**Important:** `archive` is not a deletion operation: it accepts only cancelled or safely finalized campaigns with no nonterminal/uncertain delivery. `redactArchived` defaults to dry-run, requires a legal-hold approval hook and a DB delete capability, and erases only campaign-specific template/recipient data, not durable mail activity or consent/suppression stores. See the [email guide](../../../apps/zerux-docs/src/docs/0.0.4/package-email.md) for related APIs.

## Bounded submission and explicit outcomes

[The public-import example](examples/bounded-send.ts) creates a generation-owned manager around a host-owned transport. No transport starts on import. `ownTransport:false` borrows an injected transport; omission retains the legacy manager-owned default. Call `close()` during generation teardown. Failed idle verification closes an owned transport once; a released injected handle must be replaced.

`maxConcurrentSends` defaults to 8 (maximum 128), `sendTimeoutMs` to 30000 (maximum 600000), and accounts are limited to 64. `send` accepts `signal`, `timeoutMs` and an absolute epoch-millisecond `deadline`; `sendBatch` shares a total deadline. Overload rejects with `EMAIL_SEND_OVERLOAD`. Coalesced idempotent callers have independently bounded observation, without cancelling the first caller's owned operation. Execution controls do not change the message fingerprint.

A deadline bounds caller observation. Actual native work retains its capacity until settlement and attachment cleanup; `close()` aborts cooperative work and waits for actual settlement before closing owned pools. Injected transports receive an optional second `{signal}` context. Native Nodemailer has no assumed per-message cancellation contract here: configure SMTP connection/greeting/socket timeouts too. Noncooperative transports or host callbacks can delay shutdown; arbitrary JavaScript is not force-cancelled.

`recipientOutcomes` distinguishes `accepted`, `rejected`, `transient`, `permanent` and `uncertain`; missing or conflicting recipient reports remain uncertain. A fulfilled partial submission never resends accepted recipients. SMTP acceptance is not inbox delivery. See [Nodemailer's SMTP result contract](https://nodemailer.com/smtp). `EmailSubmissionError` exposes a fixed code/message; its non-enumerable cause and recipient outcomes are trusted internal detail. Use `describeSmtpRecipients` for address-free counters. Existing `EmailResult.response`, accepted/rejected lists and message IDs remain private application data, not a sanitized public response.

If optional post-send telemetry stalls after known acceptance, the observed result preserves acceptance with `telemetryIncomplete:true`. Do not resend. Manager idempotency caches successful and uncertain outcomes for the configured TTL (default five minutes), within a bounded process-local cache; it is not durable or cross-instance deduplication. Ambiguous outcomes need host reconciliation. The in-memory queue retries explicit transient SMTP replies or qualified pre-DATA connection failures only. Bare `ECONNRESET`/`ETIMEDOUT` and DATA uncertainty no longer imply safe retry. Failover stops before submission; it never retries a failed send on another account.

Attachment preparation validates up to 40 sources and an aggregate raw-byte budget (default 25 MiB, maximum 1 GiB). File reads open lazily, enforce recorded length including underflow, and limit concurrent underlying streams (`maxAttachmentStreams`, default 4, maximum 40). `resolveAttachmentScope` owns wrappers and has awaitable `dispose`; direct compatibility `resolveAttachments` callers must destroy unconsumed streams. Files managers remain borrowed. Read/iterator cancellation is cooperative and cleanup waits for actual settlement. String/byte attachments remain supported; arbitrary raw/href options are rejected. Explicit local-path mode accepts absolute regular files only, rejecting URL paths and final symlinks; filesystem ancestry and replacement races remain the trusted host's responsibility. Prefer the authorized files adapter. See [Nodemailer's attachment inputs](https://nodemailer.com/message/attachments).

Marketing checks fresh boolean subscription/suppression state again at the SMTP boundary, and authorization requires literal `true`. Tracking remains a separate per-send opt-in; analytics failure does not undo one-click unsubscribe. Queue delivery, SMTP handles and inbox ingestion retain separate ownership. Existing inbox APIs authorize before reads/polls, and inbound MIME/attachment budgets and sanitization remain enforced in `inbox-api.ts`, `inbound.ts` and `inbound-safety.ts`.

Qualification uses injected transports, streams and local HTTP preference fixtures. It does not certify live SMTP/TLS delivery, IMAP/POP3 servers, broker crash recovery or production durable stores.

## Authenticated feedback and local sender visibility

`createSenderFeedbackService` is an opt-in correlated ledger alongside the unchanged `createEmailReputationService` policy API. [The public-import example](examples/sender-visibility.ts) binds one tenant/site/account/provider and wires authenticated feedback, suppression and a report endpoint. No collectors, provider polling, remote requests or analytics start on import.

The host must supply a 32-byte private `lookupKey`, stable across workers/restarts, and a `sender-feedback-v1` store. The database adapter `createDatabaseSenderFeedbackStore` uses immutable primary-key inserts with conflict verification, keyset reads and scope/recipient indexes when the connector exposes `createIndex`. It borrows the DB connection; the host closes it. Production requires real durable unique inserts and committed reads, not a synthetic adapter. `createMemorySenderFeedbackStore` is a bounded reference fixture (default 10,000 records), explicitly process-only; using it requires `requireDurable:false`. No automatic fallback exists.

Records bind tenant/site/account/provider plus provider event, message and canonical recipient identity. Recipients and message references are HMACed before storage; provider event references become opaque IDs. Repeated identical identities return duplicate, while conflicting message/kind/time data rejects. SMTP acceptance has its own identity namespace and keeps the first accepted timestamp on replay. Multiple provider event IDs about the same message/recipient/kind remain ledger evidence but do not inflate a cohort count. Hashes are pseudonymous linkage, not proof of authorship, consent or authorization. Keep ledger/key access private; key rotation requires an explicit data migration or retained lookup strategy, not simply swapping keys and losing suppression history.

### Authenticate, persist, then admit more marketing

`createMarketingFeedbackEndpoint` retains its mandatory raw-body `verifySignature` and provider-specific parser. Optional `correlatedFeedback:{service,normalize}` requires `signatureTime(headers)`; it checks a signed timestamp against a bounded replay window (default five minutes, maximum ten minutes, at most one minute future skew). **The verifier must authenticate that timestamp with the actual provider signature**, along with the correct raw body, source account/topic and signing-key policy. A separate unsigned timestamp header is not replay protection. Providers with timestamps in their signed envelope can verify the envelope and return that verified value through an appropriately scoped adapter; this package does not ship a universal vendor verifier. For example, SES/SNS has its own [signature verification requirements](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html); no certificate-URL fetch or SES subscription auto-confirmation is implemented here. Legacy endpoint configurations without `signatureTime` keep their existing host-owned replay checks.

Normalize only authenticated provider metadata into `{eventId,messageId,email,kind,at}`. Resolve message IDs to the exact IDs recorded at SMTP acceptance; do not fuzzy-match email addresses or trust an unsigned tenant/account field. Delivered/deferred notifications also need a verified recipient correlation. All normalized batch records validate before any writes. The correlated ledger is persisted before legacy suppression/reputation/outcome callbacks; failures return 503 and retries remain independently idempotent. These separate stores are not a distributed transaction, and a partially failed batch may already have durable effects.

Wire the new service's `isSuppressed` into **both** campaign planning and `EmailManager.marketingSuppression`. Its durable event ledger is the source of truth: any recorded hard bounce/complaint blocks, and soft bounces block after the configured number of distinct messages (default three). Duplicate notifications do not raise that count. A clock-skewed but accepted future-dated complaint still suppresses immediately. Keep fresh subscription consent checks too. The legacy suppression store remains supported, including its bounded recent-event list; it alone is not the new indefinite deduplication ledger. In-flight sends already admitted cannot be recalled atomically by a later feedback write.

The new service does not invent an account health grade or pause transactional mail. Wire `recordAccepted` to the manager's existing reputation hook alongside your chosen `checkBeforeSend` policy. Manager hooks remain best-effort operational telemetry: failed acceptance recording means the cohort ledger may lack that denominator. There is no atomic SMTP/database commit. Do not label such coverage as complete delivery history.

### Windows, denominators and late reports

`report(from,until,signal?)` uses UTC epoch milliseconds with an inclusive start and exclusive end, a maximum 90-day completed window, and a separately returned `asOf`. `rolling()` defaults to seven days. Accepted message/recipient pairs in that window form the denominator. Reported delivery, hard bounce, soft bounce and complaint numerators each count distinct correlated pairs, not raw webhook repetitions. Categories may overlap and must not be summed as mutually exclusive delivery states. Rates are percentages and **null when the denominator is zero**.

Feedback received later can update a past cohort's numerators. UTC trend days follow the acceptance date, not webhook arrival date. `lateFeedback` counts unique correlated outcomes first received after the cohort window; `unmatchedFeedback` counts unique scanned feedback without an acceptance in that cohort (including other-window or missing acceptance records). Missing identity/feedback is not assumed successful delivery. Deferred events are retained but are not a delivered/bounce/complaint numerator. The report exposes retained-ledger/recorded-through coverage and `snapshotConsistent:false`: paged reads are not an immutable database snapshot, and concurrent inserts may change a subsequent result.

Scans use 500-record keyset pages with a configured retained-history cap (default 10,000, maximum 100,000). Overflow or storage failure rejects coverage instead of returning sampled rates or an unsuppressed result. Reads cooperatively check cancellation between pages; DB execution deadlines remain the host/database policy's responsibility. Large histories require a deliberately maintained aggregate/retention strategy before increasing limits. There is no automatic pruning: deleting old feedback can remove deduplication and suppression evidence. Retain durable suppression separately before any approved retention migration.

### Authorized Reports charts and interpretation

`senderReputationCharts(report)` produces bounded, PII-free Reports-compatible UTC trend charts with an explicit accepted-cohort denominator series. `createSenderReputationReportEndpoint({authorize,resolveService})` exposes `{report,charts}` on an explicit GET route; authorization must enforce the bound tenant/site before service resolution. Only bounded `from`/`until` parameters are accepted, responses are `private, no-store`, and client errors contain no raw DB/provider cause. Mount charts through optional `@zeruxjs/reports/view` to retain its captions, table alternatives, local sorting/pagination, keyboard controls and disposable ownership. No Reports runtime dependency, default public dashboard, or global cross-tenant report source is added. Analytics/audit integrations should consume aggregate counts/coverage only, never recipient/message hashes, addresses, raw responses or signed URLs; this adapter emits no automatic analytics events.

SMTP acceptance measures acceptance by the configured outbound transport, not delivery or inbox placement. Provider delivery feedback reports the provider's observation; an asynchronous bounce can follow earlier acceptance. Opens/clicks remain separately consented, approximate tracking observations, not unique readers or proof of delivery. These local rates are explicitly a **local heuristic with authenticated-reported-only coverage**, not mailbox/provider/DNS reputation. Provider dashboards use their own populations and denominators; see [SES's reputation metrics](https://docs.aws.amazon.com/ses/latest/dg/monitor-sender-reputation.html) and [asynchronous-delivery behavior](https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-deliverability.html). No SPF, DKIM, DMARC, blocklist or DNS status is asserted without a separate current evidence source.

Qualification includes signed HMAC fixture tamper/stale-window checks (not a vendor protocol claim), conflicting/duplicate feedback, late/zero-denominator cohorts, authorized report access, source failure, Reports DOM-emulated tables, and a disposable SQLite two-connection/reopen fixture with cleanup. Live SMTP/provider webhook, production DB engines, DNS checks, browsers and assistive technologies remain separate prerequisites; no live-provider acceptance is claimed.

Inbound markup heuristics scan at most 1 MiB of UTF-16 text, bound individual tag
analysis to 8 KiB, and report `body_truncated` when those limits are reached. They
compare apparent link text with literal destinations without fetching URLs or
executing markup. These lexical warnings are advisory, not an HTML sanitizer,
complete browser parser, authentication result or malware certification.

The dependency floor now selects Nodemailer 10.4+ and Mailparser 3.14.2+ to avoid the earlier address-parser advisories. Transport acceptance, ambiguous outcomes and MIME limits retain the contracts above; injected transport and MIME fixtures are not live SMTP qualification.

## Reading the sending and consent implementation

`src/manager.ts` owns lazy native transports, actual unsettled send/verification slots, caller observation, explicit tracking policy and process-local idempotency fences. `src/smtp-outcomes.ts` classifies intended envelope recipients and projects address-free counters. Neither a fulfilled send nor a tracking observation proves inbox delivery. The historical internal `redactResult` helper normalizes private native fields; it is not a public response sanitizer.

`src/attachments.ts` owns lazy Node wrappers, exact recorded lengths, concurrent reader slots and iterator/close settlement. Files managers remain borrowed. `src/queue.ts` owns a separate process-local FIFO/retry loop: `close()` without `drain:true` rejects queued jobs without cancelling or awaiting active borrowed sends. `flush()` observes actual local drain. A draining close waits before stopping admission, so hosts should stop producers first. This is distinct from manager close and durable outbox delivery.

`src/validation.ts`, `src/filters.ts`, `src/templates.ts` and `src/html.ts` separate envelope policy, local recipient rules, inert placeholder substitution and maintained sanitization/inlining. Authored table/cell HTML remains trusted input to layout helpers. Templates and fingerprinting do not sandbox getters, `toJSON` or scalar conversion on trusted application objects. Filter `setRules` retains its sequential replacement behavior; it is not a staged transaction.

`src/persistence.ts` stage-validates a bounded V1 snapshot before applying it. Loading merges templates and suppressions while replacing rules; an absent imported template/suppression does not delete an existing one. Trusted directory ancestry and concurrent filesystem operators remain host responsibilities. Snapshot contents contain private recipient values, even though SMTP credentials are excluded.

`src/preferences.ts` keeps committed subscription state separate from tracking. GET/HEAD confirmation cannot unsubscribe; the encrypted capability plus exact bounded POST body commits the change. The default memory consent store is development-only, its inspection snapshots copy the outer map rather than deep-freezing records, and production requires a shared committed store. Host code must authorize management/status access and independently verify opt-in evidence.

`src/campaigns.ts` is the paged planner: its completed state means planning finished and still permits delivery of queued messages. `src/marketing.ts` is the separate function-first service: finalization checks registered terminal delivery records and its completed state blocks further sends. Campaign, recipient, durable delivery and queue writes are separate commits. Stable job IDs do not provide exactly-once SMTP delivery; pending redrive requires explicit queue-absence evidence and never replays sending/uncertain outcomes. Its five-minute CAS operation lease is private management state, not a browser capability.

`src/marketing-import.ts` parses bounded inert CSV without evaluating source. `src/marketing-import-jobs.ts` checkpoints aggregate progress against an immutable host-asserted source revision. Changed input needs a new job identity/revision; append must reconcile identical replays because a crash can occur after append and before checkpoint. Lease loss/cancellation fences later checkpoints but cannot recall an already started native append.

`src/inbound.ts` owns native per-operation IMAP locks/logout and POP3 completion, while injected drivers and stores remain borrowed. Receiver `close()` only stops admission: it does not cancel or drain active polls. Attachment persistence can precede message metadata, so hosts own idempotence and orphan repair. `src/inbound-sync.ts` fences durable folder cursors with lease epochs; `src/inbox-api.ts` requires literal per-call authorization and exposes private untrusted summaries. Remote unread/flag changes are distinct from local erasure. Retention previews do not delete; actual deletion needs explicit host policy, and related stores are not erased atomically.

`src/campaign-dashboard.ts` and `src/marketing-dashboard.ts` return explicit host-registerable routes, never a listener. Every page, asset and API request requires a verified principal; writes also require exact origin, host CSRF and scoped action approval. Body readers own five-second read deadlines (12 KiB planner, 128 KiB marketing), not arbitrary callback deadlines. The browser assets use text-only result rendering; rendered email HTML remains untrusted data. The [sender visibility example](examples/sender-visibility.ts) shows public imports with durable stores and host signature/report authorization callbacks. HTTP/parser fixtures are not live browser or provider qualification.
