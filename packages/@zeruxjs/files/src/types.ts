/** Storage-neutral binary objects; bucket and key are separate from the connection name. */
export interface FileAddress {
  /** Optional named connection; manager defaults apply when omitted. */
  storage?: string;
  /** Separate validated storage bucket, not an arbitrary filesystem path. */
  bucket: string;
  /** Relative slash-separated object key; traversal and empty segments reject. */
  key: string;
}
/** Application metadata visibility; it does not grant backend IAM/bucket access. */
export type FileVisibility = 'private' | 'public';
/** Storage metadata, kept separate from binary ownership and principal authorization. */
export interface FileInfo extends FileAddress {
  /** Logical object length in bytes; not a character count. */
  size: number;
  /** Provider object validator; multipart/S3 ETags are not guaranteed SHA-256 hashes. */
  etag: string;
  /** Declared bare MIME type; metadata does not prove byte-content safety. */
  contentType: string;
  /** Provider/content modification timestamp; not an invented authorship fact. */
  modifiedAt: string;
  /** Application visibility metadata; public does not configure IAM or bucket access. */
  visibility: FileVisibility;
  /** Optional HTTP caching metadata; private response helpers still force no-store. */
  cacheControl?: string;
  /** Optional validated download disposition; never unrestricted response headers. */
  contentDisposition?: string;
  /** Bounded string metadata; reserved zfiles- names are managed internally. */
  metadata: Record<string, string>;
  /** Optional provider or local encryption version metadata; semantics are driver-specific. */
  versionId?: string;
  /** Optional parseable expiry timestamp; elapsed objects reject manager reads. */
  expiresAt?: string;
  /** Configured/provider encryption mode; not a cross-provider security equivalence. */
  encryption?: string;
  /** Whether byte ranges are meaningful after storage-side decryption. */
  rangeSupported?: boolean;
}
/** Borrowed binary input; generators consume it without executing data as source code. */
export type FileSource =
  | Uint8Array
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>
  | ReadableStream<Uint8Array>;
