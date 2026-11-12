# zenixjs

Initial opt-in CMS application: **ZyroJS UI + ZeruxJS server runtime + Zenix domain
core**. `zenixjs/application` renders actual ZyroJS static HTML through the ZeruxJS
renderer registry and installs explicit framework Fetch routes. It does not implement
another server, authentication protocol or frontend runtime. Native forms work with
JavaScript disabled; hydration, browser bundles, dashboards beyond this one editor,
plugin discovery and complete CMS parity are not supplied.

Root metadata keeps `version = "0.0.4"`; `status` is now `"initial-cms"` and
`capabilities` lists the delivered scope. The metadata entry retains its CommonJS
format; new Node-only application/setup-store entries use ESM. Importing them opens
no connections or listeners. No automatic config key is added; the separate generator requires explicit host policy integration.

## Explicit startup

[Public-import example](examples/application.mjs) creates a file-backed core and
setup store, installs routes into a trusted ZeruxJS plugin API and registers cleanup.
All identity, secrets, CSRF and provider settings must be private host configuration,
not public build manifests or request-supplied objects. Supply these contracts:

- A borrowed `@zenixjs/core/cms` instance and fixed tenant/site/entry ID. Its
  `resolvePrincipal` verifies fresh host session proof and actual auth-owned permissions.
- A durable `zenix-setup-cas-v1` store. `createSqliteSetupStore` uses the existing
  native synchronous SQLite transaction facade on a **qualified file-backed** borrowed
  connector. `migrate:true` is explicit startup approval for its v1 table; otherwise
  an existing compatible table is required. Never use a volatile store in production.
- Exact `origin`, explicit `basePath` (for example `/cms`, or `/` for root mounting),
  and a private least-privilege `publicPrincipal` accepted by the core for read-only
  published content in that site. Public requests cannot select this identity.
- Host `authenticate`, `login` and `logout` callbacks using persistent sessions,
  plus an action-specific `authorize` callback. No default account/password exists.
- Host CSRF `issue`/`verify`, login/setup admission limits, a constant-time
  `verifySetupSecret`, and fresh privileged `authorizeRecovery` proof verification.

`authenticate` returns `{principal,key}` only after verification; key is a nonsecret
opaque session binding, not a raw cookie, email or client role. `principal` is passed
to the core and revalidated there. `login` checks the submitted credentials with the
configured host identity system; it returns one reviewed session `cookie`, never a
browser role claim. `logout` returns an expiry cookie. Production cookies must use
appropriate Secure/HttpOnly/SameSite/path policy. CSRF issuance can return a cookie
for anonymous login/setup sessions; verification must bind the token to the actual
request/session. The fixture's synthetic secrets and always-allowed callbacks are
not production auth implementations.

This application does not create identity-provider accounts: the host provisions a
privileged setup operator separately and supplies its login/session system, such as
`@zeruxjs/auth` persistence. Roles alone are never authentication. Host rate limits
must bound credential and setup-secret attempts across replicas. Request callbacks
receive cancellation through the Request signal and must own dependency deadlines.
No live identity provider or production session adapter is bundled or qualified.

## Routes and editorial workflow

For base `/cms`, installed exact routes are:

| Path | Behavior |
| --- | --- |
| `/cms/login` | GET/HEAD host-backed login form; POST checks Origin, anonymous CSRF and admission |
| `/cms/setup` | Authenticated privileged GET/POST setup; host secret, CSRF, Origin and durable unique claim |
| `/cms/admin` | Authorized dashboard for the one configured entry |
| `/cms/editor` | Authorized title/body editor, current optimistic revision and saved-preview action |
| `/cms/save` | POST validated title/body draft with expected head; no remote executable functions |
| `/cms/publish` | POST separate authorization and exact expected saved revision |
| `/cms/preview` | POST creates private saved-revision preview; GET/HEAD requires fresh auth and session-bound nonce |
| `/cms/page` | GET/HEAD only the published revision; drafts are never a fallback |
| `/cms/logout` | CSRF/Origin-protected POST host session termination |

The initial immutable content type is `article@1` with required title (200 characters)
and plain-text body (8192 characters). This is one editor/theme, not arbitrary schema
or rich HTML editing. Core permissions gate every read/write/publication. Draft saves
retain the prior published pointer; stale expected revisions return 409. All state
changes are POST. Body input is bounded URL-encoded form data, with duplicate/unknown
fields and file/multipart uploads rejected. Invalid input/denials use fixed messages,
not echoed passwords, secrets, database paths or private causes.

The basic theme renders only saved title/body as escaped ZyroJS text. Optional
`theme.brand` pins an existing asset-manager `BrandVersion` reference (version/asset/
hash), and exposes only its version marker. It does not infer authorship, load brand
notes/HTML, edit brand rules, fetch logos or grant binary access. Theme names remain
inert. Media upload/editor controls are not supplied; core media references continue
to require the core's host files ownership/version/hash authorization callback.
There is no arbitrary theme/plugin code loading from content or browser settings;
unknown application configuration rejects.

## One-time setup and trusted recovery

Setup initializes the configured site and `article@1` using the already authenticated,
privileged host operator. Before any content write it atomically claims the unique
hashed tenant/site key. The durable record contains only scope/claim references,
state, revision and time, never setup secrets or credentials. Parallel setup requests
cannot both claim; a completed setup cannot run again, including after process restart.
No application password or public administrator role is created by setup.

