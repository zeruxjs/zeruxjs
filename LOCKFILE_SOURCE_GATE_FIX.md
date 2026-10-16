# Why `Source and security contracts` checks `package-lock.json`

**Affected commands:** `npm run deps:check`, `npm run deps:sync-local`.

The root lockfile records two distinct kinds of data:

1. **Local workspace metadata** (`packages/<name>` and `node_modules/<workspace-name>` link records), which npm derives from the committed workspace `package.json` manifests.
2. **External npm package resolutions**, including registry-provided versions, transitive dependencies and tarball integrity hashes. These cannot safely be invented from local source code.

`npm run deps:check` is intentionally read-only and strict. It checks the workspace metadata, direct and transitive required dependencies, and registry resolution/integrity structure before allowing the release CI matrix to start. It does not replace `npm ci` or security auditing.

## When the error is `Stale workspace lock entries`

Run from the repository root:

```bash
npm run deps:sync-local
npm run deps:check
```

Review and commit the changed **root `package-lock.json`**. The sync command only reconciles local workspace metadata; it preserves external package integrity records. It now treats differences in JSON object key order as equivalent rather than falsely declaring metadata stale.

This command should not be placed in the strict `Source and security contracts` job: CI must verify what was **committed**, not silently repair its own checkout.

## When 16 external resolutions or 19 missing dependency edges remain

These are a separate failure. On a trusted machine with npm registry connectivity:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm run deps:sync-local
npm run deps:check
npm ci --no-audit --no-fund
```

Then review and commit the resulting `package-lock.json` and rerun CI.

Alternatively, use **Actions → Recover package-lock (manual, no publish)**. That workflow now runs the local sync **after** npm resolves genuine external metadata, **before** `deps:check`, and offers the reviewed lockfile via pull request or artifact. The workflow never approves or publishes a release.

**Observed in the baseline ZIP for this patch:** local workspace metadata is already synchronized (`staleWorkspaceMetadata=false`). The 16 external registry resolutions are still unavailable because `registry.npmjs.org` DNS resolution failed from this environment. It would be incorrect to claim the complete strict dependency check passes.
