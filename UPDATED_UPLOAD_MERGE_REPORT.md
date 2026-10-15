# ZeruxJS current-upload merge and GitHub Actions handoff

This handoff is generated **from the user's updated `zeruxjs(1).zip`**, not from the earlier unmodified `zeruxjs.zip`. The updated upload is authoritative for all source and package changes.

## What was compared

- Earlier repository snapshot: `zeruxjs.zip` (1,552 files), used **only** as the three-way comparison base.
- Current user upload: `zeruxjs(1).zip` (1,594 files).
- Previously prepared release-workflow candidate (1,683 files), used only as a source for changes still missing from the current upload.

The current upload adds 42 files and modifies 143 files versus the earlier snapshot. **Every one of those 185 changes exactly matches the corresponding already-hardened file** in the release-workflow candidate. No manual changes conflicted with the prepared release work. Therefore **none of the user's updated package source files needed to be replaced**.

The merge applied exactly 101 changes absent from the user's current upload: **89 additions** (workflows, scripts, integration lab, API snapshot and tests) and **12 modifications** (repository settings, manifests, samples, docs and GitLab mirror). An additional report (this document) records the merge and its limitations.

## What is included

- The current upload's entire package source, apps, create-app packages, VS Code extension and existing documentation.
- GitHub Actions: package source/clean consumer matrix, manual lockfile recovery, manual service lab, manual package release review, CodeQL, and a fast-forward-only GitLab mirror. The existing GitHub Pages workflow is preserved.
- Root-level workspace and package-lock metadata, source checks, package build tooling, artifact/consumer/security/license checks, reproducible lab fixtures and fail-closed CI release verdict.
- `GITHUB_ACTIONS_RELEASE_SETUP.md` with GitHub upload and CI steps.

## Verified locally on the merged *current upload*

- `npm run verify:source`: 60 test passes, 51 workspace package contracts, 46 build targets.
- `npm run test:workspace-tools`: 70 test passes.
- `npm run api:freeze:check`: passed for 51 workspace contracts.
- `npm run security:source`: source-only structural audit passed; no online advisory claim.
- `npm run release:graph`: 13 public candidates, 38 private workspaces; public dependency graph valid.
- Seven workflow files parse as YAML with expected jobs and triggers.
- `npm run release:ci:decision`: **NO_GO** outside required GitHub CI evidence (expected, fail closed).

## Not certified by this handoff

The workspace lockfile still lacks verified resolutions for **16 external dependencies**, across 19 dependency edges. Without a trusted online npm registry and a clean CI installation, `npm ci`, all 13 packed npm consumers, online dependency advisories/licensing, live service tests, cross-platform runtime behavior and stable-release signoff are **not certified**. The lockfile metadata was not fabricated; package versions were not promoted; no package was published.

## Next steps after uploading to GitHub

1. Push this complete updated repository to a review branch. Review the changes and protect `master`, `dev`, and `test`.
2. Manually run **Recover package-lock (manual, no publish)**. Download and review the lockfile proposal; commit only if the clean installation and dependency checks succeed.
3. Run **Package workspace CI**; correct any failures in the six Node/OS combinations and 13-package consumer gate.
4. Run **Package integration lab** with disposable service testing enabled, then arrange Redis Cluster, real mail and browser/fault testing required by the full acceptance gate.
5. Run **Package release review (no publish)** with the complete lab configured. Preserve the verdict artifact and require explicit maintainer approval before setting up trusted publishing.

**All archives in this handoff are compared against `zeruxjs(1).zip`, not against the old baseline or any older work ZIP.**
