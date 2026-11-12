# @zeruxjs/asset-manager

Validated in-memory asset catalog for images, video, fonts, color tokens, documents and branding assets. Supports filtering, tagged assets, variant resolution, snapshots, and safe file persistence.

```ts
import { createAssetManager, saveAssetCatalog, loadAssetCatalog } from '@zeruxjs/asset-manager';
const catalog = createAssetManager();
catalog.add({id:'brand/logo',name:'Primary logo',type:'image',url:'https://cdn.example/logo.svg',
  variants:{dark:{url:'https://cdn.example/logo-dark.svg'},small:{url:'https://cdn.example/logo-sm.svg'}}});
const revision = catalog.revision;
catalog.apply([
  {action:'update',id:'brand/logo',changes:{name:'Company logo'}},
  {action:'add',asset:{id:'brand/accent',name:'Accent',type:'color',value:'#345678'}}
],revision); // atomic; throws AssetRevisionError on a stale expected revision
const dark = catalog.resolve('brand/logo','dark');
await saveAssetCatalog(catalog,'./private/assets.json');
const loaded = await loadAssetCatalog('./private/assets.json');
```

`addMany`, `import`, and `apply` stage and validate all changes before publishing. Values returned by `get`, `list`, `resolve` and `snapshot` are defensive copies. `AssetSnapshot` stays version 1 with an optional monotonic `revision`, compatible with earlier files. Variants are URL/value overrides, validated with the same restrictions as the base asset. Catalog files have an 8 MiB limit, restricted permissions, symlink checks and atomic replace; the directory must be trusted.

This is **single-process revision control**, not a distributed lock: concurrent file writers still require a lock or database transaction. URLs are metadata, not fetch permissions; the application must enforce any outbound network/SSRF and SVG sanitization policy.

## Explicit storage adapter

The optional `@zeruxjs/asset-manager/storage` entry connects a catalog to a borrowed `@zeruxjs/files` manager. Install the matching files peer when using this entry. Core catalog imports do not load files or require it for their declarations. Existing `add`/`apply` upsert and revision semantics remain unchanged; the adapter adds immutable version records rather than changing those APIs. The package export map retains the root and legacy `dist/*` paths.

```ts
import {createHash} from 'node:crypto';
import {createAssetManager} from '@zeruxjs/asset-manager';
import {createAssetStorage} from '@zeruxjs/asset-manager/storage';
import type {AssetIdentity, AssetStorageOptions} from '@zeruxjs/asset-manager/storage';
import type {StorageManager} from '@zeruxjs/files';

export async function storeAsset(
  files: StorageManager, identity: AssetIdentity,
  authorize: AssetStorageOptions['authorize']
) {
  const catalog = createAssetManager();
  const assets = createAssetStorage({catalog, files, namespace: 'branding',
    location: () => ({storage: 'private', bucket: 'assets', prefix: 'managed/'}),
    authorize, allowedTypes: ['text/plain'], maxBytes: 1024 * 1024});
  const bytes = new TextEncoder().encode('Brand guidelines');
  try {
    const stored = await assets.upload(identity, {
      asset: {id: 'brand/guidelines', name: 'Guidelines', type: 'document'},
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: 'text/plain'
    }, bytes);
    return {version: stored.reference.versionId,
      bytes: await assets.download(identity, stored.reference.versionId),
      snapshot: catalog.snapshot()};
  } finally { await assets.close(); } // the host still owns files
}
```

The host must supply a verified `{tenant,subject}` and an authorization callback returning exactly `true`. It runs on upload, registration, version inventory, download, delete and repair; version/address/ownership context is supplied where available. `versions` is its own permission because it exposes the private history inventory. Never derive these identities from unverified headers. Cookie-authenticated routes still need origin/CSRF controls. Asset URLs/variants remain descriptive metadata; they do not grant storage access or become signed URLs automatically. Returned references/snapshots include private addresses and must not be put into browser manifests indiscriminately.

`location(identity)` declares a named storage, bucket and optional validated prefix. Keep location mappings stable across persisted versions; changing them requires an explicit host migration. Actual managed keys are `prefix + namespace + '/' + SHA256(tenant) + '/' + randomVersionId`. The digest is partitioning, not proof of identity or anonymization. Uploads use unique private create-only objects and require the provider's verified `createOnlyWrite:true` capability. The manager validates its bucket, prefix, read-only, MIME and size policies before any upload. Custom S3 providers need the qualification described by files; there is no fallback to weaker overwrite behavior.

`upload(identity,input,source,signal?)` requires exact size, lowercase hexadecimal SHA-256 and an explicit MIME allowlist. It verifies streamed input, uploads a bounded buffer, reads back to verify storage integrity/ownership metadata, then commits catalog metadata with the captured expected revision. `register(identity,input,address,signal?)` verifies an existing object under the same tenant namespace but **borrows** its binary: it cannot claim ownership by matching a hash. Registration does not modify file metadata, and can use read-only storage. MIME is a validated declaration, not file-format sniffing, malware detection or SVG sanitization.

