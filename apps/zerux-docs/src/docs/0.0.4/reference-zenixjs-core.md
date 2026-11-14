---
{
  "title": "@zenixjs/core",
  "description": "Minimal authorized CMS domain core, SQLite persistence and explicit limits.",
  "section": "Packages",
  "order": 210,
  "package": "@zenixjs/core",
  "sources": [
    "packages/@zenixjs/core/README.md",
    "packages/@zenixjs/core/package.json"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Implemented domain core

`@zenixjs/core/cms` exposes an opt-in Node-only `createCms` over the existing SQLite
connector. Root `version` and legacy `status` metadata remain compatible; new
`capabilities` describes the minimal implemented scope. The separate `zenixjs/application` entry supplies initial host-configured SSR UI;
the separate creator emits a host-configured SQLite integration scaffold. This core mounts no admin routes.

The core provides tenant/site-authorized sites, immutable content type versions,
drafts, optimistic entry heads, immutable revision references, publication pointers
and restore-to-new-draft. Auth-owned verified principals/permissions and explicit
files media ownership/version/hash checks remain host integrations. Role names or
client JSON never authenticate a caller.

## Persistence and lifecycle

Explicit `migrate:true` initializes schema v1 and its checksum journal on one native
synchronous SQLite transaction. Head changes and revision inserts are also atomic;
stale revisions conflict. Other adapters and async transaction parity are not claimed.
Use a private file-backed database; without migration approval startup verifies the
existing schema. The package README defines the journal and publication semantics.

Plugins are explicit trusted setup code with generation-owned cleanup. Startup
resource rollback does not undo already committed plugin writes. Await `close` to
abort/drain callbacks, dispose resources and close only the owned connector.

## Public imports

```js
import {version, status, capabilities} from '@zenixjs/core';
import {createCms, cmsRolePermissions} from '@zenixjs/core/cms';
```

The package's `examples/cms.ts` shows private dependency injection and a minimal
draft/publication flow. Host session proof, Origin/CSRF policy, media providers and
private rendering remain explicit. Native SQLite fixtures check file-backed reopen,
rollback, revision conflicts and denied sites; no browser/admin/provider qualification
or complete CMS behavior is implied.
