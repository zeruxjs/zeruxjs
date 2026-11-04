---
{
  "title": "Email configuration",
  "description": "Set up email with exact runtime options, typed JavaScript/TypeScript examples and lifecycle policies.",
  "section": "Configuration",
  "order": 115,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/services.ts"
  ],
  "related": [
    "package-email",
    "durable-email",
    "configuration-files",
    "configuration-queue"
  ]
}
---

## Before you configure it

Install the runtime and the packages used by this feature in the application directory. Keep the dependency lockfile committed. Configure only services the application actually uses; a public package name is not automatic service registration.

```sh
npm install zeruxjs @zeruxjs/email
```

## JavaScript application setup

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  email: {
  defaultAccount: 'transactional',
  maxRecipients: 20,
  accounts: [{ name: 'transactional', smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    requireTLS: true,
    auth: { type: 'password', user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  }, defaults: { from: 'Application <noreply@example.com>' } }],
},
};
```

This example is a server configuration. Supply the referenced environment values through the server process before starting it. The documentation site's static exporter does not start this service merely because it imports a config file.

## What each setting does

Use named accounts and choose `defaultAccount` explicitly when there is more than one sender. SMTP credentials remain server-side. `secure: false` on port 587 normally means a connection upgraded through STARTTLS; `requireTLS: true` requires that upgrade. Port/transport settings must match the actual provider. SMTP acceptance is not final delivery.

Accounts may instead contain an application-supplied transport. Runtime bootstrap starts a sending manager only for accounts with SMTP/transport configuration. Inbound-only setup uses `receive.accounts` or account-level receive configuration. At least one sending or receiving account is required once the email service is configured.

Tracking, preferences, reputation, campaign dashboards and feedback are independent opt-in features. Tracking requires a public origin and signing secret/key ring. Preferences require a signing secret and a suitable persistent store in production. A signature verifier must validate provider feedback before the application accepts delivery or complaint events.

## TypeScript configuration

For a TypeScript application, use `zerux.config.ts`. Validate the service object separately so errors point to its option rather than a large application object. `NonNullable` removes the optional top-level absence; it does not invent defaults or validate external data at runtime.

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';

type Options = NonNullable<ZeruxConfig['email']>;
const options = {
  defaultAccount: 'transactional',
  maxRecipients: 20,
  accounts: [{ name: 'transactional', smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    requireTLS: true,
    auth: { type: 'password', user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  }, defaults: { from: 'Application <noreply@example.com>' } }],
} satisfies Options;
export default { email: options } satisfies ZeruxConfig;
```

In JavaScript, the JSDoc annotation provides editor assistance. In TypeScript, `satisfies` checks the shape while preserving inferred literal values. Neither changes the runtime behavior or establishes a network connection during a typecheck. See [TypeScript application development](typescript.md) for strict settings and validation boundaries.

## Lifecycle and failure policy

Files initialize before email so stored attachments can be resolved. For persistent inbound mode, provide a named database connection or a host store. JSON inbound mode returns parsed messages without creating an inbox table; it is not a durable mailbox store. An inbox UI API still requires persistence and an authorization callback.

Separate transactional and marketing policies. Recheck consent and suppression at delivery time, use durable idempotency for retryable campaigns, and record ambiguous outcomes instead of blindly resending. Shutdown must release SMTP/receive resources. A queue job completion or SMTP response does not prove that an end user's mailbox accepted the message.

## Verify a real integration

1. Start the application with just this feature and its declared dependencies configured.
2. Check service readiness, then perform one operation through the application API.
3. Test a failure path such as unavailable infrastructure or a rejected input.
4. Restart the runtime and verify that owned resources close and state behaves according to the chosen storage model.
5. Repeat with the production build and the real deployment identity; a successful static docs build does not test external services.

## Declared options

