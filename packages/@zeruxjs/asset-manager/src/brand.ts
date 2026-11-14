import { createHash, randomBytes } from 'node:crypto';
import type { Asset, AssetSnapshot } from './types.js';
import {
  AssetManager,
  AssetRevisionError,
  createAssetManager,
} from './manager.js';
import { readCatalogData, writeCatalogData } from './catalog-io.js';
import { validateAsset } from './validation.js';
export * from './brand-rules.js';
export type BrandAction = 'add' | 'update' | 'delete' | 'restore';
export interface BrandActor {
  /** Verified server actor label; never an email-derived identity by default. */
  actor: string;
  /** Fixed verified tenant boundary. */
  tenant: string;
}
export interface BrandVersion {
  /** Random immutable metadata version identifier. */
  versionId: string;
  /** Logical asset identity outside reserved storage records. */
  assetId: string;
  /** Detached metadata or null for an explicit deletion. */
  asset: Asset | null;
  /** Canonical metadata digest or null for deletion; never authorship/permission. */
  hash: string | null;
  /** Earlier same-asset immutable parent reference. */
  previousVersionId?: string;
  /** Explicit edit action, or migration with no invented actor. */
  action: BrandAction | 'migration';
  /** Verified server actor label; never an email-derived identity by default. */
  actor?: string;
  /** Server observation time, not a fabricated historical author date. */
  at: number;
  /** Single-process optimistic catalog revision. */
  revision: number;
}
export interface BrandCatalogSnapshot {
  /** Explicit V2 snapshot format version. */
  version: 2;
  /** Fixed verified tenant boundary. */
  tenant: string;
  /** Borrowed V1 catalog or nested snapshot; host owns persistence. */
  catalog: AssetSnapshot;
  /** Private immutable metadata versions; not automatically pruned. */
  history: BrandVersion[];
}
export interface BrandAuditEvent {
  /** Audit event schema version one. */
  schema: 1;
  /** Opaque audit event identifier for host deduplication. */
  eventId: string;
  /** Intent, committed or rejected acknowledgement phase. */
  phase: 'intent' | 'committed' | 'rejected';
  /** Verified server actor label; never an email-derived identity by default. */
  actor: string;
  /** Fixed verified tenant boundary. */
  tenant: string;
  /** Server observation time, not a fabricated historical author date. */
  at: number;
  /** Explicit edit action, or migration with no invented actor. */
  action: BrandAction;
  /** Logical asset identity outside reserved storage records. */
  assetId: string;
  /** Random immutable metadata version identifier. */
  versionId: string;
  /** Required previous local revision. */
  expectedRevision: number;
  /** Proposed next local revision, not proof it committed. */
  nextRevision: number;
  /** Explicit asset-metadata-v1 digest domain. */
  hashDomain: 'asset-metadata-v1';
  /** SHA-256 metadata hashing, not a signature. */
  hashAlgorithm: 'sha256';
  /** Previous metadata digest, or null for absence. */
  beforeHash: string | null;
  /** Proposed metadata digest, or null for deletion. */
  afterHash: string | null;
}
export interface BrandAuditSink {
  /** Resolve only after durable acknowledgement; no raw asset/notes/URLs/binaries are supplied. */
  append(event: Readonly<BrandAuditEvent>): Promise<void>;
}
export interface BrandCatalogOptions {
  /** Borrowed V1 catalog or nested snapshot; host owns persistence. */
  catalog: AssetManager;
  /** Fixed verified tenant boundary. */
  tenant: string;
  /** Borrowed host sink or explicit mutation acknowledgement result. */
  audit: BrandAuditSink;
  /** Required or best-effort; postcommit failure remains explicit. */
  auditPolicy: 'required' | 'best-effort';
  /** Required fresh host permission callback. */
  authorize: (
    identity: BrandActor,
    action: BrandAction | 'read' | 'snapshot',
    assetId: string
  ) => boolean | Promise<boolean>;
  /** Optional private baseline, accepted only with an empty target catalog. */
  snapshot?: AssetSnapshot | BrandCatalogSnapshot;
  /** History cap, default 1000 and maximum 10000. */
  maxHistory?: number;
  /** Actual-settlement admission cap, default eight and maximum 64. */
  maxPending?: number;
  /** Trusted injected server clock or Date.now. */
  now?: () => number;
}
export interface BrandMutationResult {
  /** Explicit V2 snapshot format version. */
  version: BrandVersion;
  /** Single-process optimistic catalog revision. */
  revision: number;
  /** Borrowed host sink or explicit mutation acknowledgement result. */
  audit: 'written' | 'failed';
}
/** Resolvable local revision conflict with explicit audit acknowledgement status when known. */
export class BrandRevisionError extends AssetRevisionError {
  /** Create an explicit conflict/audit error carrying only the documented revision or committed receipt. Private causes remain for trusted diagnostics.
   * @param {number} expectedRevision - Previous revision expected by the caller.
   * @param {number} actualRevision - Observed local catalog revision.
   * @param {string} assetId - Logical conflicting asset ID.
   * @param {'written' | 'failed'} auditStatus - Optional explicit rejected-audit acknowledgement.
   */
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
    readonly assetId: string,
    readonly auditStatus?: 'written' | 'failed'
  ) {
    super();
    this.name = 'BrandRevisionError';
  }
}
/** Explicit durable-audit failure; committed receipts must be reconciled instead of blindly replayed. */
export class BrandAuditError extends Error {
  /** Stable public failure category with no private sink values. */
  readonly code = 'BRAND_AUDIT_FAILED';
  /** Create an explicit conflict/audit error carrying only the documented revision or committed receipt. Private causes remain for trusted diagnostics.
   * @param {BrandAuditEvent['phase']} phase - Intent or terminal audit phase that failed.
   * @param {boolean} committed - Whether local catalog mutation already committed.
   * @param {{ versionId: string; revision: number } | undefined} receipt - Committed version/revision when available; reconcile rather than replay.
   * @param {unknown} cause - Private underlying sink failure, never a client response.
   */
  constructor(
    readonly phase: BrandAuditEvent['phase'],
    readonly committed: boolean,
    readonly receipt:
      | {
          /** Random immutable metadata version identifier. */
          versionId: string; /** Single-process optimistic catalog revision. */
          revision: number;
        }
      | undefined,
    cause: unknown
  ) {
    super('Brand audit sink failed', { cause });
    this.name = 'BrandAuditError';
  }
}
/** Process-local ownership set: one brand workflow per borrowed catalog, not a distributed lock. */
const active = new WeakSet<AssetManager>();
/** Exact random 24-byte history version-ID grammar. */
const idPattern = /^[a-f0-9]{48}$/;
/** Validate bounded host actor/tenant labels without authenticating them.
 * @param {unknown} value - Candidate verified server label.
 * @returns {void} Unsupported identifiers throw.
 */
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@-]{1,128}$/.test(value)) {
    throw new TypeError('Invalid brand actor or tenant');
  }
}
/** Reject invalid IDs and the storage adapter-owned namespace before edits.
 * @param {string} id - Editable logical asset identifier outside the storage namespace.
 * @returns {void} Invalid/reserved identifiers throw.
 */
