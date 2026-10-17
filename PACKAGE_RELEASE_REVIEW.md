# Package release review

Reviewed on 2026-10-17. Scope: every package under `packages/` except names/directories starting with `sample` (47 reviewed packages; 47 release candidates including five explicit placeholders, and five sample packages remain private and unchanged).

## Changes

- Enabled public publication, added explicit distributable file allowlists and `prepack` builds, and supplied missing license files/declarations.
- Added package-local TypeScript build dependencies, registered `@zenix/core` as a workspace, and updated npm's lockfile from registry metadata.
- Corrected conditional export ordering so TypeScript sees `types` first.
- Fixed MySQL driver typings while preserving the native pool, and raised the `mysql2` dependency minimum to `3.24.6` after advisory GHSA-rgwj-5xj2-c3m3 was found.
- Updated Nodemailer to `^10.1.2` and esbuild to `^0.28.2` after checking the complete installed production graph.
- Restored Stylelint with standard CSS and SCSS configs, `stylelint-scss` and `postcss-scss`. Packaged defaults, project configuration discovery, explicit configuration overrides and autofix support CSS/SCSS consumers. Updated compatible dependencies and bundled a locked Stylelint/SCSS tree using inspected `@zklogic/braces@3.0.7`, including its nesting-depth guard. The published archive carries the fix without consumer overrides or post-install scripts. The compressed lint archive is about 2.5 MB.
- Added a checked-in JS/TS correctness lint configuration, corrected dev-client template regex escaping, scoped a Mongo switch declaration, cleaned redundant regex escapes, and documented intentional control-character filters, cleanup propagation, and optional failure handling.
- Included all five devtools runtime assets in the `zforge` archive and corrected file-URL decoding for package paths.
- Renamed `packages/zenixjs` from `zenix` to `zenixjs` as requested, avoiding an npm package owned by someone else.
- Removed obsolete AWS module shims, letting the storage package compile against real SDK declarations. Updated its existing offline client fixture to supply the configuration consumed by the real SDK uploader.
- Fixed the Zenix creator's duplicate binary name (`create-zenix`), added executable-entry shebangs to empty creator CLIs, and documented their actual placeholder status.
- Corrected release tooling for npm's array/keyed-object pack inventories, application workspace links, empty dependency maps, and normalized binary paths.
- Updated the API snapshot for the reviewed publication metadata, conditional export ordering, optional SQLite peer, new CMS workspace, and creator binary correction.

## Verified

- All 47 packages built successfully using `npm run build` from their package directories.
- All 47 produced actual npm archives. Every declared JavaScript, declaration, asset, and binary target is present; archive allowlist/security checks pass.
- All 47 current release archives installed together into a fresh npm consumer with production dependencies. Lifecycle scripts were disabled during consumer installation. This verifies installation and does not certify optional native-addon build scripts.
- 81 runtime entry-point imports and 81 TypeScript consumer imports passed against the current fresh consumer.
- Installed creator CLI links passed help/version and unavailable-generation checks in the current 47-package consumer. The three creator CLIs and two CMS packages are now public placeholders; help/version are supported, while generation requests fail explicitly.
- 31 release/build/lock tooling tests, 14 file-storage tests, 2 MySQL tests, 132 email tests, 5 TypeScript tests, and 2 lint tests passed: 186 passed, with four optional live email tests skipped.
- Manual smoke checks exercised the upgraded esbuild bundler. The restored Stylelint runner was checked for CSS/SCSS parsing, SCSS plugin rules, project configuration discovery, explicit overrides, invalid configuration, autofix, traversal, symlinks and literal brace filenames. A fresh packed-package consumer passed SCSS parser/plugin checks.
- Latest focused regressions passed: eight Mongo tests, seven auth tests, six devtools tests and two lint tests. The generated dev-client regex preserves literal dots and numeric character classes.
- JS/TS lint: 1,042 files, zero errors, 213 unused-binding warnings. Warnings remain visible and were not silently disabled.
- CSS lint: the non-sample package stylesheet passed with zero errors and zero warnings after correcting 104 initial violations.
- Explicit `tsc --noEmit` checks passed for all 47 non-sample packages.
- Source contracts, API snapshot, offline source security, complete external lock resolutions, and public dependency graph checks pass.
- Exact-version registry checks completed for all 47 final names. All returned HTTP 404 for `0.0.1`; `zenixjs` also returned 404 at the package endpoint. This does not establish publication rights for other names/scopes.
- The current fresh 47-package consumer production audit reports **zero known vulnerabilities** at every severity. Its installed Stylelint resolves the inspected patched fork, and SCSS defaults/parser/plugin and deeply nested brace/parenthesis inputs pass.
- All 47 current archive inventories pass entrypoint and file checks. Twenty-four release/API/lock tests and the two lint package tests passed after the bundle changes. The source lock is synchronized and the API snapshot matches the five public placeholder packages.

## Remaining publication decisions

