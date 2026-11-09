# Repository security automation

This is the repository-specific integration of the reviewed local security stack.
It complements existing publishing, site deployment and GitLab mirror workflows;
it does not replace those workflows or run application code.

## Checks and results

| Owner | Scope | Finding behavior |
| --- | --- | --- |
| `workflows/codeql.yml`: CodeQL | JavaScript/TypeScript and GitHub Actions, security-and-quality queries | Uploads findings; successful execution is not a zero-alert guarantee. |
| `workflows/security.yml`: Semgrep CE | Public `p/security-audit` rules over source | Findings fail the job (`--error`); metrics/version telemetry disabled. |
| Trivy | Filesystem lockfile vulnerabilities, configuration and current-file secrets; HIGH/CRITICAL, including unfixed findings | Findings fail; no repository npm install or application startup. |
| Gitleaks | All Git history fetched by checkout | Findings fail; CLI and SARIF use 100% secret redaction. Historical leaks still require revocation. |
| Zizmor | Local workflow/action configuration, offline | SARIF reporting; SARIF mode can succeed with findings. Online checks are intentionally absent. |
| ESLint | Root `eslint.config.mjs`, JS/JSX/TS/TSX and CommonJS; public light preset | `npm run lint:js:report`, read-only; errors fail and JSON is retained. |
| HTML-validate | Root `htmlvalidate.config.json`; authored HTML, including reference previews | Locked CLI, private/generated ignores, explicit reviewed inline-style exceptions; errors fail. |
| Stylelint | Root `stylelint.config.mjs`, authored CSS/SCSS | `npm run lint:css:report`, read-only; errors fail and JSON is retained. |
| Dependency Review | Changes introduced by a pull request | New HIGH/CRITICAL dependencies fail; unavailable dependency graph/API access is an error, not an empty result. |
| `.github/dependabot.yml` | Root npm workspace, separate private Stylelint bundle, standalone `pages`, Actions | Weekly review PRs; no automatic merge or release. Internal package versions are excluded. |

Static security validation runs on PR updates and pushes to `master`, plus its
existing merge-queue, manual and daily scheduled events. Feature branch pushes do
not launch a second static run alongside the PR. A branch without an open PR can
use manual dispatch before opening one. Master validation after merge remains
intentional. `dependency-review.yml` is PR-only, so it creates no skipped push job.
Scorecard listens only to master pushes, its weekly schedule and manual dispatch
on the default branch; it creates no PR check. Runtime/API and RESTler workflows
are manual-only and keep their enable-flag conditions. An intentional optional
job skip means no scan occurred; it is not a clean security assessment.
 Security scans use restricted
per-job tokens, no persisted checkout credentials and no repository secrets.
Semgrep, Trivy and Gitleaks findings fail their jobs without suppressing report
upload. Download/install/database failures also fail; they are not clean scans.

Find reports in **Actions → Security and Code Quality → run → Artifacts**
(`scan-semgrep`, `scan-trivy`, `scan-gitleaks`, `scan-zizmor`; scanner reports retain
14 days, while ESLint/Stylelint/HTML JSON reports retain seven days).
Same-repository runs upload SARIF to **Security → Code scanning** with separate
categories. Fork PRs retain artifacts but skip these additional SARIF uploads to
avoid relying on unavailable write permission. Fork approval/repository Actions
policies still apply. Existing CodeQL handles its own supported upload path.
Reports can disclose code locations or source context; do not put private secrets
in fixtures, and review artifact access under repository visibility policy.

## Adaptations from the supplied stack

- Keep the existing CodeQL job; do not enable a second default setup or copy its
  duplicate job. The invalid explicit `UTC` workflow timezone was removed; cron
  already defaults to UTC.