The following table is captured from the source contract used by runtime bootstrap. Optional means a property may be omitted; it does not mean every combination is meaningful. Callback and nested adapter shapes must satisfy the full declared type.

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `accounts` | `Array<Record<string, unknown>>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `receive` | `` { enabled?:boolean; /** Required only for the built-in persistent inbox. */ database?:string; table?:string; /** Existing application-owned inbox table mapping. No schema changes unless createTable=true. */ mapping?:{table:string;createTable?:boolean;columns?:{id?:string;account?:string;payload?:string;subject?:string;mailbox?:string;receivedAt?:string;from?:string}}; /** json returns parsed messages without creating inbox tables. */ mode?:'json'\|'persist'; /** Host-provided storage mapping can replace the built-in ZeruxJS table. */ store?:{get:(id:string)=>Promise<unknown>;put:(message:unknown)=>Promise<boolean>;page:(account:string,cursor:string\|null,limit:number)=>Promise<unknown>;erase?:(id:string,account:string)=>Promise<boolean>}; /** Optional server-only inbox UI API. Never enabled without a host authorization callback. */ api?:{ authorize:(access:{operation:'list'\|'read'\|'search'\|'poll'\|'markSeen'\|'markUnread'\|'flag'\|'unflag'\|'folders'\|'erase';account:string;messageId?:string})=>boolean\|Promise<boolean>; canErase?:(message:unknown)=>boolean\|Promise<boolean>; }; onMessage?:(message:unknown)=>Promise<void>\|void; /** Host-provided scanners; failures stop the poll instead of claiming a clean scan. */ inspectRaw?:(context:{account:string;raw:Buffer})=>Promise<'clean'\|'spam'\|'phishing'\|'malware'\|'review'>; inspectAttachment?:(context:{account:string;messageId:string;filename:string;content:Buffer})=>Promise<'clean'\|'suspicious'\|'blocked'>; saveAttachment?:(context:{account:string;messageId:string;attachment:unknown;content:Buffer})=>Promise<string>; attachmentContent?:'metadata'\|'base64'; maxInlineAttachmentBytes?:number; accounts?:Array<Record<string,unknown>>; /** If omitted, each sending account's `receive` config is used. */ } `` | No | Optional receive-only or combined SMTP/IMAP/POP3 runtime. Inbound credentials are server-only. |
| `defaultAccount` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxRecipients` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `marketingSuppression` | `{isSuppressed:(address:string)=>Promise<boolean>}` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `reputation` | `{enabled?:boolean;database:string;table?:string;policy?:{ windowMs?:number;minimumAccepted?:number;warnBouncePercent?:number;pauseBouncePercent?:number; warnComplaintPercent?:number;pauseComplaintPercent?:number;warnSoftBouncePercent?:number;pauseSoftBouncePercent?:number; protectTransactional?:boolean;scanLimit?:number }}` | No | Opt-in, durable, per-SMTP-account sender reputation. Connector name is resolved server-side. |
| `tracking` | `EmailTrackingStartupConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `preferences` | `EmailPreferencesStartupConfig` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `marketingFeedback` | `{ enabled?:boolean; suppression:{recordFeedback:(event:any)=>Promise<unknown>}; feedbackAccount?:(event:any)=>string; /** Optional provider-verified delivery/deferred/bounce/complaint event ledger. */ providerOutcomes?:{record:(event:{eventId:string;provider:string;campaignId:string;messageId:string;kind:'delivered'\|'deferred'\|'hard-bounce'\|'soft-bounce'\|'complaint';occurredAt:number})=>Promise<boolean>}; /** Must resolve attribution and stable event time from trusted provider metadata. */ feedbackDelivery?:(event:any)=>{provider:string;campaignId:string;messageId:string;occurredAt:number}; verifySignature:(body:Uint8Array,headers:Headers)=>boolean\|Promise<boolean>; parse:(body:Uint8Array,headers:Headers)=>unknown\|Promise<unknown>; path?:string;maxBodyBytes?:number;timeoutMs?:number; }` | No | Optional trusted campaign admin UI, not enabled by default. Optional signed provider bounce/complaint intake; never mounted without signature verifier. |
| `marketingCampaignDashboard` | `{ service:unknown; authorize:(request:Request)=>unknown\|Promise<unknown>; authorizeCampaign:(principal:unknown,code:string,action:string)=>boolean\|Promise<boolean>; authorizeCreate:(principal:unknown)=>boolean\|Promise<boolean>; authorizeList?:(principal:unknown)=>boolean\|Promise<boolean>; verifyCsrf:(request:Request,principal:unknown)=>boolean\|Promise<boolean>; csrfToken:(request:Request,principal:unknown)=>string\|Promise<string>; prefix?:string;publicOrigin?:string; }` | No | Optional protected UI for one-template function-first marketing campaigns. |
| `campaignDashboard` | `{ /** Host-provided CampaignPlanner; strongly typed by @zeruxjs/email itself. */ planner:unknown; authorize:(request:Request)=>unknown\|Promise<unknown>; verifyCsrf:(request:Request,principal:unknown)=>boolean\|Promise<boolean>; csrfToken:(request:Request,principal:unknown)=>string\|Promise<string>; authorizeCampaign:(principal:unknown,id:string,action:string)=>boolean\|Promise<boolean>; /** Optional PII-free, bounded delivery report callback; scope enforced by authorizeCampaign. */ deliveryReport?:(campaignId:string)=>Promise<unknown>; performanceReport?:(campaignId:string)=>Promise<unknown>; /** Opt-in native UTC-day report, guarded by per-campaign dashboard authorization. */ trendsReport?:(campaignId:string,from:string,to:string)=>Promise<unknown>; prefix?:string;publicOrigin?:string; }` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |

## Continue with the package

- [email](package-email.md)
- [durable email](durable-email.md)
- [files](configuration-files.md)
- [queue](configuration-queue.md)