/** Validated write metadata and resource policy; create-only defaults true. */
export interface PutFileOptions {
  /** Declared bare MIME type; metadata does not prove byte-content safety. */
  contentType?: string;
  /** Optional validated download disposition; never unrestricted response headers. */
  contentDisposition?: string;
  /** Application visibility metadata; public does not configure IAM or bucket access. */
  visibility?: FileVisibility;
  /** Optional HTTP caching metadata; private response helpers still force no-store. */
  cacheControl?: string;
  /** Bounded string metadata; reserved zfiles- names are managed internally. */
  metadata?: Record<string, string>;
  /** Positive safe-integer byte ceiling; combined with manager connection limits. */
  maxBytes?: number;
  /** Fail rather than overwrite an existing object. Defaults to true. */
  ifNoneMatch?: boolean;
  /** Optional parseable expiry timestamp; elapsed objects reject manager reads. */
  expiresAt?: string;
  /** Caller-owned cooperative cancellation; abort does not prove a write rolled back. */
  signal?: AbortSignal;
}
/** Inclusive byte bounds and cooperative caller cancellation. */
export interface ReadFileOptions {
  /** Optional inclusive nonnegative byte start. */
  start?: number;
  /** Optional inclusive byte end at least start; provider object bounds still apply. */
  end?: number;
  /** Caller-owned cooperative cancellation; abort does not prove a write rolled back. */
  signal?: AbortSignal;
}
/** One bounded page; ordering/continuations remain provider-specific. */
export interface ListFileOptions {
  /** Optional literal key prefix, not a regex or tenant identity. */
  prefix?: string;
  /** Optional page size; manager accepts 1–1000, default is driver-owned. */
  limit?: number;
  /** Optional opaque provider continuation; local driver uses a key continuation. */
  cursor?: string;
}
/** Metadata page without binary content or an implied exhaustive count. */
export interface FileListing {
  /** Metadata records in this page; listing does not fetch their binary content. */
  items: FileInfo[];
  /** Optional continuation indicating another provider page may exist. */
  nextCursor?: string;
}
/** Unknown metadata is not a guarantee. Native provider claims require provider qualification. */
export interface StorageCapabilities {
  /** Whether byte-range reads are explicitly qualified for this provider. */
  readonly range: boolean | 'unknown';
  /** Whether provider multipart writes are supported/qualified. */
  readonly multipart: boolean | 'unknown';
  /** Optional explicit resumable multipart capability; absence is not a guarantee. */
  readonly resumableMultipart?: boolean | 'unknown';
  /** Optional native conditional multipart-completion support. */
  readonly multipartCreateOnly?: boolean | 'unknown';
  /** Whether backend signed URLs are supported/qualified. */
  readonly signedUrls: boolean | 'unknown';
  /** Whether byte-buffer writes can atomically require destination absence. */
  readonly createOnlyWrite: boolean | 'unknown';
  /** Whether streamed writes can atomically require destination absence. */
  readonly createOnlyStream: boolean | 'unknown';
  /** Whether native copies can atomically require destination absence. */
  readonly createOnlyCopy: boolean | 'unknown';
  /** Qualified encryption mode names; listing a name is not a cross-provider security equivalence. */
  readonly encryption: readonly string[];
}
/** Provider-owned implementation boundary; optional capabilities must be checked explicitly. */
export interface StorageDriver {
  /** Optional immutable provider claims; absent/unknown metadata is not support. */
  readonly capabilities?: Readonly<StorageCapabilities>;
  /** Driver discriminator; not evidence of full vendor protocol compatibility. */
  readonly kind: string;
  /** Trusted native multipart boundary; never expose native IDs as authorization. */
  readonly multipartOperations?: import('./multipart-types.js').NativeMultipartOperations;
  /** Persist binary content under the configured driver/policy; an error after dispatch may have an uncertain commit outcome.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {FileSource} data - Borrowed bytes or stream; consumption and cancellation remain cooperative.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<FileInfo>} Committed provider metadata; create-only behavior depends on declared capabilities.
   */
  put(
    address: FileAddress,
    data: FileSource,
    options?: PutFileOptions
  ): Promise<FileInfo>;
  /** Read metadata without returning binary content. Managers reject expired records; drivers expose native metadata.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {Promise<FileInfo | null>} Metadata or null for a missing object; provider failures propagate.
   */
  stat(address: FileAddress): Promise<FileInfo | null>;
  /** Open a streaming read; consume or close the returned iterator so its underlying resources can release.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {ReadFileOptions} options - Optional inclusive byte bounds and caller-owned cancellation.
   * @returns {Promise<AsyncIterable<Uint8Array>>} Byte stream, subject to declared range/encryption capabilities.
   */
  read(
    address: FileAddress,
    options?: ReadFileOptions
  ): Promise<AsyncIterable<Uint8Array>>;
  /** Delete one object under configured permissions; this is not a conditional version delete.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {Promise<boolean>} Whether an object was present for deletion; provider failures propagate.
   */
  delete(address: FileAddress): Promise<boolean>;
  /** Return a bounded provider page. Opaque continuations and ordering are driver-specific.
   * @param {string} bucket - Validated bucket within configured policy.
   * @param {ListFileOptions} options - Optional literal prefix, limit, cursor and manager storage selection.
   * @returns {Promise<FileListing>} Page metadata and optional continuation; not an unbounded scan.
   */
  list(bucket: string, options?: ListFileOptions): Promise<FileListing>;
  /** Copy bytes/metadata subject to destination policy; create-only support must be negotiated.
   * @param {FileAddress} from - Source address; caller must have permission to read it.
   * @param {FileAddress} to - Destination address subject to write policy.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<FileInfo>} Destination metadata; cross-driver fallback streams without a shared transaction.
   */
  copy?(
    from: FileAddress,
    to: FileAddress,
    options?: PutFileOptions
  ): Promise<FileInfo>;
  /** Sign backend access for a bounded lifetime without granting application authorization or changing object visibility.
   * @param {'GET' | 'PUT'} method - Backend operation to sign.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {number} expiresSeconds - Safe integer lifetime from 1 to 604800 seconds.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<string>} Sensitive temporary URL; keep it out of default logs.
   */
  signedUrl?(
    method: 'GET' | 'PUT',
    address: FileAddress,
    expiresSeconds: number,
    options?: PutFileOptions
  ): Promise<string>;
  /** Format a configured public address without changing object permissions or verifying public reachability.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {string | undefined} Formatted URL when supported/configured; not an authorization receipt.
   */
  publicUrl?(address: FileAddress): string | undefined;
  /** Stop admission and release owned resources. Manager closes distinct configured drivers; resumable coordinators must drain first. Borrowed native clients retain their declared ownership.
   * @returns {Promise<void>} Cleanup completion; manager does not track every in-flight read/write.
   */
  close?(): Promise<void>;
}
/** Named manager policy applied before calls reach the configured driver. */
export interface StorageDefinition {
  /** Unique validated named connection within one manager. */
  name: string;
  /** Configured driver whose optional close is invoked by manager shutdown. */
  driver: StorageDriver;
  /** Reject manager write/delete/copy targets when true; not a backend credential policy. */
  readonly?: boolean;
  /** Optional exact MIME or type/* allowlist enforced on manager writes/copies. */
  allowedTypes?: string[];
  /** Optional nonempty bucket allowlist applied before provider access. */
  allowedBuckets?: string[];
  /** Optional literal key namespace ending in /; not a substitute for principal authorization. */
  keyPrefix?: string;
  /** Positive safe-integer byte ceiling; combined with manager connection limits. */
  maxBytes?: number;
}
/** Application-scoped connections and optional in-process public byte cache. */
export interface StorageManagerOptions {
  /** Nonempty named connections; duplicate names reject before manager use. */
  stores: StorageDefinition[];
  /** Optional default named connection; otherwise the first store is used. */
  defaultStorage?: string;
  /** Optional process-local public unencrypted byte cache; disabled when absent. */
  cache?: {
    /** Optional retained-entry cap; FileByteCache defaults to 64. */
    maxEntries?: number;
    /** Positive retained-byte ceiling; FileByteCache defaults to 8 MiB. */
    maxBytes?: number;
    /** Optional byte-cache lifetime in milliseconds; defaults to 15000. */
    ttlMs?: number;
  };
}
/** Policy-aware named storage facade; it does not authenticate HTTP callers itself. */
export interface StorageManager {
  /** Validate manager write policy without opening storage resources; required by resumable coordination.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {FileAddress} Canonical named address, or a policy error before dispatch.
   */
  validateWrite?(address: FileAddress, options: PutFileOptions): FileAddress;
  /** Persist binary content under the configured driver/policy; an error after dispatch may have an uncertain commit outcome.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {FileSource} data - Borrowed bytes or stream; consumption and cancellation remain cooperative.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<FileInfo>} Committed provider metadata; create-only behavior depends on declared capabilities.
   */
  put(
    address: FileAddress,
    data: FileSource,
    options?: PutFileOptions
  ): Promise<FileInfo>;
  /** Read metadata without returning binary content. Managers reject expired records; drivers expose native metadata.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {Promise<FileInfo | null>} Metadata or null for a missing object; provider failures propagate.
   */
  stat(address: FileAddress): Promise<FileInfo | null>;
  /** Open a streaming read; consume or close the returned iterator so its underlying resources can release.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {ReadFileOptions} options - Optional inclusive byte bounds and caller-owned cancellation.
   * @returns {Promise<AsyncIterable<Uint8Array>>} Byte stream, subject to declared range/encryption capabilities.
   */
  read(
    address: FileAddress,
    options?: ReadFileOptions
  ): Promise<AsyncIterable<Uint8Array>>;
  /** Buffer a bounded object and verify observed size. Only public unencrypted manager reads may use the optional byte cache.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {number} maxBytes - Positive safe-integer byte ceiling; defaults to 16 MiB.
   * @returns {Promise<Uint8Array>} Object bytes; an oversized or changed read rejects.
   */
  get(address: FileAddress, maxBytes?: number): Promise<Uint8Array>;
  /** Check metadata presence under manager policy without swallowing provider failures.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {Promise<boolean>} False only when stat returns null; expiry/policy errors still propagate.
   */
  exists(address: FileAddress): Promise<boolean>;
  /** Rewrite object visibility through copy with explicit overwrite; this is not an IAM/bucket policy change.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {FileVisibility} visibility - Explicit private or public application metadata.
   * @returns {Promise<FileInfo>} Updated metadata, subject to copy capabilities and destination policy.
   */
  setVisibility(
    address: FileAddress,
    visibility: FileVisibility
  ): Promise<FileInfo>;
  /** Copy then delete the source. A failed deletion leaves the committed destination intact.
   * @param {FileAddress} from - Source object; moving onto the same key rejects.
   * @param {FileAddress} to - Destination object under write policy.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<FileInfo>} Destination metadata after source deletion; not a cross-store atomic transaction.
   */
  move(
    from: FileAddress,
    to: FileAddress,
    options?: PutFileOptions
  ): Promise<FileInfo>;
  /** Delete one object under configured permissions; this is not a conditional version delete.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {Promise<boolean>} Whether an object was present for deletion; provider failures propagate.
   */
  delete(address: FileAddress): Promise<boolean>;
  /** Return a bounded provider page. Opaque continuations and ordering are driver-specific.
   * @param {string} bucket - Validated bucket within configured policy.
   * @param {ListFileOptions} options - Optional literal prefix, limit, cursor and manager storage selection.
   * @returns {Promise<FileListing>} Page metadata and optional continuation; not an unbounded scan.
   */
  list(
    bucket: string,
    options?: ListFileOptions & {
      /** Optional named connection; manager defaults apply when omitted. */
      storage?: string;
    }
  ): Promise<FileListing>;
  /** Copy bytes/metadata subject to destination policy; create-only support must be negotiated.
   * @param {FileAddress} from - Source address; caller must have permission to read it.
   * @param {FileAddress} to - Destination address subject to write policy.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<FileInfo>} Destination metadata; cross-driver fallback streams without a shared transaction.
   */
  copy(
    from: FileAddress,
    to: FileAddress,
    options?: PutFileOptions
  ): Promise<FileInfo>;
  /** Sign backend access for a bounded lifetime without granting application authorization or changing object visibility.
   * @param {'GET' | 'PUT'} method - Backend operation to sign.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @param {number} expiresSeconds - Safe integer lifetime from 1 to 604800 seconds.
   * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
   * @returns {Promise<string>} Sensitive temporary URL; keep it out of default logs.
   */
  signedUrl(
    method: 'GET' | 'PUT',
    address: FileAddress,
    expiresSeconds: number,
    options?: PutFileOptions
  ): Promise<string>;
  /** Format a configured public address without changing object permissions or verifying public reachability.
   * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
   * @returns {string | undefined} Formatted URL when supported/configured; not an authorization receipt.
   */
  publicUrl(address: FileAddress): string | undefined;
  /** Expose the configured driver to trusted server integration code.
   * @param {string} storage - Optional connection name; defaults to the manager default.
   * @returns {StorageDriver} Configured driver, borrowed by the caller; unknown/closed access rejects.
   */
  getDriver(storage?: string): StorageDriver;
  /** Project process-local retained bytes and lifetime hit/miss counters.
   * @returns {object} Fresh entry/byte/hit/miss counters, or zeros when disabled.
   */
  cacheStats(): {
    /** Currently retained cache entry count. */
    entries: number;
    /** Currently retained payload bytes, excluding object/map overhead. */
    bytes: number;
    /** Lifetime cache-hit observations; clear does not reset them. */
    hits: number;
    /** Lifetime missing/expired observations; clear does not reset them. */
    misses: number;
  };
  /** Invalidate process-local cached versions of one address, or clear all retained bytes.
   * @param {FileAddress | undefined} address - Optional object identity; omit to clear this manager cache.
   * @returns {void} No distributed invalidation or persistence is implied.
   */
  invalidate(address?: FileAddress): void;
  /** Stop admission and release owned resources. Manager closes distinct configured drivers; resumable coordinators must drain first. Borrowed native clients retain their declared ownership.
   * @returns {Promise<void>} Cleanup completion; manager does not track every in-flight read/write.
   */
  close(): Promise<void>;
}
