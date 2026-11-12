import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { DecipherGCM } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  lstat,
  realpath,
  open,
  link,
  rename,
  unlink,
  readdir,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  FileAddress,
  FileInfo,
  FileSource,
  ListFileOptions,
  FileListing,
  PutFileOptions,
  ReadFileOptions,
  StorageDriver,
} from '../types.js';
import {
  chunks,
  ensureNotExpired,
  validateAddress,
  validateBucket,
  validateKey,
  validatePut,
  validateRange,
} from '../validation.js';
/** Trusted private-disk configuration; the host owns permissions and encryption-key lifecycle. */
export interface LocalStorageOptions {
  /** Trusted local storage root; private directory ownership remains host-controlled. */
  root: string;
  /** 32-byte application-owned AES-256-GCM key; binary or base64-encoded. */
  encryptionKey?: Uint8Array | string;
}
/** Create a fixed missing-object error without including a local path.
 * @returns {Error} Error carrying ENOENT for host status mapping.
 */
function failNotFound(): Error {
  return Object.assign(new Error('File not found'), { code: 'ENOENT' });
}
/** Create a private local object driver with separate object/metadata trees and optional AES-256-GCM. No persistent handle or server starts at construction.
 * @param {LocalStorageOptions} options - Trusted canonical storage root and optional copied 32-byte encryption key.
 * @returns {StorageDriver} Local object-addressing API, not an AWS wire server; individual operations/iterators own file handles.
 */
