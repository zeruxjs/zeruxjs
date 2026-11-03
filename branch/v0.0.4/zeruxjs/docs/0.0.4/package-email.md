# Email delivery, inboxes and campaigns

Separate transport, consent, tracking, scheduling and durable delivery state.


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
npm install @zeruxjs/email@0.0.4
```

This package participates in the runtime's **email** integration. Start with [email configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-email.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Use named SMTP accounts, provider-compatible TLS settings and a separate transactional/marketing policy. Runtime config supplies files, tracking, preferences and reputation adapters when configured; a standalone manager needs those real dependencies explicitly. Keep recipient rules and attachment limits close to the manager policy, and choose a default account before sending.

## TypeScript: inputs, results and ownership

```ts
import { createEmailManager } from '@zeruxjs/email';

type Inputs = Parameters<typeof createEmailManager>;
type Result = Awaited<ReturnType<typeof createEmailManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createEmailManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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


## Public entry points

Manifest reference for `@zeruxjs/email@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./html": {
      "types": "./dist/html.d.ts",
      "default": "./dist/html.js"
    }
  },
  "engines": {},
  "dependencies": {
    "html-to-text": "^9.0.0",
    "imapflow": "^1.0.0",
    "juice": "^11.0.0",
    "mailparser": "^3.7.0",
    "node-pop3": "^0.15.1",
    "nodemailer": "^10.1.2",
    "sanitize-html": "^2.13.0"
  },
  "peerDependencies": {
    "@zeruxjs/files": "0.0.4"
  },
  "bin": {}
}
```


## Package README

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

Delivery safeguards include `createRecipientFilter` for allow/block/suppression lists, encrypted-transport policy options, optional `authorize` hook for `@zeruxjs/auth`, bounded batches, idempotency keys scoped to a manager lifetime, and a bounded in-memory transient-error queue. The included `createEmailQueue` is **not durable**; use the existing durable queue/outbox integration to persist scheduling, suppression, campaign state and send IDs before delivery. Never use open/click telemetry as a substitute for unsubscribe/consent handling.

For file attachments supply `files` when creating the manager and set `attachments:[{filename:'manual.pdf',file:{storage:'object',bucket:'uploads',key:'manual.pdf'}}]`. Streams are bounded by the configured attachment limits. Avoid local path attachments unless explicitly allowed for trusted server code.

## Marketing permission is separate from activity tracking

`purpose:'marketing'` requires one recipient and an affirmative subscribed record in an injected `preferences` service. Marketing unsubscribe endpoints are hosted by ZeruxJS and require a POST to modify preference state. `purpose:'transactional'` remains independent of the marketing permission store. Neither an opt-in subscription nor an unsubscribe silently changes `tracking` for any message. Tracking is still off unless explicitly requested *on the send*, and can be overridden by `{tracking:false}`.

For tracked deliveries, `EmailResult.trackingId` identifies activity reports (an opaque UUID), but is only supplied when tracking is requested and a tracking service is injected. `message.tracking` accepts `opens`, `clicks`, `downloads`, and a list of exact HTTPS `downloadLinks`. For per-email first/last timestamps and counts call `tracking.getActivity(result.trackingId)` in `@zeruxjs/analytics`. A link click is **not** a proven completed download. Attachments are not trackable after delivery.

## Marketing campaigns

Use `createCampaignPlanner` for persistent, segmented recipient paging and stage-before-enqueue checkpoints, `createDatabaseCampaignStore` for atomic multi-node document CAS, `createMarketingSuppressionService` with a shared store for hard/soft bounce and complaint handling, and `createCampaignDashboard`/branch/v0.0.4/`createMarketingFeedbackEndpoint` for *opt-in* authenticated routes. `createCampaignAnalyticsReporter` can emit best-effort operational events for internal Reports. Never assume memory stores provide restart/multi-server safety; provider webhooks must verify raw-body signatures.

See the [durable email guide](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/docs/0.0.4/durable-email.md) for queue integration and delivery controls.

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
JSON-only mode remain supported. See the [email guide](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/docs/0.0.4/package-email.md) for configuration and storage boundaries.