Defaults are 16 MiB per binary (configurable to 64 MiB), four pending calls, 10000 total catalog records and at most 65536 source chunks. Pending calls remain counted until actual settlement. Hash-verified downloads return bounded bytes only after full verification; they do not stream unverified plaintext. Signals are cooperative and cannot forcibly cancel a noncooperating reader. Inputs and returned records are copied. `close()` rejects new calls and drains existing ones; it never closes the borrowed files manager. No remote client, watcher, background cleanup or network access starts on import.

A logical asset ID cannot be uploaded/registered twice accidentally: duplicates reject `ASSET_EXISTS`. To append a version, pass `previousVersionId` matching the latest reference, optionally with `expectedRevision`. Each version has a random identifier independent of SHA-256, and a parent reference. Identical bytes produce separate owned objects and permissions; they are not deduplicated across principals or tenants. `versions(identity,assetId)` returns history, and `download(identity,versionId)` authorizes that exact reference. The catalog's `storage.version/*` records store the original asset plus an `asset.storage.version` JSON reference; `storage.retired/*` tombstones retire references without rewriting historical versions. The `storage.*` ID namespace and `asset.storage.*` metadata prefix are adapter-owned. Direct catalog mutation remains trusted and can violate these invariants; do not edit the records through legacy upsert methods.

Existing snapshots and `saveAssetCatalog`/`loadAssetCatalog` preserve these ordinary validated records, still using snapshot version 1. Persistence remains explicit: an in-memory catalog commit is not a durable disk/database transaction. The existing 8 MiB catalog-file limit still applies. Persist/reconcile the complete history before treating it as durable. Total-record budgets include tombstones and unrelated metadata; if full, increase/maintain the budget before further mutations. Catalog revisions and shared-catalog address leases coordinate only this process; separate catalogs/processes and arbitrary legacy writers require host locking/transactions.

`delete(identity,versionId,{binary:false,expectedRevision?})` only retires the reference. `{binary:true}` also deletes an owned, hash-verified object, but refuses borrowed binaries or addresses with other active references. Storage deletion happens before the tombstone: a definite backend failure leaves active metadata intact; a successful/uncertain delete followed by a revision/persistence failure can leave a missing binary referenced. Inspect storage and deliberately retire metadata with `binary:false` after reconciliation. There is no claim of a transaction spanning catalog and backend. Previously returned history snapshots are never overwritten.

## Failure compensation and repair

A failed upload, lost response, readback failure or metadata revision conflict never blindly deletes a key. A successful write may already exist. Owned objects carry namespace, tenant digest, version and expected-hash markers, so `previewRepair(identity,{cursor?,limit?})` can inventory unreferenced candidates under that exact tenant prefix. It lists at most 100 items per page; follow `nextCursor` even when an individual page has no candidates. Active historical/borrowed references protect their addresses, and uploads holding this catalog's lease are excluded. Metadata-only retirement of an owned object makes it repairable once no active reference remains. Unmarked/unrelated objects are never deletion candidates.

The compensating cleanup path is explicit: review the preview, then call `repair(identity,preview.items)`. It requires both the repair permission and a configured `approveRepair(identity,candidates)` returning `true`. Before deletion it rechecks catalog revision, active references, tenant address, ownership markers, ETag, size and actual bytes/hash. Changed candidates are skipped; integrity/backend failures propagate and retain the object for investigation/retry. A readback hash mismatch must be investigated rather than force-deleted by this helper. No repair starts automatically on failure or close. Keep previews/approval endpoints private and sanitize underlying storage errors before sending responses.

The files contract has no atomic delete-if-ETag primitive. Therefore binary deletion/repair requires **exclusive host ownership of this namespace**, coherent catalog coordination and no out-of-band object overwrites. Same-catalog leases cover these adapters, not arbitrary file-manager calls or other processes. Under concurrent external writers this API cannot prove safe compensating deletion; use an appropriate durable lock/conditional backend adapter instead. Never use identical hashes as proof that two references share permissions. Missing-binary metadata and corrupted catalogs require inspection; repair only deletes positively identified unreferenced owned objects.

Focused checks cover real disposable local storage, upload failure/lost response, duplicate/version IDs, revision conflicts, failed delete, integrity mismatch, registration ownership, tenant isolation, persisted history, explicit repair and lease/close cleanup. Packed consumers verify root import without files and `/storage` declarations with the actual files package. No live S3/MinIO, distributed catalog lock or crash-atomic cross-resource acceptance is claimed.

## Brand rules and audited editing

Assets may include validated `brand` metadata:

- `colorTokens`: up to 64 named `#RRGGBB`/`#RRGGBBAA` tokens, normalized to lowercase. Arbitrary CSS, names, functions and URLs are not accepted as tokens. Existing legacy color `value` strings retain their previous semantics.
- `logoVariants`, `localeVariants` and `themeVariants`: references to existing `asset.variants` names. Logo usage names are explicit; locales use canonical Intl language tags (duplicate canonical tags reject); themes are `light`, `dark` and `highContrast`. These maps do not automatically select or combine variants. Resolve the chosen name through the existing `resolve` API.
- `safeArea`: `{unit:'px'|'ratio',top,right,bottom,left}` with finite nonnegative values. Ratios are relative to the shorter rendered dimension, limited to 10; pixels are limited to 100000.
- `minimumSize`: positive `{unit:'px',width,height}` up to 100000 pixels.
- `developerNotes`: at most 8192 characters of inert text; and `publication`: `draft`, `review`, `published` or `archived`.

Unknown brand fields, malformed dimensions and missing variant references reject at every catalog validation/import boundary. Rules and publication states are **descriptive**: a published label does not grant access, and changing a label does not publish a website. Explicit `validateBrandUsage(asset,{width,height,clearance?})` from `/brand` checks minimum size/safe area against host-supplied measurements, returning value-free issue codes/paths. No binary measurement, automatic CSS enforcement or accessibility certification is implied.

Notes remain plain text. This package adds no rendering UI. A host UI must use `element.textContent = asset.brand?.developerNotes ?? ''`; server HTML must use the verified `@zeruxjs/security/encoding` text encoder at its text sink. Do not put notes in `innerHTML`, scripts, styles or event attributes. HTML escaping is not a JavaScript/CSS/URL policy.

`@zeruxjs/asset-manager/brand` adds an opt-in tenant editing workflow, leaving the synchronous legacy catalog and `/storage` APIs intact. It starts no network exporter on import. The host supplies a durable audit sink and an explicit failure policy:

```ts
import {createAssetManager} from '@zeruxjs/asset-manager';
import {createBrandCatalog} from '@zeruxjs/asset-manager/brand';
import type {BrandActor, BrandAuditSink, BrandCatalogOptions} from '@zeruxjs/asset-manager/brand';

export async function editBrand(
  actor: BrandActor, audit: BrandAuditSink,
  authorize: BrandCatalogOptions['authorize']
) {
  const catalog = createAssetManager();
  const brand = createBrandCatalog({catalog, tenant: actor.tenant,
    audit, auditPolicy: 'required', authorize});
  try {
    const result = await brand.add(actor, {
      id: 'brand/logo', name: 'Primary logo', type: 'image',
      url: 'https://cdn.example/logo.svg',
      variants: {dark: {url: 'https://cdn.example/logo-dark.svg'}},
      brand: {colorTokens: {accent: '#345678'}, logoVariants: {primary: 'dark'},
        themeVariants: {dark: 'dark'}, minimumSize: {unit: 'px', width: 100, height: 50},
        developerNotes: 'Use the dark variant on light backgrounds.', publication: 'draft'}
    }, catalog.revision);
    return {result, snapshot: await brand.snapshot(actor)};
  } finally { await brand.close(); }
}
```

Actors/tenants must be verified server identifiers, limited to 128 ASCII identifier characters; caller-supplied tenant strings are not authentication. The workflow is bound to one tenant and requires explicit authorization for add/update/delete/restore/read/snapshot. Do not combine mutually untrusted tenants in the borrowed catalog: snapshot permission exposes its complete private catalog, including stored binary references. The host must apply its publication/review/tenant policy before calling an edit. All mutations require an expected revision. `BrandRevisionError` extends `AssetRevisionError` with `expectedRevision`, `actualRevision`, `assetId` and optional audit status, allowing an authorized UI to fetch current data and resolve conflicts rather than silently overwrite it. Concurrent workflow mutations reject busy; there is no hidden last-writer-wins queue.

`add` rejects existing IDs; `update` validates the complete resulting asset; `delete` removes current metadata only; `restore(actor,versionId,expectedRevision)` appends a new edit from a prior nondeleted version. It does not recreate deleted binaries. Every committed edit appends a distinct immutable metadata version with a random version ID, parent reference, observation time, actor, action and canonical SHA-256 metadata digest. Returned data is copied. The `storage.*` namespace remains protected; existing storage history records and arbitrary reference metadata are carried forward unchanged. Content hashes verify the chosen bytes/metadata, not authorship, identity, permission or the validity of a brand decision.

### Audit policy and consistency

The injected `BrandAuditSink.append(event)` must resolve only after its own durable acknowledgement. Events contain schema version 1, actor/tenant, action, mutation time, event/version IDs, proposed revisions and before/after **metadata** hashes (`hashDomain:'asset-metadata-v1'`). They contain no asset object, notes, URLs (including signed access URLs), binary bytes or storage credentials. Identifiers must not contain credentials. `at` is mutation observation time, shared across its phases; the sink may additionally record delivery time.

