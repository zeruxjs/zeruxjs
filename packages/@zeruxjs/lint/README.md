# @zeruxjs/lint

Composable ESLint, Stylelint CSS/SCSS and Prettier runners with typed results, bounded source file discovery, and disposable watch mode.

```ts
import { lintAll, lintJs, lintCss, runPrettier, watch } from '@zeruxjs/lint';
const result = await lintAll({ cwd: process.cwd(), fix: false });
if (!result.ok) process.exitCode = 1;
const stop = await watch(async () => {
  console.log(await lintJs());
});
// stop() when no longer needed
```

`lintJs` and `lintCss` run independently. `runPrettier` recursively formats known text files while ignoring `node_modules`, build directories, symlinks, and oversized files. Without `fix`, formatting differences count as lint errors. Runners return results instead of silently printing and discarding error counts. Engine packages are explicit dependencies. Project-specific `lint.zerux.json` and JavaScript config can be loaded via `loadLintConfig`. TypeScript configs depend on the Node runtime supporting type stripping or a loader.

## CSS and SCSS linting

`lintCss()` and `runStylelint()` use Stylelint. Project Stylelint configurations, custom syntaxes and plugins are supported. If no project config exists, the packaged defaults use `stylelint-config-standard` for CSS and `stylelint-config-standard-scss` for SCSS. The SCSS configuration includes `stylelint-scss` and `postcss-scss`.

```ts
import { lintCss, runStylelint } from '@zeruxjs/lint';

const result = await lintCss({
  cwd: process.cwd(),
  files: ['src/styles'], // explicit CSS/SCSS files or directories
  cssConfigFile: 'stylelint.config.mjs', // optional; otherwise project config/defaults
  fix: false,
});
console.log(result.engine, result.errors, result.warnings); // engine: 'stylelint'
```

`configFile` is also accepted by `lintCss`. Use `cssConfigFile` to select a separate Stylelint config when calling `lintAll`. Existing Stylelint configuration formats remain supported; no Biome migration is required.

Source discovery skips symlinks and build directories and caps the file count (`maxFiles`, default 10,000). The runner supplies each source as `code` plus `codeFilename`, so input filenames are not expanded as glob expressions. Each stylesheet is limited to 5 MiB. `fix: true` writes Stylelint's fixes; read-only checks leave source files unchanged.
Reads inspect one opened regular file. Fixes reject a replaced symlink and recheck
the expected content on the same descriptor before writing; this is not a
cross-process source-editing lock. Syntax errors and configuration failures do not report a passing check.

### Dependency advisory

Upstream `braces@3.0.3` has advisory GHSA-vfj7-8cjw-p6xm. This package bundles its locked Stylelint/SCSS dependency tree with the inspected `@zklogic/braces@3.0.7` fork, which bounds brace and parenthesis nesting. The fix is included in the npm archive and requires neither a consumer override nor a post-install script. The fork adds a maintenance dependency; a zero-finding audit is not a guarantee against unknown vulnerabilities. Stylelint plugins and project configuration are trusted executable code.

Before packing, `scripts/prepare-stylelint-bundle.mjs` uses `npm ci --ignore-scripts` with the committed private `stylelint-bundle/package-lock.json`, verifies the fork version, and prepares npm's bundled dependencies. Registry/cache access may be needed during prepack. Do not bypass prepack when producing release archives.

The bundle also replaces `postcss-media-query-parser` with an independently
implemented repository-owned media-parameter adapter, because the original
distribution omits a complete license notice. The adapter preserves the
Stylelint SCSS operator-spacing interface and source offsets and includes full
MIT and Apache-2.0 license texts. It is bundled internally, requires no consumer
override or install hook, and is not a separately published package.

## Opt-in flat-config presets

Existing runners and project configuration discovery are unchanged. Presets are never adopted automatically by `lintJs`, `lintAll`, imports or framework startup. Select a flat config explicitly:

```ts
// eslint.config.mjs (JavaScript syntax; also usable in a TypeScript config)
import { createApplicationConfig } from '@zeruxjs/lint/presets';

export default await createApplicationConfig({
  environment: 'browser',
  cwd: process.cwd(),
  packages: ['zlocale'],
});
```

