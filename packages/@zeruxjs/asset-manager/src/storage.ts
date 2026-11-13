import { createHash, randomBytes } from 'node:crypto';
import type {
  StorageManager,
  FileAddress,
  FileSource,
  FileInfo,
} from '@zeruxjs/files' with { 'resolution-mode': 'import' };
import type { Asset } from './types.js';
import { AssetManager, AssetRevisionError } from './manager.js';
import { validateAsset } from './validation.js';
export interface AssetIdentity {
  /** Verified tenant label; never infer it from untrusted headers. */
  tenant: string;
  /** Verified initiating subject label. */
  subject: string;
}
export interface AssetVersionReference {
  /** Stored reference format version, fixed at one. */
  schema: 1;
  /** Random immutable version identifier independent of content hash. */
  versionId: string;
  /** Logical catalog asset identity. */
  assetId: string;
  /** Partition digest, not proof of authentication/anonymization. */
  tenantDigest: string;
  /** Configured adapter namespace. */
  namespace: string;
  /** Private named storage/bucket/key; do not expose indiscriminately to clients. */
  address: FileAddress;
  /** Whether this workflow uploaded and owns the binary. */
  owned: boolean;
  /** Exact nonnegative byte length. */
  size: number;
  /** Lowercase SHA-256 integrity hash. */
  sha256: string;
  /** Allowlisted declared MIME; no format sniffing or malware scan. */
  contentType: string;
  /** Server-time version observation timestamp. */
  createdAt: number;
  /** Explicit previous immutable version reference. */
  parentVersionId?: string;
}
export interface StoredAssetVersion {
  /** Detached descriptive catalog metadata. */
  asset: Asset;
  /** Private immutable storage reference. */
  reference: AssetVersionReference;
  /** Whether an explicit tombstone retired this reference. */
  retired: boolean;
}
export interface AssetRepairCandidate {
  /** Private named storage/bucket/key; do not expose indiscriminately to clients. */
  address: FileAddress;
  /** Random immutable version identifier independent of content hash. */
  versionId: string;
  /** Observed object identity rechecked before approved repair. */
  etag: string;
  /** Exact nonnegative byte length. */
  size: number;
  /** Lowercase SHA-256 integrity hash. */
  sha256: string;
  /** Catalog revision captured during preview/publication. */
  revision: number;
}
export interface AssetAccessContext {
  /** Private named storage/bucket/key; do not expose indiscriminately to clients. */
  address?: FileAddress;
  /** Random immutable version identifier independent of content hash. */
  versionId?: string;
  /** Whether this workflow uploaded and owns the binary. */
  owned?: boolean;
}
export interface AssetStorageOptions {
  /** Borrowed process-local catalog; host owns durable persistence. */
  catalog: AssetManager;
  /** Borrowed; the adapter never closes the file manager. */
  files: StorageManager;
  /** Configured adapter namespace. */
  namespace: string;
  /** Required stable host tenant/location resolver. */
  location: (identity: AssetIdentity) => {
    storage: string;
    bucket: string;
    prefix?: string;
  };
  /** Required fresh host permission callback per invocation. */
  authorize: (
    identity: AssetIdentity,
    action:
      | 'upload'
      | 'register'
      | 'versions'
      | 'download'
      | 'delete'
      | 'repair',
    assetId: string,
    context?: Readonly<AssetAccessContext>
  ) => boolean | Promise<boolean>;
  /** Explicit bounded MIME allowlist. */
  allowedTypes: readonly string[];
  /** Binary ceiling, default 16MiB and maximum 64MiB. */
  maxBytes?: number;
  /** Total records including tombstones, default 10000 and maximum 100000. */
  maxRecords?: number;
  /** Actual-settlement admission cap, default four and maximum 64. */
  maxPending?: number;
  /** Explicit trusted approval callback; absent/false denies cleanup. */
  approveRepair?: (
    identity: AssetIdentity,
    candidates: readonly AssetRepairCandidate[]
  ) => boolean | Promise<boolean>;
}
export interface AssetStorageInput {
  /** Detached descriptive catalog metadata. */
  asset: Asset;
  /** Exact nonnegative byte length. */
  size: number;
  /** Lowercase SHA-256 integrity hash. */
  sha256: string;
  /** Allowlisted declared MIME; no format sniffing or malware scan. */
  contentType: string;
  /** Required exact latest version when appending history. */
  previousVersionId?: string;
  /** Optional expected local catalog revision. */
  expectedRevision?: number;
}
/** Fixed-code adapter failure; private causes must stay in trusted host diagnostics. */
export class AssetStorageError extends Error {
  /** Create a fixed-code adapter error while retaining an optional private cause.
   * @param {string} code - Package failure category.
   * @param {ErrorOptions} options - Optional Error cause for trusted diagnostics.
   */
  constructor(
    readonly code: string,
    options?: ErrorOptions
  ) {
    super(code.toLowerCase().replaceAll('_', ' '), options);
    this.name = 'AssetStorageError';
  }
}
/** Create a fixed-code storage-adapter failure.
 * @param {string} code - Package-owned failure category.
 * @returns {AssetStorageError} Error without stored binary bytes or credentials in its message. */
