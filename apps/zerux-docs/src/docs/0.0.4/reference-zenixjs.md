---
{
  "title": "zenixjs",
  "description": "Initial ZyroJS SSR CMS application on ZeruxJS with explicit host security.",
  "section": "Packages",
  "order": 210,
  "package": "zenixjs",
  "sources": [
    "packages/zenixjs/README.md",
    "packages/zenixjs/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Initial CMS architecture

Zenix uses ZyroJS for server-rendered UI, ZeruxJS for server routing/response ownership
and `@zenixjs/core` for authorized SQLite content/revision storage. It is not a second
frontend runtime or complete CMS. Root metadata now reports `initial-cms`; the existing
version/module format remains compatible. The separate create-zenix-js generator emits a SQLite integration scaffold; host authentication/CSRF must still be implemented.

`zenixjs/application` installs explicit login/setup/dashboard/editor/save/publish/
preview/public-page/logout routes under a configured base path. Native forms work
without JavaScript. Host persistent authentication, session cookies, CSRF/admission
policy and private setup secrets are mandatory; no administrator password is bundled.
The package's `examples/application.mjs` shows public imports and plugin disposal.

## Setup and editorial boundaries

The durable setup store claims a tenant/site once before writes. Interrupted claims
require the trusted, non-HTTP operator recovery procedure; no automatic timeout reset
or client role assertion unlocks setup. Core permissions remain authoritative.

The one title/body editor saves optimistic draft revisions; publication is a separate
authorized POST. Public pages only read the published pointer through a fixed host
read-only identity. Private previews require fresh auth plus an expiring session-bound
random nonce and are no-store/noindex. Text is rendered inert through ZyroJS; no
untrusted theme/plugin code or arbitrary HTML is executed.

## Validation scope

Fixtures use real SQLite files, synthetic host identity callbacks and an ephemeral
HTTP request through framework Fetch registration. They cover concurrent setup,
recovery, draft/public separation, stored XSS, CSRF/origin denial and cleanup. jsdom
checks authored labels, not browser or screen-reader conformance. Live identity,
proxy/TLS/cookie deployment, browser keyboard and backup qualification remain host
prerequisites. See the package README for exact routes, limits and ownership.

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
