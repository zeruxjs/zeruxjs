# ZeruxJS GitHub Actions & npm release certification

This guide applies to the **uploaded ZeruxJS repository layout** (`packages/` and `apps/` at the repository root), not the older `apps/proworkspace/` reference layout. The existing `master`, `dev`, and `test` branch names are preserved. **No workflow in this handoff calls `npm publish`.**

## Workflows included

| Workflow | Trigger | What it proves | Can publish? |
| --- | --- | --- | --- |
| `package-workspaces.yml` | Push to master/dev/test, PR, merge queue, manual | Source and security checks, clean npm install, build and npm consumers on Node 22/24 across Linux/Windows/macOS | No |
| `package-lock-recovery.yml` | Trusted push to master/dev/test affecting package manifests, lockfile, or the recovery workflow; or manual | Resolve missing registry metadata, upload lockfile artifact, optionally create a review-only PR; separately verify clean install/build/consumers | No; only proposes a lockfile |
| `package-integration-lab.yml` | Manual | Offline package acceptance; optional disposable SQL/Mongo/Redis/MinIO service acceptance | No |
| `package-release-review.yml` | Manual | Full six-platform release matrix; optional **required** all-provider/browser lab; fail-closed verdict | No |
| `codeql.yml` | Push/PR/merge queue/weekly/manual | JavaScript/TypeScript and workflow-code security analysis | No |
| `git-sync.yml` | Push | Optional *fast-forward-only* GitLab branch mirror; refuses remote-divergent force pushes | No |
| `github-pages-deploy.yml` | Master/docs changes/manual | Site pages only | No |

The public package candidate set is **13**: `@zeruxjs/cache`, `@zeruxjs/db`, `@zeruxjs/hooks`, `@zeruxjs/lint`, `@zeruxjs/security`, `zforge`, `zargv`, `zsrv`, `zeruxjs`, `zeyro`, `zuixs`, `zlook`, `zyrojs`. Other `packages/` are private, including `zenix` (not yet separately certified), samples and three nested `create-*` packages. The example `apps/` remain root npm workspaces but are not part of package-only release qualification. The original app sources, VS Code extension and docs have been preserved.

## Your initial steps after uploading this ZIP

1. Commit all updated files to a review branch/PR. Enable GitHub Actions in repository Settings. Protect `master`, `dev`, and `test` as appropriate; require the package source and clean-consumer jobs for changes targeting protected branches. **Do not require skipped/manual-only jobs as branch checks.**
2. **Push this updated workflow to master/dev/test** to start automatic lockfile recovery, or use **Actions → Recover package-lock (manual, no publish) → Run workflow**, with **open_pull_request=true**. GitHub resolves metadata, validates dependencies and uploads `root-package-lock-proposal` immediately. It explicitly dispatches `Package workspace CI` for its recovery branch (GitHub token pushes do not automatically trigger workflows), then attempts to create a review-only pull request with *only* the root `package-lock.json` changed. Check the separate clean-install job, review registry versions/URLs/integrities and **merge the PR only if checks pass**. If PR creation is disabled under repository Settings → Actions → General → Workflow permissions, download the artifact and commit it manually instead. The root lockfile currently has **16 unresolved external packages / 19 required dependency edges**; no integrity hashes were guessed. **Until that proposed lockfile is merged/committed, the main Source and security contracts job MUST remain red.** Merely rerunning main CI or uploading this source archive does not repair a committed lockfile.
3. Let `Package workspace CI` run on the lockfile PR. Fix any actual Node 22/24, OS, package consumer, audit or license errors. CI remains red until the candidate is committed and all checks pass.
4. Manually run `Package integration lab` with service testing enabled to exercise PostgreSQL, MySQL, MongoDB, Redis, BullMQ and MinIO. Tests use disposable service credentials from `integration-lab/compose.yml`, not production accounts. Real Redis Cluster, external email, fault/recovery and browser checks require additional environments/credentials and remain separate requirements.
5. Use `Package release review` with **run_full_lab=true** only when every named required service/credential and browser is available. Any missing required suite fails; source-only passes, skipped tests and partially successful runs cannot satisfy the full acceptance gate.
6. The verdict step evaluates the CI matrix, full lab, `master` ref, GitHub Actions execution, public candidate count and reviewed stable package versions. It emits `GO_FOR_MAINTAINER_REVIEW` **only** when these conditions hold, else `NO_GO`. Even a GO verdict does **not** publish. Artifact named `package-release-verdict` records the reason and commit.