export function createLocalStorage(
  options: LocalStorageOptions
): StorageDriver {
  if (!options?.root) {
    throw new TypeError('Local storage root required');
  }
  /** Resolved private storage root, checked for canonical non-symlink directory access. */
  const root = resolve(options.root);
  /** Internal object-byte tree beneath the root. */
  const objects = join(root, 'objects');
  /** Internal sidecar tree separate from object bytes. */
  const metadata = join(root, 'metadata');
  /** Copied optional AES-256-GCM key; no implicit key derivation or remote lookup. */
  const key = (() => {
    if (options.encryptionKey === undefined) {
      return undefined;
    }
    if (typeof options.encryptionKey === 'string') {
      return Buffer.from(options.encryptionKey, 'base64');
    }
    return Buffer.from(options.encryptionKey);
  })();
  if (key && key.byteLength !== 32) {
    throw new TypeError('AES-256-GCM requires 32-byte encryption key');
  }
  /** Check canonical non-symlink directories within the configured root; optionally create private directories. This is not a hostile-filesystem race sandbox.
   * @param {string} path - Resolved descendant/root path built by trusted driver helpers.
   * @param {boolean} create - Create missing directories with mode 0700; defaults false.
   * @returns {Promise<void>} Validated directory; unsafe/noncanonical paths reject.
   */
  async function secureDir(path: string, create = false) {
    if (!(path === root || path.startsWith(root + sep))) {
      throw new Error('Unsafe storage directory');
    }
    if (create) {
      if (path !== root) {
        await secureDir(dirname(path), true);
      }
      await mkdir(path, { mode: 0o700 }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      });
    }
    /** Current directory lstat result checked together with its canonical realpath. */
    const current = await lstat(path);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      (await realpath(path)) !== path
    ) {
      throw new Error('Unsafe storage directory');
    }
    // Check root separately even when requesting a nested directory.
    if (path !== root) {
      await secureDir(root);
    }
  }
  /** Validate addressing and derive separate object and hashed sidecar paths.
   * @param {FileAddress} address - Relative bucket/key already subject to manager/host policy.
   * @returns {object} Internal object/sidecar paths; neither is a public access URL.
   */
  function paths(address: FileAddress) {
    validateAddress(address);
    /** Internal object path built only from validated bucket/key segments. */
    const dest = join(objects, address.bucket, ...address.key.split('/'));
    /** SHA-256 of the key used for a fixed-size metadata filename, not authentication. */
    const id = createHash('sha256').update(address.key).digest('hex');
    return { dest, sidecar: join(metadata, address.bucket, id + '.json') };
  }
  /** Open bounded no-follow metadata and verify the corresponding physical object shape/size, releasing both handles.
   * @param {FileAddress} a - Validated local object identity.
   * @returns {Promise<FileInfo | null>} Parsed metadata or null on ENOENT; corruption/unsafe access propagates.
   */
  async function metadataOf(a: FileAddress): Promise<FileInfo | null> {
    /** Separate sidecar/object paths for this validated address. */
    const { sidecar, dest } = paths(a);
    try {
      await secureDir(dirname(sidecar));
      /** Operation-owned no-follow/exclusive file handle; local finally blocks release it. */
      const handle = await open(
        sidecar,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        /** Observed file shape/size checked before metadata or bytes are trusted. */
        const st = await handle.stat();
        if (!st.isFile() || st.size > 16384) {
          throw new Error('Invalid file metadata');
        }
        /** Validated/generated storage metadata; not a principal authorization record. */
        const info = JSON.parse(
          await handle.readFile({ encoding: 'utf8' })
        ) as FileInfo;
        if (
          info.bucket !== a.bucket ||
          info.key !== a.key ||
          !Number.isSafeInteger(info.size) ||
          info.size < 0 ||
          typeof info.etag !== 'string' ||
          !/^"[a-f0-9]{64}"$/.test(info.etag) ||
          !['private', 'public'].includes(info.visibility) ||
          typeof info.contentType !== 'string' ||
          typeof info.modifiedAt !== 'string' ||
          !info.metadata ||
          typeof info.metadata !== 'object'
        ) {
          throw new Error('Corrupted file metadata');
        }
        await secureDir(dirname(dest));
        /** Owned no-follow object handle used only for physical validation. */
        const file = await open(
          dest,
          constants.O_RDONLY | constants.O_NOFOLLOW
        );
        try {
          /** Physical object stat used to detect missing, changed or non-file storage entries. */
          const physical = await file.stat();
          if (!physical.isFile() || physical.size !== info.size) {
            if (!info.encryption || physical.size !== info.size) {
              throw new Error('File size mismatch');
            }
          }
        } finally {
          await file.close();
        }
        return info;
      } finally {
        await handle.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw e;
    }
  }
  /** Write/fsync a private exclusive temporary sidecar and rename it into place. Binary and sidecar promotion are not one crash-atomic transaction.
   * @param {string} path - Internal sidecar destination under the private metadata tree.
   * @param {unknown} data - Trusted serializable metadata record, never executable source.
   * @returns {Promise<void>} Sidecar promotion completion; owned temporary files are removed in finally.
   */
  async function atomicJson(path: string, data: unknown) {
    await secureDir(dirname(path), true);
    /** Unique private temporary path, cleaned after success or failure. */
    const tmp = path + '.tmp-' + randomUUID();
    try {
      /** Operation-owned no-follow/exclusive file handle; local finally blocks release it. */
      const handle = await open(tmp, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(data));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, path);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  /** Inert local facade; each operation owns its temporary handles independently. */
  const driver: StorageDriver = {
    kind: 'local-s3-lite',
    capabilities: Object.freeze({
      range: !key,
      multipart: false,
      resumableMultipart: true,
      multipartCreateOnly: true,
      signedUrls: false,
      createOnlyWrite: true,
      createOnlyStream: true,
      createOnlyCopy: false,
      encryption: Object.freeze(key ? ['AES-256-GCM'] : []),
    }),
    /** Persist binary content under the configured driver/policy; an error after dispatch may have an uncertain commit outcome.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {FileSource} source - Borrowed bytes or stream; consumption and cancellation remain cooperative.
     * @param {PutFileOptions} options - Optional write metadata, limits, create-only policy and cooperative cancellation.
     * @returns {Promise<FileInfo>} Committed provider metadata; create-only behavior depends on declared capabilities.
     */
    async put(
      address: FileAddress,
      source: FileSource,
      options: PutFileOptions = {}
    ) {
      validatePut(options);
      /** Separate object/sidecar destinations; their two promotions are not globally atomic. */
      const { dest, sidecar } = paths(address);
      await secureDir(dirname(dest), true);
      await secureDir(dirname(sidecar), true);
      if (options.ifNoneMatch !== false && (await metadataOf(address))) {
        throw Object.assign(new Error('File exists'), { code: 'FILE_EXISTS' });
      }
      /** Unique private temporary path, cleaned after success or failure. */
      const tmp = dest + '.tmp-' + randomUUID();
      /** Operation-owned no-follow/exclusive file handle; local finally blocks release it. */
      const handle = await open(tmp, 'wx', 0o600);
      let length = 0;
      /** Incremental SHA-256 over plaintext bytes before optional encryption. */
      const hash = createHash('sha256');
      /** Fresh 12-byte GCM nonce stored with the authentication tag in version metadata. */
      const iv = key ? randomBytes(12) : undefined;
      /** Optional GCM encryptor; its tag is recorded only after successful finalization. */
      const cipher =
        key && iv ? createCipheriv('aes-256-gcm', key, iv) : undefined;
      try {
        // Count/hash plaintext before encoding each chunk into the uncommitted temporary file.
        for await (const part of chunks(source, options.signal)) {
          length += part.byteLength;
          if (
            !Number.isSafeInteger(length) ||
            length > (options.maxBytes ?? Number.MAX_SAFE_INTEGER)
          ) {
            throw new RangeError('File size exceeds limit');
          }
          hash.update(part);
          /** Encrypted or original chunk passed to the private staging file. */
          const encoded = cipher ? cipher.update(part) : part;
          if (encoded.byteLength) {
            await handle.writeFile(encoded);
          }
        }
        if (cipher) {
          /** Final encrypted bytes emitted before the object is synced/promoted. */
          const tail = cipher.final();
          if (tail.byteLength) {
            await handle.writeFile(tail);
          }
        }
        await handle.sync();
        await handle.close();
        if (options.ifNoneMatch !== false) {
          await link(tmp, dest);
          await unlink(tmp);
        } else {
          await rename(tmp, dest);
        }
        /** Validated/generated storage metadata; not a principal authorization record. */
        const info: FileInfo = {
          bucket: address.bucket,
          key: address.key,
          size: length,
          etag: '"' + hash.digest('hex') + '"',
          contentType: options.contentType ?? 'application/octet-stream',
          visibility: options.visibility ?? 'private',
          modifiedAt: new Date().toISOString(),
          metadata: { ...options.metadata },
          ...(options.cacheControl
            ? { cacheControl: options.cacheControl }
            : {}),
          ...(options.contentDisposition
            ? { contentDisposition: options.contentDisposition }
            : {}),
          ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
          ...(cipher && iv
            ? {
                encryption: 'AES-256-GCM',
                rangeSupported: false,
                versionId:
                  iv.toString('base64url') +
                  '.' +
                  cipher.getAuthTag().toString('base64url'),
              }
            : {}),
        };
        await atomicJson(sidecar, info);
        return info;
      } catch (err) {
        await handle.close().catch(() => {});
        throw err;
      } finally {
        await unlink(tmp).catch(() => {});
      }
    },
    /** Read metadata without returning binary content. Managers reject expired records; drivers expose native metadata.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {Promise<FileInfo | null>} Metadata or null for a missing object; provider failures propagate.
     */
    stat(address) {
      return metadataOf(address);
    },
    /** Open a streaming read; consume or close the returned iterator so its underlying resources can release.
     * @param {FileAddress} address - Bucket/key plus optional named storage; authorization remains host-owned.
     * @param {ReadFileOptions} opts - Optional inclusive byte bounds and caller-owned cancellation.
     * @returns {Promise<AsyncIterable<Uint8Array>>} Byte stream, subject to declared range/encryption capabilities.
     */
    async read(address: FileAddress, opts: ReadFileOptions = {}) {
      validateRange(opts);
      /** Validated/generated storage metadata; not a principal authorization record. */
      const info = await metadataOf(address);
      if (!info) {
        throw failNotFound();
      }
      ensureNotExpired(info);
      if (
        info.encryption &&
        (opts.start !== undefined || opts.end !== undefined)
      ) {
        throw new Error('Ranges unsupported for encrypted local objects');
      }
      /** Internal object-byte path whose ancestors are validated before opening. */
      const { dest } = paths(address);
      await secureDir(dirname(dest));
      /** Operation-owned no-follow/exclusive file handle; local finally blocks release it. */
      const handle = await open(
        dest,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      /** Observed file shape/size checked before metadata or bytes are trusted. */
      const st = await handle.stat();
      if (!st.isFile() || st.size !== info.size) {
        await handle.close();
        throw new Error('File size changed');
      }
      if (info.encryption) {
        // Verify the entire AES-GCM authentication tag BEFORE emitting any bytes.
        // This is an extra streaming pass over the private file, bounded in memory.
        try {
          if (!key || !info.versionId) {
            throw new Error('Storage encryption key unavailable');
          }
          /** Stored GCM nonce/tag decoded for verification or the subsequent decryption pass. */
          const [iv, tag] = info.versionId.split('.');
          /** First-pass GCM verifier; no plaintext is exposed before final tag verification. */
          const verifier = createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(iv, 'base64url')
          ) as DecipherGCM;
          verifier.setAuthTag(Buffer.from(tag, 'base64url'));
          let checkOffset = 0;
          // Authenticate the entire ciphertext in bounded blocks before any plaintext yield.
          while (checkOffset < info.size) {
            if (opts.signal?.aborted) {
              throw opts.signal.reason;
            }
            /** Bounded read buffer, at most 64 KiB; no full-object materialization. */
            const buf = Buffer.allocUnsafe(
              Math.min(64 * 1024, info.size - checkOffset)
            );
            /** Actual file-read count; zero before expected completion indicates truncation. */
            const { bytesRead } = await handle.read(
              buf,
              0,
              buf.length,
              checkOffset
            );
            if (!bytesRead) {
              throw new Error('File truncated during decryption');
            }
            verifier.update(buf.subarray(0, bytesRead));
            checkOffset += bytesRead;
          }
          verifier.final();
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      /** Inclusive read start, default zero. */
      const start = opts.start ?? 0;
      /** Inclusive read end clamped to the known logical size. */
      const end = Math.min(
        opts.end ?? Math.max(0, info.size - 1),
        Math.max(0, info.size - 1)
      );
      /** Yield bounded file blocks and close the opened handle in finally. Encrypted reads first completed a separate full authentication pass.
       * @returns {AsyncGenerator<Uint8Array>} Byte stream; consume or return the iterator so handle cleanup runs.
       */
      async function* reader() {
        try {
          let decipher: DecipherGCM | undefined;
          if (info!.encryption) {
            if (!key || !info!.versionId) {
              throw new Error('Storage encryption key unavailable');
            }
            /** Stored GCM nonce/tag decoded for verification or the subsequent decryption pass. */
            const [iv, tag] = info!.versionId.split('.');
            decipher = createDecipheriv(
              'aes-256-gcm',
              key,
              Buffer.from(iv, 'base64url')
            ) as DecipherGCM;
            decipher.setAuthTag(Buffer.from(tag, 'base64url'));
          }
          let offset = start;
          // Read only the selected range; encrypted reads already passed full first-pass authentication.
          while (offset <= end && info!.size) {
            if (opts.signal?.aborted) {
              throw opts.signal.reason;
            }
            /** Bounded read buffer, at most 64 KiB; no full-object materialization. */
            const buf = Buffer.allocUnsafe(
              Math.min(64 * 1024, end - offset + 1)
            );
            /** Actual file-read count; zero before expected completion indicates truncation. */
            const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
            if (!bytesRead) {
              throw new Error('File truncated during read');
            }
            offset += bytesRead;
            /** Decrypted or original read block yielded only after first-pass authentication. */
            const part = decipher
              ? decipher.update(buf.subarray(0, bytesRead))
              : buf.subarray(0, bytesRead);
            if (part.byteLength) {
              yield part;
            }
          }
          if (decipher) {
            /** Final decrypted bytes emitted after the second-pass tag check. */
            const final = decipher.final();
            if (final.byteLength) {
              yield final;
            }
          }
        } finally {
          await handle.close();
        }
      }
      return reader();
    },
    /** Delete one object under configured permissions; this is not a conditional version delete.
     * @param {FileAddress} a - Bucket/key plus optional named storage; authorization remains host-owned.
     * @returns {Promise<boolean>} Whether an object was present for deletion; provider failures propagate.
     */
    async delete(a) {
      /** Validated/generated storage metadata; not a principal authorization record. */
      const info = await metadataOf(a);
      if (!info) {
        return false;
      }
      /** Separate object/sidecar destinations; their two promotions are not globally atomic. */
      const { dest, sidecar } = paths(a);
      // Validate both targets before deleting either; this is still not a two-file transaction.
      for (const path of [dest, sidecar]) {
        /** lstat record checked to reject non-file/symlink delete targets. */
        const item = await lstat(path);
        if (!item.isFile() || item.isSymbolicLink()) {
          throw new Error('Unsafe storage entry');
        }
      }
      await unlink(sidecar);
      await unlink(dest);
      return true;
    },
    /** Return a bounded provider page. Opaque continuations and ordering are driver-specific.
     * @param {string} bucket - Validated bucket within configured policy.
     * @param {ListFileOptions} options - Optional literal prefix, limit, cursor and manager storage selection.
     * @returns {Promise<FileListing>} Page metadata and optional continuation; not an unbounded scan.
     */
    async list(
      bucket: string,
      options: ListFileOptions = {}
    ): Promise<FileListing> {
      validateBucket(bucket);
      /** Validated local metadata page size, 1–1000 with default 100. */
      const limit = options.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new RangeError('Invalid limit');
      }
      /** Private metadata bucket directory; absent buckets return an empty page. */
      const location = join(metadata, bucket);
      try {
        await secureDir(location);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          return { items: [] };
        }
        throw e;
      }
      /** Validated live metadata collected before local key ordering; this legacy listing scans the bucket. */
      const all: FileInfo[] = [];
      // Legacy local listing validates the bucket's sidecars before slicing the requested page.
      for (const name of (await readdir(location)).filter((n) =>
        /^[a-f0-9]{64}\.json$/.test(n)
      )) {
        try {
          /** Internal metadata entry path opened without following a final symlink. */
          const path = join(location, name);
          /** Operation-owned no-follow/exclusive file handle; local finally blocks release it. */
          const handle = await open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW
          );
          let info: FileInfo;
          try {
            if ((await handle.stat()).size > 16384) {
              continue;
            }
            info = JSON.parse(
              await handle.readFile({ encoding: 'utf8' })
            ) as FileInfo;
          } finally {
            await handle.close();
          }
          if (info.bucket !== bucket || typeof info.key !== 'string') {
            continue;
          }
          validateKey(info.key);
          if (options.prefix && !info.key.startsWith(options.prefix)) {
            continue;
          }
          /** Revalidated metadata whose expiry still permits inclusion. */
          const valid = await metadataOf(info);
          if (
            (valid && !valid.expiresAt) ||
            (valid && Date.parse(valid.expiresAt!) > Date.now())
          ) {
            all.push(valid!);
          }
        } catch {
          /* exclude broken records */
        }
      }
      all.sort((a, b) => a.key.localeCompare(b.key));
      /** Key-ordered live records strictly after the supplied local cursor. */
      const filtered = all.filter(
        (item) => !options.cursor || item.key > options.cursor
      );
      /** Bounded slice returned to the caller with a last-key continuation when needed. */
      const items = filtered.slice(0, limit);
      return {
        items,
        nextCursor: filtered.length > limit ? items.at(-1)!.key : undefined,
      };
    },
  };
  return driver;
}
/** Compatible alias for createLocalStorage; object addressing does not implement an AWS HTTP server. */
export const createS3LiteStorage = createLocalStorage;
