# ZeruxJS local integration app

A **ZeruxJS framework application with ZyroJS UI**, built around services that run
locally. It is not a CMS. AI/model packages are excluded. The existing runtime,
worker, route and middleware examples remain available alongside `/workspace`.

The app uses public package imports. It does not dynamically execute package
exports, uploaded files, note text, email content, model output or protocol arguments.
It does not require Redis, MySQL, an S3 server, a remote search engine or API keys.
External integrations are not simulated as successful services.

## Run the local profile

Use Node **24.15+** and the repository's npm workspace installation. Build the
required library dependencies first if their `dist` output is missing; the workspace
build script resolves that ordering. Do not run the complete workspace test suite.

1. From this application directory, run `npm run workspace:configure -- --origin
http://localhost:3010 --username operator --tenant local --site main` on one line.
   The zclivo-backed operator helper reads a hidden password (at least 16 characters),
   generates independent session/pepper keys and atomically creates `.env.local` at
   mode `0600`. It never overwrites an existing file, prints credentials, installs
   packages, creates a database or starts the app. `--dry-run` reads no password
   and writes nothing. Automation can supply one UTF-8 password line on stdin;
   plaintext password flags are rejected.
2. Alternatively, use `.env.workspace.example` with an operator-created
   `hashPassword` scrypt record from `@zeruxjs/auth`, a stable independent
   `randomBytes(32).toString('base64url')` key and the same private
   `SECURITY_PASSWORD_SALT` during hashing and verification. No plaintext password
   belongs in an environment example, source or command history.
3. Run `npm run workspace:init`. This explicit operator command initializes the
   local schemas; it neither creates a default password nor connects to an external
   provider. Startup later requires the initialized private directory.
4. Run `npm run dev` yourself and open `/workspace` at the configured origin.
   For browser-source changes, use `npm run watch:assets` in a separate terminal;
   its zlook subscriptions exclude generated output/private state, coalesce bursts,
   retain prior assets on errors and dispose on Ctrl-C. Default dev port is **3010**.
   If occupied, choose a free port with `zerux dev -p <port>` and update
   `WORKSPACE_ORIGIN`; never stop another app. The default profile binds direct
   loopback HTTP and does not start or modify the shared portless proxy. Set
   `ENABLE_PORTLESS_PROXY=true` only to opt into that separately managed proxy;
   an unverifiable PID marker remains an operator recovery issue, never a reason
   to kill an unknown process or remove its ownership evidence.

Development uses Node's native TypeScript stripping. App classes use explicit
fields rather than parameter properties. The CLI's project-scoped source loader
maps missing local `.js`/`.mjs` imports to `.ts`/`.mts` sources; real JavaScript
files take precedence. This is not a general TypeScript/JSX transpiler.

The framework loads its configured environment files for dev/start. The initialization
command deliberately uses `.env.local`; use the same settings for all commands.
`npm run build` prepares browser assets and creates the normal framework production
build. `npm run start` uses that build. These instructions do not authorize a tool to
restart a running application.

The optional old MySQL demonstration is enabled only by `ENABLE_MYSQL_DEMO=true`
and its existing `DB_*` settings. It uses its separate legacy database, not the
workspace SQLite database. Keep legacy playground/demo endpoints on a development
host; workspace session checks do not retroactively protect every old example.
The obsolete unused root `apiKeys` config field was removed because the framework
now rejects unregistered configuration keys.

The runtime examples explicitly register `app/middleware`, `app/controllers` and
`app/composables` in `structure`; the framework defaults look in root directories.
`/api/echo` includes a native POST form, `/plugin/workers` runs a real thread-worker
calculation, and `/index.html` mounts the standalone counter from `client/counter.ts`.
The counter is bundled from the installed ZyroJS package during `build:assets`,
uses local system fonts and disposes its root on page exit. The optional MySQL page
shows setup instructions while disabled; there is no `db:init` command. Its table
is created on the first enabled API request. Build `@zeruxjs/db-mysql` and its
dependencies before enabling that example.

When `WORKSPACE_ENABLED` is not `true`, `/workspace` and `/workspace/login`
return the setup-required page with HTTP 503. Login and other workspace operations
become available only after configuration, explicit initialization and startup.

## Implemented local workflows

