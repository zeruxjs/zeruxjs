# @zenixjs/core

Minimal authorized CMS domain core, SQLite persistence and explicit limits.


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

The package's `examples/cms.mjs` shows private dependency injection and a minimal
draft/publication flow. Host session proof, Origin/CSRF policy, media providers and
private rendering remain explicit. Native SQLite fixtures check file-backed reopen,
rollback, revision conflicts and denied sites; no browser/admin/provider qualification
or complete CMS behavior is implied.


## Public entry points

Manifest reference for `@zenixjs/core@0.0.4`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./cms": {
      "types": "./dist/cms.d.ts",
      "browser": null,
      "import": "./dist/cms.js"
    },
    "./types": {
      "types": "./dist/types.d.ts",
      "browser": null,
      "import": "./dist/types.js"
    }
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/auth": "0.0.4",
    "@zeruxjs/db": "0.0.4",
    "@zeruxjs/db-sqlite": "0.0.4",
    "@zeruxjs/files": "0.0.4"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zenixjs/core

Minimal opt-in CMS domain core with one file-backed SQLite adapter. There are no
admin routes, dashboard, project generator, authentication UI or implicit plugins.
The separate `zenixjs/application` entry supplies an initial host-configured SSR UI;
this domain package itself mounts no admin routes.

## Public surface

Root imports retain `version = "0.0.4"` and legacy `status = "placeholder"` for
compatibility. New `capabilities` reports implemented scope; use the Node-only
`@zenixjs/core/cms` entry for `createCms`, `CmsError`, role policy data and domain
types. `@zenixjs/core/types` exposes package-owned types/role data. Root import opens
no database and does not initialize the CMS dependencies.

```js
import {createCms} from '@zenixjs/core/cms';
const cms = await createCms({
  adapter: 'sqlite', filename: '/private/app/content.sqlite', migrate: true,
  resolvePrincipal: authenticateServerSession,
  authorizeMedia: verifyFilesOwnershipVersionAndHash,
});
try {
  const current = await cms.readEntry({tenant:'tenantA',site:'siteA'}, 'welcome', serverSession);
} finally { await cms.close(); }
```

Callbacks and session variables above are host-owned, not bundled defaults. See the
[public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zenixjs/core/examples/cms.mjs) for explicit schema/draft/publication calls.
No HTTP endpoint or `zerux.config` option is mounted automatically.

| Capability      | Implemented behavior                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sites           | Create/read, fixed tenant and site scope; names are inert content                                                                                   |
| Content types   | Immutable numbered schemas; text, finite number, boolean and versioned media-reference fields                                                       |
| Entries         | Create draft, optimistic head updates, authorized reads                                                                                             |
| Revisions       | Immutable tenant/site/entry/revision references, actor/time and restore provenance                                                                  |
| Publication     | Publishing creates a new immutable revision and advances a separate published pointer                                                               |
| Adapter         | SQLite file only through `@zeruxjs/db-sqlite` native synchronous transactions                                                                       |
| Plugins         | Explicit trusted setup callbacks and LIFO async disposal; no package scanning                                                                       |
| Not implemented | Admin/router, anonymous delivery, localization, relations, nested rich text, search, deletion, unpublish, arbitrary migrations or other DB adapters |

## Authentication, permissions and media

The host `resolvePrincipal` must verify a fresh authenticated/unexpired session and
return the existing auth-owned `TenantPrincipal`. `hasTenantPermission` enforces
exact tenant, permission and site allowlist on **every operation**. Omitted siteIds
deny access; role strings, email, caller-supplied principal JSON and forwarding headers
are never authentication. `cmsRolePermissions` is convenience policy data for hosts
to grant through verified sessions, not an automatic role-to-privilege conversion.
Site creation needs a preauthorized site ID, not a self-granted administrator.

Permissions are `cms:read`, `cms:site-manage`, `cms:type-manage`, `cms:write`, and
`cms:publish`. All reads, including `readPublished`, are authorized private reads.
Host routes remain responsible for CSRF/origin controls and cache/privacy policy.
Auth persistence/session rotation remains in `@zeruxjs/auth`; CMS neither stores
passwords nor implements a second session system.

Media references use files-owned storage/bucket/key addressing with an immutable
version ID and lowercase SHA-256. Files validates addresses; a required
`authorizeMedia` callback checks actual tenant ownership, storage permissions,
version availability and hash before saving/publishing/restoring a reference. It
must use configured files providers, never fetch a caller URL. Failed checks commit
no entry/revision. References borrow bytes; CMS never uploads/deletes files, signs
URLs, copies credentials or grants binary access. Host download handlers still run
files authorization. The example/test callbacks are not S3/provider qualification.

Strings/notes are inert data, not HTML. Rendering clients must escape them for their
output context. Content type fields reject unknown keys/kinds, getters, unsafe names,
missing required values and invalid numeric/enum constraints. Types allow at most
64 fields, text at most 8192 characters and entry values at most 32 KiB. Text is
not evaluated, and no request-time templates, SQL/JS expressions or plugins are
loaded from content. Media permissions do not make user text trusted HTML.

## Schema and revision model

Configure a trusted private file path; CMS does not create parent directories or
sandbox arbitrary filesystem paths. Reject HTTP-selected paths, secure directory
permissions, backups and deployment storage separately. `:memory:` and URI filenames
reject for owned adapters. Node's existing native `node:sqlite` driver is selected
explicitly, with bounded busy timeout and WAL; no fallback to another driver or
async transaction system is inferred. A borrowed `connection` must be a qualified
file-backed `SqliteConnector` with real `synchronousTransactions`; it cannot also
specify filename and stays host-owned. Query-only/unsupported adapters reject.