const fail = (code: string) => new AssetStorageError(code);
/** Hash explicit bytes/tenant labels for integrity or partition identity.
 * @param {string|Uint8Array} value - Validated input data.
 * @returns {string} SHA-256 hex digest; not authorship, anonymization or permission. */
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
/** Exact random 24-byte version-ID wire grammar. */
const versionPattern = /^[a-f0-9]{48}$/;
/** Exact lowercase SHA-256 hex grammar. */
const hashPattern = /^[a-f0-9]{64}$/;
/** Process-local address leases shared only by adapters borrowing the same catalog. */
const catalogLeases = new WeakMap<AssetManager, Set<string>>();
/** Adapter-owned metadata key storing immutable version references. */
const recordKey = 'asset.storage.version';
/** Adapter-owned metadata key storing retirement tombstones. */
const deletedKey = 'asset.storage.retired';
/** Map a validated version ID to its reserved catalog record ID.
 * @param {string} id - Validated random version identifier.
 * @returns {string} Reserved storage.version record name. */
const recordId = (id: string) => 'storage.version/' + id;
/** Map a validated version ID to its reserved tombstone ID.
 * @param {string} id - Validated random version identifier.
 * @returns {string} Reserved storage.retired record name. */
const retiredId = (id: string) => 'storage.retired/' + id;
/** Validate bounded principal labels without authenticating or inferring identity.
 * @param {AssetIdentity} value - Host-verified tenant/subject; caller strings are not authentication.
 * @returns {AssetIdentity} Detached principal tuple; invalid labels reject.
 */
function identity(value: AssetIdentity) {
  if (
    !value ||
    [value.tenant, value.subject].some(
      (v) =>
        typeof v !== 'string' ||
        !v ||
        v.length > 256 ||
        // eslint-disable-next-line no-control-regex -- Reject control characters in verified identity labels.
        /[\x00-\x1f\x7f]/.test(v)
    )
  ) {
    throw fail('ASSET_IDENTITY');
  }
  return { ...value };
}
/** Require the immutable random version-ID grammar.
 * @param {string} id - Untrusted version reference.
 * @returns {string} Accepted version ID; unsupported values reject.
 */
function version(id: string) {
  if (typeof id !== 'string' || !versionPattern.test(id)) {
    throw fail('ASSET_VERSION');
  }
  return id;
}
/** Validate exact safe binary size against the configured ceiling.
 * @param {number} value - Declared byte length.
 * @param {number} max - Inclusive maximum bytes.
 * @returns {void} Invalid/negative/oversized values throw.
 */
function size(value: number, max: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw fail('ASSET_SIZE');
  }
}
/** Create an explicit files/catalog adapter with no network work, background cleanup or automatic compensation. Close drains active calls but never closes borrowed files.
 * @param {AssetStorageOptions} options - Explicit policy-aware files, catalog, tenant location, MIME and authorization policies.
 * @returns {ReturnType<typeof createAssetStorage>} Disposable private adapter; the host owns durable catalog persistence and cross-process coordination.
 */