## Function-based campaign completion

`createMarketingCampaignService` includes `schedule`, `report`, `finalize`, `exportPage`, `archive` and opt-in archival `redactArchived` in addition to existing create/preview/import/queue/paused operations. Configure `renderer:createVariableRegistry()` for globally registered subject/HTML/text variables; `segment` supports the supported `all`/branch/v0.0.4/`any` primitive conditions. Require durable `onAudit:createDatabaseMarketingAuditLog(db).record` for PII-free audit trails, real `verifyMissingJob`/branch/v0.0.4/`queue.getJob` before redrive, and consent/suppression policies both at queue and SMTP boundaries. Use the durable outbox for Redis outage recovery. The dashboard presents paginated, privacy-limited reports/exports with per-action host authorization and CSRF.

**Important:** `archive` is not a deletion operation: it accepts only cancelled or safely finalized campaigns with no nonterminal/uncertain delivery. `redactArchived` defaults to dry-run, requires a legal-hold approval hook and a DB delete capability, and erases only campaign-specific template/recipient data, not durable mail activity or consent/suppression stores. See the [email guide](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/docs/0.0.4/package-email.md) for related APIs.

## Bounded submission and explicit outcomes

[The public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/email/examples/bounded-send.ts) creates a generation-owned manager around a host-owned transport. No transport starts on import. `ownTransport:false` borrows an injected transport; omission retains the legacy manager-owned default. Call `close()` during generation teardown. Failed idle verification closes an owned transport once; a released injected handle must be replaced.

`maxConcurrentSends` defaults to 8 (maximum 128), `sendTimeoutMs` to 30000 (maximum 600000), and accounts are limited to 64. `send` accepts `signal`, `timeoutMs` and an absolute epoch-millisecond `deadline`; `sendBatch` shares a total deadline. Overload rejects with `EMAIL_SEND_OVERLOAD`. Coalesced idempotent callers have independently bounded observation, without cancelling the first caller's owned operation. Execution controls do not change the message fingerprint.

A deadline bounds caller observation. Actual native work retains its capacity until settlement and attachment cleanup; `close()` aborts cooperative work and waits for actual settlement before closing owned pools. Injected transports receive an optional second `{signal}` context. Native Nodemailer has no assumed per-message cancellation contract here: configure SMTP connection/greeting/socket timeouts too. Noncooperative transports or host callbacks can delay shutdown; arbitrary JavaScript is not force-cancelled.

