---
{
  "title": "Upgrading and compatibility",
  "description": "Plan source, dependency, schema and documentation changes together.",
  "section": "Operations",
  "order": 70,
  "sources": [
    "packages/zeruxjs/src/index.ts"
  ],
  "related": [
    "production-checklist",
    "documentation-contributing",
    "capabilities"
  ]
}
---

## Early-version expectations

The ecosystem is at an early 0.0.x stage. Review actual exports and behavioral changes rather than assuming stability from a package name. Keep related workspace versions aligned and select a new unused package version for each release.

## Names and imports

Current utility names include zclivo, zforge, zhost, zlook and ztrial. Old draft references can contain zcli, z-dev, zsrv, zwatch or zeyro. Use installed manifests and current source as the authority. The PostgreSQL package is @zeruxjs/db-pg and the SQLite package is @zeruxjs/db-sqlite even when an old source folder has a historical typo.

## Before switching runtime code

Compile and separately typecheck a representative application. Exercise error paths, middleware order, streamed uploads, worker cleanup and the built start path. A local package symlink can hide missing tarball files, so inspect the actual release artifact when validating package changes.

## Data and secrets

Schema changes, cache prefixes, serialized search snapshots, message-delivery state and key-ring rotation need explicit migration plans. Preserve old verification keys while old encrypted links remain valid. Do not rotate password/session salts as an ordinary deploy without understanding account/session compatibility.

## Multi-instance rollout

Coordinate old/new database schemas and control-plane document versions. Keep required shared stores available across replicas. Avoid running a migration runner concurrently without exclusive ownership, and designate which processes own queue workers.

## Documentation archive

Freeze the current package reference snapshot before bumping packages, pin implementation links to a release ref, and create the next content version. Archived docs must not silently read the newest workspace manifest. Explain changed behavior and migration steps in the guide where the API is used.
