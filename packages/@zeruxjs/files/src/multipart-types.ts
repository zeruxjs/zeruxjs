import type {
  FileAddress,
  FileInfo,
  PutFileOptions,
  FileSource,
  StorageManager,
} from './types.js';
/** Verified initiating context supplied by the host, never trusted directly from a client. */
export interface UploadIdentity {
  /** Verified tenant namespace, checked together with subject on each coordinator call. */
  tenant: string;
  /** Verified initiating principal; an opaque upload ID alone is insufficient. */
  subject: string;
}
/** Immutable accepted receipt for one bounded binary part. */
export interface UploadPart {
  /** 1-based immutable part number, bounded by configured maxParts. */
  number: number;
  /** Declared exact byte length; full sessions must match aggregate part length. */
  size: number;
  /** Lowercase 64-hex SHA-256; full-object and part hashes cover their respective bytes. */
  sha256: string;
  /** Optional native provider receipt used with hash/size during finalization. */
  etag?: string;
}
/** Public session projection excluding private addresses, identity digests and native IDs. */
export interface UploadSession {
  /** Opaque session reference; not bearer authorization or a native provider credential. */
  id: string;
  /** Session expiry in epoch milliseconds; not a stored request deadline. */
  expiresAt: number;
  /** Declared exact byte length; full sessions must match aggregate part length. */
  size: number;
  /** Lowercase 64-hex SHA-256; full-object and part hashes cover their respective bytes. */
  sha256: string;
  /** Journal lifecycle state; finalizing may require explicit uncertain-result reconciliation. */
  status: 'open' | 'finalizing' | 'complete' | 'aborted' | 'initiating';
  /** Public part receipt snapshots, without staged binary bytes. */
  parts: UploadPart[];
}
/** Trusted driver boundary. Never expose native IDs directly as an HTTP authorization mechanism. */
export interface NativeMultipartOperations {
  /** Native minimum nonfinal part size in bytes. */
  readonly minPartBytes: number;
  /** Whether native completion can atomically require an absent destination. */
  readonly createOnly: boolean;
  /** Create a provider/coordinator upload session. The coordinator authorizes verified identity and persists its journal before exposing an open session.
   * @param {FileAddress} address - Validated destination under the host manager policy.
   * @param {PutFileOptions} options - Write metadata; coordinator additionally requires exact size and full-object lowercase SHA-256.
   * @returns {Promise<string>} Private native provider ID; acceptance is not binary commit.
   */
  initiate(address: FileAddress, options: PutFileOptions): Promise<string>;
  /** Upload a verified native part under the coordinator lease; require a provider checksum/ETag receipt.
   * @param {FileAddress} address - Validated destination under the host manager policy.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @param {UploadPart} part - Bounded part number, exact byte size and SHA-256 metadata.
   * @param {Uint8Array} bytes - Bytes whose size/hash must match the declared part.
   * @param {AbortSignal | undefined} signal - Cooperative native request cancellation; no commit rollback guarantee.
   * @returns {Promise<string>} Provider ETag after integrity confirmation.
   */
  upload(
    address: FileAddress,
    id: string,
    part: UploadPart,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<string>;
  /** List bounded native receipts for comparison against the coordinator journal.
   * @param {FileAddress} address - Validated destination under the host manager policy.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @param {number} maxParts - Safe integer receipt limit, 1–1000.
   * @returns {Promise<UploadPart[]>} Validated provider receipts; truncated or over-budget responses reject.
   */
  list(
    address: FileAddress,
    id: string,
    maxParts: number
  ): Promise<UploadPart[]>;
  /** Commit an ordered native multipart session once. A lost acknowledgement may leave the result uncertain.
   * @param {FileAddress} address - Validated destination under the host manager policy.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @param {UploadPart[]} parts - Ordered contiguous part receipts with hashes and provider ETags.
   * @param {boolean} createOnly - Require qualified native conditional completion when true.
   * @param {AbortSignal | undefined} signal - Cooperative request cancellation; commit may already have occurred.
   * @returns {Promise<void>} Provider completion observation; not consumer exactly-once processing.
   */
  complete(
    address: FileAddress,
    id: string,
    parts: UploadPart[],
    createOnly: boolean,
    signal?: AbortSignal
  ): Promise<void>;
  /** Abandon an upload under its owning boundary. Coordinator finalizing sessions remain fenced; native abort requires provider cleanup confirmation.
   * @param {FileAddress} address - Validated destination under the host manager policy.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @returns {Promise<void>} Abort/cleanup observation; transient provider failures preserve resumable state.
   */
  abort(address: FileAddress, id: string): Promise<void>;
}
/** Trusted coordinator configuration; journal storage must be private and durable. */
export interface ResumableUploadOptions {
  /** Borrowed policy-aware manager; coordinator never closes it. */
  files: StorageManager;
  /** Private canonical local journal/staging root, shared by resumptions using this manager configuration. */
  root: string;
  /** Trusted host callback, required on every operation with verified identity/address/action. */
  authorize: (
    identity: UploadIdentity,
    address: FileAddress,
    action: 'initiate' | 'part' | 'list' | 'finalize' | 'abort'
  ) => boolean | Promise<boolean>;
  /** Maximum session bytes; default 1 GiB, positive safe integer. */
  maxBytes?: number;
  /** Maximum buffered/staged part bytes; default 8 MiB, ceiling 64 MiB. */
  maxPartBytes?: number;
  /** Maximum parts per session; default/ceiling 1000. */
  maxParts?: number;
  /** Maximum retained sessions; default 100, ceiling 10000. */
  maxSessions?: number;
  /** Maximum actual admitted coordinator calls; default 8, ceiling 64. */
  maxPending?: number;
  /** Session lifetime in milliseconds; default one hour, ceiling seven days. */
  ttlMs?: number;
  /** Trusted clock for deterministic tests. */
  now?: () => number;
  /** Explicit approval is needed again for each cleanup batch; never inferred from request headers. */
  approveCleanup?: (
    candidates: readonly UploadCleanupCandidate[]
  ) => boolean | Promise<boolean>;
}
/** Preview evidence rechecked under a lease before explicitly approved cleanup. */
export interface UploadCleanupCandidate {
  /** Opaque session reference; not bearer authorization or a native provider credential. */
  id: string;
  /** Session expiry in epoch milliseconds; not a stored request deadline. */
  expiresAt: number;
  /** Journal lifecycle state; finalizing may require explicit uncertain-result reconciliation. */
  status: UploadSession['status'];
  /** SHA-256 of previewed journal state, rechecked before cleanup. */
  revision: string;
}
/** Host-authorized resumable session owner, distinct from any one request AbortController. */
export interface ResumableUploads {
  /** Create a provider/coordinator upload session. The coordinator authorizes verified identity and persists its journal before exposing an open session.
   * @param {UploadIdentity} identity - Host-verified tenant/subject; never derive trust from a request body alone.
   * @param {FileAddress} address - Validated destination under the host manager policy.
   * @param {PutFileOptions} options - Write metadata; coordinator additionally requires exact size and full-object lowercase SHA-256.
   * @returns {Promise<UploadSession>} Authorized public session; acceptance is not binary commit.
   */
  initiate(
    identity: UploadIdentity,
    address: FileAddress,
    options: PutFileOptions & {
      /** Declared exact byte length; full sessions must match aggregate part length. */
      size: number;
      /** Lowercase 64-hex SHA-256; full-object and part hashes cover their respective bytes. */
      sha256: string;
    }
  ): Promise<UploadSession>;
  /** Authorize, validate and journal one immutable accepted part. Identical declared receipt retries do not replace its bytes.
   * @param {UploadIdentity} identity - Host-verified tenant/subject; never derive trust from a request body alone.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @param {number} number - Safe integer part number, bounded by configured maxParts.
   * @param {FileSource} source - Borrowed binary input counted/hashed before acceptance.
   * @param {object} options - Exact size, lowercase SHA-256 and optional caller cancellation signal.
   * @param {number} options.size - Exact expected part byte count.
   * @param {string} options.sha256 - Expected lowercase SHA-256 of this part.
   * @param {AbortSignal} [options.signal] - Caller-owned cooperative cancellation.
   * @returns {Promise<UploadPart>} Accepted part receipt; a request abort does not abandon the session.
   */
  uploadPart(
    identity: UploadIdentity,
    id: string,
    number: number,
    source: FileSource,
    options: {
      /** Declared exact byte length; full sessions must match aggregate part length. */
      size: number;
      /** Lowercase 64-hex SHA-256; full-object and part hashes cover their respective bytes. */
      sha256: string;
      /** Caller-owned cooperative cancellation; aborting one request preserves session ownership. */
      signal?: AbortSignal;
    }
  ): Promise<UploadPart>;
  /** Authorize access to a cloned public session view without exposing native IDs or private addresses.
   * @param {UploadIdentity} identity - Host-verified tenant/subject; never derive trust from a request body alone.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @returns {Promise<UploadSession>} Session/part snapshot; listing alone does not prove final binary persistence.
   */
  listParts(identity: UploadIdentity, id: string): Promise<UploadSession>;
  /** Verify ordered parts, total bytes and SHA-256 before committing. Complete retries return the recorded result; uncertain outcomes reconcile without blindly rewriting.
   * @param {UploadIdentity} identity - Host-verified tenant/subject; never derive trust from a request body alone.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @param {readonly number[]} partNumbers - Contiguous 1-based sequence exactly covering accepted parts.
   * @param {AbortSignal | undefined} signal - Cooperative verification/native cancellation; timeout does not prove rollback.
   * @returns {Promise<FileInfo>} Committed metadata or explicit failure/uncertainty; no automatic ambiguous retry.
   */
  finalize(
    identity: UploadIdentity,
    id: string,
    partNumbers: readonly number[],
    signal?: AbortSignal
  ): Promise<FileInfo>;
  /** Abandon an upload under its owning boundary. Coordinator finalizing sessions remain fenced; native abort requires provider cleanup confirmation.
   * @param {UploadIdentity} identity - Host-verified tenant/subject; never derive trust from a request body alone.
   * @param {string} id - Opaque upload identifier bound to the owning service; never an authorization credential.
   * @returns {Promise<void>} Abort/cleanup observation; transient provider failures preserve resumable state.
   */
  abort(identity: UploadIdentity, id: string): Promise<void>;
  /** Page expired non-finalizing candidates without deleting them; trusted operator approval is a separate step.
   * @param {object} options - Optional validated cursor and page limit (1–100, default 50).
   * @param {string} [options.cursor] - Prior session ID page continuation.
   * @param {number} [options.limit] - Page size from 1–100; defaults to 50.
   * @returns {Promise<object>} Revision-bound candidates and optional nextCursor, without binary payloads.
   */
  previewCleanup(options?: {
    /** Opaque session ID continuation; not a filesystem path. */
    cursor?: string;
    /** Cleanup preview page size, 1–100; default 50. */
    limit?: number;
  }): Promise<{
    /** Expired revision-bound cleanup candidates; no deletion performed by preview. */
    items: UploadCleanupCandidate[];
    /** Optional page continuation; absence means the bounded scan is exhausted. */
    nextCursor?: string;
  }>;
  /** Recheck trusted approval, expiry, session revision and lease before deleting one bounded candidate batch.
   * @param {readonly UploadCleanupCandidate[]} candidates - At most 100 preview records; stale revisions are skipped and live leases are never broken.
   * @returns {Promise<number>} Removed session count; transient abort failures propagate without deleting live data.
   */
  cleanup(candidates: readonly UploadCleanupCandidate[]): Promise<number>;
  /** Reject new calls and await actual admitted settlement, retaining unfinished sessions. Close before the borrowed file manager.
   * @returns {Promise<void>} Drain completion; no forced JavaScript/source cancellation or manager close is implied.
   */
  close(): Promise<void>;
}
