---
{
  "title": "Linting and formatting",
  "description": "Run JavaScript, CSS/SCSS and formatting checks with structured outcomes.",
  "section": "Packages",
  "order": 32,
  "sources": [
    "packages/@zeruxjs/lint/README.md",
    "packages/@zeruxjs/lint/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/lint"
}
---

## Independent runners

```ts
import { lintJs, lintCss } from '@zeruxjs/lint';
const javascript = await lintJs({ cwd: process.cwd(), fix: false });
const styles = await lintCss({ cwd: process.cwd(), files: ['src/styles'],
  cssConfigFile: 'stylelint.config.mjs', fix: false });
if (!javascript.ok || !styles.ok) process.exitCode = 1;
```

The runners return error/warning results. Make the process exit nonzero on failed checks; do not print and discard the result. lintAll composes checks and runPrettier handles formatting.

## CSS and SCSS

Stylelint is the CSS engine. Project configs, custom syntaxes and plugins are supported. Defaults select standard CSS/SCSS configs, the SCSS plugin and parser. Inputs are explicit files/directories, not blindly expanded filename globs.

## Boundaries

Discovery skips generated directories, symlinks and oversized files with file-count bounds. Read-only mode does not apply fixes. Formatting differences count as failures without fix. Project config/plugins are executable trusted code, not safe inputs from untrusted requests.

## Watching and releases

watch returns a stop/disposer. Release prepack prepares the pinned Stylelint dependency bundle, including reviewed compatibility adapters. Keep that dependency process and license/security evidence maintained; a current zero-finding audit does not prove absence of unknown vulnerabilities.

## Install and select the integration

```sh
npm install @zeruxjs/lint@0.0.4
```

There is no automatic `lint` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Install the package in development tooling and run it from an explicit cwd. Configure ESLint, Stylelint and Prettier through their intended files; SCSS uses Stylelint syntax/plugins, not a substitute CSS engine. Use fix false for CI review and fix true only when source mutation is intentional. Consume the typed result instead of assuming no thrown error means a clean run.

## TypeScript: inputs, results and ownership

```ts
import { lintAll } from '@zeruxjs/lint';

type Inputs = Parameters<typeof lintAll>;
type Result = Awaited<ReturnType<typeof lintAll>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof lintAll>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Bound discovery by file count/size and avoid symlink traversal into unrelated workspaces. A watcher belongs to one development task and must be stopped on teardown. Plugins and configuration modules execute trusted code. An automatic fix or vulnerability audit is not proof of correct application behavior; keep typechecking and relevant runtime verification separate.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### LintOptions

| Field           | Accepted type/value | Optional |
| --------------- | ------------------- | -------- |
| `cwd`           | `string`            | Yes      |
| `fix`           | `boolean`           | Yes      |
| `files`         | `string[]`          | Yes      |
| `maxFiles`      | `number`            | Yes      |
| `quiet`         | `boolean`           | Yes      |
| `configFile`    | `string`            | Yes      |
| `cssConfigFile` | `string`            | Yes      |

### LintResult

| Field      | Accepted type/value                     | Optional |
| ---------- | --------------------------------------- | -------- |
| `engine`   | `'eslint' \| 'stylelint' \| 'prettier'` | No       |
| `scanned`  | `number`                                | No       |
| `errors`   | `number`                                | No       |
| `warnings` | `number`                                | No       |
| `changed`  | `number`                                | No       |
| `output`   | `string`                                | No       |
| `ok`       | `boolean`                               | No       |

### CombinedLintResult

| Field      | Accepted type/value | Optional |
| ---------- | ------------------- | -------- |
| `results`  | `LintResult[]`      | No       |
| `ok`       | `boolean`           | No       |
| `errors`   | `number`            | No       |
| `warnings` | `number`            | No       |

## Managed package policy

The strict application preset now enables the internal `zerux/package-usage` rule. It recommends verified public ZeruxJS APIs for direct managed SDK integrations (for example, Nodemailer to `@zeruxjs/email` `createEmailManager`). The light preset leaves it off; select `createPackageConfig({ environment: "node", packageUsage: true })` for a managed layer. Native primitives remain valid unless a concrete overlapping operation such as filesystem watching is detected. Type-only imports and shadowed calls are excluded. Exact file-scoped allowlists support native adapters; no autofix or dependency installation is performed. See the package README for the supported mapping and ownership limits.

## Registered API deprecations

Use `createDeprecationRegistry` from `@zeruxjs/lint` or `/presets` to validate/snapshot explicit `{ module, export, reason, replacement?, since?, kind? }` records. Pass them as `deprecations` to either preset; other packages can export data arrays for hosts to combine explicitly. `zerux/deprecated-api` warns in the light preset and errors in the strict preset. The frozen registry is inspectable and has no global mutation or automatic source/dependency execution. Type-only deprecations remain distinct from runtime functions; source-verified validator type aliases are the initial builtin facts. Configure `includeBuiltInDeprecations: false` or file-scoped severity overrides when a reviewed migration policy needs them. No autofix or blanket deprecation claim is made.

The client/server import rule includes the source-verified Node-only `@zenixjs/core/cms` and `/types` entries (their export maps deny browser resolution). Core root metadata and erased type-only imports remain allowed; this check still does not resolve a transitive bundle graph.

The cleanup-ownership rule also recognizes discarded accessibility handles from `createPreferenceState`, `bindPreferenceStyles`, `createPreferencePanel`, `createSpeechController`, `observeReducedMotion` and `onEscape`. Retain and dispose each owned handle; retaining a value satisfies only the static ownership check, not proof of runtime cleanup. Panels borrow preference and speech owners, which the host disposes separately.

AI cleanup ownership checks recognize `createAiProviderRegistry` from `@zeruxjs/ai`, `createStructuredClient` from `/structured` and `createToolExecutor` from `/tools`. Retain and close these owners. Ordinary `createAiClient` conveniences and borrowed providers are not treated as closeable acquisitions; the check does not prove eventual disposal or cancel host-owned transports.

The direct client/server import check rejects runtime `@zeruxjs/ai/tools` imports: that entry owns Node cryptography and server-authenticated execution. Erased type imports stay allowed. Root `createAiClient` remains a structural provider convenience; this rule does not claim every provider configuration is safe to expose in a browser.

AI-model ownership checks recognize `createCorpusReader` from `@zeruxjs/ai-model/corpus` and `createEvidenceRetriever` from `/evidence`. Retain/close these copied-corpus and native-job owners; assistants only borrow them. The client import rule rejects runtime root, `/corpus` and `/evidence` imports because those entries eagerly load Node persistence/cryptography. Erased types stay allowed. These checks do not infer tenant permission or prove eventual disposal.

The client import rule rejects runtime `@zeruxjs/analytics` and `/http` entries because they eagerly load Node server collection helpers. The explicit `/browser` runtime and erased types remain allowed. `createEventClient` does not return a closeable subscription owner, so it is not added to cleanup-acquisition checks. These static checks do not prove consent, tenant binding or durable delivery.

Analytics direct runtime boundaries include root, `/http`, `/email` and `/durable`; `/browser` and erased type imports remain allowed. Cleanup ownership recognizes the standalone `createAnalyticsAnalysis` and `createDurableAnalytics` factories because they expose `close()`. The borrowed `createAnalytics` manager, schema registries and store conveniences are not classified as disposer-producing APIs. These static checks do not prove authorization or actual teardown.

Asset-manager runtime boundaries cover the root (eager filesystem persistence), `/storage` and `/brand` (Node owners); erased types remain allowed. Cleanup ownership covers only `createAssetStorage` and `createBrandCatalog`, whose actual `close()` drains work. `createAssetManager` is a plain in-memory catalog with no close handle. No browser-safe root or SDK equivalence is inferred.

Auth cleanup ownership recognizes root `createSharedAuth`, `createPasskeyManager` and `createProviderLogin`: each owns active work and copied private key material with an explicit `close()`. Memory persistence, token and revocation reference stores are ordinary explicit values, not disposer-producing acquisitions. Existing direct auth runtime imports remain server-only; erased types stay allowed. Retaining a handle is only a static hint, not proof of completed cleanup or recent authentication.
