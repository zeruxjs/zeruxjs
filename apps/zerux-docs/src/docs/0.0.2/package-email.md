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

## Install and select the integration

```sh
npm install @zeruxjs/email@0.0.2
```

This package participates in the runtime's **email** integration. Start with [email configuration](configuration-email.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Use named SMTP accounts, provider-compatible TLS settings and a separate transactional/marketing policy. Runtime config supplies files, tracking, preferences and reputation adapters when configured; a standalone manager needs those real dependencies explicitly. Keep recipient rules and attachment limits close to the manager policy, and choose a default account before sending.

## TypeScript: inputs, results and ownership

```ts
import { createEmailManager } from '@zeruxjs/email';

type Inputs = Parameters<typeof createEmailManager>;
type Result = Awaited<ReturnType<typeof createEmailManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createEmailManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Check accepted/rejected/unknown outcomes rather than treating a resolved SMTP call as final delivery. Keep consent/suppression/idempotency in durable shared stores for retryable marketing. Inbound persistence, feedback signatures and dashboard authorization are separate features. Close owned SMTP and inbound resources, and never place provider passwords, signing secrets or raw inbox payloads in client bundles.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### EmailManagerOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `accounts` | `EmailAccount[]` | No |
| `defaultAccount` | `string` | Yes |
| `maxRecipients` | `number` | Yes |
| `suppressions` | `string[]` | Yes |
| `rules` | `RecipientRule[]` | Yes |
| `authorize` | `(message:Readonly<EmailMessage>,account:string)=>boolean\|Promise<boolean>` | Yes |
| `files` | `{ stat(addr:{storage?:string;bucket:string;key:string}):Promise<{size:number;contentType:string}\|null>;read(addr:{storage?:string;bucket:string;key:string}):Promise<AsyncIterable<Uint8Array>>}` | Yes |
| `maxAttachmentBytes` | `number` | Yes |
| `idempotencyTtlMs` | `number` | Yes |
| `maxIdempotencyKeys` | `number` | Yes |
| `tracking` | `{instrumentHtml(html:string,context:{id:string;account:string;message:Readonly<EmailMessage>}):string\|Promise<string>; onSent?(event:{id:string;account:string;message:Readonly<EmailMessage>;result:Readonly<EmailResult>}):void\|Promise<void>}` | Yes |
| `marketingSuppression` | `{isSuppressed(address:EmailAddress):Promise<boolean>}` | Yes |
| `preferences` | `{ isSubscribed(address:EmailAddress):Promise<boolean>; makeUnsubscribeUrl(address:EmailAddress):string; }` | Yes |
| `reputation` | `{ checkBeforeSend:(account:string,purpose:'marketing'\|'transactional')=>Promise<{allowed:boolean}>; recordAccepted:(account:string,email:string,messageId:string)=>Promise<boolean\|unknown>; }` | Yes |
| `onSmtpWarning` | `(warning:{account:string;status:'accepted'\|'partial'\|'rejected'\|'unknown';reason:string})=>void` | Yes |
| `onReputationError` | `(error:unknown)=>void` | Yes |
| `onTrackingError` | `(error:unknown)=>void` | Yes |

### EmailAccount

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `name` | `string` | No |
| `smtp` | `SmtpSettings` | Yes |
| `transport` | `TransportLike` | Yes |
| `receive` | `Omit<import('./inbound.js').IncomingAccount,'name'>` | Yes |
| `defaults` | `Partial<EmailMessage>` | Yes |
| `maxRecipients` | `number` | Yes |
| `enabled` | `boolean` | Yes |

### SmtpSettings

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `host` | `string` | No |
| `port` | `number` | No |
| `secure` | `boolean` | Yes |
| `requireTLS` | `boolean` | Yes |
| `ignoreTLS` | `boolean` | Yes |
| `auth` | `SmtpAuth` | Yes |
| `pool` | `boolean` | Yes |
| `maxConnections` | `number` | Yes |
| `maxMessages` | `number` | Yes |
| `connectionTimeout` | `number` | Yes |
| `greetingTimeout` | `number` | Yes |
| `socketTimeout` | `number` | Yes |
| `tls` | `{servername?:string;minVersion?:'TLSv1.2'\|'TLSv1.3';rejectUnauthorized?:boolean;ca?:string\|string[]}` | Yes |
| `dkim` | `{domainName:string;keySelector:string;privateKey:string;cacheDir?:string}` | Yes |

### EmailSendOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `htmlMode` | `'email'\|'trusted'` | Yes |
| `allowLocalAttachmentPaths` | `boolean` | Yes |
| `tracking` | `boolean\|NonNullable<EmailMessage['tracking']>` | Yes |

### EmailPreferencesOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `baseUrl` | `string` | No |
| `secret` | `string` | No |
| `path` | `string` | Yes |
| `store` | `ConsentStore` | Yes |
| `maxAgeMs` | `number` | Yes |
| `postTimeoutMs` | `number` | Yes |

### EmailReceiverOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `accounts` | `IncomingAccount[]` | No |
| `store` | `InboundStore` | Yes |
| `mode` | `'persist'\|'json'` | Yes |
| `onMessage` | `(message:InboundMessage)=>Promise<void>\|void` | Yes |
| `inspectRaw` | `(context:{account:string;raw:Buffer})=>Promise<'clean'\|'spam'\|'phishing'\|'malware'\|'review'>` | Yes |
| `inspectAttachment` | `(context:{account:string;messageId:string;filename:string;content:Buffer})=>Promise<'clean'\|'suspicious'\|'blocked'>` | Yes |
| `attachmentContent` | `'metadata'\|'base64'` | Yes |
| `maxInlineAttachmentBytes` | `number` | Yes |
| `connections` | `IncomingConnections` | Yes |
| `parse` | `(raw:Buffer)=>Promise<ParsedIncomingMail>` | Yes |
| `sanitizeHtml` | `(html:string)=>string\|Promise<string>` | Yes |
| `saveAttachment` | `(context:{account:string;messageId:string;attachment:InboundAttachment;content:Buffer})=>Promise<string>` | Yes |
| `now` | `()=>number` | Yes |

### MarketingCampaignServiceOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `db` | `CampaignDatabaseConnection` | No |
| `queue` | `MarketingQueue` | No |
| `delivery` | `MarketingDeliveryStore` | No |
| `renderer` | `MarketingRenderer` | Yes |
| `isSubscribed` | `(email:string)=>Promise<boolean>\|boolean` | Yes |
| `isSuppressed` | `(email:string)=>Promise<boolean>\|boolean` | Yes |
| `verifyMissingJob` | `(messageId:string)=>Promise<boolean>\|boolean` | Yes |
| `approveRetention` | `(campaign:Readonly<StoredMarketingCampaign>)=>Promise<boolean>\|boolean` | Yes |
| `authorize` | `(action:'create'\|'read'\|'enqueue'\|'cancel'\|'render'\|'append'\|'pause'\|'resume'\|'redrive'\|'schedule'\|'archive'\|'export'\|'exportPII'\|'retention'\|'finalize',code?:string)=>Promise<boolean>\|boolean` | Yes |
| `onQueueError` | `(code:string,error:unknown)=>void\|Promise<void>` | Yes |
| `verifyProvider` | `(account:string)=>boolean\|Promise<boolean>` | Yes |
| `onAudit` | `(entry:{code:string;action:'create'\|'append'\|'enqueue'\|'pause'\|'resume'\|'cancel'\|'redrive'\|'schedule'\|'archive'\|'export'\|'retention'\|'finalize';at:number;count?:number})=>void\|Promise<void>` | Yes |
| `table` | `string` | Yes |
| `recipientTable` | `string` | Yes |
| `now` | `()=>number` | Yes |

### EmailLayoutOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `maxWidth` | `number` | Yes |
| `background` | `string` | Yes |
| `direction` | `'ltr'\|'rtl'` | Yes |
| `language` | `string` | Yes |
| `preheader` | `string` | Yes |

### HtmlConversionOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `layout` | `boolean` | Yes |
| `maxInputBytes` | `number` | Yes |
| `allowImages` | `boolean` | Yes |
| `allowRemoteImages` | `boolean` | Yes |

### EmailQueueOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `concurrency` | `number` | Yes |
| `maxPending` | `number` | Yes |
| `retries` | `number` | Yes |
| `backoffMs` | `number` | Yes |
| `maxBackoffMs` | `number` | Yes |

### CampaignPlannerOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `store` | `CampaignStore` | No |
| `source` | `CampaignSource` | No |
| `isSubscribed` | `(email:string)=>Promise<boolean>` | No |
| `isSuppressed` | `(email:string)=>Promise<boolean>` | No |
| `ensureMessage` | `(target:CampaignTarget,context:{campaignId:string;tracking:EmailMessage['tracking']})=>Promise<void>` | No |
| `enqueue` | `(messageId:string,sendAt:number)=>Promise<void>` | No |
| `now` | `()=>number` | Yes |
| `batchSize` | `number` | Yes |
| `leaseMs` | `number` | Yes |
| `onAudit` | `(entry:{campaignId:string;action:string;at:string})=>void\|Promise<void>` | Yes |
| `onMetric` | `(metric:{campaignId:string;kind:'queued'\|'scheduled'\|'completed'\|'cancelled';at:number;count:number})=>Promise<void>\|void` | Yes |

### CampaignDashboardOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `planner` | `CampaignPlanner` | No |
| `authorize` | `(request:Request)=>unknown\|Promise<unknown>` | No |
| `verifyCsrf` | `(request:Request,principal:unknown)=>boolean\|Promise<boolean>` | No |
| `csrfToken` | `(request:Request,principal:unknown)=>string\|Promise<string>` | No |
| `authorizeCampaign` | `(principal:unknown,id:string,action:string)=>boolean\|Promise<boolean>` | No |
| `deliveryReport` | `(campaignId:string)=>Promise<unknown>` | Yes |
| `performanceReport` | `(campaignId:string)=>Promise<unknown>` | Yes |
| `trendsReport` | `(campaignId:string,from:string,to:string)=>Promise<unknown>` | Yes |
| `prefix` | `string` | Yes |
| `publicOrigin` | `string` | Yes |

### MarketingFeedbackHttpOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `verifySignature` | `(body:Uint8Array,headers:Headers)=>Promise<boolean>\|boolean` | No |
| `parse` | `(body:Uint8Array,headers:Headers)=>Promise<VerifiedEmailNotification[]>\|VerifiedEmailNotification[]` | No |
| `suppression` | `ReturnType<typeof createMarketingSuppressionService>` | No |
| `reputation` | `{recordFeedback(input:{account:string;email:string;eventId:string;kind:'hard-bounce'\|'soft-bounce'\|'complaint';at?:number}):Promise<unknown>}` | Yes |
| `feedbackAccount` | `(event:MarketingFeedback)=>string` | Yes |
| `providerOutcomes` | `{record(event:{eventId:string;provider:string;campaignId:string;messageId:string;kind:'hard-bounce'\|'soft-bounce'\|'complaint'\|'delivered'\|'deferred';occurredAt:number}):Promise<boolean>}` | Yes |
| `feedbackDelivery` | `(event:VerifiedEmailNotification)=>{provider:string;campaignId:string;messageId:string;occurredAt:number}` | Yes |
| `path` | `string` | Yes |
| `maxBodyBytes` | `number` | Yes |
| `timeoutMs` | `number` | Yes |
| `maxEvents` | `number` | Yes |

### ReputationPolicy

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `windowMs` | `number` | Yes |
| `minimumAccepted` | `number` | Yes |
| `warnBouncePercent` | `number` | Yes |
| `pauseBouncePercent` | `number` | Yes |
| `warnComplaintPercent` | `number` | Yes |
| `pauseComplaintPercent` | `number` | Yes |
| `warnSoftBouncePercent` | `number` | Yes |
| `pauseSoftBouncePercent` | `number` | Yes |
| `protectTransactional` | `boolean` | Yes |
| `scanLimit` | `number` | Yes |

### CampaignImportOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `batchSize` | `number` | Yes |
| `maxRecipients` | `number` | Yes |
| `enqueueAfter` | `boolean` | Yes |
| `signal` | `AbortSignal` | Yes |
| `onProgress` | `(result:{processed:number;added:number;existing:number})=>void\|Promise<void>` | Yes |

### MarketingCampaignDashboardOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `service` | `MarketingCampaignService` | No |
| `authorize` | `(request:Request)=>unknown\|Promise<unknown>` | No |
| `authorizeCampaign` | `(principal:unknown,code:string,action:'read'\|'recipients'\|'preview'\|'append'\|'enqueue'\|'pause'\|'resume'\|'cancel'\|'redrive'\|'schedule'\|'archive'\|'finalize'\|'export')=>boolean\|Promise<boolean>` | No |
| `authorizeCreate` | `(principal:unknown)=>boolean\|Promise<boolean>` | No |
| `authorizeList` | `(principal:unknown)=>boolean\|Promise<boolean>` | Yes |
| `verifyCsrf` | `(request:Request,principal:unknown)=>boolean\|Promise<boolean>` | No |
| `csrfToken` | `(request:Request,principal:unknown)=>string\|Promise<string>` | No |
| `prefix` | `string` | Yes |
| `publicOrigin` | `string` | Yes |

### MarketingImportJobOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `db` | `CampaignDatabaseConnection` | No |
| `id` | `string` | No |
| `campaignCode` | `string` | No |
| `sourceRevision` | `string` | No |
| `source` | `MarketingImportSource` | No |
| `append` | `(campaignCode:string,entries:readonly (string\|MarketingRecipient)[])=>Promise<{added:number;existing:number;recipientCount:number}>` | No |
| `batchSize` | `number` | Yes |
| `leaseMs` | `number` | Yes |
| `now` | `()=>number` | Yes |
| `table` | `string` | Yes |

### ContactRetentionOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `store` | `MailingContactStore` | No |
| `olderThan` | `number` | No |
| `canErase` | `(contact:Readonly<MailingContact>)=>Promise<boolean>\|boolean` | No |
| `dryRun` | `boolean` | Yes |
| `cursor` | `string\|null` | Yes |
| `pageSize` | `number` | Yes |
| `maxScanned` | `number` | Yes |
| `signal` | `AbortSignal` | Yes |
| `onErased` | `(metadata:{contactId:string;at:number})=>void\|Promise<void>` | Yes |
| `now` | `()=>number` | Yes |

### IncomingPollOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `cursor` | `IncomingPollCursor` | Yes |
| `mailbox` | `string` | Yes |

### MappedDatabaseInboxOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `table` | `string` | No |
| `createTable` | `boolean` | Yes |
| `columns` | `Partial<MappedInboxColumns>` | Yes |

### MailboxSyncOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `db` | `CampaignDatabaseConnection` | No |
| `id` | `string` | No |
| `account` | `string` | No |
| `mailbox` | `string` | Yes |
| `receiver` | `{poll:(account:string,options:{cursor:IncomingPollCursor;mailbox?:string})=>Promise<{stored:number;nextCursor?:IncomingPollCursor}>}` | No |
| `leaseMs` | `number` | Yes |
| `table` | `string` | Yes |
| `now` | `()=>number` | Yes |

### InboundRetentionOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `store` | `InboundStore` | No |
| `account` | `string` | No |
| `olderThan` | `number` | No |
| `canErase` | `(message:Readonly<InboundMessage>)=>boolean\|Promise<boolean>` | No |
| `dryRun` | `boolean` | Yes |
| `cursor` | `string\|null` | Yes |
| `pageSize` | `number` | Yes |
| `maxScanned` | `number` | Yes |
| `signal` | `AbortSignal` | Yes |
| `afterErase` | `(entry:{id:string;account:string;references:string[]})=>Promise<void>\|void` | Yes |

### InboxApiOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `store` | `InboundStore` | No |
| `authorize` | `(access:InboxAccess)=>Promise<boolean>\|boolean` | No |
| `receiver` | `Pick<EmailReceiver,'poll'\|'markSeen'\|'markUnread'\|'setFlagged'\|'folders'\|'accounts'>` | Yes |
| `canErase` | `(message:Readonly<InboundMessage>)=>Promise<boolean>\|boolean` | Yes |
