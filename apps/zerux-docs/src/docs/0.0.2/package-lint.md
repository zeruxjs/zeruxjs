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