function editable(id: string) {
  if (
    typeof id !== 'string' ||
    id.startsWith('storage.') ||
    !/^[\w.:/-]{1,128}$/.test(id) ||
    ['__proto__', 'constructor', 'prototype'].includes(id)
  ) {
    throw new TypeError('Invalid editable asset ID');
  }
}
/** Serialize validated metadata deterministically with sorted object keys.
 * @param {unknown} value - Validated metadata object/array/scalar.
 * @returns {string} Stable JSON spelling; input is detached acyclic catalog data.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) +
          ':' +
          canonical((value as Record<string, unknown>)[key])
      )
      .join(',') +
    '}'
  );
}
/** Hash normalized metadata only, not binary content or authorship.
 * @param {Asset} asset - Asset candidate validated before canonical serialization.
 * @returns {string} Canonical SHA-256 metadata digest.
 */
export function hashAssetMetadata(asset: Asset): string {
  return createHash('sha256')
    .update(canonical(validateAsset(asset)))
    .digest('hex');
}
/** Validate private snapshot serialization against the shared eight-MiB ceiling.
 * @param {unknown} value - Detached candidate private snapshot.
 * @returns {void} Unserializable or oversized snapshots reject before audit intent/write.
 */
function bounded(value: unknown) {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new TypeError('Invalid brand snapshot data');
  }
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) {
    throw new RangeError('Brand snapshot exceeds 8 MiB');
  }
}
/** Require a nonnegative safe server timestamp.
 * @param {number} value - Trusted injected clock sample.
 * @returns {number} Validated observation time.
 */