| Page                                                | Actual behavior and package owners                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workspace/login`                                  | Operator login using auth scrypt verification, application-owned SQLite `auth-cas-v1` persistence, one-hour opaque sessions, persisted attempt admission and session-bound CSRF.                                                                                                       |
| `/workspace/notes`                                  | SQLite notebook, bounded plain text, at most 100 notes per tenant/site, optimistic edit conflicts, private by default and explicit public visibility. Ordinary POST forms work without JavaScript. This is not the Zenix CMS.                                                          |
| `/workspace/files`                                  | Named files manager with a local provider, tenant/site object prefixes, private create-only text objects and authenticated attachment downloads. Local S3-style addressing is not an AWS wire server.                                                                                  |
| `/workspace/assets`                                 | Asset-manager/files integration: storage before metadata, SHA-256 verified downloads, immutable version IDs and SQLite catalog snapshot CAS. At most 100 returned version records; concurrent metadata conflict retains a recorded orphan candidate.                                   |
| `/workspace/search`                                 | Weighted Unicode local search over explicitly public notes, deterministic package ranking and bounded query/results. No remote engine or private-note fallback.                                                                                                                        |
| `/workspace/public`                                 | Escaped public-note board, with `/workspace/feed.xml`, `/workspace/feed.json` and `/workspace/sitemap.xml` derived from persisted public facts and timestamps. Feed ETags, HEAD and conditional GET are supported.                                                                     |
| `/workspace/share`                                  | Persistent short-link reservations through the share SQLite adapter. Generated high-entropy slugs, fixed public-board destinations, 302 redirects and one-day expiry. Click analytics are disabled.                                                                                    |
| `/workspace/reports`                                | Explicitly consented sample events, versioned analytics dimensions/units, SQLite numeric facts, exact database aggregate counts, native table fallback and a replaceable Reports browser view. No automatic visitor collection.                                                        |
| `/workspace/tags`                                   | A fixed trusted version-1 container, explicit consent and durable request-ID reservation; only a local analytics sink. No remote destination, executable configuration, draft editor or publish endpoint is enabled.                                                                   |
| `/workspace/email`                                  | Escaped email-template composition and inert source/plain-text previews. No SMTP connection, marketing send, tracking pixel or inbox operation.                                                                                                                                        |
| `/workspace/experiments`                            | Authenticated local evaluation with three named variants and a pinned salt/version. Consent is required, identity is server-bound and assignment is stateless. No exposure recording or statistical significance claim.                                                                |
| `/workspace/lab`                                    | ZyroJS signals/computed values, an explicit observable renderer bridge, standalone React/Vue store interoperability, English/Hindi/Arabic demo messages with RTL, scoped accessibility preferences and user-triggered generated PCM/WAV playback. No React/Vue DOM runtime is started. |
| `/workspace/performance`                            | Bounded process-local cache counters and observations from the single zhost compression owner. `/workspace/measure-response` serves a repeatable synthetic payload via performance's response integration. No browser-vitals collection or guaranteed performance gain.                |
| `/workspace/diagnostics`                            | Actual framework lifecycle counters from hooks, with generation-owned registrations. No retained headers, bodies, raw paths or user traits.                                                                                                                                            |
| `/playground`, `/plugin/runtime`, `/plugin/workers` | Existing framework routing, middleware, controller, composable, plugin, startup-worker and Node thread-worker demonstrations.                                                                                                                                                          |

The browser lab uses `@zeruxjs/react` and `@zeruxjs/vue` **standalone stores only**.
Its page is rendered by ZyroJS. It does not claim framework hydration, SFC compilation,
React/Vue SSR parity or support for arbitrary browser codecs.

Zuixs generates explicit utility CSS at build time. Font's structured SVG encoder
produces the authored local mark; system fallback fonts are used, with no font
redistribution or remote download. `zclivo`, `zlook`, `zhost`, `zforge`, lint and
TypeScript remain in their real CLI/watch/hosting/development/build ownership paths;
packages are not imported into the browser merely to inflate coverage.

## Authenticated protocol lab

`/workspace/protocols` shows the current session's CSRF token and the supported
endpoint matrix. Each endpoint uses the actual `zhost/protocols` gateway, with a
fixed origin, fresh session check, at most eight active requests, 16 KiB input limit
and a five-second deadline. POST also requires the exact `Origin` and
`X-CSRF-Token`; loopback does not bypass authorization.

| Endpoint                            | Implemented protocol                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/rpc`                              | JSON-RPC 2.0, `workspace.summary`, empty arguments only.                                                                                             |
| `/mcp`                              | MCP initialization, `workspace_summary` tool and a fixed capability resource. `Accept` must include both `application/json` and `text/event-stream`. |
| `/events`                           | SSE, bounded package backlog, metadata-only `note.saved` events; clients must reconnect after the finite connection deadline.                        |
| `/workspace.Notebook/Summary`       | Connect unary JSON subset.                                                                                                                           |
| `/workspace.Notebook/SummaryStream` | Connect framed JSON subset, at most four input messages.                                                                                             |
| `/trpc/workspace.summary`           | tRPC-style JSON subset, not the complete tRPC framework.                                                                                             |

These are read-only registered operations. They cannot run commands, import
packages, fetch model-provided URLs or evaluate stored content. Native gRPC, QUIC,
WebTransport, HTTP/2 forwarding and WebSocket upgrade adapters need their actual
hosting integrations; this app does not pretend that naming a route implements them.

## State, security and ownership

