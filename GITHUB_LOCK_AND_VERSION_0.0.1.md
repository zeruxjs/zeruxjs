# Owned packages at 0.0.1 — lockfile recovery and CI

This update is based on the manually updated `zeruxjs(1).zip` repository, after its release-tooling merge.

## What changed

- Every **52** manifest under `packages/**/package.json` is now exactly `0.0.1`, including private packages, sample packages, and the nested `packages/@zenix/core` manifest.
- All dependency ranges referring to these owned package names in package and application manifests are exactly `0.0.1`. Applications keep their own versions. Third-party package versions are not changed.
- `api-freeze.json` and `package-lock.json` **local workspace sections** reflect the approved version reset. The nested `@zenix/core` package is not a currently configured npm workspace, so it has no workspace entry in the lockfile; its own manifest is still updated and checked.
- `npm run versions:check` enforces the owned package version policy; `verify:source` and GitHub package CI include this policy.
- The cross-platform CI matrix now waits for a **single source-job lockfile gate**. This prevents six duplicate missing-lock reports. It does not bypass `npm ci`.
- The manual recovery workflow now uploads the proposed lockfile under its actual filename, `package-lock.json`, to make applying the artifact easier. It never commits or publishes on your behalf.

## Why the existing GitHub matrix failed

The root lockfile has **16 missing external npm package resolutions across 19 mandatory edges**. These include AWS SDK, email, Redis, BullMQ, and `prompts`. This was present before and after the owned-package version reset. It is not related to whether an owned package is `0.0.1` or an alpha version.

A valid lockfile must come from actual npm registry resolutions with verified integrity metadata. Do not add placeholder records or disable the strict gate.

## Required GitHub steps

1. Commit the updated repository, including all changed package manifests, `api-freeze.json`, `package-lock.json`, and CI tools.
2. In GitHub, run **Actions → Recover package-lock (manual, no publish) → Run workflow** on the updated branch. This requires access to `registry.npmjs.org`.
3. From the run's **Artifacts**, download `root-package-lock-proposal`, then extract `lockfile-proposal/package-lock.json` and copy it to the **repository root** as `package-lock.json`.
4. Review the diff, resolved versions, `resolved` HTTPS URLs and npm-generated `integrity` values. Only the version reset and genuine npm dependency resolution should be present.
5. Commit the reviewed lockfile and push it. That triggers the source gate and then Linux/Windows/macOS Node 22/24 matrix.
6. If the recovery workflow fails at a later build, **still retrieve and commit the valid proposed lockfile** and inspect the specific subsequent build error. Correct any genuine registry or peer-dependency conflicts before proceeding.

The workflow intentionally does not approve stable npm publishing. `0.0.1` is a semver release version, but **changing the manifest is not production acceptance, release authorization, or proof that the version is available on npm**.

## Local checks

```sh
npm run versions:check
npm run api:freeze:check
npm run verify:source
npm run test:workspace-tools
npm run release:graph
npm run deps:check
```

The final `deps:check` is expected to fail until you commit the registry-recovered lockfile. Running a source-only preflight does not make missing npm dependencies acceptable for publication.