function time(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid brand timestamp');
  }
  return value;
}
/** Validate/copy V1 or V2 snapshots and explicitly migrate baseline history without inventing actors.
 * @param {AssetSnapshot | BrandCatalogSnapshot} input - Untrusted private snapshot data.
 * @param {string} tenant - Fixed verified snapshot tenant.
 * @param {number} observedAt - Migration observation time, default current server time.
 * @returns {BrandCatalogSnapshot} Private V2 snapshot preserving catalog revision and reference metadata; malformed history rejects.
 */
export function migrateBrandSnapshot(
  input: AssetSnapshot | BrandCatalogSnapshot,
  tenant: string,
  observedAt = Date.now()
): BrandCatalogSnapshot {
  identifier(tenant);
  time(observedAt);
  bounded(input);
  if (!input || ![1, 2].includes(input.version)) {
    throw new TypeError('Unsupported brand snapshot');
  }
  /** Borrowed metadata catalog; the host owns persistence and unrelated legacy/storage writers. */
  const catalog = createAssetManager();
  catalog.load(input.version === 1 ? input : input.catalog);
  /** Validated current V1 snapshot used as migration/history baseline. */
  const current = catalog.snapshot();
  if (input.version === 1) {
    /** Explicit V2 baseline whose migration time is observation, never invented authorship. */
    const migrated: BrandCatalogSnapshot = {
      version: 2,
      tenant,
      catalog: current,
      history: current.assets
        .filter((asset) => !asset.id.startsWith('storage.'))
        .map((asset) => ({
          versionId: randomBytes(24).toString('hex'),
          assetId: asset.id,
          asset,
          hash: hashAssetMetadata(asset),
          action: 'migration',
          at: observedAt,
          revision: current.revision ?? 0,
        })),
    };
    bounded(migrated);
    return migrated;
  }
  if (
    input.tenant !== tenant ||
    !Array.isArray(input.history) ||
    input.history.length > 10000
  ) {
    throw new TypeError('Invalid brand snapshot tenant/history');
  }
  /** Owned immutable metadata versions retained within the configured finite history budget. */
  const history: BrandVersion[] = [];
  /** Previously validated version IDs for duplicate and same-asset parent checks. */
  const seen = new Map<string, BrandVersion>();
  // Validate each history entry against already observed IDs, parent asset and catalog revision.
  for (const item of input.history) {
    if (
      !item ||
      !idPattern.test(item.versionId) ||
      seen.has(item.versionId) ||
      !['migration', 'add', 'update', 'delete', 'restore'].includes(
        item.action
      ) ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 0 ||
      item.revision > (current.revision ?? 0)
    ) {
      throw new TypeError('Invalid brand history');
    }
    editable(item.assetId);
    time(item.at);
    if (item.actor !== undefined) {
      identifier(item.actor);
    }
    if (item.action !== 'migration' && item.actor === undefined) {
      throw new TypeError('Missing brand history actor');
    }
    /** Validated detached historical asset or explicit deletion tombstone. */
    const asset = item.asset === null ? null : validateAsset(item.asset);
    if (
      (asset && asset.id !== item.assetId) ||
      (item.action === 'delete' && asset !== null) ||
      (item.action !== 'delete' && asset === null) ||
      item.hash !== (asset ? hashAssetMetadata(asset) : null)
    ) {
      throw new TypeError('Invalid brand history hash');
    }
    if (
      item.previousVersionId !== undefined &&
      seen.get(item.previousVersionId)?.assetId !== item.assetId
    ) {
      throw new TypeError('Invalid brand history parent');
    }
    /** Distinct immutable metadata version; hash identifies metadata, not binary bytes or permission. */
    const version: BrandVersion = {
      versionId: item.versionId,
      assetId: item.assetId,
      asset,
      hash: item.hash,
      action: item.action,
      at: item.at,
      revision: item.revision,
      ...(item.actor !== undefined ? { actor: item.actor } : {}),
      ...(item.previousVersionId
        ? { previousVersionId: item.previousVersionId }
        : {}),
    };
    seen.set(version.versionId, version);
    history.push(version);
  }
  /** Validated detached private V2 snapshot or explicit mutation receipt. */
  const result: BrandCatalogSnapshot = {
    version: 2,
    tenant,
    catalog: current,
    history,
  };
  bounded(result);
  return structuredClone(result);
}
/** Create one tenant-bound audited edit owner over a borrowed catalog. Construction starts no exporter; close drains active work and releases this local ownership.
 * @param {BrandCatalogOptions} options - Explicit tenant, fresh authorization, audit policy and bounded history/admission settings.
 * @returns {ReturnType<typeof createBrandCatalog>} Disposable workflow; the host owns sink durability, persistence and cross-process coordination.
 */
