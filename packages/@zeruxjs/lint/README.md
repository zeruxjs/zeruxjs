# @zeruxjs/lint

Composable ESLint, Stylelint CSS/SCSS and Prettier runners with typed results, bounded source file discovery, and disposable watch mode.

```ts
import { lintAll, lintJs, lintCss, runPrettier, watch } from '@zeruxjs/lint';
const result = await lintAll({ cwd: process.cwd(), fix: false });
if (!result.ok) process.exitCode = 1;
const stop = await watch(async () => { console.log(await lintJs()); });
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
  fix: false
});
console.log(result.engine, result.errors, result.warnings); // engine: 'stylelint'
```

`configFile` is also accepted by `lintCss`. Use `cssConfigFile` to select a separate Stylelint config when calling `lintAll`. Existing Stylelint configuration formats remain supported; no Biome migration is required.

Source discovery skips symlinks and build directories and caps the file count (`maxFiles`, default 10,000). The runner supplies each source as `code` plus `codeFilename`, so input filenames are not expanded as glob expressions. Each stylesheet is limited to 5 MiB. `fix: true` writes Stylelint's fixes; read-only checks leave source files unchanged. Syntax errors and configuration failures do not report a passing check.

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

| Public entry/export | Behavior |
| --- | --- |
| `@zeruxjs/lint/presets` → `createPackageConfig(options)` | Fresh light flat-config array: recommended JS/TS parser diagnostics, unused-variable warnings, named security/ownership rules at error level; explicit `any` remains allowed |
| `@zeruxjs/lint/presets` → `createApplicationConfig(options)` | Async fresh strict array: same security errors, unused-variable errors, explicit-`any` warnings and zlocale extraction/domain checks |
| `@zeruxjs/lint/presets/package` default | Light array with universal ECMAScript globals; also exports the light factory |
| `@zeruxjs/lint/presets/application` default | Explicit strict array with universal globals; importing this entry loads the optional extractor; also exports the strict factory |

`environment` is `universal` (default), `node` or `browser`; specify the actual ambient APIs rather than assuming Node and browser globals are interchangeable. Use separate file-scoped flat overrides for mixed applications. JS/JSX and TS/TSX, including `.mjs/.cjs/.mts/.cts`, are supported. TypeScript syntax uses the existing parser without a type-aware project/program. Vue SFCs, framework template compilation, React hooks and formatting are not enabled by these presets; add the appropriate native engine/plugin configuration explicitly. Native fetch/timers/DOM APIs remain valid with their declared environment; no rule forces a framework equivalent.

Both presets retain `no-eval`, `no-implied-eval`, `no-new-func` and all shared `zerux/*` security/ownership rules at **error** level. Light means fewer style/type restrictions, not reduced security policy. Generated/dependency directories are ignored. Select one preset per overlapping file set, then append ordinary file-scoped overrides rather than combining separate `zerux` plugin instances. Factories return application-owned arrays; use a fresh factory when customizing instead of mutating the shared default export. Presets follow ESLint's [flat-config model](https://eslint.org/docs/latest/use/configure/configuration-files).

### Initial named rule contracts

| Rule | Reported violation | Deliberate boundary / escape hatch |
| --- | --- | --- |
| `zerux/client-server-import` | Direct runtime import/re-export/dynamic literal import/global `require` of known server modules in a leading `'use client'` prologue or `*.client.*` file | Node builtins, `.server` filenames and the listed server-owned package entries; erased type-only imports and shadowed `require` are excluded. It does not resolve a transitive graph or certify a browser bundle; the framework compiler remains authoritative |
| `zerux/cleanup-ownership` | Immediately discarded known disposer/resource factories or global `setInterval`, including `void`/await wrappers | Retain/return the handle or pass it to an explicit owner. This detects a dropped handle, not every missing eventual close; assignment is not a proof of correct disposal |
| `zerux/public-service-config` | Visible credential-like keys, functions/accessors/class instances/non-JSON literals in proven framework public settings; sensitive `defineService.publicFields` entries | Inspects imported `createApplicationLifecycle({config:{publicSettings}})`, `createServiceScope(...)`, imported `defineService(...)` and default-exported `zerux.config.*` public settings. Private options and unrelated objects are untouched. It is not data-flow/secret-value analysis; runtime validation/redaction still applies |
| `zerux/package-exports` | Literal package subpath absent or explicitly denied in a selected installed export map | `packages` is an explicit list (empty by default). Its manifests are read as bounded JSON, never executed. Unknown packages, packages without exports and unresolved conditions are not guessed; target existence, declaration compatibility and runtime conditions remain consumer/build checks |
| `zerux/locale-text-domain` (strict) | Proven zlocale translator call without a nonempty literal call/owner domain, or a call rejected by zlocale extraction | Recognizes scoped imported `createI18n` owners, their `forLocale` views and simple method destructuring. Owner `domain: 'shop'` is sufficient. Computed/indirect wrappers and unrelated `__` methods are not inferred. Messages/context/plurals must remain extractable through the actual zlocale contract |

Known cleanup factories initially cover `zlook` (`startWatcher`, `watchDirectory`), `zlocale`/`zlocale/browser` (`createCatalogLoader`, `createLocaleController`), `zlocale/node` (`createRequestI18n`), `zuixs` (`injectZuix`), `zuixs/node` (`watchZuix`) and `@zeruxjs/validator/browser` (`createFormFeedback`). Scope resolution honors renamed/namespace imports and local shadowing. The direct-client rule includes Node builtins, `server-only`, relative `.server` modules, database/auth/files/email/queue packages, validator `/http`, zlocale `/node`/`/build`, Zuixs `/node`, zhost, framework server entries and security's Node crypto/JWT/policy entries. Pure security `/encoding` is not classified as a Node entry. This conservative list is not a substitute for actual server/client compilation checks.

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
