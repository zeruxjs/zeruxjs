---
{
  "title": "Publish selected packages",
  "description": "Interactive repository publication with browser verification, exact archive checks and explicit trusted-publisher permissions.",
  "navigation": "deploy",
  "section": "Operations",
  "order": 15,
  "sources": [
    "NPM_PUBLISHING.md",
    "scripts/publish-selected.ts",
    "scripts/selected-publish.ts",
    "scripts/npm-publish-session.ts",
    ".github/workflows/package-publish.yml"
  ],
  "related": ["deployment", "packages"]
}
---

## Select exact public package names

Run from the repository root in a real terminal:

```sh
npm run publish -- -p @zeruxjs/docs -p zuixs
```

The `--` separator forwards repeated `-p` flags through npm. The command first
builds all packages under `packages/`, without starting/building applications.
It publishes only the selected names in dependency order. Versions never change.
Use `--dry-run` to inspect the selection without builds, authentication or network
access. Installed dependencies and working package builds are prerequisites.

## Verification and partial completion

Native npm retains browser links and 2FA prompts. New archives are checked against
their exact registry SHA-512 identity every 15 seconds, with a default 15-minute
visibility budget. Uncertain uploads are not automatically replayed. Existing
versions are immutable and skipped; unpublished local edits are not thereby shipped.

After each confirmed version, the session bridge verifies the exact repository
workflow's `createPackage`, `createStagedPackage` and `manageDistTags` permissions.
It creates an absent publisher, preserves unrelated connections and stops if an
existing matching connection needs permission repair. Browser approval never
replaces the final permission read. No manually supplied token is required.

The small session bridge depends on reviewed installed npm internals (11.15+
within 11, or 12.x) because the native trust flags do not expose dist-tag management.
It does not patch npm. Future npm changes require compatibility review.

Ctrl-C prevents subsequent operations, but cannot undo a registry commit. A failed
run can leave earlier packages published. Normal cleanup releases owned temporary
archives and the checkout-local lock; hard crashes may require operator inspection.
No npm publication or live authentication was exercised by the synthetic tests.