export function createBrandCatalog(options: BrandCatalogOptions) {
  if (
    !options ||
    !(options.catalog instanceof AssetManager) ||
    typeof options.audit?.append !== 'function' ||
    typeof options.authorize !== 'function' ||
    !['required', 'best-effort'].includes(options.auditPolicy)
  ) {
    throw new TypeError(
      'Brand catalog requires explicit authorization/audit policy'
    );
  }
  identifier(options.tenant);
  /** Borrowed metadata catalog; the host owns persistence and unrelated legacy/storage writers. */
  const catalog = options.catalog;
  /** Fixed verified tenant bound to this workflow. */
  const tenant = options.tenant;
  /** Trusted server clock or explicit host test clock. */
  const now = options.now ?? Date.now;
  /** History ceiling, default 1000 and maximum 10000; no silent pruning. */
  const maxHistory = options.maxHistory ?? 1000;
  /** Actual-settlement admission limit, default eight and maximum 64. */
  const maxPending = options.maxPending ?? 8;
  if (
    typeof now !== 'function' ||
    !Number.isSafeInteger(maxHistory) ||
    maxHistory < 1 ||
    maxHistory > 10000 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 64
  ) {
    throw new TypeError('Invalid brand workflow limits');
  }
  if (active.has(catalog)) {
    throw new Error('Brand catalog already owned');
  }
  if (options.snapshot && catalog.size) {
    throw new Error('Snapshot restoration requires an empty catalog');
  }
  /** Validated/migrated baseline snapshot checked before claiming catalog ownership. */
  const initial = migrateBrandSnapshot(
    options.snapshot ?? catalog.snapshot(),
    tenant,
    time(now())
  );
  if (initial.history.length > maxHistory) {
    throw new RangeError('Brand history limit');
  }
  if (options.snapshot) {
    catalog.load(initial.catalog);
  }
  /** Owned immutable metadata versions retained within the configured finite history budget. */
  const history = initial.history;
  /** Actual host authorization/audit/mutation work retained until settlement. */
  const pending = new Set<Promise<unknown>>();
  let closed = false,
    mutating = false,
    closing: Promise<void> | undefined;
  /** Borrowed audit append bound to its sink; the host owns durability and sink shutdown. */
  const append = options.audit.append.bind(options.audit);
  /** Explicit required versus best-effort acknowledgement policy; no hidden fallback sink. */
  const auditPolicy = options.auditPolicy;
  active.add(catalog);
  /** Admit bounded host work without hiding a mutation queue.
   * @param {() => Promise<T>} fn - Explicit asynchronous workflow operation.
   * @returns {Promise<T>} Actual operation result; closed/busy calls reject and settlement releases the slot.
   */
  function run<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(new Error('Brand catalog closed'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(new Error('Brand catalog busy'));
    }
    /** Actual asynchronous operation settlement owning its admission slot. */
    const work = Promise.resolve().then(fn);
    pending.add(work);
    work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
    return work;
  }
  /** Validate and detach actor labels against this workflow tenant.
   * @param {BrandActor} input - Host-verified actor/tenant context, never browser role claims.
   * @returns {BrandActor} Matching verified labels; this is not authentication.
   */
  function who(input: BrandActor) {
    if (!input) {
      throw new TypeError('Brand actor required');
    }
    identifier(input.actor);
    identifier(input.tenant);
    if (input.tenant !== tenant) {
      throw new Error('Brand tenant denied');
    }
    return { ...input };
  }
  /** Require a fresh literal-true host permission for the exact action/asset.
   * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
   * @param {Parameters<BrandCatalogOptions['authorize']>[1]} action - Explicit workflow/read capability.
   * @param {string} id - Editable logical asset identifier outside the storage namespace.
   * @returns {Promise<void>} Denied authorization rejects before catalog/audit mutation.
   */
  async function permit(
    actor: BrandActor,
    action: Parameters<BrandCatalogOptions['authorize']>[1],
    id: string
  ) {
    if ((await options.authorize({ ...actor }, action, id)) !== true) {
      throw new Error('Brand action denied');
    }
  }
  /** Require an explicit safe expected revision matching current local state.
   * @param {number} revision - Required exact local catalog revision; stale edits reject.
   * @param {string} id - Editable logical asset identifier outside the storage namespace.
   * @returns {void} Invalid or stale revisions throw a resolvable conflict.
   */
  function check(revision: number, id: string) {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new TypeError('Expected revision required');
    }
    if (revision !== catalog.revision) {
      throw new BrandRevisionError(revision, catalog.revision, id);
    }
  }
  /** Stage an authorized edit, await audit intent, fence the local revision, then emit terminal audit. A terminal sink failure can report already-committed state.
   * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
   * @param {BrandAction} action - Explicit add/update/delete/restore operation.
   * @param {string} id - Editable logical asset identifier outside the storage namespace.
   * @param {number} expectedRevision - Required exact local catalog revision; stale edits reject.
   * @param {(before: Asset | undefined) => Asset | null} produce - Trusted internal synchronous producer returning validated metadata or deletion.
   * @returns {Promise<BrandMutationResult>} Distinct immutable version plus explicit audit outcome; no catalog/sink distributed transaction.
   */
  async function mutate(
    actor: BrandActor,
    action: BrandAction,
    id: string,
    expectedRevision: number,
    produce: (before: Asset | undefined) => Asset | null
  ) {
    actor = who(actor);
    editable(id);
    check(expectedRevision, id);
    if (mutating) {
      throw new Error('Brand mutation busy');
    }
    mutating = true;
    try {
      await permit(actor, action, id);
      check(expectedRevision, id);
      if (history.length >= maxHistory) {
        throw new RangeError('Brand history limit');
      }
      /** Detached current metadata observed at the expected revision. */
      const before = catalog.get(id);
      /** Validated proposed metadata or explicit deletion, staged before audit intent. */
      const after = produce(before);
      /** Latest same-asset immutable version reference, never hash-based permission deduplication. */
      const parent = [...history].reverse().find((v) => v.assetId === id);
      /** Trusted mutation observation timestamp shared by all audit phases. */
      const at = time(now());
      /** Distinct immutable metadata version; hash identifies metadata, not binary bytes or permission. */
      const version: BrandVersion = {
        versionId: randomBytes(24).toString('hex'),
        assetId: id,
        asset: after,
        hash: after ? hashAssetMetadata(after) : null,
        action,
        actor: actor.actor,
        at,
        revision: expectedRevision + 1,
        ...(parent ? { previousVersionId: parent.versionId } : {}),
      };
      // Stage through the existing validator/revision implementation; no live mutation before audit intent.
      /** Private candidate catalog; no live mutation occurs before required audit intent. */
      const staging = createAssetManager();
      staging.load(catalog.snapshot());
      staging.apply(
        after ? [{ action: 'add', asset: after }] : [{ action: 'remove', id }],
        expectedRevision
      );
      bounded({
        version: 2,
        tenant,
        catalog: staging.snapshot(),
        history: [...history, version],
      });
      /** Payload-free audit identity/revision/hash metadata, never notes/URLs/binary data. */
      const event: BrandAuditEvent = {
        schema: 1,
        eventId: randomBytes(24).toString('hex'),
        phase: 'intent',
        actor: actor.actor,
        tenant,
        at,
        action,
        assetId: id,
        versionId: version.versionId,
        expectedRevision,
        nextRevision: expectedRevision + 1,
        hashDomain: 'asset-metadata-v1',
        hashAlgorithm: 'sha256',
        beforeHash: before ? hashAssetMetadata(before) : null,
        afterHash: version.hash,
      };
      let failed = false;
      try {
        await append(Object.freeze({ ...event }));
      } catch (cause) {
        failed = true;
        if (auditPolicy === 'required') {
          throw new BrandAuditError('intent', false, undefined, cause);
        }
      }
      if (catalog.revision !== expectedRevision) {
        let auditStatus: 'written' | 'failed' = 'written';
        try {
          await append(Object.freeze({ ...event, phase: 'rejected' }));
        } catch {
          auditStatus = 'failed';
        }
        throw new BrandRevisionError(
          expectedRevision,
          catalog.revision,
          id,
          auditStatus
        );
      }
      catalog.apply(
        after ? [{ action: 'add', asset: after }] : [{ action: 'remove', id }],
        expectedRevision
      );
      history.push(version);
      /** Postcommit version/revision evidence; audit failure after this point must not be blindly replayed. */
      const receipt = {
        versionId: version.versionId,
        revision: catalog.revision,
      };
      try {
        await append(Object.freeze({ ...event, phase: 'committed' }));
      } catch (cause) {
        failed = true;
        if (auditPolicy === 'required') {
          throw new BrandAuditError('committed', true, receipt, cause);
        }
      }
      return {
        version: structuredClone(version),
        revision: receipt.revision,
        audit: failed ? 'failed' : 'written',
      } satisfies BrandMutationResult;
    } finally {
      mutating = false;
    }
  }
  return {
    /** Reject an existing editable ID and append one authorized audited metadata version.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @param {Asset} asset - Complete untrusted metadata validated before staging.
     * @param {number} expectedRevision - Required exact local catalog revision; stale edits reject.
     * @returns {Promise<BrandMutationResult>} Committed version and audit outcome; expected revision is mandatory.
     */
    add(actor: BrandActor, asset: Asset, expectedRevision: number) {
      return run(() => {
        /** Detached validated mutation input; later caller changes cannot alter this edit. */
        const copy = validateAsset(asset);
        return mutate(actor, 'add', copy.id, expectedRevision, (before) => {
          if (before) {
            throw new Error('Brand asset already exists');
          }
          return copy;
        });
      });
    },
    /** Validate the complete merged asset and append a new metadata history version.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @param {string} id - Editable logical asset identifier outside the storage namespace.
     * @param {Partial<Omit<Asset, 'id'>>} changes - Detached partial metadata changes; ID is fixed.
     * @param {number} expectedRevision - Required exact local catalog revision; stale edits reject.
     * @returns {Promise<BrandMutationResult>} Committed receipt or explicit revision/audit failure.
     */
    update(
      actor: BrandActor,
      id: string,
      changes: Partial<Omit<Asset, 'id'>>,
      expectedRevision: number
    ) {
      return run(() => {
        /** Detached validated mutation input; later caller changes cannot alter this edit. */
        const copy = structuredClone(changes);
        return mutate(actor, 'update', id, expectedRevision, (before) => {
          if (!before) {
            throw new Error('Brand asset not found');
          }
          return validateAsset({ ...before, ...copy, id });
        });
      });
    },
    /** Delete current metadata only and append an immutable deletion version.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @param {string} id - Editable logical asset identifier outside the storage namespace.
     * @param {number} expectedRevision - Required exact local catalog revision; stale edits reject.
     * @returns {Promise<BrandMutationResult>} Metadata/audit receipt; no binary deletion occurs.
     */
    delete(actor: BrandActor, id: string, expectedRevision: number) {
      return run(() =>
        mutate(actor, 'delete', id, expectedRevision, (before) => {
          if (!before) {
            throw new Error('Brand asset not found');
          }
          return null;
        })
      );
    },
    /** Append a new edit from an existing nondeleted metadata version.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @param {string} versionId - Exact immutable same-tenant historical version.
     * @param {number} expectedRevision - Required exact local catalog revision; stale edits reject.
     * @returns {Promise<BrandMutationResult>} New restoration version; deleted binaries are never recreated.
     */
    restore(actor: BrandActor, versionId: string, expectedRevision: number) {
      return run(() => {
        actor = who(actor);
        if (!idPattern.test(versionId)) {
          throw new TypeError('Invalid brand version');
        }
        /** Distinct immutable metadata version; hash identifies metadata, not binary bytes or permission. */
        const version = history.find((v) => v.versionId === versionId);
        if (!version?.asset) {
          throw new Error('Restorable brand version not found');
        }
        return mutate(actor, 'restore', version.assetId, expectedRevision, () =>
          structuredClone(version.asset!)
        );
      });
    },
    /** Authorize read and return a detached current metadata record.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @param {string} id - Editable logical asset identifier outside the storage namespace.
     * @returns {Promise<Asset|undefined>} Copied record or absence; host UI must escape notes at its sink.
     */
    get(actor: BrandActor, id: string) {
      return run(async () => {
        actor = who(actor);
        editable(id);
        await permit(actor, 'read', id);
        return catalog.get(id);
      });
    },
    /** Authorize and copy immutable metadata history for one editable asset.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @param {string} id - Editable logical asset identifier outside the storage namespace.
     * @returns {Promise<BrandVersion[]>} Private versions; history can include URLs/notes and must not be public.
     */
    history(actor: BrandActor, id: string) {
      return run(async () => {
        actor = who(actor);
        editable(id);
        await permit(actor, 'read', id);
        return structuredClone(history.filter((v) => v.assetId === id));
      });
    },
    /** Authorize a complete private tenant/catalog/history snapshot.
     * @param {BrandActor} actor - Host-verified actor/tenant context, never browser role claims.
     * @returns {Promise<BrandCatalogSnapshot>} Bounded V2 data; do not mix mutually untrusted tenants in the borrowed catalog.
     */
    snapshot(actor: BrandActor) {
      return run(async () => {
        actor = who(actor);
        await permit(actor, 'snapshot', '*');
        /** Validated detached private V2 snapshot or explicit mutation receipt. */
        const result: BrandCatalogSnapshot = {
          version: 2,
          tenant,
          catalog: catalog.snapshot(),
          history: structuredClone(history),
        };
        bounded(result);
        return result;
      });
    },
    /** Stop new admission, drain actual sink/authorization work and release local ownership once.
     * @returns {Promise<void>} Idempotent drain; borrowed sink/catalog are never closed and noncooperative promises may delay settlement.
     */
    close() {
      closed = true;
      return (closing ??= (async () => {
        await Promise.allSettled([...pending]);
        active.delete(catalog);
      })());
    },
  };
}

