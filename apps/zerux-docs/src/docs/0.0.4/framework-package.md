---
{
  "title": "The zeruxjs package",
  "description": "Install the framework and choose its public entry points intentionally.",
  "section": "API reference",
  "order": 75,
  "package": "zeruxjs",
  "sources": [
    "packages/zeruxjs/package.json",
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/cache-api.ts"
  ],
  "related": [
    "mental-model",
    "api",
    "configuration-reference"
  ]
}
---

## Responsibilities

The main package coordinates configuration, application module discovery, HTTP dispatch, services, workers and builds. Ecosystem packages provide focused functionality. Installing the main package does not automatically turn every optional package into a configured service.

## Installation and application commands

```sh
npm install zeruxjs@0.0.4 @zeruxjs/typescript@0.0.4
npx zerux dev
npx zerux build
npx zerux start
```

Run commands inside your application directory. Configure infrastructure and domains before deployment. Use the implemented [SSR generator](reference-create-zerux-js.md), manual installation guide or tutorial.

## Root exports

Import public types and helpers from zeruxjs: ZeruxConfig, ZeruxPluginApi, ZeruxRequestContext, startup/thread-worker helpers, HttpError, logger/Logger, navigation, cache/stream responses, protocol factories, metrics, Fetch bridge helpers, service lifecycle functions, application build helpers and template variables. Prefer the focused subpath when it makes a runtime dependency explicit.

## Focused entry points

| Import                | Responsibility                                                     |
| --------------------- | ------------------------------------------------------------------ |
| zeruxjs/navigation    | Redirect responses and supported redirect codes                    |
| zeruxjs/response      | HTTP cache policies and bounded streams                            |
| zeruxjs/fetch-route   | Web Request/Response interoperability                              |
| zeruxjs/theme         | Theme preferences and HTML integration                             |
| zeruxjs/accessibility | Accessible tab enhancement and reduced-motion helper               |
| zeruxjs/variables     | Explicit interpolation registries                                  |
| zeruxjs/build         | Application source compilation and production structure resolution |
| zeruxjs/services      | Service scope and lifecycle startup types/functions                |
| zeruxjs/protocols     | Protocol registration facade                                       |
| zeruxjs/cache         | Active cache facade convenience exports                            |

The complete export map below includes other low-level bootstrap/loader paths and the configuration schema. They are advanced integration surfaces, not additional automatic application features.

## Cache and service ownership

zeruxjs/cache reexports active-manager convenience methods from the cache package. For explicit multi-application/generation ownership, use the manager supplied through api.service or context.services.get instead of assuming a process-active facade is request-local. Construct standalone managers when the caller owns shutdown.

## Build contract and boundaries

The server compiler stages application modules and public assets; it does not promise a generic static export, a typecheck or arbitrary external worker-file compilation. The production resolver uses a valid build manifest when present and can fall back to source configuration when absent. Verify your artifact and built path explicitly.

React/Vue state adapters, standalone Zyro rendering and host-configured CMS/generator packages have separate contracts. Use the capability map and task guides rather than interpreting a roadmap statement as an implemented framework integration.

## TypeScript configuration and service access

Use `ZeruxConfig` for application setup and narrower nested types for each configured service. The [configuration handbook](configuration-reference.md) maps every declared setting to its actual consumer and startup policy. A root extension key is not automatic service initialization.

```ts
import type { ZeruxConfig, ZeruxRequestContext, ZeruxPluginApi } from 'zeruxjs';
const config = { type: 'fix', cache: { connector: 'memory', prefix: 'application' } } satisfies ZeruxConfig;
type Context = ZeruxRequestContext;
type Plugin = (api: ZeruxPluginApi) => void;
```

Service managers are generation-owned and can be disabled/degraded. Use their concrete factory return type for typed lookup and check availability; do not turn optional access into an unchecked non-null assertion. The [TypeScript guide](typescript.md) explains strict NodeNext configuration, unknown-data validation and virtual-import boundaries.

## Production verification path

Create one route, run development, build, then start the compiled application. Verify its host policy and configured infrastructure before adding more services. Read the [production checklist](production-checklist.md), [service lifecycle](service-lifecycle.md) and [configuration entry point](zerux-config.md). Source README roadmap statements do not replace these implemented contracts.

## Coordinated subject privacy operations

The optional Node-only `zeruxjs/privacy` entry exposes a headless host-authorized
coordinator. Explicit participants declare find/export/erase coverage and exclusions;
no subject identity, object ownership or remote erasure capability is inferred from
an email, service name or report source. The package README lists actual service
contracts and missing host mappings.

Jobs require verified subject linkage, per-operation authorization, preview pages,
expiring approval evidence and a durable private CAS/checkpoint journal. Resume
rechecks authorization and processes one bounded participant page. Local page
receipts must be durable/idempotent with effects; uncertain outcomes recover receipts
rather than automatically repeating deletion. Retained holds, inaccessible providers
and backups remain visible as partial coverage. No cross-store transaction or legal
compliance guarantee is implied.

Private expiring JSONL exports use approved projections and bounded streams, with
per-chunk authorization/expiry checks and no public URLs. Host routes still own
CSRF/authentication, private attachment headers and disconnect cleanup. The public
`examples/privacy.mjs` demonstrates explicit injection. Synthetic fixtures verify
checkpoint recovery and partial completion; no real user-data deletion was run.

## Local integration hosts

`server.watchIgnoredPaths` accepts up to 64 project-relative directories, such as
`[".workspace"]`, and is omitted from public config. ZeruxJS forwards these
exclusions and its runtime directory to zhost before source scanning. This is
watch policy, not file authorization.

Trusted plugins can obtain the optional borrowed host bus through
`api.lifecycleHooks?.()`. Register observers only when a host supplied the bus and
remove their tokens with `api.onDispose`; `getConfig()` deliberately does not expose
the private lifecycle authority. No bus is created implicitly.

Prebundled browser assets may use local `{exports:{}}` wrapper data. That does not
permit free `exports`, `module`, `require` or `globalThis.exports` in client graphs.
