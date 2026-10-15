# @zeruxjs/tags — server and browser tag manager

Managed triggers, tags, data-layer variables, browser `ttag()` and server `astag()` APIs. Supports Zerux internal analytics, **server-side GA4 Measurement Protocol**, and preapproved HTTPS webhook destinations. Credentials are only resolved on the server. Does not execute arbitrary browser script tags.

## Zerux runtime configuration

```ts
export default {
  analytics: { analytics: 'reporting', enabled: true },
  tags: {
    enabled: true,
    site: 'storefront',
    prefix: '/_tags', // browser: /_tags/ttag.js, collector: /_tags/collect
    publicOrigin: 'https://tags.example.com', // optional for tagging subdomain
    allowedOrigins: ['https://shop.example.com'],
    dashboardHost: 'tags.example.com', // optional restrict dashboard host
    authorizeAdmin: async req => await sessionHasRole(req, 'analytics_admin'),
    credentials: { ga4: {secret: process.env.GA4_MP_SECRET!} },
    destinations: { crm: { url: 'https://hooks.example.net/events', headers: { Authorization: `Bearer ${process.env.HOOK_TOKEN!}` } } },
    debug: process.env.NODE_ENV !== 'production',
  }
}
```

The default container includes an **internal analytics tag** fired for all events. `dashboardHost` applies to admin routes only. Session/role authorization must be supplied by the host application; otherwise **no admin routes are registered**. Admin PUT requires a matching Origin and a monotonically increasing version. Credentials and destination URLs never appear in public container JSON. Direct browser-origin POSTs cannot claim `server` events.

For browser collection with cross-origin tags, put the script on the page:

```html
<script>window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:'preload',properties:{section:'home'}});</script>
<script async src="https://tags.example.com/_tags/ttag.js"></script>
```

```js
const requestId = ttag('event', 'purchase', { value: 49.99, currency: 'USD' });
ttag('set', 'sessionId', 'opaque-session'); // optional stable client_id for GA4
const x = ttag('get', 'sessionId');
ttag('config', {site: 'shop',debug: false});
ttag('consent', 'denied');  // telemetry-only switch, unrelated to email marketing consent
window.dataLayer.push({event:'cart_add',properties:{quantity:1}});
```

`ttag('event')` returns the **16-character request ID** immediately; that ID is also attached to the collected event and passed to matching triggers. Events queue asynchronously, attempt `navigator.sendBeacon()` first (CORS-simple text/plain), then `fetch(...,{keepalive:true})` if Beacon cannot queue. Flushing also occurs on `visibilitychange` / `pagehide`. Network delivery is **best-effort**, not an exactly-once guarantee. Browsers that do not provide secure `crypto.getRandomValues()` cannot safely generate IDs and therefore do not send telemetry.

On the server, get a request-scoped function (not a cross-request global singleton):

```ts
const tagService = runtimeServices.get('tags');
const astag = tagService.createAstag({site:'storefront',sessionId:'opaque-user-id'});
await astag('set', 'tier', 'pro');
const result = await astag('event', 'checkout', {value:125});
await astag('get', 'tier');
await astag('config', {pathname:'/checkout'});
await astag('consent', 'denied'); // telemetry control only
```

A server request scope can generate **one** request ID, reserved for the UTC day, and reuse it across related events; browser deliveries use **one ID per POST**. The current UTC day is assigned on the server. The event row contains reserved `zRequestId` / `zRequestUtcDay` scalar properties for joining data. Duplicate request ID reservations are rejected (409), invalid ID (422), unavailable reservation storage (503). For guaranteed cross-replica uniqueness, use the analytics-named shared DB reservation adapter or inject an atomic shared `requestIds` store. Memory-only reservation is development-only.

### Editing tags

Navigate to `/_tags/admin` on the selected dashboard host with an authenticated application session. Create/edit triggers, event matches and conditions; variables can read event properties, dataLayer values, or request context; tags can fire internally, to a configured GA4 stream, or to a preapproved webhook. `/_tags/admin/preview` is a protected **dry run** that shows eligible triggers/tags without dispatching to destinations. The full JSON editor can edit uncommon fields; publish uses optimistic version checking.

A GA4 tag needs `measurementId` (e.g., `G-ABC1234`), `credentialRef` referencing the server-side secret, and a **client_id** via explicit sessionId or a variable; Zerux does not silently invent a cookie or fingerprint. GA4 HTTP success means received, **not necessarily processed**. See [Google's Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events). Webhooks are referenced by `destinationRef` to a server allowlist (not an attacker-controlled URL). Use egress filtering/DNS rebinding protection in production.

### Deployment prerequisites

Connect `analytics.analytics` to a real named @zeruxjs/db connector. Its facade should implement `createTable`, atomic `insert`, `select`, conditional `update` and reliable `affectedCount`. The default store uses `analytics_tag_containers` with optimistic CAS; `analytics_request_ids` enforces UTC-day ID uniqueness and can optionally prune old IDs if the connector supports `delete`. Multi-server nodes must share the same DB and dashboard store; keep admin APIs protected behind HTTPS session auth, CSRF restrictions, reverse proxy limits and role controls. Supply `store`/`requestIds` adapters if your DB is not compatible. Monitor warnings, 409/429/503 rates and outgoing destination failures. No durable queue/replay is implemented yet.

### Optional automatic web triggers

Published `pageview`, `click`, `form`, and `history` trigger types cause the generated bootstrap to register corresponding browser listeners. They emit `page_view`, `click`, `form_submit`, and `history_change` events respectively. Click/form metadata intentionally excludes element text and form field values. Automatic tracking is not enabled unless a corresponding trigger is published. Set `tags.defaultConsent:'denied'` for a site's privacy policy to suppress telemetry before the application calls `ttag('consent','granted')`; this switch is independent of email marketing subscription state. `history` currently listens to `popstate` rather than monkeypatching routing APIs.
