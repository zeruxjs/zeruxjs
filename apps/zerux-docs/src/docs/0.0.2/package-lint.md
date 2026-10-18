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
npm install @zeruxjs/lint@0.0.2
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

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `cwd` | `string` | Yes |
| `fix` | `boolean` | Yes |
| `files` | `string[]` | Yes |
| `maxFiles` | `number` | Yes |
| `quiet` | `boolean` | Yes |
| `configFile` | `string` | Yes |
| `cssConfigFile` | `string` | Yes |

### LintResult

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `engine` | `'eslint' \| 'stylelint' \| 'prettier'` | No |
| `scanned` | `number` | No |
| `errors` | `number` | No |
| `warnings` | `number` | No |
| `changed` | `number` | No |
| `output` | `string` | No |
| `ok` | `boolean` | No |

### CombinedLintResult

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `results` | `LintResult[]` | No |
| `ok` | `boolean` | No |
| `errors` | `number` | No |
| `warnings` | `number` | No |
