# Publishing repository packages

## Interactive selected publication

From the repository root, after installing the reviewed lockfile:

```sh
npm run publish -- -p @zeruxjs/docs -p zuixs
```

Repeat `-p` (or `--package`) for each **exact npm name**, including names whose
folder differs (`@zeruxjs/db-sqlite`, not `db-sqllite`). npm requires the `--`
separator to reliably forward these flags. There is no implicit “publish all”.

Preview the selection without builds, authentication or registry access:

```sh
npm run publish -- -p @zeruxjs/docs -p zuixs --dry-run
npm run publish -- --help
```

The command:

1. Validates every selected package before doing work. Applications, private
   helpers, filesystem paths, version specs and unknown names reject. The manual
   path currently accepts stable `major.minor.patch` versions, public access and
   official-registry publication settings only.
2. Builds **all packages under `packages/`**, in existing dependency order with
   export-target verification. It does not build/start applications, install
   dependencies or change versions. A failed build stops publication.
3. Checks the npm session and runs native `npm login --auth-type=web` if needed.
   Native npm owns browser links, ENTER-to-open prompts and 2FA verification.
4. Processes selected packages in dependency order. Existing exact versions are
   reported and not uploaded: npm versions are immutable, so this does not mean
   unpublished local edits were released. Missing versions are packed with their
   normal lifecycle hooks, including Stylelint's private bundle checks. Uploads
   use those exact archives and disable a second lifecycle-script execution.
5. Uploads each archive once, then polls the exact public registry version every
   **15 seconds**. Newly uploaded versions must match the local archive's SHA-512
   integrity before trust setup starts. Lost acknowledgements and temporary read
   outages cause read-only verification, never automatic upload replay.
6. Inspects the package's trusted publishers and creates an absent exact GitHub
   connection with `createPackage`, `createStagedPackage` and `manageDistTags`.
   A fresh GET must verify all three independent permissions before success.

Run from an interactive terminal; piping/redirecting the command is rejected
before builds or writes. Complete npm's browser/2FA challenge when prompted.
If you choose npm's five-minute same-IP approval, npm/the registry manage that
approval. This script never caches it or treats it as evidence that permissions
were granted. No manually supplied token is required; the script does not parse
`.npmrc`, print session credentials or persist authentication receipts.

Publication visibility defaults to **15 minutes per uploaded package**. Change it
explicitly within 15 seconds–one hour:

```sh
npm run publish -- -p @zeruxjs/docs --timeout-ms 1800000
```

Each metadata request is additionally bounded to 15 seconds. Browser/native npm
operations have ten-minute subprocess deadlines; builds have a one-hour parent
budget plus the builder's existing per-package deadlines. These are separate
budgets, not one total workflow deadline. A rejected/uncertain upload can consume
the visibility budget; Ctrl-C stops waiting and prevents subsequent writes.

## Trust identity and npm compatibility

The fixed connection matches `.github/workflows/package-publish.yml`:

- Provider: GitHub Actions.
- Repository: `zeruxjs/zeruxjs`.
- Workflow: `package-publish.yml`.
- Environment: none, matching the current workflow.
- Permissions: direct publish, staged publish and dist-tag management.

This is deliberately a **manual terminal command**, separate from the existing
OIDC workflow. Native `npm trust` does not currently expose the third permission
flag. The small `scripts/npm-publish-session.ts` bridge uses npm's installed
session loader, registry client and browser/OTP helper to submit the documented
registry permissions. It does not patch the npm installation or import code from
the registry. Compatibility checks accept npm 11.15+ within 11 and npm 12.x;
installed native helper shapes are checked before release writes. The bridge was
inspected against npm 12.0.1/12.2.3 and the 11.21.3 implementation. Future npm
internal API changes need review; a CLI version number alone is not live-provider
qualification. Prefer the repository's Node 24 toolchain.

Only official npm authentication/confirmation origins and paths are accepted by
the trust bridge. Requests have finite time/response budgets, reject redirects,
and do not automatically retry trust writes on network errors. If a trust write
loses acknowledgement, rerun: the first operation inspects existing connections.

Existing correct connections are read-only successes. A matching connection with
insufficient permissions causes an explicit failure; it is **not revoked**. Review
and recreate that exact connection in npm package settings, then rerun. Unrelated
connections are never removed. Registry conflicts, missing package-management
rights and failed 2FA remain visible failures rather than false successes.

## Interruption and ownership

One local `.npm-release/manual-publish.lock` prevents overlapping manual runs in
this checkout. Archives live in a private temporary directory. Normal success,
failure and handled interruption remove owned temporary archives and release the
lock after child settlement. SIGKILL/machine failure can leave a lock: inspect its
PID and confirm the previous release has stopped before removing it. Never delete
a live operator's lock or stop another application. This lock does not coordinate
other checkouts, GitHub runners or other machines.

Failure exits nonzero and stops later packages. Earlier successful releases stay
published; no global rollback is claimed. Ctrl-C cannot undo bytes npm already
accepted. Inspect the exact registry version before retrying an uncertain release.
Build/prepack hooks are trusted repository code and own their nested resource
cleanup; terminating a native child is not cancellation of every possible hook
side effect. No package version is bumped, no tag is moved automatically and no
existing version is overwritten by this tool.

## Existing automated workflow

`package-publish.yml` remains independent. It plans unpublished versions on
`master`, gates source/build/audit/license checks, packs verified artifacts and
publishes through OIDC with `id-token: write`. Setting up all three permissions
allows those operations; it does not make the workflow stage packages or change
dist-tags automatically. Its current publish job uses direct publication.

## Verification

```sh
npm run test:publish
```

Focused tests use synthetic registry/authentication records, virtual propagation
clocks and owned local subprocesses. They do not publish a package, log in, open a
real verification browser or change a live trusted publisher. A successful local
check is not live npm acceptance. Actual publication requires your npm account,
package-management rights, enabled 2FA and completing the requested challenge.