`recipientOutcomes` distinguishes `accepted`, `rejected`, `transient`, `permanent` and `uncertain`; missing or conflicting recipient reports remain uncertain. A fulfilled partial submission never resends accepted recipients. SMTP acceptance is not inbox delivery. See [Nodemailer's SMTP result contract](https://nodemailer.com/smtp). `EmailSubmissionError` exposes a fixed code/message; its non-enumerable cause and recipient outcomes are trusted internal detail. Use `describeSmtpRecipients` for address-free counters. Existing `EmailResult.response`, accepted/rejected lists and message IDs remain private application data, not a sanitized public response.

If optional post-send telemetry stalls after known acceptance, the observed result preserves acceptance with `telemetryIncomplete:true`. Do not resend. Manager idempotency caches successful and uncertain outcomes for the configured TTL (default five minutes), within a bounded process-local cache; it is not durable or cross-instance deduplication. Ambiguous outcomes need host reconciliation. The in-memory queue retries explicit transient SMTP replies or qualified pre-DATA connection failures only. Bare `ECONNRESET`/branch/v0.0.4/`ETIMEDOUT` and DATA uncertainty no longer imply safe retry. Failover stops before submission; it never retries a failed send on another account.

Attachment preparation validates up to 40 sources and an aggregate raw-byte budget (default 25 MiB, maximum 1 GiB). File reads open lazily, enforce recorded length including underflow, and limit concurrent underlying streams (`maxAttachmentStreams`, default 4, maximum 40). `resolveAttachmentScope` owns wrappers and has awaitable `dispose`; direct compatibility `resolveAttachments` callers must destroy unconsumed streams. Files managers remain borrowed. Read/iterator cancellation is cooperative and cleanup waits for actual settlement. String/byte attachments remain supported; arbitrary raw/href options are rejected. Explicit local-path mode accepts absolute regular files only, rejecting URL paths and final symlinks; filesystem ancestry and replacement races remain the trusted host's responsibility. Prefer the authorized files adapter. See [Nodemailer's attachment inputs](https://nodemailer.com/message/attachments).

Marketing checks fresh boolean subscription/suppression state again at the SMTP boundary, and authorization requires literal `true`. Tracking remains a separate per-send opt-in; analytics failure does not undo one-click unsubscribe. Queue delivery, SMTP handles and inbox ingestion retain separate ownership. Existing inbox APIs authorize before reads/polls, and inbound MIME/attachment budgets and sanitization remain enforced in `inbox-api.ts`, `inbound.ts` and `inbound-safety.ts`.

Qualification uses injected transports, streams and local HTTP preference fixtures. It does not certify live SMTP/TLS delivery, IMAP/POP3 servers, broker crash recovery or production durable stores.


## Authenticated feedback and local sender visibility

`createSenderFeedbackService` is an opt-in correlated ledger alongside the unchanged `createEmailReputationService` policy API. [The public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/email/examples/sender-visibility.ts) binds one tenant/site/account/provider and wires authenticated feedback, suppression and a report endpoint. No collectors, provider polling, remote requests or analytics start on import.

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

`senderReputationCharts(report)` produces bounded, PII-free Reports-compatible UTC trend charts with an explicit accepted-cohort denominator series. `createSenderReputationReportEndpoint({authorize,resolveService})` exposes `{report,charts}` on an explicit GET route; authorization must enforce the bound tenant/site before service resolution. Only bounded `from`/branch/v0.0.4/`until` parameters are accepted, responses are `private, no-store`, and client errors contain no raw DB/provider cause. Mount charts through optional `@zeruxjs/reports/view` to retain its captions, table alternatives, local sorting/pagination, keyboard controls and disposable ownership. No Reports runtime dependency, default public dashboard, or global cross-tenant report source is added. Analytics/audit integrations should consume aggregate counts/coverage only, never recipient/message hashes, addresses, raw responses or signed URLs; this adapter emits no automatic analytics events.

SMTP acceptance measures acceptance by the configured outbound transport, not delivery or inbox placement. Provider delivery feedback reports the provider's observation; an asynchronous bounce can follow earlier acceptance. Opens/clicks remain separately consented, approximate tracking observations, not unique readers or proof of delivery. These local rates are explicitly a **local heuristic with authenticated-reported-only coverage**, not mailbox/provider/DNS reputation. Provider dashboards use their own populations and denominators; see [SES's reputation metrics](https://docs.aws.amazon.com/ses/latest/dg/monitor-sender-reputation.html) and [asynchronous-delivery behavior](https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-deliverability.html). No SPF, DKIM, DMARC, blocklist or DNS status is asserted without a separate current evidence source.

Qualification includes signed HMAC fixture tamper/stale-window checks (not a vendor protocol claim), conflicting/duplicate feedback, late/zero-denominator cohorts, authorized report access, source failure, Reports DOM-emulated tables, and a disposable SQLite two-connection/reopen fixture with cleanup. Live SMTP/provider webhook, production DB engines, DNS checks, browsers and assistive technologies remain separate prerequisites; no live-provider acceptance is claimed.

Inbound markup heuristics scan at most 1 MiB of UTF-16 text, bound individual tag
analysis to 8 KiB, and report `body_truncated` when those limits are reached. They
compare apparent link text with literal destinations without fetching URLs or
executing markup. These lexical warnings are advisory, not an HTML sanitizer,
complete browser parser, authentication result or malware certification.


## Implementation sources

- [packages/@zeruxjs/email/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/email/README.md)
- [packages/@zeruxjs/email/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/email/package.json)
