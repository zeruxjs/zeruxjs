# Tag-manager configuration

Configure browser/server event routing, shared stores, consent and protected administration.


## Prerequisites and setup

Install `@zeruxjs/tags` and `@zeruxjs/analytics`, configure an analytics database connection, and enable analytics before tags. A standalone manager requires actual analytics/request-ID services; runtime bootstrap supplies them when available. A missing analytics service degrades the configured tags integration rather than inventing a reporting backend.

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  analytics: { enabled: true, analytics: 'reporting' },
  tags: {
    enabled: true,
    prefix: '/_tags',
    site: 'storefront',
    publicOrigin: 'https://tags.example.com',
    allowedOrigins: ['https://app.example.com'],
    defaultConsent: 'denied',
    requireBrowserConsent: true,
    debug: false,
  },
};
```

This is collector setup; it deliberately does not create anonymous admin access. Define the `reporting` connection in `db`. The application must proxy the public tagging origin to the actual runtime if it uses a separate subdomain. An origin setting does not configure DNS, TLS or routing infrastructure.

## Paths, identity and consent

The default prefix is `/_tags`; the browser client is served beneath that prefix. `site` partitions the intended analytics context, while `siteByOrigin` can map explicitly allowed browser origins to sites. Do not trust a client-supplied site ID as proof of tenant authorization. `allowedOrigins` is a browser collection policy, not administrator authentication.

The package default consent is granted unless configured otherwise; this example explicitly chooses denied. The host's consent interaction must update the client consent state before optional browser event collection. `requireBrowserConsent` controls whether consent is required for relevant browser events. Do not place GA4 secrets, webhook authorization headers or administrator tokens in browser data-layer payloads.

## Destinations and protected administration

GA4 credentials and preapproved webhook destinations belong to the server-side `credentials` and `destinations` maps. Tags refer to those entries by identifier; the browser container must not receive their secret values. Destination validation does not replace a network egress policy or a review of the data sent to a third party.

To enable administration, implement `authorizeAdmin(request)` against a validated host session and role policy. `authorizePublish` can restrict publishing separately from draft editing. `dashboardHost` restricts the host serving administration; it is not authentication. Missing authorization means no public editing route should be assumed. Container writes use version checks: treat stale revisions as conflicts rather than retrying with unreviewed changes.

## TypeScript setup

```ts
import type { ZeruxConfig } from 'zeruxjs';
type TagSetup = NonNullable<ZeruxConfig['tags']>;
const tags = {
  enabled: true, prefix: '/_tags', site: 'storefront',
  defaultConsent: 'denied', requireBrowserConsent: true,
} satisfies TagSetup;
export default { tags } satisfies ZeruxConfig;
```

For a standalone factory infer its input with `Parameters<typeof createTagManager>[0]`, which includes dependencies supplied automatically by the runtime. Do not cast a partial runtime setup into the standalone factory input. The complete `TagsStartupConfig` table below shows the callback/store contracts.

## Persistence and lifecycle

Bootstrap attempts to use analytics-backed container and request-ID stores. Supply shared stores explicitly when the backing analytics implementation cannot provide them. Memory fallback is suitable for single-process development and does not coordinate revisions or duplicate reservations across hosts. Never describe a memory reservation map as durable event deduplication.

Verify a browser event, a server event, a denied origin, denied consent, and an unauthorized administration request. Check that published container JSON excludes credentials. Restart and test publication persistence with two processes before relying on the store for production tag governance.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.

### TagsStartupConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `site` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `publicOrigin` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `allowedOrigins` | `string[]` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `serverToken` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `requestIds` | `{reserve(day:string,id:string):Promise<boolean>}` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `store` | `{load():Promise<unknown>;save(container:unknown,expectedVersion:number):Promise<boolean>}` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `container` | `unknown` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `credentials` | `Record<string,{secret:string}>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `destinations` | `Record<string,{url:string;headers?:Record<string,string>}>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `authorizeAdmin` | `(request:Request)=>boolean\|Promise<boolean>` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `authorizePublish` | `(request:Request)=>boolean\|Promise<boolean>` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `requireBrowserConsent` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `siteByOrigin` | `Record<string,string>` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `botPolicy` | `'allow'\|'drop-known'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `onWarning` | `(message:string)=>void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `dashboardHost` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `debug` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `defaultConsent` | `'granted'\|'denied'` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `onDebug` | `(data:unknown)=>void` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `maxBodyBytes` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `maxEventsPerMinute` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
