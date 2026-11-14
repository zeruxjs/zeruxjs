# Stylelint security bundle

Private build input for the lint package. The pinned dependency tree replaces vulnerable `braces` with the inspected `@zklogic/braces@3.0.7` fork. `npm ci --ignore-scripts` prepares the dependencies that npm bundles in the parent archive. This directory is not published independently.

The SCSS media-query parser is replaced by the repository-owned adapter archive
in `vendor/`, with complete MIT and Apache-2.0 notices. The adapter is internal
and bundled, and needs no separate registry publication. The override references
the private build's explicit local dependency; bundle preparation mirrors the
repository layout so its archive path resolves identically.
The adapter's private compatibility version is `0.2.3`, satisfying the plugin's
existing dependency range. Public package versions are defined in their own manifests.

## Ownership and maintenance

This directory contains only the private manifest, lockfile and this guide. It has
no public entry point or authored runtime to format. Installed dependency trees,
the reviewed [adapter source and notices](../../../../vendor/scss-media-parser/README.md)
and its deterministic archive retain their own bytes and license requirements.
Do not reformat them as package source or replace pinned versions merely to make
a readability check pass.

The parent package's [prepack preparation](../scripts/prepare-stylelint-bundle.ts)
owns the executable integration. It mirrors repository depth in an owned temporary
directory so the local archive path resolves correctly, runs the locked npm
installation with dependency scripts disabled, verifies the reviewed braces and
media-parser identities, then copies the prepared dependency tree into the parent
package. Its `finally` removes the owned temporary directory even on failure.
The parent `prepack` hook runs preparation before its TypeScript build; consumers
do not rely on their own npm overrides applying transitively.

Bundle preparation can install dependencies and copy package-local build inputs.
Invoke it only for an intentional parent packaging operation. A documentation or
readability pass can verify committed manifest/lock/archive integrity, notices and
the existing adapter diagnostics without running preparation or regenerating the
archive. This private package is never published separately.

## Public usage

Use the parent package's supported API rather than importing this private helper:

```ts
import { lintCss } from '@zeruxjs/lint';

// The caller owns this project and explicitly chooses read-only checking.
const result = await lintCss({ files: ['src/style.scss'], fix: false });
console.log(result.ok);
```

The host owns configuration trust: JavaScript configs and registered native
plugins execute trusted code. No lint operation starts on import. Explicit fixes
are separate from read-only checking, and diagnostics can contain private source
paths; do not expose them as public HTTP errors. The SCSS media adapter implements
only the interface used by the reviewed rule, not a general media-query AST.
