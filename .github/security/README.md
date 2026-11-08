# Repository security automation

This is the repository-specific integration of the reviewed local security stack.
It complements existing publishing, site deployment and GitLab mirror workflows;
it does not replace those workflows or run application code.

## Checks and results

| Owner | Scope | Finding behavior |
| --- | --- | --- |
| `workflows/codeql.yml` | JavaScript/TypeScript and GitHub Actions, security-and-quality queries | Uploads findings; successful execution is not a zero-alert guarantee. |
| `workflows/security.yml`: Semgrep CE | Public `p/security-audit` rules over source | Findings fail the job (`--error`); metrics/version telemetry disabled. |
| Trivy | Filesystem lockfile vulnerabilities and configuration; HIGH/CRITICAL, including unfixed findings | Findings fail; no repository npm install or application startup. |
| Gitleaks | All Git history fetched by checkout | Findings fail; CLI and SARIF use 100% secret redaction. Historical leaks still require revocation. |
| Zizmor | Local workflow/action configuration, offline | SARIF reporting; SARIF mode can succeed with findings. Online checks are intentionally absent. |
| ESLint | Root `eslint.config.mjs`, JS/JSX/TS/TSX and CommonJS; public light preset | `npm run lint:js:report`, read-only; errors fail and JSON is retained. |
| Stylelint | Root `stylelint.config.mjs`, authored CSS/SCSS | `npm run lint:css:report`, read-only; errors fail and JSON is retained. |
| Dependency Review | Changes introduced by a pull request | New HIGH/CRITICAL dependencies fail; unavailable dependency graph/API access is an error, not an empty result. |
| `.github/dependabot.yml` | Root npm workspace, separate private Stylelint bundle, standalone `pages`, Actions | Weekly review PRs; no automatic merge or release. Internal package versions are excluded. |

Both workflows run on push, PR, merge queue, manual dispatch and daily schedules
(default UTC). Dependency Review runs only on PRs. Security scans use restricted
per-job tokens, no persisted checkout credentials and no repository secrets.
Semgrep, Trivy and Gitleaks findings fail their jobs without suppressing report
upload. Download/install/database failures also fail; they are not clean scans.

Find reports in **Actions → Additional security scans → run → Artifacts**
(`scan-semgrep`, `scan-trivy`, `scan-gitleaks`, `scan-zizmor`, seven-day retention).
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