`migrate:true` explicitly authorizes startup schema-v1 creation. It runs DDL, scoped
lookup index creation and a checksum journal insert on the **same** immediate SQLite
transaction. Failures roll back all three. Existing journal version/checksum mismatches
and future versions reject; no destructive automatic downgrade or guessed repair is
performed. Without migration approval, startup only verifies the current journal and
required columns. Tables are `zenix_schema` and `zenix_content_v1`; do not precreate
conflicting tables or manually edit the journal. This is the initial v1 migration,
not a user-defined schema migration runner.

SQLite's own file write transaction serializes migration/write admission. The shared
`@zeruxjs/db` async pinned migration/transaction contract is deliberately not claimed:
SQLite exposes a distinct synchronous transaction facade. See the connector's
[transaction documentation](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-sqllite/README.md) and official
[Node SQLite API](https://nodejs.org/api/sqlite.html). No PostgreSQL/MySQL/distributed
migration support, replica durability or backup certification is implied.

Create a draft with `expected = null`; updates/publish/restore require the exact
current head. A stale value raises `CmsError('REVISION_CONFLICT')`. Head update and
new revision insert commit atomically. Type IDs/versions cannot change on an existing
entry; register explicitly numbered content schemas (retaining prior versions) for
new entries. Schemas are immutable and versions must retain contiguous history.

`publish` creates a new published revision from the specified current head.
`restoreDraft` copies historical values into a **new** draft with `sourceRevision`;
no history is overwritten. New drafts/restores keep any existing published pointer:
`entry.state` describes the newest head, while `publishedRevision` separately identifies
the still-published content. There is no unpublish operation in this minimal core.

## Ownership, errors and limits

Each instance owns its opened connector, abort scope and explicitly registered plugin
resources. Plugins run in declaration order after schema initialization; immediately
register disposal with `onDispose`. Startup failure aborts/disposes acquired plugin
resources in reverse order and closes owned connections. Plugin-issued content writes
are separate committed operations; resource rollback does not undo previously committed
application data. Setup is trusted executable server code, not content or a sandbox.
Create fresh plugin resources per generation and await `close` before dependencies.

Defaults: 16 pending operations (max 64), 5-second SQLite transaction deadline (max
60 seconds), 16 plugins and 64 cleanup callbacks. SQLite operations are synchronous;
auth/media/plugin callbacks must cooperate with the instance abort signal and own
any external deadlines. Close rejects admission, aborts and waits for actual pending
work, disposes plugins LIFO and closes only owned connections. Signals cannot forcibly
cancel arbitrary JavaScript. Borrowed auth/files services are never closed.

Public errors have fixed codes/messages and non-enumerable private causes. Do not
return/log raw causes to clients. No file paths, credentials or content values are
included in the default error envelope. Use restricted operational diagnostics for
underlying database/provider failure evidence.

## Verification and limits

Run `npm run build --workspace=@zenixjs/core` and
`node --test packages/@zenixjs/core/test/cms.test.mjs` from the repository root.
Focused fixtures use real native Node SQLite files and verify durable close/reopen in a separate process,
revision races, publication/restore history, tenant/site denial, malformed schemas,
media denial, head-write rollback, migration rollback/version rejection and plugin
cleanup. No browser/admin app, remote database, live auth provider or live files
provider was exercised. Disk replication, recovery/backups and multi-process load
qualification remain host responsibilities. This is a domain foundation, not a
complete CMS or legal/compliance product.

## License

MIT OR Apache-2.0.

## Source maintenance

| Module              | Ownership and review focus                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`      | Inert compatibility metadata; preserve version/status exports.                                                       |
| `src/types.ts`      | Package-owned domain contracts, field constraints and host callbacks; role data never authenticates a caller.        |
| `src/validation.ts` | Own-data checks and bounded schema/content/media syntax; files policy and authorization stay with their owners.      |
| `src/cms.ts`        | SQLite migration identity, scoped reads, optimistic revision commits, fresh host authorization and instance cleanup. |
| `examples/cms.mjs`  | Inert public-import helpers; setup/save/publish remain separate commits.                                             |
| `test/cms.test.mjs` | Synthetic temporary SQLite files; tests close resources before removing owned paths.                                 |

Function/method contracts include typed parameters, return values and relevant
failure behavior. Constants and loop bindings document provenance/ownership.
Auth/media awaits stay outside synchronous SQLite callbacks; write permissions
are rechecked before the final guarded commit. Admission remains occupied until
actual promise settlement; close drains it before LIFO plugin disposal. Native
SHA-256 identifies trusted schema/key data and is not a replacement for auth,
signing or a managed service. This package has no source-marked deprecated APIs.

The repository reviewed-scope formatting/documentation gate applies to authored
source/tests/examples/configuration, excluding generated output and license text.
Do not sort/rewrite schema data as a cosmetic change: migration identity depends
on its deterministic JSON content/order. Preserve embedded subprocess fixture
source bytes and verify public consumers after any actual type/API change.


## Implementation sources

- [packages/@zenixjs/core/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zenixjs/core/README.md)
- [packages/@zenixjs/core/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zenixjs/core/package.json)
