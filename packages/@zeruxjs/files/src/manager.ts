import type {
  FileAddress,
  FileSource,
  PutFileOptions,
  ReadFileOptions,
  ListFileOptions,
  StorageManager,
  StorageManagerOptions,
  StorageDefinition,
  StorageDriver,
} from './types.js';
import {
  chunks,
  validateAddress,
  validateBucket,
  validateKey,
  validatePut,
  validateRange,
  ensureNotExpired,
} from './validation.js';
import { FileByteCache } from './cache.js';
/** Create a policy-aware named-storage facade. Configured drivers are closed once per identity on manager close; active operations are not globally tracked/drained.
 * @param {StorageManagerOptions} options - Trusted named definitions and optional in-process public unencrypted byte cache.
 * @returns {StorageManager} Application-scoped facade; host owns HTTP authorization and shutdown ordering.
 */
export function createFileManager(
  options: StorageManagerOptions
): StorageManager {
  if (!options?.stores?.length) {
    throw new TypeError('At least one storage connection required');
  }
  /** Validated named definitions retained by this manager; no global connection selection. */
  const stores = new Map<string, StorageDefinition>();
  // Validate the complete named registry before exposing a manager or dispatching driver work.
  for (const store of options.stores) {
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(store.name) ||
      stores.has(store.name) ||
      !store.driver
    ) {
      throw new TypeError('Invalid or duplicate storage connection');
    }
    if (
      store.allowedBuckets &&
      (!store.allowedBuckets.length ||
        store.allowedBuckets.some((b) => {
          try {
            validateBucket(b);
            return false;
          } catch {
            return true;
          }
        }))
    ) {
      throw new TypeError('Invalid bucket policy');
    }
    if (
      store.keyPrefix !== undefined &&
      store.keyPrefix !== '' &&
      !store.keyPrefix.endsWith('/')
    ) {
      throw new TypeError('Key prefix must end with /');
    }
    stores.set(store.name, store);
  }
  /** Configured default connection or the first store; it must exist before use. */
  const fallback = options.defaultStorage ?? options.stores[0].name;
  if (!stores.has(fallback)) {
    throw new TypeError('Unknown default storage');
  }
  /** Optional process-local byte cache; eligibility is checked at each manager get. */
  const cache = options.cache
    ? new FileByteCache(
        options.cache.maxEntries,
        options.cache.maxBytes,
        options.cache.ttlMs
      )
    : null;
  let closed = false;
  /** Resolve defaults and enforce connection bucket/key namespace before provider access.
   * @param {FileAddress} address - Borrowed syntactically validated address; principal authorization is separate.
   * @returns {object} Connection/name and a copied canonical named address; unknown/closed/disallowed access rejects.
   */
  function resolve(address: FileAddress) {
    if (closed) {
      throw new Error('File manager closed');
    }
    validateAddress(address);
    /** Resolved named connection used for dispatch and returned metadata. */
    const name = address.storage ?? fallback;
    /** Configured driver and host policy for the selected connection. */
    const connection = stores.get(name);
    if (!connection) {
      throw new Error(`Unknown storage: ${name}`);
    }
    if (
      connection.allowedBuckets &&
      !connection.allowedBuckets.includes(address.bucket)
    ) {
      throw new Error('Bucket not allowed by storage policy');
    }
    if (connection.keyPrefix && !address.key.startsWith(connection.keyPrefix)) {
      throw new Error('Key not allowed by storage policy');
    }
    return { name, connection, address: { ...address, storage: name } };
  }
  /** Build an unambiguous connection/bucket/key identity for this manager cache.
   * @param {FileAddress} a - Borrowed object address, defaulting storage consistently.
   * @returns {string} Internal NUL-separated cache identity, never a public URL. */
  const cacheKey = (a: FileAddress) =>
    `${a.storage ?? fallback}\0${a.bucket}\0${a.key}`;
  /** Remove cached object versions, or clear the manager cache.
   * @param {FileAddress} [a] - Optional address; omitted clears all local cached bytes.
   * @returns {void | undefined} Cache invalidation only; no provider or distributed side effect. */
  const invalidate = (a?: FileAddress) =>
    a ? cache?.deletePrefix(cacheKey(a) + ':') : cache?.clear();
  /** Self-referencing facade so composed operations reuse the same policy/expiry checks. */
  const manager: StorageManager = {
    /** Validate manager write policy without opening storage resources; required by resumable coordination.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {FileAddress} Canonical named address, or a policy error before dispatch.
     */
    validateWrite(address, opts) {
      /** Resolved connection and copied named address returned only after write-policy validation. */
      const { connection, address: canonical } = resolve(address);
      validatePut(opts);
      if (connection.readonly) {
        throw new Error('Storage is read-only');
      }
      if (
        connection.allowedTypes?.length &&
        !connection.allowedTypes.some((pattern) =>
          pattern.endsWith('/*')
            ? opts.contentType?.startsWith(pattern.slice(0, -1))
            : opts.contentType === pattern
        )
      ) {
        throw new Error('Content type not allowed');
      }
      if (
        connection.maxBytes !== undefined &&
        opts.maxBytes !== undefined &&
        opts.maxBytes > connection.maxBytes
      ) {
        throw new RangeError('File size exceeds limit');
      }
      return canonical;
    },
    /** Expose the configured driver to trusted server integration code.
     * @param {string} name - Optional connection name; defaults to the manager default.
     * @returns {StorageDriver} Configured driver, borrowed by the caller; unknown/closed access rejects.
     */
    getDriver(name?: string): StorageDriver {
      if (closed) {
        throw new Error('File manager closed');
      }
      /** Operation result observed before returning; failures propagate without manufacturing rollback. */
      const result = stores.get(name ?? fallback);
      if (!result) {
        throw new Error('Unknown storage');
      }
      return result.driver;
    },
    /** Persist binary content under the configured driver/policy; an error after dispatch may have an uncertain commit outcome.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {FileSource} data - Borrowed bytes or stream; consumption and cancellation remain cooperative.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<FileInfo>} Committed provider metadata; create-only behavior depends on declared capabilities.
     */
    async put(
      address: FileAddress,
      data: FileSource,
      opts: PutFileOptions = {}
    ) {
      /** Resolved named connection plus canonical provider address after policy checks. */
      const { name, connection, address: a } = resolve(address);
      validatePut(opts);
      if (connection.readonly) {
        throw new Error('Storage is read-only');
      }
      if (
        connection.allowedTypes?.length &&
        !connection.allowedTypes.some((pattern) =>
          pattern.endsWith('/*')
            ? opts.contentType?.startsWith(pattern.slice(0, -1))
            : opts.contentType === pattern
        )
      ) {
        throw new Error('Content type not allowed');
      }
      /** Stricter request/connection byte ceiling; validated as a positive safe integer. */
      const max = Math.min(
        opts.maxBytes ?? Number.MAX_SAFE_INTEGER,
        connection.maxBytes ?? Number.MAX_SAFE_INTEGER
      );
      if (!Number.isSafeInteger(max) || max < 1) {
        throw new RangeError('Invalid storage size limit');
      }
      /** Count actual source bytes before yielding to a driver; max is the stricter connection/request ceiling.
       * @returns {AsyncGenerator<Uint8Array>} Borrowed chunks; overflow rejects before another chunk reaches the driver.
       */
      async function* bounded() {
        let count = 0;
        // Count actual bytes before each yield so connection limits also apply to streamed writes.
        for await (const part of chunks(data, opts.signal)) {
          count += part.byteLength;
          if (!Number.isSafeInteger(count) || count > max) {
            throw new RangeError('File size exceeds limit');
          }
          yield part;
        }
      }
      if (data instanceof Uint8Array && data.byteLength > max) {
        throw new RangeError('File size exceeds limit');
      }
      /** Driver receipt after successful put; cache invalidation follows this observation only. */
      const stored = await connection.driver.put(
        a,
        data instanceof Uint8Array ? data : bounded(),
        { ...opts, maxBytes: max }
      );
      invalidate(a);
      return { ...stored, storage: name };
    },
    /** Read metadata without returning binary content. Managers reject expired records; drivers expose native metadata.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {Promise<FileInfo | null>} Metadata or null for a missing object; provider failures propagate.
     */
    async stat(address: FileAddress) {
      /** Resolved named connection plus canonical provider address after policy checks. */
      const { name, connection, address: a } = resolve(address);
      /** Fresh object metadata checked for presence/expiry before a composed read or copy. */
      const info = await connection.driver.stat(a);
      if (!info) {
        return null;
      }
      ensureNotExpired(info);
      return { ...info, storage: name };
    },
    /** Open a streaming read; consume or close the returned iterator so its underlying resources can release.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {ReadFileOptions} opts - Optional inclusive byte bounds and caller-owned cancellation.
     * @returns {Promise<AsyncIterable<Uint8Array>>} Byte stream, subject to declared range/encryption capabilities.
     */
    async read(address: FileAddress, opts: ReadFileOptions = {}) {
      validateRange(opts);
      /** Resolved provider/address under this manager policy; identity authorization remains host-owned. */
      const { connection, address: a } = resolve(address);
      /** Fresh object metadata checked for presence/expiry before a composed read or copy. */
      const info = await manager.stat(a);
      if (!info) {
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
      }
      return connection.driver.read(a, opts);
    },
    /** Buffer a bounded object and verify observed size. Only public unencrypted manager reads may use the optional byte cache.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {number} maxBytes - Positive safe-integer byte ceiling; defaults to 16 MiB.
     * @returns {Promise<Uint8Array>} Object bytes; an oversized or changed read rejects.
     */
    async get(address: FileAddress, maxBytes = 16 * 1024 * 1024) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new RangeError('Invalid read limit');
      }
      /** Fresh object metadata checked for presence/expiry before a composed read or copy. */
      const info = await manager.stat(address);
      if (!info) {
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
      }
      if (info.size > maxBytes) {
        throw new RangeError('File exceeds read limit');
      }
      /** Cache identity includes current ETag so distinct object versions cannot share a hit. */
      const key = cacheKey(address) + ':' + info.etag;
      if (cache && info.visibility === 'public' && !info.encryption) {
        /** Independent byte-cache hit for a public unencrypted object, when enabled. */
        const found = cache.get(key);
        if (found) {
          return found;
        }
      }
      /** Borrowed driver read stream consumed with for-await so iterator return can release its resources. */
      const iterable = await manager.read(address);
      let size = 0;
      /** Byte chunks retained only within the explicit get byte ceiling. */
      const parts: Uint8Array[] = [];
      // The explicit get limit bounds this materialization; larger reads should use read().
      for await (const part of iterable) {
        size += part.byteLength;
        if (size > maxBytes) {
          throw new RangeError('File exceeds read limit');
        }
        parts.push(part);
      }
      /** Operation result observed before returning; failures propagate without manufacturing rollback. */
      const result = Buffer.concat(parts, size);
      if (size !== info.size) {
        throw new Error('File changed during read');
      }
      if (cache && info.visibility === 'public' && !info.encryption) {
        cache.set(key, result);
      }
      return result;
    },
    /** Check metadata presence under manager policy without swallowing provider failures.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {Promise<boolean>} False only when stat returns null; expiry/policy errors still propagate.
     */
    async exists(address: FileAddress) {
      return (await manager.stat(address)) !== null;
    },
    /** Rewrite object visibility through copy with explicit overwrite; this is not an IAM/bucket policy change.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {FileVisibility} visibility - Explicit private or public application metadata.
     * @returns {Promise<FileInfo>} Updated metadata, subject to copy capabilities and destination policy.
     */
    async setVisibility(
      address: FileAddress,
      visibility: 'private' | 'public'
    ) {
      if (!['private', 'public'].includes(visibility)) {
        throw new TypeError('Invalid visibility');
      }
      return manager.copy(address, address, { visibility, ifNoneMatch: false });
    },
    /** Copy then delete the source. A failed deletion leaves the committed destination intact.
     * @param {FileAddress} from - Source object; moving onto the same key rejects.
     * @param {FileAddress} to - Destination object under write policy.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<FileInfo>} Destination metadata after source deletion; not a cross-store atomic transaction.
     */
    async move(from: FileAddress, to: FileAddress, opts: PutFileOptions = {}) {
      if (cacheKey(from) === cacheKey(to)) {
        throw new TypeError('Cannot move a file onto itself');
      }
      /** Operation result observed before returning; failures propagate without manufacturing rollback. */
      const result = await manager.copy(from, to, opts);
      // Not an atomic transaction across stores: if source deletion fails,
      // the copied destination is preserved and the error is propagated.
      await manager.delete(from);
      return result;
    },
    /** Delete one object under configured permissions; this is not a conditional version delete.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {Promise<boolean>} Whether an object was present for deletion; provider failures propagate.
     */
    async delete(address: FileAddress) {
      /** Resolved provider/address under this manager policy; identity authorization remains host-owned. */
      const { connection, address: a } = resolve(address);
      if (connection.readonly) {
        throw new Error('Storage is read-only');
      }
      /** Operation result observed before returning; failures propagate without manufacturing rollback. */
      const result = await connection.driver.delete(a);
      invalidate(a);
      return result;
    },
    /** Return a bounded provider page. Opaque continuations and ordering are driver-specific.
     * @param {string} bucket - Validated bucket within configured policy.
     * @param {ListFileOptions} opts - Optional literal prefix, limit, cursor and manager storage selection.
     * @returns {Promise<FileListing>} Page metadata and optional continuation; not an unbounded scan.
     */
    async list(
      bucket: string,
      opts: ListFileOptions & { storage?: string } = {}
    ) {
      validateBucket(bucket);
      if (closed) {
        throw new Error('File manager closed');
      }
      /** Resolved named connection used for dispatch and returned metadata. */
      const name = opts.storage ?? fallback;
      /** Configured driver and host policy for the selected connection. */
      const connection = stores.get(name);
      if (!connection) {
        throw new Error('Unknown storage');
      }
      if (
        connection.allowedBuckets &&
        !connection.allowedBuckets.includes(bucket)
      ) {
        throw new Error('Bucket not allowed by storage policy');
      }
      if (opts.prefix) {
        validateKey(
          opts.prefix.endsWith('/') ? opts.prefix.slice(0, -1) : opts.prefix
        );
      }
      if (
        opts.limit !== undefined &&
        (!Number.isSafeInteger(opts.limit) ||
          opts.limit < 1 ||
          opts.limit > 1000)
      ) {
        throw new RangeError('Invalid list limit');
      }
      if (
        connection.keyPrefix &&
        opts.prefix &&
        !opts.prefix.startsWith(connection.keyPrefix)
      ) {
        throw new Error('Prefix not allowed by storage policy');
      }
      /** Bounded provider page before expired/out-of-prefix entries are filtered. */
      const listed = await connection.driver.list(bucket, {
        ...opts,
        prefix: opts.prefix ?? connection.keyPrefix,
      });
      return {
        ...listed,
        items: listed.items
          .filter(
            (i) =>
              (!i.expiresAt || Date.parse(i.expiresAt) > Date.now()) &&
              (!connection.keyPrefix || i.key.startsWith(connection.keyPrefix))
          )
          .map((i) => ({ ...i, storage: name })),
      };
    },
    /** Copy bytes/metadata subject to destination policy; create-only support must be negotiated.
     * @param {FileAddress} from - Source address; caller must have permission to read it.
     * @param {FileAddress} to - Destination address subject to write policy.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<FileInfo>} Destination metadata; cross-driver fallback streams without a shared transaction.
     */
    async copy(from: FileAddress, to: FileAddress, opts: PutFileOptions = {}) {
      validatePut(opts);
      /** Resolved source connection/address; copy does not authorize a principal. */
      const src = resolve(from);
      /** Resolved destination connection/address whose write policy is checked before copying. */
      const dst = resolve(to);
      if (dst.connection.readonly) {
        throw new Error('Storage is read-only');
      }
      /** Fresh object metadata checked for presence/expiry before a composed read or copy. */
      const info = await manager.stat(from);
      if (!info) {
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
      }
      // Native storage-side COPY must obey the same destination policies as
      // PUT, even when no data is streamed through the manager.
      /** Effective destination MIME for both native-copy and streamed fallback policy checks. */
      const kind = opts.contentType ?? info.contentType;
      if (
        dst.connection.allowedTypes?.length &&
        !dst.connection.allowedTypes.some((pattern) =>
          pattern.endsWith('/*')
            ? kind.startsWith(pattern.slice(0, -1))
            : kind === pattern
        )
      ) {
        throw new Error('Content type not allowed');
      }
      /** Stricter request/connection byte ceiling; validated as a positive safe integer. */
      const max = Math.min(
        opts.maxBytes ?? Number.MAX_SAFE_INTEGER,
        dst.connection.maxBytes ?? Number.MAX_SAFE_INTEGER
      );
      if (!Number.isSafeInteger(max) || max < 1 || info.size > max) {
        throw new RangeError('File size exceeds limit');
      }
      // Streaming fallback across different drivers; never materializes the full object.
      if (src.name === dst.name && src.connection.driver.copy) {
        /** Operation result observed before returning; failures propagate without manufacturing rollback. */
        const result = await src.connection.driver.copy(
          src.address,
          dst.address,
          opts
        );
        invalidate(dst.address);
        return result;
      }
      /** Source byte iterable passed directly to destination put without full-object buffering. */
      const stream = await manager.read(from);
      return manager.put(to, stream, {
        contentType: info.contentType,
        visibility: info.visibility,
        cacheControl: info.cacheControl,
        metadata: info.metadata,
        ...opts,
        maxBytes: max,
      });
    },
    /** Sign backend access for a bounded lifetime without granting application authorization or changing object visibility.
     * @param {'GET' | 'PUT'} method - Backend operation to sign.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {number} seconds - Safe integer lifetime from 1 to 604800 seconds.
     * @param {PutFileOptions} opts - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<string>} Sensitive temporary URL; keep it out of default logs.
     */
    async signedUrl(method, address, seconds, opts) {
      /** Resolved provider/address under this manager policy; identity authorization remains host-owned. */
      const { connection, address: a } = resolve(address);
      if (!['GET', 'PUT'].includes(method)) {
        throw new TypeError('Invalid signed method');
      }
      if (method === 'PUT' && connection.readonly) {
        throw new Error('Storage is read-only');
      }
      validatePut(opts ?? {});
      if (
        method === 'PUT' &&
        (connection.maxBytes !== undefined || connection.allowedTypes?.length)
      ) {
        throw new TypeError(
          'Signed PUT cannot enforce manager size/type policies'
        );
      }
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 604800) {
        throw new RangeError('Invalid signing lifetime');
      }
      if (!connection.driver.signedUrl) {
        throw new Error('Signed URL unsupported by storage');
      }
      return connection.driver.signedUrl(method, a, seconds, opts);
    },
    /** Format a configured public address without changing object permissions or verifying public reachability.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {string | undefined} Formatted URL when supported/configured; not an authorization receipt.
     */
    publicUrl(address) {
      /** Resolved provider/address under this manager policy; identity authorization remains host-owned. */
      const { connection, address: a } = resolve(address);
      return connection.driver.publicUrl?.(a);
    },
    /** Project process-local retained bytes and lifetime hit/miss counters.
     * @returns {object} Fresh entry/byte/hit/miss counters, or zeros when disabled.
     */
    cacheStats() {
      return cache?.stats() ?? { entries: 0, bytes: 0, hits: 0, misses: 0 };
    },
    invalidate,
    /** Stop admission and release owned resources. Manager closes distinct configured drivers; resumable coordinators must drain first. Borrowed native clients retain their declared ownership.
     * @returns {Promise<void>} Cleanup completion; manager does not track every in-flight read/write.
     */
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      invalidate();
      await Promise.all(
        [...new Set([...stores.values()].map((s) => s.driver))].map((s) =>
          s.close?.()
        )
      );
    },
  };
  return manager;
}
