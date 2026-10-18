# Linting and formatting

Run JavaScript, CSS/SCSS and formatting checks with structured outcomes.


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

There is no automatic `lint` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/zeruxjs/docs/0.0.2/configuration-reference.md) and [TypeScript](/zeruxjs/docs/0.0.2/typescript.md).

## A practical integration workflow

Install the package in development tooling and run it from an explicit cwd. Configure ESLint, Stylelint and Prettier through their intended files; SCSS uses Stylelint syntax/plugins, not a substitute CSS engine. Use fix false for CI review and fix true only when source mutation is intentional. Consume the typed result instead of assuming no thrown error means a clean run.

## TypeScript: inputs, results and ownership

```ts
import { lintAll } from '@zeruxjs/lint';

type Inputs = Parameters<typeof lintAll>;
type Result = Awaited<ReturnType<typeof lintAll>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof lintAll>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.2/typescript.md) for the complete NodeNext checker configuration.

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


## Public entry points

Manifest reference for `@zeruxjs/lint@0.0.2`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./files": {
      "types": "./dist/files.d.ts",
      "import": "./dist/files.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@eslint/js": "^9.39.4",
    "eslint": "^9.39.4",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-prettier": "^5.5.5",
    "eslint-plugin-react": "^7.37.5",
    "eslint-plugin-vue": "^10.8.0",
    "globals": "^17.4.0",
    "postcss-scss": "4.0.9",
    "prettier": "^3.8.1",
    "stylelint": "17.16.0",
    "stylelint-config-standard": "40.0.0",
    "stylelint-config-standard-scss": "17.0.0",
    "stylelint-scss": "7.3.0",
    "typescript-eslint": "^8.57.0",
    "zlook": "0.0.2"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

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

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/lint/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/lint/README.md)
- [packages/@zeruxjs/lint/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/lint/package.json)