`.workspace/` is private, ignored and outside `public/`. Existing directory ancestors,
database and storage roots reject symlinks. The directory must be mode `0700`, the
main SQLite file is `0600`, and native SQL uses fixed statements with parameters.
SQLite WAL/SHM files stay inside that private directory. The operator owns backups,
disk quotas, retention and recovery. Do not point this directory at a shared/public
volume controlled by another user.

Authentication, CSRF, notebook records, file prefixes, catalogs, analytics and short
links bind to fixed host tenant/site context. Request parameters never select a
principal, tenant or site. Production requires HTTPS; insecure HTTP is restricted to
explicit loopback origins. Forwarded headers do not change the reviewed origin.
Cookies are HttpOnly/SameSite=Strict and use `__Host-`/Secure on HTTPS. No default
credentials, stored password plaintext, remote preference collection or automatic
speech activation is supplied. Cross-origin administration is not enabled.

Operational pages and downloads are private/no-store. All lab pages, including the anonymous public-note board, are marked noindex.
HTML uses a per-response
style nonce, self-only external scripts, no inline event attributes, no framing and
no raw note HTML. The audio lab explicitly permits owned `blob:` media. Preferences
are scoped to the main container, respect reduced motion/forced colors, have reset
and are not persisted. Page teardown releases subscriptions, styles, listeners and
media object URLs. Browser back/forward restoration reinstalls owned UI scopes.

The framework consumes `server.watchIgnoredPaths: [".workspace"]`: private database
and object writes are excluded from source scans and cannot trigger reload loops.
These paths stay out of public configuration.

Cache budget/read/write failures fall back to SQLite rather than fail valid
public reads.

The memory cache is bounded and process-local, not durable. Publication invalidates
its local key; another process can retain public data for at most 15 seconds.
Private notes are not cached. Catalog snapshots use durable CAS, not a claim of
atomicity across SQLite and the filesystem. A failure after binary commit can leave
an orphan, including when storage/journal persistence is unavailable. The asset page
reports recorded candidates; no automatic deletion/repair of live files is performed.

All module resources belong to the plugin generation. Startup failure and close drain
actual pending work, unregister lifecycle observers, cancel protocol/compression/input
owners and close owned services before the SQLite connection. Cleanup attempts all
owners even if one fails. UI button disabling is only duplicate-submit feedback:
notebook revisions and create-only writes enforce their own conflicts, and arbitrary
mutations are never automatically retried.

## Coverage limits

This app is an integration consumer, **not exhaustive coverage of every exported
function**. External-only database/cache/search/broker adapters require real servers
and are not included as fake local backends. Queue delivery, durable webhook/email
sending, remote reports, transcoding, resumable binary transfers, passkey/OAuth login,
provider plugins and generator execution are not wired into these workflows.
Generators are development tools, not server endpoints that execute generated code.
Zenix CMS packages are not used for this application; AI packages remain excluded.
No new private sample package is needed for the current diagnostics, so the existing
sample modules remain unchanged.

## Validation and public-import examples

From the application directory:

```sh
npm run check
npm run check:workspace
npm run build:assets
npm run test:workspace
npm run build
# Optional installed Chrome; owned temporary app/profile/database only:
npm run check:browser
```

`check:browser` first builds the app, then copies its production output into an
owned temporary fixture and mounts the real framework routes, plugins, middleware
and workers. It checks the static counter, local page/API availability, login,
protocol calls, reports and the browser lab. External MySQL is always disabled in
this synthetic fixture. It does not start or restart the operator's application.

The full app check covers legacy and new TypeScript sources without generated
virtual database declarations. The optional MySQL demo resolves its connection
only when invoked; it returns an unavailable error when disabled. The additional
workspace check isolates the new modules and plugin. The application build checks
the real production source graph. The framework's focused production-build
regression test covers safe bundled CommonJS export data versus actual Node globals.
No live provider, broker, SMTP or assistive-technology qualification is implied.

A minimal browser island using public imports (mount into `<div id="counter"></div>`):

```ts
import { h, defineComponent, signal } from 'zyrojs/component';
import { mount, unmount } from 'zyrojs/dom';

// Local browser owner: attach only to an explicit app container.
const count = signal(0);
const Counter = defineComponent(() => () =>
  h('button', { type: 'button', onClick: () => { count.value++; } }, count.value)
);
const host = document.querySelector('#counter');
if (host) {
  mount(h(Counter, null), host);
  window.addEventListener('pagehide', () => unmount(host), { once: true });
}
```

See `lib/workspace/application.ts` for service ownership, `client/workspace.ts` for disposable
browser integrations and `test/workspace.test.ts` for isolated full request flows.
Build APIs follow [esbuild's JavaScript API](https://esbuild.github.io/api/#build);
SQLite behavior is exercised on Node 24.15; the [official SQLite reference](https://nodejs.org/api/sqlite.html) describes the current upstream API, not a claim that every
future Node SQLite API is supported.

Authored browser code lives in `client/workspace.ts`, outside the framework’s
server source roots. The explicit asset build bundles it into the validated public
client asset; no authored browser module is imported during Node startup.