export function createAssetStorage(options: AssetStorageOptions) {
  if (
    !options ||
    !(options.catalog instanceof AssetManager) ||
    typeof options.files?.validateWrite !== 'function' ||
    typeof options.location !== 'function' ||
    typeof options.authorize !== 'function' ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(options.namespace)
  ) {
    throw new TypeError(
      'Catalog, policy-aware files, namespace and authorization required'
    );
  }
  if (
    !Array.isArray(options.allowedTypes) ||
    !options.allowedTypes.length ||
    options.allowedTypes.length > 100 ||
    options.allowedTypes.some(
      (type) =>
        typeof type !== 'string' || !/^[-\w.+]+\/(?:[-\w.+]+|\*)$/.test(type)
    )
  ) {
    throw new TypeError('Explicit MIME allowlist required');
  }
  /** Borrowed policy-aware files manager; this adapter never closes it. */
  const files = options.files;
  /** Borrowed metadata catalog; revisions coordinate this process only. */
  const catalog = options.catalog;
  /** Validated private namespace for this adapter owner. */
  const namespace = options.namespace;
  /** Detached explicit MIME declaration allowlist, not format sniffing. */
  const allowedTypes = [...options.allowedTypes];
  /** Per-binary verification buffer ceiling, default 16MiB and maximum 64MiB. */
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  /** Total catalog record budget including history/tombstones, default 10000. */
  const maxRecords = options.maxRecords ?? 10000;
  /** Actual-settlement operation admission cap, default four and maximum 64. */
  const maxPending = options.maxPending ?? 4;
  size(maxBytes, 64 * 1024 * 1024);
  if (
    maxBytes < 1 ||
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > 100000 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 64
  ) {
    throw new TypeError('Invalid asset storage limits');
  }
  /** Actual active operations retained until settlement; close drains them. */
  const pending = new Set<Promise<unknown>>();
  let closed = false;
  /** Shared same-catalog address lease set; not a cross-process or out-of-band lock. */
  const leased = catalogLeases.get(catalog) ?? new Set<string>();
  catalogLeases.set(catalog, leased);
  /** Bind an address lease to storage, bucket and key without lossy concatenation.
   * @param {FileAddress} address - Validated private object address.
   * @returns {string} Unambiguous tuple serialization for this process-local lease. */
  const leaseKey = (address: FileAddress) =>
    JSON.stringify([address.storage, address.bucket, address.key]);
  /** Hold one same-catalog address lease through actual operation settlement.
   * @param {FileAddress} address - Validated object address.
   * @param {() => Promise<T>} fn - Bounded host/files operation under this process-local lease.
   * @returns {Promise<T>} Callback result; busy/rejected work releases the lease in finally.
   */
  async function lease<T>(address: FileAddress, fn: () => Promise<T>) {
    /** Exact process-local address lease identity. */
    const key = leaseKey(address);
    if (leased.has(key)) {
      throw fail('ASSET_BUSY');
    }
    leased.add(key);
    try {
      return await fn();
    } finally {
      leased.delete(key);
    }
  }

  /** Bound admitted operations and retain slots until actual settlement.
   * @param {() => Promise<T>} fn - Explicit asynchronous adapter operation.
   * @returns {Promise<T>} Callback result; closed/busy calls reject without queueing.
   */
  function run<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(fail('ASSET_CLOSED'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(fail('ASSET_BUSY'));
    }
    /** Actual host/files operation settlement owning the pending slot. */
    const work = Promise.resolve().then(fn);
    pending.add(work);
    work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
    return work;
  }
  /** Require fresh host authorization for this exact principal/action/reference.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @param {Parameters<AssetStorageOptions['authorize']>[1]} action - Allowlisted adapter action.
   * @param {string} id - Logical asset or explicit repair inventory label.
   * @param {AssetAccessContext} context - Optional private address/version/ownership context copied before authorization.
   * @returns {Promise<void>} Only literal true permits dispatch.
   */
  async function permit(
    who: AssetIdentity,
    action: Parameters<AssetStorageOptions['authorize']>[1],
    id: string,
    context?: AssetAccessContext
  ) {
    if (
      (await options.authorize(
        { ...who },
        action,
        id,
        context ? structuredClone(context) : undefined
      )) !== true
    ) {
      throw fail('ASSET_FORBIDDEN');
    }
  }
  /** Validate a stable host location and partition it by namespace plus tenant digest.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @returns {ReturnType<typeof scope>} Private storage/bucket/prefix tuple; malformed bindings reject.
   */
  function scope(who: AssetIdentity) {
    /** Host-provided stable storage/bucket/prefix binding for the verified principal. */
    const binding = options.location({ ...who });
    if (
      !binding ||
      typeof binding.storage !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(binding.storage) ||
      typeof binding.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(binding.bucket) ||
      binding.bucket.includes('..')
    ) {
      throw fail('ASSET_LOCATION');
    }
    /** Validated relative managed-key prefix, not a filesystem path from the caller. */
    const prefix = binding.prefix ?? '';
    if (
      typeof prefix !== 'string' ||
      prefix.length > 400 ||
      (prefix &&
        (!prefix.endsWith('/') ||
          prefix.startsWith('/') ||
          prefix
            .slice(0, -1)
            .split('/')
            .some((p) => !p || p === '.' || p === '..'))) ||
      // eslint-disable-next-line no-control-regex -- Reject slash escapes/controls in the configured managed prefix.
      /[\\\x00-\x1f\x7f]/.test(prefix)
    ) {
      throw fail('ASSET_LOCATION');
    }
    /** Tenant partition digest; hashing does not authenticate or anonymize a principal. */
    const tenantDigest = digest(who.tenant);
    return {
      ...binding,
      tenantDigest,
      prefix: prefix + namespace + '/' + tenantDigest + '/',
    };
  }
  /** Compare exact named storage addresses without treating matching bytes as shared permissions.
   * @param {FileAddress} a - First private address.
   * @param {FileAddress} b - Second private address.
   * @returns {boolean} Whether storage, bucket and key are identical.
   */
  function same(a: FileAddress, b: FileAddress) {
    return a.storage === b.storage && a.bucket === b.bucket && a.key === b.key;
  }
  /** Require the exact configured tenant storage/bucket/prefix before binary access.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @param {FileAddress} address - Private address to check.
   * @returns {ReturnType<typeof scope>} Validated tenant binding; foreign addresses reject.
   */
  function inScope(who: AssetIdentity, address: FileAddress) {
    /** Validated storage scope pinned to this tenant/namespace. */
    const target = scope(who);
    if (
      !address ||
      address.storage !== target.storage ||
      address.bucket !== target.bucket ||
      typeof address.key !== 'string' ||
      !address.key.startsWith(target.prefix)
    ) {
      throw fail('ASSET_FORBIDDEN');
    }
    return target;
  }
  /** Read bounded reserved version records and validate stored reference identity.
   * @returns {StoredAssetVersion[]} Detached version inventory; malformed adapter records reject.
   */
  function records(): StoredAssetVersion[] {
    if (catalog.size > maxRecords) {
      throw fail('ASSET_RECORD_LIMIT');
    }
    /** Detached catalog inventory checked against the total-record budget. */
    const snapshot = catalog.snapshot();
    if (snapshot.assets.length > maxRecords) {
      throw fail('ASSET_RECORD_LIMIT');
    }
    return snapshot.assets
      .filter((asset) => asset.id.startsWith('storage.version/'))
      .map((asset) => {
        let reference: AssetVersionReference;
        try {
          reference = JSON.parse(asset.metadata?.[recordKey] ?? '');
        } catch {
          throw fail('ASSET_CATALOG_CORRUPT');
        }
        if (
          reference.schema !== 1 ||
          asset.id !== recordId(version(reference.versionId)) ||
          !hashPattern.test(reference.tenantDigest) ||
          !hashPattern.test(reference.sha256) ||
          typeof reference.owned !== 'boolean' ||
          typeof reference.namespace !== 'string' ||
          typeof reference.assetId !== 'string'
        ) {
          throw fail('ASSET_CATALOG_CORRUPT');
        }
        size(reference.size, 64 * 1024 * 1024);
        /** Copied asset metadata with adapter-owned version payload removed before return. */
        const metadata = { ...asset.metadata };
        delete metadata[recordKey];
        return {
          asset: validateAsset({ ...asset, id: reference.assetId, metadata }),
          reference,
          retired: catalog.has(retiredId(reference.versionId)),
        };
      });
  }
  /** Select only this configured namespace and tenant partition from catalog history.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @returns {StoredAssetVersion[]} Tenant-local inventory, including borrowed binaries; binary ownership is a separate flag.
   */
  function ownedVersions(who: AssetIdentity) {
    /** Validated storage scope pinned to this tenant/namespace. */
    const target = scope(who);
    return records().filter(
      (v) =>
        v.reference.tenantDigest === target.tenantDigest &&
        v.reference.namespace === namespace
    );
  }
  /** Find an exact historical tenant version and recheck its storage scope.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @param {string} id - Immutable version reference.
   * @returns {StoredAssetVersion} Existing validated version; missing/foreign references reject.
   */
  function find(who: AssetIdentity, id: string) {
    version(id);
    /** Exact tenant-scoped historical version; retirement/authorization remain separate checks. */
    const found = ownedVersions(who).find((v) => v.reference.versionId === id);
    if (!found) {
      throw fail('ASSET_NOT_FOUND');
    }
    inScope(who, found.reference.address);
    return found;
  }
  /** Validate metadata, declared integrity and parent/revision before binary work.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @param {AssetStorageInput} input - Declared size/hash/MIME and explicit version/revision intent.
   * @returns {{asset: Asset, revision: number}} Detached asset and captured revision; duplicate/invalid content policies reject.
   */
  function begin(who: AssetIdentity, input: AssetStorageInput) {
    /** Detached validated asset metadata protected from reserved adapter namespaces. */
    const asset = validateAsset(input.asset);
    if (
      asset.id.startsWith('storage.') ||
      Object.keys(asset.metadata ?? {}).some((key) =>
        key.startsWith('asset.storage.')
      )
    ) {
      throw fail('ASSET_RESERVED');
    }
    if (Object.keys(asset.metadata ?? {}).length > 99) {
      throw fail('ASSET_METADATA');
    }
    size(input.size, maxBytes);
    if (
      typeof input.sha256 !== 'string' ||
      !hashPattern.test(input.sha256) ||
      typeof input.contentType !== 'string' ||
      !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(input.contentType) ||
      !allowedTypes.some((type) =>
        type.endsWith('/*')
          ? input.contentType.startsWith(type.slice(0, -1))
          : type === input.contentType
      )
    ) {
      throw fail('ASSET_CONTENT');
    }
    /** Captured local revision required before publishing metadata/tombstones. */
    const revision = catalog.revision;
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== revision
    ) {
      throw new AssetRevisionError();
    }
    /** Tenant-local versions for this logical asset, not equivalent cross-tenant permissions. */
    const existing = ownedVersions(who).filter((v) => v.asset.id === asset.id);
    /** Latest explicit version parent required for append; accidental duplicate IDs reject. */
    const latest = existing.at(-1);
    if (latest) {
      if (!input.previousVersionId) {
        throw fail('ASSET_EXISTS');
      }
      if (input.previousVersionId !== latest.reference.versionId) {
        throw fail('ASSET_VERSION_CONFLICT');
      }
    } else if (input.previousVersionId !== undefined) {
      throw fail('ASSET_VERSION_CONFLICT');
    }
    if (catalog.size >= maxRecords) {
      throw fail('ASSET_RECORD_LIMIT');
    }
    return { asset, revision };
  }
  /** Read a finite binary source under exact size, chunk count and SHA-256 checks. It never evaluates or decodes content as code.
   * @param {FileSource} source - Explicit bytes or stream provided by the caller.
   * @param {number} expected - Exact declared byte count.
   * @param {string} sha256 - Expected lowercase SHA-256 hex.
   * @param {AbortSignal} signal - Optional cooperative cancellation; native reads may require host cooperation.
   * @returns {Promise<Buffer>} Fully verified bounded bytes; reader cancellation/lock release runs on every outcome.
   */
  async function collect(
    source: FileSource,
    expected: number,
    sha256: string,
    signal?: AbortSignal
  ) {
    /** Bounded verification buffer allocated only for the declared exact size. */
    const data = Buffer.alloc(expected);
    let count = 0,
      chunks = 0;
    /** Incremental SHA-256 owner covering the actual source bytes. */
    const hash = createHash('sha256');
    /** Validate and copy one bounded source chunk while updating integrity state.
     * @param {Uint8Array} chunk - Actual binary chunk, never decoded or executed.
     * @returns {void} Invalid type/size/count/cancellation throws before publication. */
    const consume = (chunk: Uint8Array) => {
      if (signal?.aborted) {
        throw fail('ASSET_CANCELLED');
      }
      if (!(chunk instanceof Uint8Array)) {
        throw fail('ASSET_CONTENT');
      }
      if (++chunks > 65536 || count + chunk.byteLength > expected) {
        throw fail('ASSET_LENGTH');
      }
      data.set(chunk, count);
      count += chunk.byteLength;
      hash.update(chunk);
    };
    if (source instanceof Uint8Array) {
      consume(source);
    } else if (source instanceof ReadableStream) {
      /** Owned stream reader; cancellation and lock release run in finally. */
      const reader = source.getReader();
      try {
        // Read only bounded chunks while checking cancellation; release the owned reader in finally.
        while (true) {
          if (signal?.aborted) {
            throw fail('ASSET_CANCELLED');
          }
          /** Actual source read result; cancellation does not forcibly stop a noncooperative reader. */
          const next = await reader.read();
          if (next.done) {
            break;
          }
          consume(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } else {
      // Consume finite asynchronous byte chunks without evaluating their content.
      for await (const chunk of source) {
        consume(chunk);
      }
    }
    if (signal?.aborted) {
      throw fail('ASSET_CANCELLED');
    }
    if (count !== expected) {
      throw fail('ASSET_LENGTH');
    }
    if (hash.digest('hex') !== sha256) {
      throw fail('ASSET_INTEGRITY');
    }
    return data;
  }
  /** Check stored metadata then verify all bytes before exposing them.
   * @param {FileAddress} address - Scoped private object address.
   * @param {Pick<AssetVersionReference, 'size' | 'sha256' | 'contentType'>} expected - Declared exact size/hash/MIME.
   * @param {AbortSignal} signal - Optional cooperative read cancellation.
   * @returns {ReturnType<typeof verified>} Object metadata plus verified bounded bytes; mismatches reject.
   */
  async function verified(
    address: FileAddress,
    expected: Pick<AssetVersionReference, 'size' | 'sha256' | 'contentType'>,
    signal?: AbortSignal
  ) {
    size(expected.size, maxBytes);
    /** Actual stored object metadata checked before trusting size/type/ownership. */
    const info = await files.stat(address);
    if (!info) {
      throw fail('ASSET_BINARY_MISSING');
    }
    if (
      info.size !== expected.size ||
      info.contentType !== expected.contentType
    ) {
      throw fail('ASSET_INTEGRITY');
    }
    /** Fully bounded hash-verified bytes; no unverified download data is exposed. */
    const bytes = await collect(
      await files.read(address, { signal }),
      expected.size,
      expected.sha256,
      signal
    );
    return { info, bytes };
  }
  /** Commit an immutable metadata reference only after successful binary verification.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @param {AssetStorageInput} input - Validated declaration and explicit optional parent.
   * @param {Asset} asset - Detached asset metadata.
   * @param {number} revision - Expected local catalog revision captured before binary work.
   * @param {FileAddress} address - Verified private object address.
   * @param {boolean} owned - Whether this upload owns the bytes; registration stays borrowed.
   * @param {string} versionId - Fresh random version reference.
   * @returns {StoredAssetVersion} Detached version receipt; stale catalog revision rejects without blind binary deletion.
   */
  function publish(
    who: AssetIdentity,
    input: AssetStorageInput,
    asset: Asset,
    revision: number,
    address: FileAddress,
    owned: boolean,
    versionId: string
  ) {
    /** Immutable version identity and private storage address; not a public browser manifest. */
    const reference: AssetVersionReference = {
      schema: 1,
      versionId,
      assetId: asset.id,
      namespace,
      tenantDigest: scope(who).tenantDigest,
      address: { ...address },
      owned,
      size: input.size,
      sha256: input.sha256,
      contentType: input.contentType,
      createdAt: Date.now(),
      ...(input.previousVersionId
        ? { parentVersionId: input.previousVersionId }
        : {}),
    };
    /** Validated reserved catalog record staged only after binary verification. */
    const record = validateAsset({
      ...asset,
      id: recordId(versionId),
      metadata: { ...asset.metadata, [recordKey]: JSON.stringify(reference) },
    });
    catalog.apply([{ action: 'add', asset: record }], revision);
    return structuredClone({ asset, reference, retired: false });
  }
  /** Verify positive ownership markers before cleanup of managed bytes.
   * @param {FileInfo} info - Actual backend object metadata.
   * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
   * @param {string} versionId - Expected immutable version ID.
   * @param {string} sha256 - Expected stored byte hash.
   * @returns {boolean} Whether every namespace/tenant/version/hash marker matches.
   */
  function marker(
    info: FileInfo,
    who: AssetIdentity,
    versionId: string,
    sha256: string
  ) {
    return (
      info.metadata['zx-asset-namespace'] === namespace &&
      info.metadata['zx-asset-tenant'] === scope(who).tenantDigest &&
      info.metadata['zx-asset-version'] === versionId &&
      info.metadata['zx-asset-sha256'] === sha256
    );
  }
  /** Protect any active historical/borrowed reference to the same address.
   * @param {FileAddress} address - Scoped object address.
   * @param {string} except - Optional version being explicitly retired.
   * @returns {boolean} Whether another active reference prevents deletion.
   */
  function referenced(address: FileAddress, except?: string) {
    return records().some(
      (v) =>
        !v.retired &&
        v.reference.versionId !== except &&
        same(v.reference.address, address)
    );
  }
  return {
    /** Authorize and verify a create-only private upload before catalog publication. Ambiguous writes/conflicts leave explicit repair candidates instead of blind deletion.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {AssetStorageInput} input - Explicit metadata/size/hash/MIME and parent/revision policy.
     * @param {FileSource} source - Finite binary bytes/stream; never executed.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<StoredAssetVersion>} Owned immutable version receipt; storage/catalog failures reject without claiming cross-resource atomicity.
     */
    upload(
      who: AssetIdentity,
      input: AssetStorageInput,
      source: FileSource,
      signal?: AbortSignal
    ) {
      return run(async () => {
        who = identity(who);
        input = { ...input, asset: validateAsset(input.asset) };
        /** Validated metadata plus expected local catalog revision captured before binary work. */
        const { asset, revision } = begin(who, input);
        /** Validated storage scope pinned to this tenant/namespace. */
        const target = scope(who);
        /** Fresh random immutable version ID independent of content hash. */
        const versionId = randomBytes(24).toString('hex');
        /** Unique tenant/namespace-bound private object address. */
        const address = {
          storage: target.storage,
          bucket: target.bucket,
          key: target.prefix + versionId,
        };
        await permit(who, 'upload', asset.id, {
          address,
          versionId,
          owned: true,
        });
        files.validateWrite!(address, {
          contentType: input.contentType,
          maxBytes: input.size || 1,
        });
        if (
          files.getDriver(address.storage).capabilities?.createOnlyWrite !==
          true
        ) {
          throw fail('ASSET_UNSUPPORTED_CAPABILITY');
        }
        /** Fully bounded hash-verified bytes; no unverified download data is exposed. */
        const bytes = await collect(source, input.size, input.sha256, signal);
        return lease(address, async () => {
          await files.put(address, bytes, {
            contentType: input.contentType,
            visibility: 'private',
            maxBytes: input.size || 1,
            ifNoneMatch: true,
            signal,
            metadata: {
              'zx-asset-namespace': namespace,
              'zx-asset-tenant': target.tenantDigest,
              'zx-asset-version': versionId,
              'zx-asset-sha256': input.sha256,
            },
          });
          /** Readback verification receipt required before owned metadata publication. */
          const stored = await verified(address, input, signal);
          if (!marker(stored.info, who, versionId, input.sha256)) {
            throw fail('ASSET_OWNERSHIP');
          }
          // A revision conflict never deletes a possibly committed object. Inventory repair is explicit.
          return publish(who, input, asset, revision, address, true, versionId);
        });
      });
    },
    /** Verify and register an existing scoped binary without claiming ownership of its bytes.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {AssetStorageInput} input - Explicit metadata/size/hash/MIME declaration.
     * @param {FileAddress} address - Existing object under this tenant namespace.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<StoredAssetVersion>} Borrowed immutable version receipt; no backend metadata mutation.
     */
    register(
      who: AssetIdentity,
      input: AssetStorageInput,
      address: FileAddress,
      signal?: AbortSignal
    ) {
      return run(async () => {
        who = identity(who);
        input = { ...input, asset: validateAsset(input.asset) };
        /** Validated metadata plus expected local catalog revision captured before binary work. */
        const { asset, revision } = begin(who, input);
        address = { ...address };
        inScope(who, address);
        await permit(who, 'register', asset.id, { address, owned: false });
        return lease(address, async () => {
          await verified(address, input, signal);
          return publish(
            who,
            input,
            asset,
            revision,
            address,
            false,
            randomBytes(24).toString('hex')
          );
        });
      });
    },
    /** Authorize a private history inventory independently of download permission.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {string} assetId - Logical asset ID.
     * @returns {Promise<StoredAssetVersion[]>} Detached tenant-local logical asset versions.
     */
    versions(who: AssetIdentity, assetId: string) {
      return run(async () => {
        who = identity(who);
        await permit(who, 'versions', assetId);
        return structuredClone(
          ownedVersions(who).filter((v) => v.asset.id === assetId)
        );
      });
    },
    /** Authorize an exact nonretired version before exposing fully verified bounded bytes.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {string} versionId - Immutable historical version.
     * @param {AbortSignal} signal - Optional cooperative cancellation.
     * @returns {Promise<Buffer>} Hash-verified bytes; no unverified streaming plaintext.
     */
    download(who: AssetIdentity, versionId: string, signal?: AbortSignal) {
      return run(async () => {
        who = identity(who);
        /** Exact tenant-scoped historical version; retirement/authorization remain separate checks. */
        const found = find(who, versionId);
        await permit(who, 'download', found.asset.id, {
          address: found.reference.address,
          versionId,
          owned: found.reference.owned,
        });
        if (found.retired) {
          throw fail('ASSET_RETIRED');
        }
        return lease(
          found.reference.address,
          async () =>
            (await verified(found.reference.address, found.reference, signal))
              .bytes
        );
      });
    },
    /** Retire metadata, optionally deleting positively owned unshared verified bytes first. The host must exclusively own the namespace; files has no conditional delete primitive.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {string} versionId - Exact immutable version.
     * @param {{ binary: boolean; expectedRevision?: number }} input - Explicit binary-deletion policy and optional expected catalog revision.
     * @param {boolean} input.binary - Explicitly request owned binary deletion, or metadata-only retirement.
     * @param {number|undefined} input.expectedRevision - Optional expected local catalog revision.
     * @returns {Promise<void>} Retirement receipt or explicit partial-failure error; snapshots/history are not overwritten.
     */
    delete(
      who: AssetIdentity,
      versionId: string,
      input: {
        binary: boolean; /** Optional expected local catalog revision. */
        expectedRevision?: number;
      }
    ) {
      return run(async () => {
        who = identity(who);
        if (!input || typeof input.binary !== 'boolean') {
          throw fail('ASSET_DELETE_POLICY');
        }
        input = { ...input };
        /** Exact tenant-scoped historical version; retirement/authorization remain separate checks. */
        const found = find(who, versionId);
        /** Captured local revision required before publishing metadata/tombstones. */
        const revision = catalog.revision;
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== revision
        ) {
          throw new AssetRevisionError();
        }
        await permit(who, 'delete', found.asset.id, {
          address: found.reference.address,
          versionId,
          owned: found.reference.owned,
        });
        if (found.retired) {
          return;
        }
        if (catalog.size >= maxRecords) {
          throw fail('ASSET_RECORD_LIMIT');
        }
        return lease(found.reference.address, async () => {
          if (input.binary) {
            if (!found.reference.owned) {
              throw fail('ASSET_BORROWED_BINARY');
            }
            if (referenced(found.reference.address, versionId)) {
              throw fail('ASSET_REFERENCED');
            }
            /** Verified object metadata required before checking ownership/deleting owned bytes. */
            const { info } = await verified(
              found.reference.address,
              found.reference
            );
            if (!marker(info, who, versionId, found.reference.sha256)) {
              throw fail('ASSET_OWNERSHIP');
            }
            if (!(await files.delete(found.reference.address))) {
              throw fail('ASSET_BINARY_MISSING');
            }
          }
          catalog.apply(
            [
              {
                action: 'add',
                asset: {
                  id: retiredId(versionId),
                  name: 'Retired asset reference',
                  type: 'other',
                  metadata: {
                    [deletedKey]: JSON.stringify({
                      versionId,
                      tenantDigest: scope(who).tenantDigest,
                      namespace,
                      binary: input.binary,
                    }),
                  },
                },
              },
            ],
            revision
          );
        });
      });
    },
    /** Authorize and list bounded unreferenced ownership-marked candidates without deleting.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {{ cursor?: string; limit?: number }} input - Optional bounded files cursor/limit.
     * @param {string|undefined} input.cursor - Opaque files inventory continuation.
     * @param {number|undefined} input.limit - Inventory page size, default 50 and maximum 100.
     * @returns {ReturnType<ReturnType<typeof createAssetStorage>['previewRepair']>} Private candidates and continuation; an empty page may still have a cursor.
     */
    previewRepair(
      who: AssetIdentity,
      input: { cursor?: string; limit?: number } = {}
    ) {
      return run(async () => {
        who = identity(who);
        await permit(who, 'repair', '*');
        /** Validated storage scope pinned to this tenant/namespace. */
        const target = scope(who);
        /** Captured local revision required before publishing metadata/tombstones. */
        const revision = catalog.revision;
        /** Repair inventory page limit, default 50 and maximum 100. */
        const limit = input.limit ?? 50;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          throw fail('ASSET_LIMIT');
        }
        /** Bounded files inventory; follow continuation even if no repair candidates are found. */
        const page = await files.list(target.bucket, {
          storage: target.storage,
          prefix: target.prefix,
          limit,
          cursor: input.cursor,
        });
        /** Only positively marked unreferenced owned objects become repair candidates. */
        const items: AssetRepairCandidate[] = [];
        // Only positively marked, unleased and unreferenced objects enter this preview.
        for (const info of page.items) {
          /** Fresh random immutable version ID independent of content hash. */
          const versionId = info.metadata['zx-asset-version'];
          /** Expected ownership-marked hash checked again before approved deletion. */
          const sha256 = info.metadata['zx-asset-sha256'];
          if (!versionId || !sha256) {
            continue;
          }
          /** Unique tenant/namespace-bound private object address. */
          const address = {
            storage: target.storage,
            bucket: target.bucket,
            key: info.key,
          };
          if (
            versionPattern.test(versionId ?? '') &&
            hashPattern.test(sha256 ?? '') &&
            marker(info, who, versionId, sha256) &&
            !leased.has(leaseKey(address)) &&
            !referenced(address)
          ) {
            items.push({
              address,
              versionId,
              etag: info.etag,
              size: info.size,
              sha256,
              revision,
            });
          }
        }
        return { items, nextCursor: page.nextCursor };
      });
    },
    /** Require fresh authorization and explicit host approval, then recheck scope/revision/hash before deleting candidates. No automatic cleanup runs.
     * @param {AssetIdentity} who - Host-verified tenant/subject; caller strings are not authentication.
     * @param {readonly AssetRepairCandidate[]} candidates - Previously previewed private candidates, maximum 100.
     * @returns {Promise<number>} Confirmed deletion count; changed candidates skip and backend/integrity failures reject.
     */
    repair(who: AssetIdentity, candidates: readonly AssetRepairCandidate[]) {
      return run(async () => {
        who = identity(who);
        await permit(who, 'repair', '*');
        if (!Array.isArray(candidates) || candidates.length > 100) {
          throw fail('ASSET_LIMIT');
        }
        /** Detached catalog inventory checked against the total-record budget. */
        const snapshot = structuredClone(candidates);
        // Validate every candidate scope/hash/size before asking for destructive approval.
        for (const candidate of snapshot) {
          version(candidate.versionId);
          inScope(who, candidate.address);
          size(candidate.size, maxBytes);
          if (!hashPattern.test(candidate.sha256)) {
            throw fail('ASSET_INTEGRITY');
          }
        }
        if (
          !options.approveRepair ||
          (await options.approveRepair(
            { ...who },
            structuredClone(snapshot)
          )) !== true
        ) {
          throw fail('ASSET_FORBIDDEN');
        }
        let deleted = 0;
        // Recheck revision, references and actual bytes immediately before each approved deletion.
        for (const candidate of snapshot) {
          if (
            catalog.revision !== candidate.revision ||
            referenced(candidate.address)
          ) {
            continue;
          }
          if (leased.has(leaseKey(candidate.address))) {
            continue;
          }
          await lease(candidate.address, async () => {
            /** Actual stored object metadata checked before trusting size/type/ownership. */
            const info = await files.stat(candidate.address);
            if (
              !info ||
              info.etag !== candidate.etag ||
              info.size !== candidate.size ||
              !marker(info, who, candidate.versionId, candidate.sha256)
            ) {
              return;
            }
            await verified(candidate.address, {
              size: candidate.size,
              sha256: candidate.sha256,
              contentType: info.contentType,
            });
            if (
              catalog.revision !== candidate.revision ||
              referenced(candidate.address)
            ) {
              return;
            }
            if (await files.delete(candidate.address)) {
              deleted++;
            }
          });
        }
        return deleted;
      });
    },
    /** Stop new admission and drain actual pending operations without closing borrowed files/catalog.
     * @returns {Promise<void>} Settles when active calls actually settle; arbitrary host promises cannot be force-cancelled.
     */
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
    },
  };
}
