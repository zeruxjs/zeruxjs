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