Install the optional `zlocale@0.0.4` peer for strict localization checks, with its supported TypeScript 5.9 extraction peer. ESLint/parser engines are already declared by this package. The strict factory loads `zlocale/build` only when selected; missing extraction dependencies reject configuration clearly, rather than silently disabling localization. The light preset does not require zlocale. No translation source is imported/evaluated to discover text.

| Public entry/export                                          | Behavior                                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@zeruxjs/lint/presets` → `createPackageConfig(options)`     | Fresh light flat-config array: recommended JS/TS parser diagnostics, unused-variable warnings, named security/ownership rules at error level; explicit `any` remains allowed |
| `@zeruxjs/lint/presets` → `createApplicationConfig(options)` | Async fresh strict array: same security errors, unused-variable errors, explicit-`any` warnings, managed package-usage errors and zlocale extraction/domain checks           |
| `@zeruxjs/lint/presets/package` default                      | Light array with universal ECMAScript globals; also exports the light factory                                                                                                |
| `@zeruxjs/lint/presets/application` default                  | Explicit strict array with universal globals; importing this entry loads the optional extractor; also exports the strict factory                                             |

`environment` is `universal` (default), `node` or `browser`; specify the actual ambient APIs rather than assuming Node and browser globals are interchangeable. Use separate file-scoped flat overrides for mixed applications. JS/JSX and TS/TSX, including `.mjs/.cjs/.mts/.cts`, are supported. TypeScript syntax uses the existing parser without a type-aware project/program. Vue SFCs, framework template compilation, React hooks and formatting are not enabled by these presets; add the appropriate native engine/plugin configuration explicitly. Native fetch/timers/DOM APIs remain valid with their declared environment; native APIs outside the explicitly selected managed-package policy remain valid.

Both presets retain `no-eval`, `no-implied-eval`, `no-new-func` and all shared `zerux/*` security/ownership rules at **error** level. Light means fewer style/type restrictions, not reduced security policy. Generated/dependency directories are ignored. Select one preset per overlapping file set, then append ordinary file-scoped overrides rather than combining separate `zerux` plugin instances. Factories return application-owned arrays; use a fresh factory when customizing instead of mutating the shared default export. Presets follow ESLint's [flat-config model](https://eslint.org/docs/latest/use/configure/configuration-files).

The cleanup rule also recognizes directly discarded `zhost` child scopes from
`launchSupervisedCommand`, `launchManagedApplication`,
`launchRollingApplication` and `launchInstanceFleet`. Retaining a handle is only a static ownership hint;
the host must still await shutdown. Inert protocol registries, watch predicates
and diagnostic-writer factories are excluded. SSE/compression factories acquire
transport resources only when subsequently used; this narrow rule does not
infer those later method calls or certify their cleanup.

### Initial named rule contracts

| Rule                                | Reported violation                                                                                                                                                      | Deliberate boundary / escape hatch                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zerux/client-server-import`        | Direct runtime import/re-export/dynamic literal import/global `require` of known server modules in a leading `'use client'` prologue or `*.client.*` file               | Node builtins, `.server` filenames and the listed server-owned package entries; erased type-only imports and shadowed `require` are excluded. It does not resolve a transitive graph or certify a browser bundle; the framework compiler remains authoritative                                                                        |
| `zerux/cleanup-ownership`           | Immediately discarded known disposer/resource factories or global `setInterval`, including `void`/await wrappers                                                        | Retain/return the handle or pass it to an explicit owner. This detects a dropped handle, not every missing eventual close; assignment is not a proof of correct disposal                                                                                                                                                              |
| `zerux/public-service-config`       | Visible credential-like keys, functions/accessors/class instances/non-JSON literals in proven framework public settings; sensitive `defineService.publicFields` entries | Inspects imported `createApplicationLifecycle({config:{publicSettings}})`, `createServiceScope(...)`, imported `defineService(...)` and default-exported `zerux.config.*` public settings. Private options and unrelated objects are untouched. It is not data-flow/secret-value analysis; runtime validation/redaction still applies |
| `zerux/package-exports`             | Literal package subpath absent or explicitly denied in a selected installed export map                                                                                  | `packages` is an explicit list (empty by default). Its manifests are read as bounded JSON, never executed. Unknown packages, packages without exports and unresolved conditions are not guessed; target existence, declaration compatibility and runtime conditions remain consumer/build checks                                      |
| `zerux/locale-text-domain` (strict) | Proven zlocale translator call without a nonempty literal call/owner domain, or a call rejected by zlocale extraction                                                   | Recognizes scoped imported `createI18n` owners, their `forLocale` views and simple method destructuring. Owner `domain: 'shop'` is sufficient. Computed/indirect wrappers and unrelated `__` methods are not inferred. Messages/context/plurals must remain extractable through the actual zlocale contract                           |

Known cleanup factories initially cover `zlook` (`startWatcher`, `watchDirectory`), `zlocale`/`zlocale/browser` (`createCatalogLoader`, `createLocaleController`), `zlocale/node` (`createRequestI18n`), `zuixs` (`injectZuix`, `zuixVite`), `zuixs/vite` (`zuixVite`), `zuixs/node` (`watchZuix`) and `@zeruxjs/validator/browser` (`createFormFeedback`). Scope resolution honors renamed/namespace imports and local shadowing. The direct-client rule includes Node builtins, `server-only`, relative `.server` modules, database/auth/files/email/queue packages, validator `/http`, zlocale `/node`/`/build`, Zuixs `/node`, zhost, framework server entries and security's Node crypto/JWT/policy entries. Pure security `/encoding` is not classified as a Node entry. This conservative list is not a substitute for actual server/client compilation checks.

No custom rule has an autofixer: imports, ownership, public projection and translation strings need a human decision. `fix: false` performs no writes; explicit fix mode still cannot invent text domains, alter credentials or rewrite arbitrary JavaScript. Other rules added by the host may supply their own fixes. Use ordinary narrowly scoped ESLint overrides or a suppression with an explanation when a reviewed case is outside the rule's contract, for example:

```js
// eslint-disable-next-line zerux/cleanup-ownership -- host process owns this intentional lifetime
setInterval(reportHealth, 30_000);
```

Config files, plugins, imported custom modules and `lint.zerux.*` JavaScript/TypeScript remain **trusted executable code**. Neither `loadLintConfig` nor a flat preset sandboxes them; JSON config is data only. Loading `lint.zerux.json` does not itself install an ESLint flat plugin configuration. Pass an explicit `configFile` to the runner or use standard ESLint discovery. Custom rules do not perform network requests, create watchers or mutate globals.

Focused qualification uses isolated source fixtures and a packed consumer, including read-only behavior, explicit suppressions, missing dependencies and declaration imports. It does not lint the repository or certify runtime authorization/tenant isolation. Stylelint's private lockfile, adapter licenses, bundled roots and real prepack preparation remain unchanged; published release archives still require that hook.

### Scoped accessibility rules

Both opt-in presets include `zerux/a11y-required-label` and `zerux/a11y-relationships` at error level. The first reports literal missing/empty label props on imported `@zeruxjs/accessibility` `applyLabelledComponentProps` calls and intrinsic JSX `dialog`/`alertdialog` roles without an authored ARIA name/title. Native button text, native labels and custom components are not forced into package APIs. Dynamic props/spreads are left for runtime validation.

Relationship checks report empty/control-character literal ID references, multi-ID `aria-activedescendant`, self active descendants, duplicate literal IDs in the same unconditional native JSX subtree and positive literal tabindex. They do not infer missing targets outside a component, cross shadow roots or resolve runtime conditional rendering. Use accessibility's runtime component contract after mounting for actual target lookup. No label/ID/tab-order autofix is supplied. Imported accessibility helper handles are also included in `zerux/cleanup-ownership`. Standard scoped ESLint suppressions remain available for reviewed cases. These checks are neither a full JSX accessibility plugin replacement nor an accessible-name/assistive-technology audit.

### Managed package usage inside this package

`zerux/package-usage` is built into `@zeruxjs/lint`; it is not another package.
The strict application preset enables it at error level. The light package
preset defaults it off so implementation adapters can legitimately use their
underlying SDKs. Enable it explicitly for a library/application's managed layer:

```js
import { createPackageConfig } from '@zeruxjs/lint/presets';

export default [
  ...createPackageConfig({ environment: 'node', packageUsage: true }),
  {
    files: ['src/native-mail-adapter.js'],
    rules: {
      // This host-owned adapter needs native transport controls; it owns teardown.
      'zerux/package-usage': ['error', { allow: ['nodemailer'] }],
    },
  },
];
```

| Direct runtime integration                                                                                          | Recommended public package/API                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `nodemailer`                                                                                                        | `@zeruxjs/email` → `createEmailManager`                                                  |
| `typescript`, `esbuild`                                                                                             | `@zeruxjs/typescript` → `transformTypescript`/`checkTypes`; `/build` → `buildTypescript` |
| `redis`, `ioredis`                                                                                                  | `@zeruxjs/cache-redis` → `createCacheHelper`                                             |
| `pg`, `mysql2`, `better-sqlite3`                                                                                    | Corresponding `@zeruxjs/db-pg`, `db-mysql`, `db-sqlite` → `createConnector`              |
| `bullmq`, `amqplib`                                                                                                 | `@zeruxjs/queue-bullmq` → `createQueueService`; `queue-rabbitmq` → `createRabbitMQ`      |
| Named `watch` import from `fs`/`fs/promises` (with optional `node:` prefix), or static namespace/default `.watch()` | `zlook` → `startWatcher`/`watchDirectory`, with explicit disposal                        |

These are capability recommendations, not equivalent signatures or full native
SDK replacements. The rule never rewrites imports, installs dependencies or
executes candidate modules. Unregistered SDKs/native primitives remain valid.
Literal imports/reexports/dynamic imports, TypeScript import-equals and unshadowed
`require` calls are checked. Erased type-only imports and local shadowing are
excluded. Computed imports, transitive wrappers and arbitrary CommonJS filesystem
member access are outside the proof. Other filesystem operations, crypto, Fetch,
streams and timers remain legitimate native primitives.

`packageUsage: false` opts a strict preset out explicitly. Prefer a file-scoped
exact-module `allow` list for genuine native integrations: allowing `nodemailer`
does not allow `nodemailer/lib/smtp-transport`. Rule options reject unknown fields
and allow at most 64 unique exceptions. Document the missing managed capability
and native resource ownership; do not bypass consent/auth/tenant boundaries.
The strict preset still requires its optional real zlocale extractor regardless
of this policy. No automatic runtime configuration, provider credentials or
browser SDK loading is introduced.

### Source maintenance and ownership

`presets.ts` owns selection, `rules*.ts` owns isolated static policy, and
`rule-ast.ts` owns conservative lexical/literal helpers. `contracts.ts` reads only
explicit installed manifests. Runners own native engine invocation;
`file-content.ts` owns descriptor-bound reads/revision checks and `watcher.ts`
owns serialized observation/disposal. Public options/results and function
contracts document bounds, returns, failure paths and trusted executable inputs.
Keep fixtures inert and preserve their exact source strings.

The nested `stylelint-bundle` is a separate private package with its own locked
inputs, license ownership and later readability review. Its contents are not
reformatted in the parent pass. The existing real prepack fixture still verifies
archive integrity, patched dependency identities and public installed exports.

### Explicit deprecation registry

`createDeprecationRegistry`, `builtInDeprecations` and `DeprecatedApi` are public
root and `/presets` exports. Other packages can export ordinary data arrays of
`DeprecatedApi` records; the host explicitly combines them in its flat config.
No dependency or source file is scanned/evaluated to discover deprecations.

```js
import {
  createPackageConfig,
  createDeprecationRegistry,
} from '@zeruxjs/lint/presets';

const deprecations = createDeprecationRegistry([
  {
    module: 'my-plugin',
    export: 'oldSend',
    kind: 'runtime',
    since: '2.0.0',
    reason: 'The old entry no longer supports the required delivery contract.',
    replacement: 'my-plugin send',
  },
]);

export default createPackageConfig({ environment: 'node', deprecations });
```

The registry is a frozen inspectable snapshot. Supply up to 128 host entries with
exact module/export names (128 total facts including builtins), bounded reason/replacement labels, optional `since`,
and `kind: 'runtime' | 'type' | 'all'` (runtime by default). `export: '*'` explicitly
retires a whole module. Duplicate host keys and unknown/accessor fields reject;
no callbacks, commands, import paths for loading code or schema URLs are accepted.
Each host entry may replace the same builtin module/export/kind key. To select
only host facts, use `includeBuiltInDeprecations: false` in the preset and
`{ includeBuiltIns: false }` when creating a standalone registry.

`zerux/deprecated-api` warns in the light preset and errors in the strict preset;
ordinary file-scoped rule overrides control severity or disable the migration
check. Recreate the owning config to add/remove entries; there is no mutable
process-global registry. Fact labels are host-reviewed public text, not a place
for secrets, prompts, source bodies or executable replacements. Changes to the
original input array/objects do not mutate an active snapshot.

Named/default imports, literal reexports, static runtime ESM namespace members and proven
CommonJS member/destructuring imports use the original export name despite local
aliases. Shadowed require/namespace bindings and computed expressions are not
inferred. Literal dynamic imports and wildcard reexports can prove module-wide
retirement only. Erased imports are checked against type/all facts rather than
runtime-only facts. Indirect wrappers, local functions, type inference and
transitive API graphs, type-only namespace qualifications and import-type expressions remain outside this syntax-only check. No replacement
is autofixed: argument/return/ownership contracts may differ.

The initial builtins cover only the source-annotated validator `NanoIDIssue` and
`NanoIDAction` type aliases on its root, `/schemas` and `/browser` entries, pointing
to `NanoIdIssue` and `NanoIdAction`. No ZeruxJS runtime function was marked
deprecated in inspected source, so none is invented. Unknown release dates are
omitted. The registry provides migration diagnostics, not proof an API was removed
or that registered external facts are accurate.

The explicit client-boundary list also includes `@zenixjs/core/cms` and `/types`, matching their browser-denied export map. Core root metadata and erased type-only imports remain allowed; this does not infer transitive module boundaries.

Accessibility cleanup acquisitions also include `createPreferenceState`,
`bindPreferenceStyles`, `createPreferencePanel`, `createSpeechController`,
`observeReducedMotion` and `onEscape`. These public helpers return destroyable
owners or exact unsubscribers. Calls retaining/returning the handle remain
valid; nested method subscription lifetimes are not inferred automatically.

AI cleanup ownership checks recognize `createAiProviderRegistry` from `@zeruxjs/ai`, `createStructuredClient` from `/structured` and `createToolExecutor` from `/tools`. Retain and close these owners. Ordinary `createAiClient` conveniences and borrowed providers are not treated as closeable acquisitions; the check does not prove eventual disposal or cancel host-owned transports.

The direct client/server import check rejects runtime `@zeruxjs/ai/tools` imports: that entry owns Node cryptography and server-authenticated execution. Erased type imports stay allowed. Root `createAiClient` remains a structural provider convenience; this rule does not claim every provider configuration is safe to expose in a browser.

AI-model ownership checks recognize `createCorpusReader` from `@zeruxjs/ai-model/corpus` and `createEvidenceRetriever` from `/evidence`. Retain/close these copied-corpus and native-job owners; assistants only borrow them. The client import rule rejects runtime root, `/corpus` and `/evidence` imports because those entries eagerly load Node persistence/cryptography. Erased types stay allowed. These checks do not infer tenant permission or prove eventual disposal.

The client import rule rejects runtime `@zeruxjs/analytics` and `/http` entries because they eagerly load Node server collection helpers. The explicit `/browser` runtime and erased types remain allowed. `createEventClient` does not return a closeable subscription owner, so it is not added to cleanup-acquisition checks. These static checks do not prove consent, tenant binding or durable delivery.

Analytics direct runtime boundaries include root, `/http`, `/email` and `/durable`; `/browser` and erased type imports remain allowed. Cleanup ownership recognizes the standalone `createAnalyticsAnalysis` and `createDurableAnalytics` factories because they expose `close()`. The borrowed `createAnalytics` manager, schema registries and store conveniences are not classified as disposer-producing APIs. These static checks do not prove authorization or actual teardown.

Asset-manager runtime boundaries cover the root (eager filesystem persistence), `/storage` and `/brand` (Node owners); erased types remain allowed. Cleanup ownership covers only `createAssetStorage` and `createBrandCatalog`, whose actual `close()` drains work. `createAssetManager` is a plain in-memory catalog with no close handle. No browser-safe root or SDK equivalence is inferred.

Auth cleanup ownership recognizes root `createSharedAuth`, `createPasskeyManager` and `createProviderLogin`: each owns active work and copied private key material with an explicit `close()`. Memory persistence, token and revocation reference stores are ordinary explicit values, not disposer-producing acquisitions. Existing direct auth runtime imports remain server-only; erased types stay allowed. Retaining a handle is only a static hint, not proof of completed cleanup or recent authentication.

Verified cache factories (`createCacheManager`, `createCacheManagerWithHelper`, `createMemoryCacheHelper`, `configureCacheManager`) return close owners and must retain their handles. Root cache and `/policy` runtime imports require Node; erased type imports stay allowed. Policy validation is not resource acquisition. No cache API is deprecated merely because scoped owners are preferred.

Memcached root and `/protocol` imports are Node-only. Its named `createMemcacheHelper` and `createCacheHelper` factories return socket owners; `validateKey` does not. Low-level client constructors are not covered by the direct factory-call ownership rule.

Redis root runtime imports require Node. Its cache/helper/limiter factories and native Cluster connection-pair factory require retained ownership; the pair owns two quit handles. `adaptIORedis` and `createBullMQRedisOptions` acquire no resource and are excluded. Native SDK use inside adapters is valid; no generic SDK replacement or deprecation is inferred.

Valkey root runtime imports require Node. Its named `createCacheHelper` and `createValkeyCacheHelper` factories require retained cleanup owners; erased types remain allowed. The rule does not inspect constructor disposal or certify injected native replay policy.

Database manager factories (`createDatabaseManager`, `configureDatabaseManager`) return owners requiring retained handles and eventual `disconnect()`. Inert pin/migration runners, tenant projections and keyset builders are excluded: construction acquires no native session. Compatible legacy spellings are not labeled deprecated without an actual declared deprecation.

Mongo `createConnector` returns a wrapper requiring retained `disconnect()` ownership even when its native client is borrowed. Query builders acquire nothing. Existing database client-boundary checks permit erased types; native driver use for BSON/client integration is not automatically a package-preference violation.

MySQL `createConnector` requires retained wrapper/disconnect ownership even with a borrowed pool. Erased pool types are permitted by the Node boundary rule. Direct native driver use is not replaced automatically: handshake, parser and pool ownership stay explicit host/adapter responsibilities.

PostgreSQL `createConnector` returns a wrapper requiring retained `disconnect()` ownership, including query-only borrowed transports with listeners/waits. Erased pool/client types remain permitted. The rule does not prove settings reset or native cancellation and does not replace valid direct driver usage.

SQL core runtime imports are Node-only, but `compileSql` and `createSqlConnector` acquire no native handle and have no disconnect owner. Cleanup ownership is deliberately not inferred for those inert compiler/borrowed-executor factories.

SQLite cleanup detection covers `createConnector` (`disconnect`) and `openSqlite` (`close`). `createSqliteExecutor` borrows its database; `createSqliteConsistentBackup` releases temporary handles before returning, so neither is classified as acquiring a persistent resource. Native database access remains valid trusted host code; retaining an owner does not prove eventual cleanup.

Email ownership detection covers `createEmailManager`/`createEmailQueue`/`createEmailReceiver` (`close`) and `resolveAttachmentScope` (`dispose`). Template/filter registries and SMTP counter projections acquire no native handles. Manager close drains actual sends; receiver close stops admission without cancelling or draining an active poll. The separate process-local queue retains its documented drain option and never becomes a durable delivery store through lint. Retaining these handles does not prove that their distinct cleanup contracts were fulfilled.

Feed root runtime imports use Node byte accounting; `/fetch` also owns Node hashing and producer cancellation. Both remain server-side under the direct-client rule, while erased public types are permitted. Only `createFeedFetchHandler` requires retained close ownership. Pure generators, low-level response descriptors, validation and XML encoding acquire no native subscription or client and are excluded. These checks do not authenticate public feed data, prove eventual drain or deprecate compatible author/enclosure fields.

Files keeps the Node/AWS storage root server-only. Its exact `/client` export is a separate browser-safe Fetch facade and is allowed in client code; unknown Files subpaths remain conservatively blocked. Erased root types remain allowed. The client borrows its transport and has no persistent close handle; callers own streaming response consumption or cancellation.

Files cleanup detection covers `createFileManager`, `createS3Storage` and `createResumableUploads`. Manager close invokes each distinct configured driver's close once but does not track every in-flight operation; the resumable coordinator drains actual admitted work and must close before its manager. S3 close awaits lazy client creation and destroys owned clients, leaving injected clients borrowed unless ownership was explicitly transferred. Local drivers, token authorizers, Fetch clients and HTTP handler factories have no persistent close handle. Retaining a handle does not prove cleanup or cancellation.

Font boundaries cover only the actual Node entries `/build` and `/http`; root/browser generation helpers remain client-importable and erased server types stay allowed. `createFontLoadScope` and `injectFontStyles` at root or `/browser` require retained disposal ownership. Registries and FontTools factory configuration are inert values, not persistent close owners. Scope cancellation ends load observation, not native font downloads; style disposal removes only the created node. No font API deprecation or network-provider equivalence is inferred.

Hooks root/subpaths are Node server entries; erased types remain allowed. Cleanup
detection recognizes actual request/state scopes, action/filter registries and the
lifecycle bus at their public root/subpath factories. Scope/component disposal is
synchronous; async action/filter owners dispose then separately drain whenIdle.
Context descriptors and path registries acquire no persistent cleanup handle and
are excluded. The rule does not prove eventual disposal, constructor/method
ownership, tenant authorization or equivalence with native AsyncLocalStorage.

Media's exact `/browser` and `/playback` entries remain client-importable; its Node root and other subpaths are server-only. Cleanup checks cover `createMediaTransfers` (`close`), `createMediaPlayback`/`createMediaControls` (`destroy`), and the asset/resumable/transcode coordinators (`close`). Disk-store and borrowed-files facades acquire no persistent handles and are excluded. A retained binding is only an ownership hint: callers still consume/cancel response bodies, revoke object-URL leases and await actual coordinator settlement. No native codec, network or storage equivalence is inferred.

Performance cleanup detection follows actual public owners: `observePerformance`/`observeWebVitals` return observer disposers, `installNavigationPrefetch` returns `destroy`, and reporters/analytics adapters require `destroy` followed by awaited `whenClosed`. Root and retained legacy timing/RUM/navigation imports preserve these ownership checks; inert collectors, schema builders, cache headers and measurements are excluded. The explicit `/response` native HTTP integration is server-only, while `/navigation` and `/analytics` remain browser-importable. Lint does not classify a route as public, obtain consent, own page-level web-vitals observers or replace the hosting compression layer.

Queue cleanup detection covers root `createQueueService`/`createQueueBackend`, `/neutral` `createQueueBackend`, and `/webhooks` `createWebhookWorkflow`/`createWebhookHttpsTransport`. Retain and await their close handles; workflow close precedes its borrowed transport/store, and neutral close drains actual calls before reverse registered cleanup. Backend selections, factory descriptors, borrowed publisher adapters and processor callbacks are inert and excluded. Original-channel acknowledgements and uncertain external effects remain runtime responsibilities, never guaranteed by a retained variable or lint result.

The direct `@zeruxjs/queue-bullmq` root also exposes `createQueueService` as a close owner, matching its compatibility facade. Inert task registries, schedulers over borrowed queues, memory reference stores and callback/report/ledger factories do not acquire a separate persistent service handle. Native worker drain deadlines and fixed shutdown counters remain runtime observations; lint cannot force-cancel a processor or certify crash recovery.

MemcacheQ ownership checks recognize `createMemcacheQ` and `createMemcacheQWorker` at the root and worker subpath. Retain the basic client for `close()`/`whenClosed()`, or the worker for `close()` and its actual-settlement `closed` promise. These checks do not add acknowledgements or recover destructive reads.

RabbitMQ ownership checks recognize the root `createRabbitMQ` and root/worker `createRabbitMQWorker` factories. Retain the returned close owner; pull delivery ack/reject handles remain tied to their original consumer channel. Retaining a service does not prove callback drain, confirmation success or exactly-once processing.

React ownership checks recognize root `createReactStore` (`destroy`), browser `mountReact`/`hydrateReact` (`unmount`), and hydration create/read state (`dispose`). Hook bindings and structural selectors/bridges borrow their sources and are excluded. Only the native `/server` entry is classified server-only; core stores, browser roots and the pure hydration codec remain usable in explicit browser bundles. Native React APIs remain valid.

Reports lifecycle checks recognize the source registry (`close`), GA4/AdSense adapters and explicit credential helpers (`dispose`), and mounted browser charts (`destroy`). The studio facade, memory definition store, borrowed-handler factory and pure definition codecs create no separate disposal owner. The root and source/provider subpaths are server-only; `/definitions` and `/view` remain permitted in explicit browser bundles. Accepted registry registration transfers adapter disposal, while credentials stay borrowed; retaining a handle alone does not prove eventual cleanup.

Security ownership checks recognize root encryption/HMAC owners (`destroy()`), JWT verifier/signer/JWKS (`close()`), and atomic memory/distributed rate-limit owners (`close()`). The same crypto/JWT factories are recognized on their public subpaths. Legacy CSRF/ordinary local limiter and inert structural policy composers are not classified as disposer factories. Pure `@zeruxjs/security/encoding` remains permitted in explicit client modules; Node-only root/crypto/policy/JWT imports retain the existing boundary checks. Retaining a handle does not prove eventual cleanup or authentication.

SEO ownership recognizes `createPublicCrawlerService` on `/public` and `createMetadataHooks` on `/composition`. Close the crawler; dispose then await `whenIdle()` for borrowed-filter drain. Legacy `/fetch` controllers/routes and fixed redirect/HTML serializers are not given an invented close contract. `/fetch`, `/public` and `/composition` are server-backed entries (native crypto/net or server hooks); the rule does not blanket-classify the legacy root serializers.

Share ownership checks recognize `createShortLinkService` only on `/server`: retain the service and await `close()` before closing its borrowed store/database. `/server` and `/sqlite` are server-only; root sharing remains browser-safe. `createSqliteShortLinkStore` borrows its native connector and has no independent close API, and browser controllers own no disposal handle. Static binding retention does not prove actual cleanup.

Tags ownership checks recognize root `createTagManager`/`createTagProviderRegistry`, `/admin-client` `createTagAdminClient` and `/admin-view` `mountTagAdmin`. Retain their actual close/destroy owners. Root imports are server-only; the browser subpaths remain client-importable. Memory document stores and inert definition/transfer helpers gain no invented disposal requirement. Static binding retention does not prove drain or authorization.

Validator ownership includes `createHttpInputAdapter` and `validatedJsonHandler` on both the root compatibility barrel and `/http`. Both retain an explicit close owner; standalone parse/read calls own only their operation and do not gain a disposal API. Browser feedback retains its separate destroy contract. Native Fetch/DOM usage remains valid, and static ownership checks never grant HTTP authorization or CSRF protection.

Framework ownership checks also recognize explicit service/application/renderer/protocol,
client, action/form, browser router, route-data cache, privacy and tab owners
at their documented public entries. Retain, return or pass these owners to host
lifecycle code. Pure renderer factories, asset projections, variable registries and
transactional outbox wrappers do not acquire an independent disposal contract.
The rule does not prove eventual cleanup or runtime tenant/authorization policy.
Browser-safe framework helpers stay admissible in client modules; Node-only
response, loader, cache, renderer, protocol, privacy and route-cache entries reject.

Module, service-endpoint and GraphQL registrations install cleanup on the supplied
generation API with `onDispose`. Their optional returned handles need not be retained
separately; standalone client and scope factories still require an explicit owner.

Zforge checks distinguish the explicit `/modules` host (`close`) and `/diagnostics`
store (`close`) from inert module/experiment definitions. Root and these optional
entries import Node owners and reject in client modules. Legacy shared registration
uses explicit unregister/server shutdown operations; it gains no invented returned
disposer. Static retention checks do not prove teardown or host authorization.
