# zforge

The development toolkit used by the ZeruxJS hosting integration. `zforge` provides the foundational infrastructure for developer tools, including the shared dev server, dev-client injection, and the devtools module registry.

## Core Capabilities

- **Shared Dev Server**: Orchestrates a single devtools server that can handle multiple Zdev applications simultaneously.
- **Client Injection**: Automatically injects development scripts and overlays into HTML responses during development mode.
- **Module Registry**: A flexible system to register and manage devtools modules, complete with API and WebSocket handlers.
- **Event Bus**: A robust event broadcaster for hot-updates and real-time communication between the server and the browser.
- **Security boundaries**: Security helpers provide encoding, file-path checks and document policy. Hosts still supply authentication and access controls; optional transport modules require explicit authorization callbacks.

## Key APIs

### App Registration

```typescript
import { registerSharedDevApp } from 'zforge';

const devInfo = await registerSharedDevApp({
    appName: 'my-app',
    appPort: 3000,
    rootDir: process.cwd(),
    devtools: { modules: [], frameAncestors: ['http://localhost:3000'] }
});
```

### Client Injection

```typescript
import { injectDevClient } from 'zforge';

const polyfilledHtml = injectDevClient(originalHtml, {
    routeName: 'my-app',
    serviceName: 'dev',
    devPortLessAlias: { value: null },
    devServerUrl: 'http://localhost:4000'
});
```

### Module Definition

```typescript
import { defineDevtoolsModule } from 'zforge';

export default defineDevtoolsModule({
    name: 'my-module',
    // ... config and handlers
});
```

## Internal Architecture

`zforge` is designed to be the "brain" behind the Zdev development experience. It manages the lifecycle of the dev server and provides the bridge between the framework's internal services and the developer-facing dashboard.

---

<p align="center">
  Part of the Zdev Monorepo.
</p>

## Request boundaries

The HTTP devtools server enforces a 1 MiB streamed request-body limit via `src/request.ts`, with cleanup on completion, failure, or aborted requests. Local development hostname checks reject crafted authorities. Focused tests: `node --experimental-strip-types --test test/request.test.ts` after building. Devtools should be restricted to trusted networks; configure firewall and proxy access appropriately.

### Security and live reload diagnostics

The shared development server is loopback-only by default. To listen on a different interface, set `ZDEV_BIND_HOST` **only with trusted access controls**, such as an authenticated reverse proxy. Devtools and its APIs are not an Internet-facing administration service.

State and registry JSON files are private, bounded, atomic and reject symlink destinations. Client HTML injection escapes script-breaking values. Snapshot and bootstrap JSON include a `reload` status object containing the attempt count, generation and last failure message when available.

## Document policy and framing

Development devtools pages allow same-origin framing by default. Cross-origin
embedding now requires exact canonical origins in the registration's
`devtools.frameAncestors` list (HTTP(S), no wildcard/path/credentials). Registration
validates the list before writing registry state. Existing allowedDomains routing
rules and untrusted Origin/Referer/Host headers never grant framing. Configure the
parent application's frame-src separately; both sides must permit the embed.
Theme synchronization additionally checks the actual parent window and exact
origin. Messages target same-origin or explicitly approved development ancestors;
there is no wildcard postMessage target or trust derived from a request header.

`createDevtoolsDocumentPolicy({mode, frameAncestors})` is a public, side-effect-free
per-document helper, defaulting to production. Each call returns fresh nonce and
frozen headers. The server uses development unless NODE_ENV is production; production
ignores all development framing grants and keeps frame-ancestors none, XFO DENY,
COOP same-origin, COEP require-corp and CORP same-origin. Development explicitly
allows inline UI styles/data images/fonts and uses COEP unsafe-none to support the
development document; these choices never follow a browser error or request header.
No development server access/authentication is implied by a framing grant.

