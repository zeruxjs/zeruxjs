# Renderer registration and module boundaries

Select an explicit server renderer and publish a checked browser ESM graph without mixing UI runtimes.


## Generation-owned server renderers

Register a renderer through `api.renderers()` in an explicit entry/plugin and call
`context.render(registration, view)` from a route. `zeruxjs/renderers` exports typed
contexts, registrations/results, diagnostics and injected Zyro/React/Vue static
factories. The package README contains the runnable public-import Zyro example and
capability matrix. Existing route responses remain compatible; no loader, filename
or installed package registers a renderer implicitly.

Static factories call their supplied runtime's own server renderer. The observable
bridge packages remain separate APIs. Hydration/client-only features are unavailable,
and custom streaming adapters must declare and own their async source. Contexts,
local maps and cancellation are per render/request; generation disposal drains
actual work before dependent services. UI runtimes never share a DOM mount root or
an implicit request store. Native React/Vue and browser acceptance require separately
installed/configured runtimes, not just injected function tests.

## Closed local client graphs

Build classification uses TypeScript's syntax tree and valid leading directives,
plus explicit client/server filename conventions. It follows imports/re-exports
transitively, rejecting server services, Node globals, private server modules and
opaque dynamic imports from browser graphs. Server-to-client entry imports reject;
there is no RSC protocol. Neutral helpers can be shared, while browser-only app
entries are excluded from server route execution.

The emitter deliberately supports local ESM modules, not an automatic npm/browser
bundler, Vue SFC compiler or hydration pipeline. Explicit host transforms receive
server/client environment metadata and their output is checked again. Diagnostics
show the real import chain. Classification does not grant authorization or detect
arbitrary hardcoded secret strings; HTTP tenant/auth/consent policies remain required.

## Deterministic staged artifacts

The private server manifest holds hashes, partitions, local imports and server-file/
client-URL mappings. The minimal public projection holds only asset URLs, integrity,
size, kind and entry URLs. Browser modules use graph-hashed opaque paths under the
configured public root and their local imports are rewritten to actual emitted
assets. No request data or credentials are serialized automatically.

Build publication is atomic: failed compilation or boundary validation preserves
the previous successful build. The package README describes exact graph/resource
limits, unsupported features and disposal semantics. Local tests exercise installed
Zyro HTML, normal routes, request isolation, linked ESM assets and production static
serving; they do not establish browser hydration or vendor/framework parity.

## HTTP document composition

`createZyroDocumentRenderer` and `createRenderAssets` in `zeruxjs/renderers`
connect injected Zyro SSR to private HTTP documents and named emitted assets.
Document streaming sends already-rendered component HTML with backpressure; it
is not incremental component execution. The host creates one security-policy
response/nonce per document, chooses trusted layouts and pre-commit boundaries,
and projects public props through Zyro's validator. Optional V1 hydration requires
an explicitly prebundled leading-client ESM entry and its exact manifest integrity.
The compiler does not bundle bare package imports. Other renderers remain opt-in.

Streams now expose an awaited completion promise. A failure before the first
nonempty chunk leaves headers mutable for sanitized framework errors; after the
first write, errors terminate the connection. Disconnect/HEAD return owned sources,
and close drains actual cooperative work. Documents are no-store, and stream
headers cannot override no-store/no-transform. Failed candidate startup or build
keeps the last good generation/artifacts. The docs app retains its own exporter.
See the package README's complete public-import plugin and hydration instructions.
Local HTTP, emitted-client/jsdom and packed-declaration checks are distinct from
real-browser CSP/form/navigation acceptance.

## Explicit generic static export

`zeruxjs/static-export` provides a separate `exportStaticSite` API. It exports only
explicit public pages and finite validated parameter tuples through a request-free,
static-HTML-only renderer. Private data, request context access, server actions,
forms and scripts reject. Mounted canonical URLs, public asset hashes, a real 404
artifact and redirect/status hosting metadata are emitted deterministically.

Candidates stage inside the project with path/symlink checks and an exclusive lock.
Failed enumeration/rendering leaves the previous export intact; edited or unowned
output is not overwritten. Mixed mode marks unlisted routes as requiring the Node
server; it is not a static-host server-function runtime or universal SPA fallback.
The docs app keeps its own exporter, and `zerux build/start` retain Node behavior.
The package README gives a public-import ZyroJS example, asset selection, budgets,
callback trust assumptions and provider hosting responsibilities.


## Implementation sources

- [packages/zeruxjs/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/README.md)
- [packages/zeruxjs/src/renderers.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/renderers.ts)
- [packages/zeruxjs/src/commands/project-builder.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/commands/project-builder.ts)
