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
// ttag('config', {...}) is intentionally disabled: tenant/debug are server-controlled.
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

Navigate to `/_tags/admin` on the selected dashboard host with an authenticated application session. Create/edit triggers, event matches and conditions; variables can read event properties, dataLayer values, or request context; tags can fire internally, to a configured GA4 stream, or to a preapproved webhook. `/_tags/admin/preview` is a protected **dry run** that shows eligible triggers/tags without dispatching to destinations. The full JSON editor can edit uncommon fields; saving a draft and publishing it are separately authorized, version-checked operations. Registered variables can be used as exact parameter bindings such as `parameters:{revenue:'{{cart_total}}'}`; JavaScript expressions are never evaluated.

A GA4 tag needs `measurementId` (e.g., `G-ABC1234`), `credentialRef` referencing the server-side secret, and a **client_id** via explicit sessionId or a variable; Zerux does not silently invent a cookie or fingerprint. GA4 HTTP success means received, **not necessarily processed**. See [Google's Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events). Webhooks are referenced by `destinationRef` to a server allowlist (not an attacker-controlled URL). Use egress filtering/DNS rebinding protection in production.

### Deployment prerequisites

Connect `analytics.analytics` to a real named @zeruxjs/db connector. Its facade should implement `createTable`, atomic `insert`, `select`, conditional `update` and reliable `affectedCount`. The default store uses `analytics_tag_containers` with optimistic CAS; `analytics_request_ids` enforces UTC-day ID uniqueness and can optionally prune old IDs if the connector supports `delete`. Multi-server nodes must share the same DB and dashboard store; keep admin APIs protected behind HTTPS session auth, CSRF restrictions, reverse proxy limits and role controls. Supply `store`/`requestIds` adapters if your DB is not compatible. Monitor warnings, 409/429/503 rates and outgoing destination failures. No durable queue/replay is implemented yet.

### Optional automatic web triggers

Published `pageview`, `click`, `form`, and `history` trigger types cause the generated bootstrap to register corresponding browser listeners. They emit `page_view`, `click`, `form_submit`, and `history_change` events respectively. Click/form metadata intentionally excludes element text and form field values. Automatic tracking is not enabled unless a corresponding trigger is published. Set `tags.defaultConsent:'denied'` for a site's privacy policy to suppress telemetry before the application calls `ttag('consent','granted')`; this switch is independent of email marketing subscription state. `history` currently listens to `popstate` rather than monkeypatching routing APIs.

## Publishable releases and governance

**Important migration:** `PUT /_tags/admin/api` now **saves a draft**, not the live container. A separate privileged `POST /_tags/admin/publish` makes the draft live. Existing plain versioned containers are treated as live **release 1** until their first draft change; the first save persists a governance envelope in the existing CAS document. No new table is required. Two manager replicas must share the same atomic versioned document store and request-ID adapter; an in-memory store is for development only.

Configure **both** independent authorizers on the server; no publish or rollback is allowed when `authorizePublish` is absent:

```ts
const tagConfig = {
  site: 'shop',
  allowedOrigins: ['https://shop.example.com'],
  siteByOrigin: { 'https://shop.example.com': 'shop' },
  defaultConsent: 'denied',           // for browser AND astag by default
  requireBrowserConsent: true,      // drops unknown client-consent claims
  botPolicy: 'drop-known',
  dashboardHost: 'tags.example.com',
  authorizeAdmin: req => checkRole(req, 'analytics_editor'),
  authorizePublish: req => checkRole(req, 'analytics_publisher'),
  onWarning: message => logger.warn(message),
};
```

An authorizer must verify the user's authenticated session, tenant and role. Both controls are checked for publisher actions; a publisher needs editor/admin access too. By default, all POST/PUT studio writes require same-origin `Origin` checks in addition to these authorizers; the explicit administration policy below permits exact approved UI origins only with host-verified CSRF tokens. Never expose a dashboard publicly. Add CSRF tokens in the host layer if your deployment accepts unusual state-changing request patterns.

| Route                   | Method    | Permission                            | Purpose                                                                          |
| ----------------------- | --------- | ------------------------------------- | -------------------------------------------------------------------------------- | ------------- |
| `/_tags/admin`          | GET       | editor                                | Visual draft editor, dry-run, publish and rollback controls                      |
| `/_tags/admin/api`      | GET / PUT | editor                                | Read full draft / save `{version: prior+1,...}`                                  |
| `/_tags/admin/status`   | GET       | editor                                | Draft revision, live release and bounded release-history metadata                |
| `/_tags/admin/preview`  | POST      | editor                                | Pure trigger dry-run `{name,properties,data,mode:'draft'                         | 'published'}` |
| `/_tags/admin/publish`  | POST      | editor + publisher                    | `{expectedVersion}`; atomic CAS live switch and history append                   |
| `/_tags/admin/rollback` | POST      | editor + publisher                    | `{expectedVersion,releaseId}`; publish a retained snapshot as a new live release |
| `/_tags/ttag.js`        | GET       | public                                | Bootstrap **from published triggers only**, `Cache-Control: no-store`            |
| `/_tags/collect`        | POST      | allowed origin or server bearer token | Browser/server telemetry, validated and fail-soft                                |

The editor shows draft and live revision independently; **saving never fires edited tags**. Preview is pure and does not send to GA4/webhooks or internal storage. Publish rejects missing GA4 credentials or webhook destination references; credentials, actual URL/headers and OAuth tokens are always supplied by trusted server configuration, never dashboard JSON. Rollback preserves the current draft so a publisher may fix/re-publish it later. Revisions are monotonic and concurrent conflicting writers receive HTTP 409. The atomic single-document scheme supports a 12-entry release history, compacted further to keep the complete document below 58,000 bytes for portable SQL `TEXT` implementations. Oversized definitions are rejected until simplified; historical snapshots pruned by the retention policy are not available for rollback. A rollback is a new release, not mutation of old history.

`ttag('config', {site:..., debug:...})` is **no longer accepted**: an untrusted web page may not change the server-issued tenant or debug policy. Arbitrary JavaScript/HTML tags are **not supported**. The studio uses an exact SHA-256 hash for inline script CSP, with scripts otherwise denied; it also denies framing and uses no-store responses. Automatic click/form listeners avoid form field values, text contents and URLs. Browser telemetry uses opaque random request IDs, bounded scalar properties and client-side consent. `ttag('consent','denied')` discards queued events. `defaultConsent:'denied'` gates `astag` until it receives `astag('consent','granted')`, and enables consent checks on browser ingestion by default. The collector drops explicit `denied` claims and, with `requireBrowserConsent:true`, ignores unknown consent. **A browser's `granted` claim cannot prove legal consent**: host consent management and privacy policies remain essential. `siteByOrigin` should be configured for every public origin in multi-tenant deployments; collection-side binding rejects mismatched site assertions. The system never infers identity from IPs or browser fingerprints.

Built-in GA4/webhook destinations have independently bounded 1-second timeouts; provider helpers use the owning evaluation deadline. Failures isolate each tag, with sanitized warnings. Webhook destinations must use public HTTPS DNS hostnames and redirects are disallowed; this **does not remove DNS-rebinding risk**. Enforce outbound DNS/IP allowlists and egress firewall rules in your deployment. GA4 HTTP acceptance is not proof of Google-side processing. No arbitrary remote script execution, guaranteed browser delivery, distributed rate limiting, replay queue or unbounded GTM/GA4 feature parity is provided. Large production deployments should migrate release snapshots to a normalized transactional release table rather than depending on the capped JSON envelope.

## Explicit versioned provider plugins

`createTagProviderRegistry()` owns trusted **server code** registered with `register({id,version,config,destinations,dispatch,dispose?})`. There is no package scanning, remote script loading, eval, or JavaScript-string plugin type. [The public-import example](examples/provider.ts) creates one app-owned registry and manager. Existing analytics/GA4/webhook tags retain their APIs; custom tags use `type:'provider'`, `providerRef`, integer `providerVersion`, and scalar `publicConfig`. Provider schemas are snapshotted at registration; the same ID/version cannot be replaced. Register retained versions explicitly if old releases must remain runnable/rollbackable.

A registry permits at most 32 registrations. `config` declares at most 25 named string/number/boolean fields, optional `required`, and bounded allowed-value lists. Unknown/wrong-type fields and incompatible provider versions reject before a draft/import or publish transition. Obvious secret-bearing public field names are rejected. This does not detect a secret hidden in an innocently named literal: hosts must review all declared public fields/values. Keep secret clients/options in private server closures or existing server credential/destination configuration; never place them in container variables, publicConfig or exported definitions. Browser bootstrap still emits only server-issued collection settings and published automatic-trigger types, never plugin code, private headers, destination URLs or credential values.

A provider's `dispatch` receives a frozen event/config/parameter snapshot, an AbortSignal and `send(destinationRef, scalarPayload)`. Every send must use both the provider's declared `destinations` list (maximum 16 references) and the manager's configured HTTPS destination allowlist. Provider publish/import/preview checks reject missing declared destinations; payloads are capped at 16 KiB and four send calls per provider-tag dispatch. Requests disallow redirects and responses are cancelled after status inspection. No automatic server retry is added; ambiguous writes must not be transparently replayed. Sends begun without awaiting are still tracked/drained, and sends attempted after the provider callback completes reject. Provider callbacks should still await owned work and cooperate with cancellation. The visual editor recognizes provider references/versions/public JSON and group composition; server validation remains authoritative.

Registered code is trusted application code, **not a sandbox**: direct global fetch, timers or arbitrary side effects created by that code cannot be intercepted safely. Use the supplied bounded send helper and explicit disposer, and review additional SDK/network policy yourself. The package does not promise vendor/plugin parity or that an HTTP 2xx means provider-side processing. The existing web-stream Measurement Protocol behavior follows Google's [server-only secret and identifier contract](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events); no new vendor SDK or browser Measurement Protocol secret is introduced.

### Trigger and variable schemas

Existing trigger/variable kinds remain supported; optional `schemaVersion:1` explicitly identifies their current schema (omission means V1). Unsupported versions reject. A trigger can additionally use `type:'group'` with `composition:{mode:'all'|'any'|'not',triggerIds:[...]}`. Groups reference existing trigger IDs, accept 1–20 distinct inputs (`not` exactly one), and may have their own existing conditions. IDs are memoized within one event only. Cycles, unknown references, depth over eight and validation/evaluation work over 5000 visits reject. Disabled inputs evaluate false, so `not` of a disabled input evaluates true; disabled groups themselves remain false. These are Boolean conditions, not authorization rules.

Variables remain constant, event, dataLayer or the enumerated request context; bindings remain exact `{{variableId}}` strings. There is no expression language, nested object evaluation or arbitrary callback in a saved container. Unknown document/trigger/variable/tag/condition fields now reject instead of being silently stripped: move host-only metadata into separate private storage. Constants and names may contain inert text; text that resembles JavaScript is never evaluated. Definitions reject functions, accessors, classes, cyclic/prototype-polluting JSON, nesting beyond 32, more than 20,000 visited nodes, or over 128 KiB before reconstruction. Existing governance still bounds persisted releases to 58,000 bytes.

### Dispatch lifetime, consent and scope

Managers default to eight actual pending evaluations and a 2000 ms observation deadline (configurable maxima 64 and 30 seconds). Event JSON is bounded by `maxBodyBytes` (default 16 KiB); data layers have 40 scalar fields. A timeout returns `dispatch_cancelled`, but capacity remains occupied until native work and tracked sends actually settle. Overload returns `dispatch_overload`; reentrant calls from a provider to the same manager return `recursive_dispatch`. This is cooperative cancellation, not forced JavaScript termination, and partial external acceptance may already have occurred. Existing direct `evaluate` is a trusted server API for an already-reserved request ID; remote callers must use the collector, which retains atomic request-ID reservation and origin/site checks.

`astag` rechecks its mutable consent state before each tag and supplied send. Optional host `allowDispatch(event)` must return literal true and runs again at dispatch boundaries, letting the application enforce fresh consent/tenant policy. A change cannot recall an already-started request. Browser claims are still not proof of legal consent, and marketing subscription state stays separate. With a fixed `site`, server contexts/config calls reject another site; multi-site collector requests may use only the independently origin-validated `siteByOrigin` mapping. Direct server sites without a fixed site remain the host's authenticated request responsibility. Pathname query/hash suffixes are removed before dispatch.

Await `manager.close()` to stop new collection/dispatch, abort cooperative work, drain actual settlement, then dispose providers when `ownProviders:true`. Registries are borrowed by default; hosts sharing one close it **after all borrowing managers drain**. Database stores, analytics managers and request-ID stores remain borrowed. `status()` exposes fixed closed/pending counters without site/event payload labels. Noncooperative callbacks/SDKs can delay shutdown. Constructors/registrations are inert; if setup validation fails, the host still owns any registry/resources it created before construction.

Browser queues are now bounded to 100 pending items/16 KiB per POST, 40 state keys, the last 500 retained dataLayer entries and the last 500 initial preload entries. Oversized/overflow events drop without remote dispatch; deny still purges the queue. The existing single 409-ID-conflict retry remains capped at one and checks consent; no retry follows an ambiguous transport failure. The generated bootstrap's listeners remain document-owned, not a general SPA mount/unmount API.

### Controlled transfer and preview

`exportTagDefinition(container,registry?)` emits `{format:'zerux-tags',schemaVersion:1,container}` without governance/history. `importTagDefinition(text,registry?)` validates this envelope, a 58,000-byte transfer budget, public fields and provider compatibility before returning a definition. Provider tags require the explicit registry in these codecs and in direct `saveTagDraft`/`publishTagDraft`/`rollbackTagRelease` calls (new optional final argument). Standalone codecs never mutate storage or publish.

Authenticated managers additionally expose `GET /_tags/admin/export` and same-origin JSON `POST /_tags/admin/import` with `{expectedVersion,definition:<envelope string>}`. Imports reject incompatible schemas and unresolved active destinations, retain container identity, ignore the imported revision and CAS-save a **draft** at expectedVersion+1. Admin authorization must verify the manager's tenant/site. Publishing still requires the separate publisher callback and a second explicit transition; imports cannot carry governance or activate a draft automatically. Rollback rechecks registered provider versions and configured destinations. Server JSON/export responses are private no-store. Admin body reads are bounded/cancellable with a five-second read deadline; host authorization callbacks still require their own cooperative limits.

Preview remains a pure authorized dry-run: no provider callback, network call, analytics write or ID reservation occurs. It uses the same group matcher and provider schema checks, with default/fresh host consent and destination readiness gates. Unknown preview scope fields reject; a preview cannot supply another site or override a denied consent policy. A default-denied instance therefore previews no candidates unless the host's actual configuration permits dispatch; there is no client-supplied consent bypass.

Qualification includes existing collector/governance checks plus provider version/import failures, recursive groups, consent changes, denied destinations, outage/no-replay, overload/deadlines and actual-settlement disposal fixtures. These tests use injected transports/VM browser fixtures, not live Google/webhook or browser acceptance. Live prerequisites remain a shared durable container/request-ID store, tenant-authorized sessions, consent management, approved egress/DNS policy and dedicated configured provider credentials. No live credentials, user applications or production destinations were used.

## Configurable headless administration

The package keeps telemetry mounting (`prefix`, collection `publicOrigin`, collector `allowedOrigins`) separate from **administration**. `TagRuntimeOptions.administration` accepts `basePath` for API routes, `uiPath` for the authenticated HTML page, optional API `publicOrigin`, and `serveUi:false` for a completely separately hosted UI. Defaults preserve `/_tags/admin` and its existing endpoints. Paths must be explicit root paths; conflicting route registrations reject. The host mounts the returned routes; no application, asset compiler or listener starts automatically.

See [the server mounting example](examples/admin-mount.ts) and [the browser client/slot example](examples/admin-browser.ts). These are explicit standalone package integrations; they do not add automatic framework configuration discovery or launch another UI server.

### Exact CORS and session/CSRF ownership

Administration has its **own** `allowedOrigins` (maximum 16 exact origins), independent of collector origins. HTTPS is required except explicit localhost HTTP development. Wildcards, URL credentials, paths, queries and opaque/null origins reject. CORS responses echo only an exact approved request origin, allow credentials and vary on Origin/Cookie/Authorization; all admin responses are private no-store. Actual in-flight admin work is capped at eight by default (`administration.maxConcurrent`, maximum 64); overload rejects before starting another authorizer/store operation. Preflight permits only GET/POST/PUT and Content-Type/X-Zerux-CSRF/Authorization. Preflight performs no authenticated data operation; each real request still calls the host authorizer. Unapproved Origin requests are rejected, including reads. See the [Fetch CORS and credentials standard](https://fetch.spec.whatwg.org/#http-cors-protocol).

Configuring cross-origin administration requires `verifyCsrf(request)`. With that verifier configured, **every write**, including same-origin validate/preview, requires JSON, a nonempty `X-Zerux-CSRF` header and literal-true host verification. Keep tokens session-bound, expiring and verified against the authenticated principal; a static shared token or Origin check alone is not the supplied CSRF integration. Default deployments without this option retain the existing same-origin Origin gate. `issueCsrfToken(request)` can provide the builtin authenticated page's per-session token; external UIs obtain it through a separately authorized host flow. Token issuance never bypasses `authorizeAdmin`. The token is intentionally visible to its authorized UI, while SMTP/provider/destination secrets remain server-only.

Host session/auth callbacks must validate tenant, site and roles for this manager/store. `authorizeAdmin` gates read/save/validate/preview/import/export, and `authorizePublish` remains an additional independent publish/rollback check. CORS is not authorization. `dashboardHost` still checks the API request host, not the browser UI Origin. Neither IP/forwarded headers nor a visible UI button grant permission.

The package creates no cookies or sessions. A UI subdomain does not automatically receive API-host cookies: choose secure host-scoped HttpOnly session cookies, SameSite policy and credentialed fetch deliberately. Cross-origin and cross-site are different boundaries, and browsers may block cross-site cookies despite CORS approval. Avoid widening cookie Domain just to make an integration appear to work; use an explicitly authenticated host/BFF/token design when required. Every script on an approved UI origin is trusted to read that user's admin responses/CSRF token, so do not share that origin with untrusted applications. No browser cookie-policy qualification is inferred from request fixtures.

### Stable operations and optimistic edits

The API base exposes:

| Suffix                  | Method     | Operation                                                                                  |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `/api`                  | GET / PUT  | Read / CAS-save full draft; create/update/delete entries through validated document arrays |
| `/validate`             | POST       | Validate schemas/provider versions without storage mutation                                |
| `/preview`              | POST       | Authorized dry-run; consent and destination policy still apply                             |
| `/status`               | GET        | Draft/live revisions and retained release metadata                                         |
| `/publish`, `/rollback` | POST       | Separate publisher-authorized CAS transition                                               |
| `/import`, `/export`    | POST / GET | Versioned draft-only definition transfer                                                   |

Saving requires `version=previous+1`; publishing/rollback require `expectedVersion`. A CAS conflict returns 409. There is no silent merge, last-writer-wins overwrite, automatic retry or implicit publish on save. Provider compatibility, destination configuration, consent and tenant checks from the execution contract remain intact. Imported definitions contain inert public data, not executable slots, credentials or callbacks. Stored labels remain text, including strings that resemble markup; notes/HTML fields are not supported expression extensions.

Optional `@zeruxjs/tags/admin-client` exports `createTagAdminClient({apiBaseUrl,csrfToken,...})`. It is DOM-free on import and makes no requests until an operation is called. Its load/save/validate/preview/status/publish/rollback/importDefinition/exportDefinition methods target fixed suffixes, always use credentialed no-store Fetch, reject redirects, bound request/response JSON to 128 KiB and default to four pending operations/10 seconds (maxima 16/30 seconds). Each accepts cancellation. `TagAdminClientError` distinguishes conflict, denial, invalid input, unavailable service, cancellation, overload and close, preserving committed/uncertain outcomes. Native pending work keeps its slot until settlement; await client.close() to abort cooperative work and drain it. Host CSRF callbacks and injected fetch implementations must cooperate with cancellation; arbitrary JavaScript cannot be forcibly stopped.

### Audit receipts and dependency failures

Durable governance history already records successful publish/rollback releases and timestamps in the same CAS document. Optional `administration.auditContext(request)` plus `audit(event)` adds host-owned durable actor auditing. Configure both together. Events are V1, with unique operationId, intent/committed/conflict phase, action, opaque tenant/actor, expected/result revision, optional rollback release and a definition hash; no names, notes, raw definitions, destination URLs, cookies or provider credentials are emitted.

A failed intent sink prevents mutation and returns 503 with `committed:false`. A postcommit sink failure returns 503 with `committed:true` and the new revision; do not retry the transition. Intent and configuration storage are separate resources, not a distributed transaction. An unresolved intent is not proof of commit. Ambiguous storage/transport failures report an unknown/uncertain outcome; reload authorized status and reconcile before any retry. A successful commit whose status read fails still returns its committed revision rather than claiming validation failure. Hosts own audit durability, idempotence/reconciliation and callback deadlines. Manager.close() drains active admin operations/audit callbacks as well as dispatch jobs before owned provider disposal; noncooperative sinks can delay close.

### Replaceable view, assets and CSS

`@zeruxjs/tags/admin-view` exports `mountTagAdmin(host,client,{slots})` and scoped `tagAdminStyles`. The optional view owns only its subtree/listeners and borrows the client. It provides labeled JSON editing, validate/save/publish/rollback controls, a live status, native keyboard interaction and conflict messages that retain unsaved edits. It does not fetch on import/mount; explicitly call view.reload(). Call view.destroy() on unmount and separately close a client you own. Host toolbar/editor slots return synchronous disposers; they are trusted UI code and cannot be stored in definitions. Partial slot setup failures remove the owned view.

Built-in CSS and headless styles expose `--tags-border`, `--tags-radius`, `--tags-focus` and `--tags-gap` where used. Preserve contrast, labels and visible focus in overrides. No positive tabindex or invented label text is used. Custom slots remain responsible for their own accessibility semantics and cleanup.

For host-built assets, `styleHref` and `scriptSrc` are independent absolute/root asset URLs with safe filenames, no query/hash/credentials or traversal. The library does not copy/build/serve them. styleHref supplements builtin styles; scriptSrc **replaces** the builtin inline client and must contain the host's actual UI entry. Authenticated HTML exposes `meta[name=zerux-tags-api]` and `meta[name=zerux-tags-csrf]` for that entry. Inline script/style hashes and explicit configured asset origins are reflected in CSP, with no unsafe-inline style exception. External module assets still require their own server's appropriate CORS/MIME policy. A separately hosted UI owns its own HTML, asset paths and CSP; do not infer its asset base from the API URL.

Qualification includes denied reads/edits/publish, exact-origin preflight/write rejection, custom mount/assets, CAS conflicts, known-release rollback, audit pre/postcommit failure, client outage/deadline ownership and jsdom stored-XSS/labels/slot cleanup fixtures. This is not live-browser, cross-domain session/cookie or assistive-technology acceptance. Those checks require a functioning browser and host-owned HTTPS session/CSRF/audit setup; no user-managed applications were started or restarted.