/** Validate and atomically save a private V2 snapshot through the shared bounded writer.
 * @param {BrandCatalogSnapshot} snapshot - Private V2 snapshot with complete metadata history.
 * @param {string} file - Private snapshot under a host-trusted directory.
 * @returns {Promise<void>} Settles after complete same-directory promotion; host owns directory trust/locking.
 */
export async function saveBrandSnapshot(
  snapshot: BrandCatalogSnapshot,
  file: string
): Promise<void> {
  if (snapshot?.version !== 2) {
    throw new TypeError('Expected brand snapshot version 2');
  }
  await writeCatalogData(file, migrateBrandSnapshot(snapshot, snapshot.tenant));
}
/** Read inert bounded V1/V2 JSON and validate/migrate it for the explicit tenant.
 * @param {string} file - Private snapshot under a host-trusted directory.
 * @param {string} tenant - Fixed verified expected tenant.
 * @returns {Promise<BrandCatalogSnapshot>} Validated private V2 snapshot; no notes/source is evaluated.
 */
export async function loadBrandSnapshot(
  file: string,
  tenant: string
): Promise<BrandCatalogSnapshot> {
  return migrateBrandSnapshot(
    (await readCatalogData(file)) as AssetSnapshot | BrandCatalogSnapshot,
    tenant
  );
}