The upstream [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched original release. The npm archive instead bundles a reproducible Stylelint tree using inspected `@zklogic/braces@3.0.7`; source comparison and compatibility/deep-nesting checks passed. This introduces a fork maintenance responsibility. Prepack installs the committed private bundle lock with lifecycle scripts disabled, then includes the actual dependencies in the archive. The root override also fixes local development; consumer safety was separately verified without any consumer override. [CSS and SCSS linting details](packages/@zeruxjs/lint/README.md#css-and-scss-linting).

Five packages are placeholders: `@zenix/core`, `zenixjs`, `create-zenix-js`, `create-zerux-js`, and `create-zyro-app`. The CMS modules export only `version` and `status` metadata. Creator CLIs support help/version and otherwise print an explicit unavailable message and exit with status 1 without generating files. They are public `0.0.1` placeholders, as requested, to establish the package names. No working CMS or generation implementation is claimed. Publication rights and name availability still require registry confirmation.

No package has been published. Live provider, real browser, cross-platform, and Node-version acceptance were not certified by this local release review. The repository's existing release-decision tool deliberately retains its external approval/acceptance gates.

## Release order

Publish dependencies before their consumers. Required peers are included in the ordering. Optional integrations must be available before consumers try to enable them.

| Order | Package | Directory |
| --- | --- | --- |
| 1 | `@zeruxjs/accessibility` | `packages/@zeruxjs/accessibility` |
| 2 | `@zeruxjs/ai` | `packages/@zeruxjs/ai` |
| 3 | `@zeruxjs/ai-model` | `packages/@zeruxjs/ai-model` |
| 4 | `@zeruxjs/analytics` | `packages/@zeruxjs/analytics` |
| 5 | `@zeruxjs/asset-manager` | `packages/@zeruxjs/asset-manager` |
| 6 | `@zeruxjs/auth` | `packages/@zeruxjs/auth` |
| 7 | `@zeruxjs/cache` | `packages/@zeruxjs/cache` |
| 8 | `@zeruxjs/cache-redis` | `packages/@zeruxjs/cache-redis` |
| 9 | `@zeruxjs/db` | `packages/@zeruxjs/db` |
| 10 | `@zeruxjs/db-mongo` | `packages/@zeruxjs/db-mongo` |
| 11 | `@zeruxjs/db-sql-core` | `packages/@zeruxjs/db-sql-core` |
| 12 | `@zeruxjs/db-mysql` | `packages/@zeruxjs/db-mysql` |
| 13 | `@zeruxjs/db-pg` | `packages/@zeruxjs/db-pg` |
| 14 | `@zeruxjs/db-sqlite` | `packages/@zeruxjs/db-sqllite` |
| 15 | `@zeruxjs/email` | `packages/@zeruxjs/email` |
| 16 | `@zeruxjs/feed` | `packages/@zeruxjs/feed` |
| 17 | `@zeruxjs/files` | `packages/@zeruxjs/files` |
| 18 | `@zeruxjs/font` | `packages/@zeruxjs/font` |
| 19 | `@zeruxjs/hooks` | `packages/@zeruxjs/hooks` |
| 20 | `zlook` | `packages/zlook` |
| 21 | `@zeruxjs/lint` | `packages/@zeruxjs/lint` |
| 22 | `@zeruxjs/media` | `packages/@zeruxjs/media` |
| 23 | `@zeruxjs/performance` | `packages/@zeruxjs/performance` |
| 24 | `@zeruxjs/queue` | `packages/@zeruxjs/queue` |
| 25 | `@zeruxjs/react` | `packages/@zeruxjs/react` |
| 26 | `@zeruxjs/reports` | `packages/@zeruxjs/reports` |
| 27 | `@zeruxjs/search` | `packages/@zeruxjs/search` |
| 28 | `@zeruxjs/security` | `packages/@zeruxjs/security` |
| 29 | `@zeruxjs/seo` | `packages/@zeruxjs/seo` |
| 30 | `@zeruxjs/share` | `packages/@zeruxjs/share` |
| 31 | `@zeruxjs/tags` | `packages/@zeruxjs/tags` |
| 32 | `@zeruxjs/typescript` | `packages/@zeruxjs/typescript` |
| 33 | `@zeruxjs/validator` | `packages/@zeruxjs/validator` |
| 34 | `@zeruxjs/vue` | `packages/@zeruxjs/vue` |
| 35 | `@zeruxjs/zyro` | `packages/@zeruxjs/zyro` |
| 36 | `zforge` | `packages/zforge` |
| 37 | `zclivo` | `packages/zclivo` |
| 38 | `zhost` | `packages/zhost` |
| 39 | `zeruxjs` | `packages/zeruxjs` |
| 40 | `zeyro` | `packages/zeyro` |
| 41 | `zuixs` | `packages/zuixs` |
| 42 | `zyrojs` | `packages/zyrojs` |
| 43 | `@zenix/core` | `packages/@zenix/core` |
| 44 | `zenixjs` | `packages/zenixjs` |
| 45 | `create-zenix-js` | `packages/create/create-zenix-app` |
| 46 | `create-zerux-js` | `packages/create/create-zerux-app` |
| 47 | `create-zyro-app` | `packages/create/create-zyro-app` |

## Repeat package checks

Run inside each package directory:

```sh
npm run build
npm pack --dry-run --json
```

`npm pack` runs the package's `prepack` build. Keep registry credentials outside source control. Recheck advisory results and name/version availability immediately before the actual release.

## Repeat lint and type checks

From `packages/@zeruxjs/lint`:

```sh
npm exec -- eslint --config ../../../scripts/package-lint.config.mjs .
npm exec -- tsc --noEmit
```

Use the same ESLint configuration for the other packages, adjusting its relative path to their directory depth. It applies JavaScript recommended correctness rules and TypeScript parsing; TypeScript handles undefined names, and unused bindings are warnings. Reviewed, narrow source comments preserve intentional control-character validation and cleanup failure propagation. Sample packages and generated output are excluded.

Use `lintCss({cwd, files: ['path/to/styles']})` from `@zeruxjs/lint` for CSS and SCSS. Inputs are explicit files or directories. `cssConfigFile` selects a Stylelint config when needed. See the lint package README for default configs and plugin support.