Manual `injectDevClient` accepts an optional trusted response-owned `nonce`. It
validates and attribute-escapes that nonce without inspecting/replacing CSP. The
application must approve required styles, WebSocket connections and devtools frames
itself. Nonced scripts do not automatically authorize dynamically created styles or
inline style attributes. The shared document renderer uses the same nonce as its
response header. Reuse it only within that response, including streamed chunks.
Zhost's automatic injector skips enforced-CSP and explicitly flushed responses.
See [security policy ownership](../@zeruxjs/security/README.md#structural-application-policy).
Run `node --experimental-strip-types --test test/framing-policy.test.ts test/state-injection.test.ts` after
building; these are Node checks, not browser framing/isolation verification.

## Scoped transport modules and request diagnostics

`zforge/modules` is an explicit opt-in host, separate from the legacy shared UI,
HTTP/WS registries and file module loader. Inject the actual `zhost/protocols`
exports; type-only optional peers avoid a runtime dependency cycle. Merely
importing these entries starts no listener. See [public example](examples/modules.ts).

| Declaration | Actual implementation                | Limits                                                             |
| ----------- | ------------------------------------ | ------------------------------------------------------------------ |
| `sse`       | zhost HTTP `/events`, bounded replay | Server-to-client JSON `update` events; no client commands          |
| `mcp`       | zhost HTTP `/mcp`                    | Stateless JSON tool subset; not full MCP/stdio/subscription parity |
| `grpc`      | Unavailable                          | Rejected before startup; a name is not an implementation           |

Every endpoint requires message/concurrency/time limits, a host authentication
callback and an exact origin allowlist. Missing Origin supports authenticated
non-browser clients; supplied Origin must match. Loopback is the default, not an
authentication mechanism. Remote binds additionally require an explicit public
origin and host-owned TLS/egress/access controls. Host is checked directly;
forwarded headers never grant identity or proxy trust. MCP clients must advertise
both `application/json` and `text/event-stream`. Each tool also authorizes its
arguments against the initiating verified principal and receives cancellation and
a deadline. The host must return a subject and expiry no more than five minutes
away. Connections expire at the earlier auth expiry/endpoint timeout; reconnect
requires fresh authorization. There is no silent authorization refresh.

Endpoints own separate listeners; addresses are returned after startup. Duplicate
binds fail through zhost registration/startup. Setup disposal callbacks run LIFO.
Startup failure rolls back listeners and acquired setup resources. Replacement
first disables and drains the old module, closes streams/sockets and then starts
the candidate; failed replacement does not resurrect privileged old connections.
Dispose handles are generation-fenced. Await `dispose`, `unload` or host `close`.
Cancellation is cooperative: teardown waits for actual handler settlement and
cannot force-stop arbitrary JavaScript. No process supervision is added.

SSE history defaults to eight events (maximum 32), clients to the declared
concurrency, and slow consumers are disconnected by zhost backpressure policy.
Output is default-deny JSON: only explicit `publicFields` survive, sensitive key
names always disappear, and depth/size/count budgets apply. Approved field values
must already be public; field names cannot detect a secret disguised as a count.
Responses are no-store. Do not use module endpoints as an unrestricted proxy.

`zforge/diagnostics` consumes the real `zeruxjs` RequestSpan/TracingAdapter contract.
Activate each application generation or create its adapter, then pass that adapter
to framework observability. Default retention is 100 records/256 KiB/15 minutes
per explicitly named app; generation replacement clears old records and fences late
exports. Route labels are allowlisted, headers retain only MIME/length, bodies are
omitted unless the host explicitly approves primitive fields, and errors retain
only normalized fixed codes. No request body stream is read or persisted. The
optional section/table escapes output; mount/read it only behind host authorization.
It does not install an auth layer in the legacy shared server. Existing private
atomic state and script-safe client injection remain separate owners.

Focused Node checks: `node --experimental-strip-types --test test/*.test.ts` after `npm run build`.
Ephemeral real HTTP/SSE/MCP fixtures cover denial, bounded replay, startup rollback,
reload disconnect and real framework span export. These do not qualify browser UI,
remote TLS/proxy deployments or native gRPC.

## Development experiment inspection

`zforge/experiments` supplies `createExperimentInspectionModule`, an opt-in consumer
of the injected public `ztrial/experiments` evaluator. Register its returned module
with `createDevtoolsModuleHost`; no global module or UI is silently replaced. See
[public example](examples/experiments.ts). The optional ztrial peer is type-only
until the host injects its factory. Production mode rejects before acquiring resources.

The MCP tools are `experiment.inspect`, `experiment.preview` and `experiment.test`.
They accept a declared experiment ID; preview additionally requires a declared
variant and integer `ttlMs` (1–60000), test a host-registered test name (maximum 16).
No source code, arbitrary role/group, subject, tenant or targeting traits are accepted.
Host authentication identifies the operator; `resolveContext` independently binds
that operator to the evaluation tenant/subject/environment/consent. The shared
evaluator's denied decisions remain denied. Explanations expose only approved
experiment/version/variant/algorithm/reason and finite variant weights.

Every tool requires host action authorization. Preview and test additionally require
POST, an explicit matching Origin and a successful host `verifyCsrf(request, context)`
callback. The module host still authenticates each request; loopback never bypasses
these checks. Browser cookie sessions need real session-bound CSRF verification,
not an always-true callback. Policy callbacks are trusted server code.

Preview returns `previewOnly:true` with expiry capped by the operator credential and
request deadline. It is a display result, never installed in an assignment store or
applied to production traffic. Consumers must discard it on expiry. There is no
persistent override/capability token, background timer or production override API.
Inspection owns a separate bounded stateless evaluator with recording disabled;
store, recording and assignment override options reject. Consequently `preserve`
catalog migrations requiring durable history are unsupported here and fail closed;
this view does not claim to reproduce a production sticky assignment. Consent is
still checked by ztrial, and no preview/test analytics are emitted.

Tests are explicit host callbacks, not test-runner discovery or arbitrary model/client
commands. They receive cancellation and return only a boolean, with no raw logs or
artifacts. Host code must cooperate with deadlines and avoid privileged side effects
unless separately authorized. Required audit callbacks receive authorized/completed/
failed metadata with operator reference, application/generation/epoch, time and preview
expiry, but no private evaluation identities, traits or payloads. Audit failure is
explicit and prevents subsequent execution when it occurs before dispatch; a terminal
sink failure cannot undo a test callback that already ran. Store audit records privately.

Create a fresh definition for every load. Setup acquires the evaluator; unload/reload
aborts/drains handlers through the module host and closes its owned evaluator. Late
results are rejected, old handles cannot dispose replacements, and imported definitions
start no work. Existing custom sections/components can render these headless results;
no browser dashboard or statistical significance claim is added.

## Building from workspace source

Use `node --experimental-strip-types scripts/build-workspaces.ts --scope zforge` from the repository root for a clean checkout. The manifest's repository-only `workspaceBuild` metadata selects `build:core` first, then builds the declared zhost/ZeruxJS owners and runs the normal full `build`. Both TypeScript configurations inherit strict checking. The core entry does not import the optional modules/diagnostics/experiments entries; the final pass must compile those entries successfully before the workspace build succeeds.

This resolves the source dependency cycle without duplicating transport/tracing types or adding eager runtime dependencies. `build:core` alone is an intermediate developer step, not a complete package/archive build. `npm run build` and prepack remain the full compiler check once prerequisite declarations exist. Invalid bootstrap metadata and either compilation-stage failure reject the build; the planner does not run applications or listeners. Optional peers remain host-selected for consumers of the compiled package.

## Ownership and maintenance boundaries

The legacy shared server, module/API/channel maps and short-lived module cache are
process-wide compatibility state. Registration does not create an independent
returned disposer: unregister explicit registrations and close the shared server
through its owning hosting lifecycle. Port probes release their listeners before
returning and do not reserve a port; native listener startup remains authoritative.
Private registry replacement is atomic at the file boundary, not a distributed
registration transaction. Keep module configuration and callback code trusted.

Request-body reads retain only their own native listeners, remove them on every
terminal outcome and pause oversized/failed sources without taking socket ownership.
State JSON uses bounded descriptor reads, exclusive same-directory temporary files
and private file permissions. Missing files may use an explicit fallback; corrupt,
oversized and unsafe leaves reject. Parsed state still requires consumer-owned schema
validation. Log inspection reads at most the trailing 256 KiB and returns a bounded
line suffix rather than a complete log export.

Optional module hosts own actual native transport startup, rollback and awaited
teardown; diagnostics stores independently own their retained records. Experiment
inspection definitions remain inert until setup acquires their evaluator. These
scoped contracts differ from the legacy browser client: that client retains caches,
listeners, native sockets and trusted module mounts for the page lifetime and exposes
no aggregate teardown API. A module socket facade borrows the page socket, so its
`close()` is intentionally inert. Do not treat these facades as independent owners or
claim that shadow DOM isolates executable plugin code.

The package examples use public imports and explicit host callbacks. Focused Node
fixtures cover denied policies, dependency failures, socket/iterator cleanup,
private file boundaries and generation fencing. DOM/VM fixtures execute only known
package-authored programs and do not qualify remote browser, TLS or assistive
technology behavior. Source comments distinguish these ownership limits from
future features; the component/import panels remain informational placeholders.
