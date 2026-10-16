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

## Required GitHub steps (one-click proposal)

1. Commit and push this updated repository, including the revised `.github/workflows/package-lock-recovery.yml`.
2. In GitHub open **Push this updated recovery workflow to `master`, `dev` or `test` for an automatic proposal, or use Actions → Recover package-lock (manual, no publish) → Run workflow** on the desired branch, leaving **open_pull_request=true**. This recovery job has scoped `contents: write` and `pull-requests: write`; normal package CI remains read-only.
3. The recovery job runs real npm registry resolution, then `npm run deps:check`, and immediately uploads `root-package-lock-proposal` containing the root `package-lock.json`. If the lock changed, the job attempts to push a new `automation/npm-lock-recovery-<run-id>` branch and open a PR against the triggering branch. **It never force-pushes, directly commits to the source branch, or publishes npm packages. It also dispatches candidate CI explicitly; commits pushed by `GITHUB_TOKEN` do not normally trigger workflows automatically.**
4. Review the PR diff (only `package-lock.json`) and its actual npm versions, HTTPS `resolved` URLs and integrity hashes. The separate **Prove resolved lockfile can install and build** job downloads exactly this proposed lockfile, runs clean `npm ci`, build, and consumer checks. Wait for and address those results before merging.
5. If no PR appears, review the workflow log. In repository **Settings → Actions → General → Workflow permissions**, allow GitHub Actions to create pull requests if permitted by your organization. Even without PR permissions the `root-package-lock-proposal` artifact can be downloaded and committed manually. Do not share GitHub tokens or npm credentials in chat.
6. Merge the reviewed PR or commit the reviewed proposed lockfile. The previous **Source and security contracts** job is correctly red until this happens. Automatic recovery only proposes real resolved metadata; it does not mark CI green before the reviewed lockfile is committed. After the merge, the normal protected Linux/Windows/macOS Node 22/24 CI is triggered.

If the recovery job fails while resolving npm registry metadata, check the error there, not six downstream platform logs. If the clean-install job fails after the artifact has been uploaded, the proposal is still available; the clean-install failure is a new, concrete issue to fix, not a reason to fabricate lock entries.


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
