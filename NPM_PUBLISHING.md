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

Enable 2FA and ensure your npm account has publishing rights to the package
names and organizations. The workflow supports npm trusted publishing (OIDC),
with an optional `NPM_TOKEN` secret for bootstrapping packages that do not yet
exist. Do not commit credentials or put them in workflow files.

For the first release from GitHub Actions, create a granular npm access token
with package read/write access, permission to create the required scoped and
unscoped packages, and bypass 2FA for automation. Check the token's organization
and package restrictions and expiration. An organization-administration grant
alone does not grant package publishing rights. Save it in GitHub repository
Settings → Secrets and variables → Actions → New repository secret as
`NPM_TOKEN`. The workflow exposes it only to the publish step.

For each published package, configure npm Settings → Trusted Publisher:

- Provider: GitHub Actions.
- Organization/user and repository: the actual GitHub source repository.
- Workflow filename: `package-publish.yml` (without the directory).
- Environment: leave blank; this workflow does not declare an environment.
- Allow direct `npm publish`.

Then remove the bootstrap secret and revoke that token. Node 24 and npm 11 in
the workflow support OIDC. Packages' `repository.url` must identify the actual
GitHub repository for provenance. Source repository access/visibility must also
meet npm's provenance requirements.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [granular access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens/).

## First release and retries

After committing and pushing the workflow, open GitHub Actions →
**Publish version-bumped packages to npm** → Run workflow, selecting `master`.
Leave **Include all missing public package versions** enabled. Enable **Build
and pack without publishing** for a preview, or leave it disabled to publish.
This can publish the current `0.0.1` packages without artificially bumping them.

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
