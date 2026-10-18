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


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.