The workflow emits `intent` before publishing catalog state, then `committed` after the local commit. These are separate acknowledgements, not a distributed transaction with the sink or a catalog file. A revision change while awaiting intent emits `rejected`; a required-policy conflict reports the audit outcome on `BrandRevisionError`. An unresolved intent after a process crash is not proof of a committed edit and requires host reconciliation.

With `auditPolicy:'required'`, an intent failure throws `BrandAuditError` with `committed:false` and leaves catalog/history untouched. If the terminal acknowledgement fails **after** commit, the same fixed-message error has `committed:true` and a `{versionId,revision}` receipt. The mutation already happened: reconcile that receipt and audit delivery, never blindly replay it. Causes remain private for trusted diagnostics, not client responses. With `'best-effort'`, the edit can commit after sink failure, but its result explicitly reports `audit:'failed'`; it never claims durable audit success. No automatic retry/exporter queue or fallback sink is added. The host owns sink retention, credentials, deduplication by event ID/phase, deadlines and outage handling.

Defaults are 1000 history entries (maximum 10000), eight pending calls (maximum 64) and an 8 MiB private snapshot budget. Budget checks run before audit intent. One workflow owns a catalog at a time; `close()` rejects new work, drains actual sink settlement and releases ownership once. It does not close the borrowed sink/catalog or force-cancel a noncooperative promise. Drain application mutations, snapshot/save, then close when durable final state is required. Direct legacy catalog/storage writes are outside this audit workflow and may trigger revision conflicts; coordinate them explicitly. No process-local revision or ownership lease is a cross-process lock.

### Snapshot version 2

Legacy `AssetSnapshot`, `catalog.snapshot()`, `saveAssetCatalog` and `loadAssetCatalog` remain version 1. The explicit brand format is `{version:2,tenant,catalog:<version-1 snapshot>,history:[...]}`. `migrateBrandSnapshot(v1,tenant,observedAt?)` validates/copies legacy assets and preserves the catalog revision/storage references. Editable assets receive baseline history marked `action:'migration'` without an invented actor; `at` records migration observation, not historical authorship. It does not emit fabricated add audit events.

`brand.snapshot(actor)` returns this private V2 document. `saveBrandSnapshot(snapshot,file)` and `loadBrandSnapshot(file,tenant)` reuse the bounded, restricted-permission, atomic catalog writer/no-follow reader. Loading V1 performs the explicit migration; V2 validates tenant, hashes, version IDs and earlier same-asset parent references. Creating a workflow with `snapshot` requires an empty target catalog. Snapshots include historical private URLs/notes/references and are not public manifests or signed provenance. A party able to rewrite a snapshot can recompute hashes; use host authentication/signatures/permissions where needed. Persist the complete V2 snapshot to retain edit history—saving only its nested V1 catalog loses that workflow history. No automatic history pruning occurs at a budget limit.

Focused checks cover V1/V2 loading, malformed rules, script-like notes remaining inert, immutable history/restore, stale revisions, required/best-effort sink failures, rejected intents, persistence and exact close ownership. Packed consumers compile the public example. Durable audit provider/retention, multi-process transactions and UI/browser rendering remain host prerequisites; no live audit service or browser UI is claimed.

## Source and runtime ownership

| Module                                     | Responsibility                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`, `validation.ts`, `variants.ts` | Catalog-owned metadata shapes, bounded validation and explicit variant selection. Values/notes are inert; URLs are not fetch authority.                                                          |
| `manager.ts`                               | Detached reads and staged single-process batch/revision changes. Legacy `add`/batch add remain upserts; optional workflows impose their own stronger duplicate/version policy.                   |
| `catalog-io.ts`, `persistence.ts`          | Bounded private JSON and owned no-follow descriptors, exclusive temporary files, sync/rename and failure cleanup. Parent directory trust and multiple-writer locks remain host responsibilities. |
| `brand-rules.ts`, `brand.ts`               | Descriptive rules plus explicit usage validation, immutable V2 history and acknowledged audit phases. Postcommit audit failure carries a committed receipt.                                      |
| `storage.ts`                               | Explicit tenant-scoped binary ownership, bounded hash verification and approved orphan repair. Same-catalog address leases are process-local.                                                    |

Root imports eagerly include Node filesystem persistence; `/storage` and `/brand` also import Node cryptography. No browser runtime entry is offered by this package. Erased type imports are separate from executable imports. Rendering consumers should receive explicitly authorized sanitized public data, not private snapshots/references. The standalone catalog owns no close handle; storage/brand workflow owners must await `close()` before releasing borrowed files or audit resources. Neither close forcibly cancels arbitrary host promises.