- ESLint and Stylelint now consume root monorepo configurations, not missing
  files under `.github/security`. Jobs use Node 24 and `npm ci --ignore-scripts`,
  not floating `npx` installations. ESLint builds the owning public preset using
  `npm run lint:prepare`; Stylelint uses installed CSS/SCSS standard configs.
  Both retain JSON reports on errors. The private Stylelint bundle, lockfile,
  licenses and prepack integrity hooks are unchanged. See the root README's
  monorepo lint commands for local checks and explicit fix modes.
- Gitleaks owns secret scanning; Trivy owns vulnerability/config scanning. There
  is no duplicate Trivy secret report or unredacted secret artifact.
- Do not import the privileged `workflow_run` PR-comment bot. Findings are
  available through Actions artifacts and Code Scanning without giving a report
  consumer PR-write permission or consuming untrusted ZIP artifacts.
- Do not import Scorecard's external result publication/OIDC job as part of this
  integration. Repository posture scoring is a separate opt-in decision.
- ZAP/Nuclei/Schemathesis/RESTler are **not wired or tested**. The supplied generic
  startup action assumes Node 22 and a root `security:start` script; this repo has
  neither that script nor a committed disposable OpenAPI harness. The existing
  app browser fixture is not an API-fuzzing harness. Never substitute the user's
  running app, operator `.env.local` or live SQLite state. A future integration
  needs synthetic state, reviewed local-only endpoints, real teardown and no
  production credentials; naming a variable does not implement that contract.

## Tool maintenance and prerequisites

New external action references are immutable commit SHAs verified against official
repositories. Semgrep 1.184.0, Zizmor 1.32.0, Trivy 0.70.0 and Gitleaks 8.30.1 are
explicitly selected. Gitleaks' archive is checked against the SHA-256 published in
its GitHub release asset metadata before extraction. Dependabot maintains Actions
and npm references; the Python/tool version literals and Gitleaks checksum require
reviewed manual updates. Python transitive installation dependencies and remote
Semgrep rules/Trivy vulnerability databases are not frozen by these version pins.
Semgrep downloads public rules, with metrics disabled; this is not an offline scan.
Zizmor deliberately uses offline audits and does not need an API token.

GitHub-hosted Ubuntu runners need access to GitHub releases, PyPI, Semgrep's rule
registry and Trivy's databases. Missing tools or denied downloads are failures.
Dependency Graph and Code Scanning must be available/enabled for the repository;
Dependabot security alerts/updates and push protection are separate GitHub settings,
not features enabled automatically by committing YAML. Add required branch checks
only after reviewing initial runs, especially the pre-existing history findings.
No scanner detects every vulnerability or certifies runtime behavior.

Official references:

- [Semgrep CI](https://docs.semgrep.dev/semgrep-ci/sample-ci-configs)
- [Trivy action](https://github.com/aquasecurity/trivy-action)
- [Gitleaks CLI](https://github.com/gitleaks/gitleaks)
- [Zizmor usage](https://docs.zizmor.sh/usage/)
- [Dependency review action](https://github.com/actions/dependency-review-action)
- [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)

## Local validation

Run `node --test scripts/codeql-workflow.test.mjs` for the existing CodeQL policy
checks. Validate `codeql.yml` and `security.yml` with a reviewed actionlint binary;
parse Dependabot YAML and verify its declared manifest directories. These are
configuration checks, not successful GitHub-hosted scanner executions. No packages
need to be installed or built to validate this workflow change.

The ESLint/Stylelint jobs have read-only repository tokens, seven-day JSON artifact
retention and no fix flags. Their configuration validation requires the locked
dependencies and, for ESLint, the compiled shared preset. Unlike scanner-only
configuration checks, that qualification builds four required library packages;
it does not build/start apps or run the full workspace suites. Existing lint
violations remain failures; adding these jobs is not a claim of a clean baseline.

## Push versus pull request runs

Validation uses event/branch filters rather than API lookups or skipping required
PR jobs. Each push to an open PR branch triggers its static PR validation; additional
push-triggered static validation is limited to `master`. Runtime/API and RESTler
are manual-only until their disposable harness is implemented and qualified. Merge-queue runs test
a separate candidate and are retained. Publishing, GitLab mirroring and site
deployment keep their existing triggers because they perform different work;
they can appear alongside PR checks without being duplicate validation. This is
not a global cache that deduplicates commits across manual/scheduled runs.

## Why historical checks were skipped

`ENABLE_RUNTIME_SCANS`, `ENABLE_RESTLER` and `SECURITY_OPENAPI_PATH` are optional
repository variables; they were unset when the cited PR checks were inspected.
The current repository also lacks the referenced
`$/.github/actions/start-test-api/action.yml` and root `security:start` script.
Do not enable the variables until a reviewed disposable launcher exists; schema
fuzzers additionally require an actual committed OpenAPI schema. No production or
operator workspace credentials/state may be used as a substitute. Optional fuzzer
workflows now appear only when manually requested; their safety gates remain.
Existing skipped runs on a PR are historical and cannot be rewritten by editing
YAML. These checks should not be required by branch rules while unconfigured.
Dependency Review has its own PR-only workflow; a real failure there still needs
investigation and is distinct from the expected skip on a push event.

## Finding remediation and local qualification

The reviewed Gitleaks exceptions in root `.gitleaks.toml` apply only to exact RFC
6238/durable-test constants in named fixtures, or documented SHA-256 content-hash
entries in generated docs manifests. They are not general key/path exclusions.
Default detection remains enabled; a synthetic new credential in the same fixture
still fails. Git history is not rewritten. Semgrep retains its audit rules without document-renderer suppression annotations.
The renderer separates fixed script elements from article fragments and uses the
security package JSON script encoder, with script-termination regression tests.

PR scans update the pull-request ref, not the source branch dashboard. To refresh
a branch dashboard explicitly, run `gh workflow run security.yml --ref <branch>`
and select the same branch in Code scanning after the run finishes.

All external Actions are pinned to verified upstream commits. The copied
privileged `workflow_run` reporter referenced a missing Python implementation and
was removed; native Checks, SARIF and artifacts remain the reporting interface.
Release jobs use the npm bundled with pinned Node 24.15.0 and validate trusted
publishing support instead of installing an unlocked global npm. No release was
executed during qualification. Optional fuzzers use GitHub's self-repository action
reference syntax but still require a real disposable launcher before enablement.
Older actionlint versions do not parse that syntax; validate those exact local
references separately rather than removing the safety gates.

Patched dependency resolutions include source-map-js 1.2.2, systeminformation
5.33.19, fast-uri 3.1.9 in both lockfiles, and the updated email MIME/SMTP libraries.
The repository's transitive minimatch 7–10 constraint is overridden to 11.0.5;
representative glob/TS parser consumers are qualified on Node 24.15. This root
override is repository tooling policy, not a promise that independently installed
packages inherit it. The private Stylelint bundle lock, fork and preparation hook
remain separately checked.

The development Dockerfile uses a digest-pinned official Node image, avoids
curl-to-shell installation, installs no recommended apt packages and defaults to
its existing non-root `node` user. Its healthcheck checks runtime availability,
not application readiness. Existing containers are not restarted; operators must
review bind-mount UID permissions before explicitly rebuilding their dev image.

Separate npm-audit coverage can differ from Trivy's database. The final npm audit
reports no high/critical/moderate findings but still reports the low-severity
`deepmerge` advisory and its dependent `html-to-text` package. Upstream's proposed
fix requires the next major HTML-to-text converter and a higher Node minimum;
that runtime migration is not silently forced by this CI repair. The existing
release audit still fails on low findings and remains enabled. Resolve/qualify
that dependency before a release requiring a zero-advisory production tree.

CodeQL remains in `workflows/codeql.yml` under job `analyze` to preserve the default-branch analysis identity. Moving it into another workflow breaks PR baseline comparisons even when language categories match. Other static scanners remain in `security.yml`; both use PR scans and master-only push scans.
