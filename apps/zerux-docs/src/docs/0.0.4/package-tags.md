---
{
  "title": "Browser and server tagging",
  "description": "Manage consent-aware events and approved destinations without arbitrary script execution.",
  "section": "Packages",
  "order": 22,
  "sources": [
    "packages/@zeruxjs/tags/README.md",
    "packages/@zeruxjs/tags/package.json"
  ],
  "related": [
    "packages",
    "services"
  ],
  "package": "@zeruxjs/tags"
}
---

## The service boundary

Tags connect browser ttag, request-scoped server astag, trigger definitions and approved destinations. The default internal analytics tag records matching events; GA4 Measurement Protocol and approved HTTPS webhooks execute server-side so destination credentials do not enter public container JSON.

## Browser collection

Load the configured /_tags/ttag.js route after establishing an intentional consent policy. Use ttag event/set/get/consent operations. Denied consent discards queued events. Browser events are delivered asynchronously and best effort; a generated request ID does not prove delivery or legal consent.

## Server context

Create astag for a request with a trusted site and approved identity context. Do not share one mutable astag singleton across users. Use a shared database request-ID store for cross-replica uniqueness and siteByOrigin for public tenant binding.

## Studio and releases

Admin routes require host authorization; writes need same-origin checks and optimistic versions. Publish/preview controls and bounded release snapshots do not replace transactional control-plane storage at large scale. No arbitrary browser JavaScript/HTML tags are executed.

## Egress

Destination timeouts isolate failures, but HTTPS hostname validation alone does not remove DNS rebinding risk. Deploy outbound DNS/IP allowlists and firewall rules. Google HTTP acceptance is not proof of GA4 processing. Email marketing consent is independent of telemetry consent.

## Install and select the integration

```sh
npm install @zeruxjs/tags@0.0.3
```

This package participates in the runtime's **tags** integration. Start with [tags configuration](configuration-tags.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Configure analytics first, then server-only credentials, a shared request-ID store and a versioned tag container. Browser tags refer to approved credentials/destinations by identifier rather than embedding secrets. Choose consent defaults explicitly; granted is the package fallback, so privacy-sensitive applications should set denied and wire the host consent interaction.

## TypeScript: inputs, results and ownership

```ts
import { createTagManager } from '@zeruxjs/tags';

type Inputs = Parameters<typeof createTagManager>;
type Result = Awaited<ReturnType<typeof createTagManager>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createTagManager>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Administrative editing/publishing requires host session callbacks and origin/version checks. A dashboard hostname is not authentication. Memory reservation/container fallback does not coordinate replicas. Verify that public container JSON never exposes tokens or destination authorization headers, and distinguish server events from untrusted browser claims.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### TagRuntimeOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `analytics` | `AnalyticsManager` | No |
| `requestIds` | `RequestIdStore` | No |
| `store` | `TagContainerStore` | Yes |
| `container` | `TagContainer` | Yes |
| `prefix` | `string` | Yes |
| `publicOrigin` | `string` | Yes |
| `site` | `string` | Yes |
| `allowedOrigins` | `string[]` | Yes |
| `serverToken` | `string` | Yes |
| `credentials` | `Record<string,{secret:string}>` | Yes |
| `destinations` | `Record<string,{url:string;headers?:Record<string,string>}>` | Yes |
| `fetch` | `typeof fetch` | Yes |
| `authorizeAdmin` | `(request:Request)=>boolean\|Promise<boolean>` | Yes |
| `authorizePublish` | `(request:Request)=>boolean\|Promise<boolean>` | Yes |
| `requireBrowserConsent` | `boolean` | Yes |
| `siteByOrigin` | `Record<string,string>` | Yes |
| `botPolicy` | `'allow'\|'drop-known'` | Yes |
| `dashboardHost` | `string` | Yes |
| `debug` | `boolean` | Yes |
| `defaultConsent` | `'granted'\|'denied'` | Yes |
| `onDebug` | `(data:{requestId:string;event:string;matchedTriggers:string[];firedTags:string[];failures:string[]})=>void` | Yes |
| `onWarning` | `(message:string)=>void` | Yes |
| `maxBodyBytes` | `number` | Yes |
| `maxEventsPerMinute` | `number` | Yes |

### TagContainer

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `version` | `number` | No |
| `name` | `string` | No |
| `triggers` | `Trigger[]` | No |
| `tags` | `TagDefinition[]` | No |
| `variables` | `Variable[]` | No |
| `governance` | `TagGovernance` | Yes |

### TagDefinition

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `name` | `string` | No |
| `type` | `'analytics'\|'ga4'\|'webhook'` | No |
| `triggerIds` | `string[]` | No |
| `enabled` | `boolean` | Yes |
| `eventName` | `string` | Yes |
| `measurementId` | `string` | Yes |
| `credentialRef` | `string` | Yes |
| `destinationRef` | `string` | Yes |
| `clientIdVariable` | `string` | Yes |
| `parameters` | `Record<string,Scalar\|string>` | Yes |

### Trigger

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `name` | `string` | No |
| `type` | `'event'\|'all'\|'pageview'\|'click'\|'form'\|'history'` | No |
| `event` | `string` | Yes |
| `conditions` | `Condition[]` | Yes |
| `enabled` | `boolean` | Yes |

### Variable

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `name` | `string` | No |
| `type` | `'constant'\|'event'\|'dataLayer'\|'context'` | No |
| `key` | `string` | Yes |
| `value` | `Scalar` | Yes |
