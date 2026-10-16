# Lockfile recovery: exact diagnosis and non-bypass closure

Updated: 2026-10-16. This handoff is based on the last `zeruxjs-lock-recovery-pr-full-project.zip`, including the 0.0.1 owned package-version policy.

## Reproduced failure

`npm run deps:check` fails because the **committed** root `package-lock.json` does not contain 16 external packages, spanning 19 dependency edges (AWS SDK, Redis/ioredis/BullMQ, SMTP/IMAP/POP3/content helpers, and `prompts`). The tool also sees 51 npm workspaces; the separate 52 count is for all owned package manifests including private/out-of-workspace package metadata. This is a dependency-resolution defect, not six individual OS failures.

`npm install --package-lock-only --ignore-scripts --no-audit --no-fund --offline` was attempted in the provided environment and failed with `ENOTCACHED` for `ioredis`. Attempts to reach the npm registry failed at DNS (`EAI_AGAIN`), and direct TCP connection attempts also failed. **No registry-verified replacement lockfile can be created here.** Do not add unverified tarball URLs or hashes, use `--legacy-peer-deps` to disguise errors, or remove declared dependencies to make the gate green.

## Fix provided in the code

The `.github/workflows/package-lock-recovery.yml` workflow now launches automatically on trusted `master`, `dev` and `test` pushes that change a package manifest, root lockfile, or the recovery workflow itself. You can also dispatch it manually as before. It first runs `npm run deps:check` and skips recovery if the committed lockfile is already valid. On failure, it resolves using **real npm registry metadata**, checks the resulting full graph, and uploads the proposed root lockfile for independent review. It pushes **only** the new lockfile to a separate branch and tries to create a review-only PR; it never force-pushes, edits the protected branch, or publishes a package.

GitHub Actions `GITHUB_TOKEN` pushes do not automatically start a new push/PR workflow, so the recovery job now explicitly dispatches the existing `package-workspaces.yml` `workflow_dispatch` for its proposal branch. The separate recovery `clean-install` job downloads the artifact and checks `npm ci`, build, and all public tarball consumers; its result is **required evidence to review**, not automatic approval.

The main `package-workspaces.yml` strict `npm run deps:check` gate remains intact. The recovery script now prints a specific explanation of which workflow or local command repairs this error.

## Action required after updating GitHub

1. Upload the updated files/ZIP to the *correct repository* on the appropriate `master`, `dev`, or `test` branch. Changing the recovery workflow file itself triggers automatic proposal generation on a trusted-branch push. Alternatively choose **Actions → Recover package-lock (manual, no publish) → Run workflow**.
2. Open the recovery workflow run. If `npm install --package-lock-only` fails in GitHub Actions, inspect **its actual registry/peer-dependency error** and fix the package manifest accordingly; do not rerun `Source and security contracts` hoping it will resolve metadata.
3. On successful recovery, inspect the `root-package-lock-proposal` artifact or generated `automation/npm-lock-recovery-*` PR. Inspect the resolved versions, HTTPS tarball URLs, and SRI integrity values. Wait for **Prove resolved lockfile can install and build** and explicitly dispatched **Package workspace CI** jobs on the proposal branch. If Actions cannot open PRs, download the artifact and commit `package-lock.json` manually after review.
4. **Merge/commit the real recovered `package-lock.json`**. This is the only way for the strict source CI check of the committed lockfile to pass; the old branch must continue to fail until it is actually fixed. It also causes the regular protected six-platform CI to rerun.
5. If recovery succeeds and the new CI exposes other genuine build/test failures, address those separately. A recovered lockfile is not stable-release approval.

### Equivalent local commands (machine with registry access)

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm run deps:check
npm ci --no-audit --no-fund
npm run verify:source
npm run build:workspaces
npm run release:public:consumer
# Review and commit the generated package-lock.json before rerunning protected CI.
```

### Evidence from this handoff

- No modified root package manifest versions, dependencies, or invented third-party integrity metadata.
- Source/test validation checked locally, including the strict lock-check negative result (16 packages, 19 edges).
- YAML parses and verifies that both automatic and manual dispatch exist, candidate checks run, and the main source lock gate remains strict.
- `npm ci` on the complete repository is not certified here because the external registry is inaccessible.
