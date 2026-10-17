# Automatic npm publishing

`.github/workflows/package-publish.yml` publishes public packages under
`packages/` when their manifest version increases in a push to `master`.
It excludes private packages, applications, and any package directory segment
starting with `sample`. Newly added package names are also eligible.
Unchanged versions are never published by a normal push.

The workflow checks source contracts, installs the committed lockfile, requires
zero production audit findings and complete license evidence, builds workspaces
with automatic parallelism, and packs selected packages. It publishes those
exact archives with public access and provenance in dependency order. Already
published versions are skipped, and registry errors stop the release. npm
publishing is not atomic: a failure can leave earlier packages published; retry
the run or use the manual missing-version option to finish the remaining ones.
Builds are parallel; publication is sequential to respect package dependencies.

## One-time npm authentication setup

All 47 public packages now have an initial npm release. The workflow uses only
npm trusted publishing (OIDC), with Node 24, npm 11 and `id-token: write`.
It does not read `NPM_TOKEN` or configure token-based npm authentication.

For each published package, configure npm Settings → Trusted Publisher:

- Provider: GitHub Actions.
- Organization/user and repository: the actual GitHub source repository.
- Workflow filename: `package-publish.yml` (without the directory).
- Environment: leave blank; this workflow does not declare an environment.
- Allow direct `npm publish`.

Remove any old bootstrap secret and revoke its token after configuring trust. Packages' `repository.url` must identify the actual
GitHub repository for provenance. Source repository access/visibility must also
meet npm's provenance requirements.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [granular access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens/).

## First release and retries

After committing and pushing the workflow, open GitHub Actions →
**Publish version-bumped packages to npm** → Run workflow, selecting `master`.
Leave **Include all missing public package versions** enabled. Enable **Build
and pack without publishing** for a preview, or leave it disabled to publish.
The prepared `0.0.2` release validates the configured trusted publishers.

The manual missing-version run is also useful if GitHub coalesces queued runs.
The shared concurrency group prevents overlapping publishers, but GitHub may
replace a pending run when several pushes arrive during an active release.

## Subsequent releases

1. Increase the affected public package's `version`, using stable
   `major.minor.patch` versions. Independent package versions are supported.
2. Update every internal dependency reference to that package, including apps,
   to its exact new version. Bump dependent public packages too if their updated
   dependency declarations should be published.
3. Update the root lockfile with
   `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
4. Review the public contract changes, then refresh the snapshot with
   `npm run api:freeze:write` (this script includes the explicit review flag).
5. Commit package manifests, lockfile and reviewed API snapshot, and push/merge
   to `master`. Publishing runs automatically.

A decrease is rejected. Packages cannot reuse an already published version.
The workflow refuses to move npm's `latest` tag backwards. It does not publish
prereleases, create Git commits/tags, or publish applications and sample packages.

The workflow and scripts are ready for review locally, but successful registry
authentication and publication can only be confirmed by a configured Actions
run. No npm packages are published merely by adding these files locally.

## Release 0.0.2: validate npm trusted publishing

All 47 public packages are prepared at `0.0.2`, with matching internal dependency
references and a release note. Push the release commit to `master` so the Actions
workflow publishes these versions through OIDC; a local publish does not validate
the GitHub trust relationship. Existing `0.0.1` releases cannot be republished.

Each publish logs its position and package name, then confirms that exact version
is available from npm. The final log reports `COMPLETE: 47/47` only when all 47
selected versions are confirmed. The Actions job summary lists every result;
`plan.json` and `publication-summary.md` are included with the release artifacts.
A partial release fails the job and lists failed/pending packages rather than
claiming completion.