The SQLite implementation uses an immediate transaction for create-if-absent and
claim/revision-bound completion. Core writes and setup completion are **separate
transactions**. A crash or failure after claim leaves state `claimed`: retries and
GET setup return conflict, not a guessed expired lock or automatic takeover.

Only the non-HTTP `recoverSetup(session,evidence)` API can continue. The host must
verify fresh operator privilege and proof bound to that claim in `authorizeRecovery`,
record its own restricted audit evidence and reconcile dependencies. Recovery checks
existing site/schema against the expected configuration, creates only missing pieces
and conditionally completes the original claim. Incompatible records require trusted
manual investigation; no browser role string, old setup secret, timer or public route
resets the record. Do not delete a live claim to retry after an uncertain outcome.
The host owns secret rotation, filesystem permissions, storage retention and backups.
Hashing references does not anonymize operator/tenant records.

## Privacy, origin and output boundaries

All responses use the existing production security-policy composer, no-store,
no-referrer and private cache headers. Administrative/login/setup/preview responses
also carry noindex/nofollow/noarchive. No inline scripts/styles are needed, no session
or form state is serialized into a hydration payload, and CSP is never weakened from
request headers. Published responses omit noindex but remain no-store in this initial
implementation. There is no cache invalidation or CDN privacy promise.

The framework Fetch adapter intentionally gives handlers a neutral URL. `install`
therefore checks the direct Host against the configured exact authority, then binds
only that reviewed origin; forwarded identity/host/proto headers never establish
trust. Every POST additionally requires the exact Origin and host CSRF validation.
Reverse proxies must preserve/review that direct authority themselves; arbitrary
cross-origin admin hosting and wildcard CORS are unavailable. Calling `handle`
directly requires the embedding host to enforce the same transport boundary.

Previews are random 256-bit nonces bound to a verified session key and an immutable
saved revision, expire after 60 seconds, and require fresh preview authorization and
core access on every request. There are at most 128 live previews per application.
A nonce alone or a public entry slug is insufficient. Preview state is private/process
local and cleared on teardown/reload; it is not a public bearer link. Hosts must redact
preview query values from external request logs. Expiry/revocation cannot recall bytes
already delivered. Core/domain authorization remains the authority for storage access.

## Accessibility, resource ownership and checks

UI controls have authored labels/native form semantics, a skip link, headings,
explicit buttons and bounded plain text. Accessibility prop contracts are used for
control names and DOM fixtures validate the actual labels/relationships. No overlay,
positive tabindex, manufactured label or conformance certification is claimed. Normal
browser keyboard/form behavior is retained; live keyboard/screen-reader checks remain
outstanding. Current tests use jsdom emulation, not a real browser.

Each application owns its renderer registry, HTTP reader slots, abort scope and
preview map. Maximum pending handlers/readers is eight; body size is 20 KB, fields
six, field bytes 10 KB, input deadline three seconds, rendered HTML 128 KiB and renderer
deadline five seconds. Fully rendered HTML is sent through the framework Fetch response
owner, which owns downstream streaming/backpressure/disconnect cleanup; this is not
progressive component streaming or hydration. Host callbacks/core writes cooperate
with cancellation; abort never proves rollback or permits automatic mutation replay.

Await application close before core/store/database shutdown. It rejects admission,
cancels owned request/reader scopes, clears preview capabilities, drains actual handlers
and closes the renderer. Borrowed CMS/auth/setup stores stay host-owned. No app/server
is started, stopped or restarted on import. The public example registers this order
through framework plugin disposal.

Build with `npm run build --workspace=zenixjs`; focused checks:
`node --test packages/zenixjs/test/application.test.mjs`. Native SQLite fixtures check
concurrent/repeated setup, privileged recovery, denied editor/CSRF/origin, duplicate
fields, draft privacy, stored XSS, publication, labels, cleanup and an actual ephemeral
HTTP request through the ZeruxJS Fetch registration. They use synthetic accounts/data.
Production authentication, durable storage/backup qualification, real proxy/TLS/cookie
integration, browser keyboard use and assistive technology remain host prerequisites.

## Project generator and license

[`create-zenix-js`](../create/create-zenix-app/README.md) generates a JavaScript SQLite integration scaffold with explicit migration and unconfigured-host startup diagnostics. It does not supply a production identity provider or default credentials. Installing the application alone does not run generation. License: MIT OR Apache-2.0.

## Explicit owners and inert metadata

```js
import { version, status, capabilities } from 'zenixjs';

console.log({ version, status, capabilities });
// Importing metadata opens no database, session service or HTTP listener.
```

Use the package's public `examples/application.mjs` to install the application
from a trusted host plugin. Its database/core/application cleanup order is explicit;
private authentication and CSRF implementations must be supplied separately.
`createZenixApplication` owns request admission, readers, previews and its renderer.
`createSqliteSetupStore` borrows the qualified connector and has no invented close
method. Close the application before shutting down the borrowed core/store/database.

The setup claim and CMS content writes are separate transactions. A failed or lost
response after claiming setup does not authorize automatic retry or claim deletion.
Use fresh operator proof and the original claim's recovery procedure. A preview
nonce still requires fresh session/core authorization, expires locally and does not
recall bytes already delivered. Keep private query tokens out of host access logs.

Authorization and parsing are separate: strict form schemas require the authored
fields, but only host/session/core policy authorizes a write. Rendered text and
fixed response messages do not include submitted passwords, setup secrets or private
causes. Metadata flags describe the current baseline, not a certification of production
identity, browser accessibility, distributed atomicity or complete CMS capability.