For local investigation:

```bash
npm run verify:source          # independent of registry; not a clean build
npm run release:graph          # confirms public publication order
npm run deps:check             # strict (currently blocked by unresolved packages)
npm run test:workspace-tools   # portable tooling regressions
npm run release:ci:decision    # local invocation always NO_GO by design
```

## npm ownership and trusted publishing

You indicated control of npm organizations `@zeruxjs`, `@zyrojs` and `@zenixjs`. This is necessary for scoped packages using those organizations. **Control of the organizations does not prove ownership of *unscoped* names** `zyrojs`, `zuixs`, `zeruxjs`, `zsrv`, `zargv`, `zlook`, `zeyro` or `zforge`: verify those names individually before publishing. `@zyrojs` and `@zenixjs` are not automatically substituted for current package names; that would be an API migration.

Once you approve each release candidate and namespace, configure npm **Trusted Publishing** for the exact repository/workflow to publish. It uses GitHub OIDC, requires `id-token: write` in the **future manual publish job**, and a sufficiently recent Node/npm. Apply a protected `npm-release` GitHub environment with required reviewers and branch restrictions. No npm publish workflow or privileged token is included here to avoid accidental release before GO. Do not share credentials in chat.

See npm documentation: https://docs.npmjs.com/trusted-publishers/

## Secret/setup boundaries

For optional mirroring, add GitHub Actions Secrets `GIT_SSH_KEY` and independently verified `GITLAB_KNOWN_HOSTS`. With no key, mirroring **skips**; with no trusted host fingerprint but a key, it **fails closed**. A diverged GitLab branch will not be force-overwritten. The previous self-hosted mirror used a remote URL containing a token and force pushes; it is intentionally disabled pending a safer authenticated replacement.

For the full lab, set *test-only* credentials as GitHub Actions Secrets: `ZX_TEST_PG_URL`, `ZX_TEST_MYSQL_DB`, `ZX_TEST_MYSQL_USER`, `ZX_TEST_MYSQL_PASSWORD`, `ZX_TEST_MONGO_URI`, `CACHE_REDIS_URL`, `QUEUE_REDIS_URL`, `CACHE_REDIS_CLUSTER_NODES`, `QUEUE_REDIS_CLUSTER_NODES`, `LAB_S3_ENDPOINT`, `LAB_S3_BUCKET`, `LAB_S3_ACCESS_KEY`, `LAB_S3_SECRET_KEY`, and `ZERUX_TEST_{SMTP,IMAP,POP3}_{HOST,USER,PASSWORD}`. The full lab deliberately fails until all named suites pass. Configure isolated test servers, not production credentials. The `package-integration-lab.yml` disposable local matrix does not require any user secrets.

Enable **private vulnerability reporting** through GitHub Code security settings; `SECURITY.md` links to the advisory form. During CI review, also verify actual third-party license notices (including `svg-tags`) and assess any high/critical npm advisories. Avoid weakening audit gates or fabricating missing registry metadata.

## Release policy

- `verify:source` and CodeQL are **not** substitutes for registry-backed `npm ci`.
- `release:public:consumer` must test all 13 published-candidate tarballs, JavaScript entry points and `.d.ts` resolutions across the targeted Node/OS matrix.
- External providers, Chromium and Redis Cluster are not certified by local mocks.
- Do not automatically bump alpha versions to stable; version/compatibility review is explicit.
- CI can authorize **technical release readiness**, but does not replace npm ownership verification or actual maintainer consent to publish.
