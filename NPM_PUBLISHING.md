# Automatic npm publishing

`.github/workflows/package-publish.yml` publishes public packages under
`packages/` when their manifest version increases in a push to `master`.
It excludes private packages, applications, and any package directory segment
starting with `sample`. Newly added package names are also eligible.
Every run checks all eligible current package versions against npm. Versions
that are already public are skipped. Missing versions are retried even when
the package version did not change in the latest Git commit.

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
Enable **Build and pack without publishing** for a preview, or leave it
disabled to publish. Every run reconciles all eligible versions with npm.
The prepared `0.0.2` release validates the configured trusted publishers.

The manual run is also useful if GitHub coalesces queued runs.
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

npm may accept an upload and spend several minutes processing it before the
version becomes public. Accepted uploads are logged as `UPLOAD ACCEPTED` and
recorded as `processing`. After submission, the workflow checks the registry in
bounded parallel batches for up to 15 minutes, logging each confirmed version.
An upload acceptance alone never produces the final `COMPLETE` message; a
processing delay is also not automatically classified as a staged release.

## Registry comparisons and failed-release recovery

npm is the publication source of truth. The plan records each local version,
its exact published version (if available), npm's latest version, its version
at the Git base, and whether the package changed between the Git base and HEAD.
For pushes the Git base is the pre-push commit; manual runs use HEAD's parent.
Git changes provide context, not an exclusion filter for unfinished releases.

Published consumer contracts are compared without depending on JSON key order
or npm's normalization of binary paths. If an already published version has
different dependencies or entrypoints, the run fails and requests a new version;
it never overwrites an immutable version. This is a manifest-contract check, not
a byte-for-byte comparison of source code with the published tarball.

A failed publish remains eligible on the next run. A version npm has already
accepted but still reserves may return the explicit previously-staged-version
409 conflict. The workflow waits for that version instead of uploading it again
or treating it as complete. If it truly needs staged approval or remains
unavailable, the run stays incomplete and requires attention; it never approves
stages automatically. Authentication, name restrictions and unrelated conflicts
still stop the release. Publisher-script, workflow and root-lockfile fixes also
trigger reconciliation on master, so they can resume a failed release without
another package version bump.

Packing logs `START` and `READY` for each numbered package, streams npm prepack
and build output, and reports archive size, elapsed time and recorded integrity.
