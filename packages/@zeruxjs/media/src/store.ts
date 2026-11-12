import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  writeFile,
  unlink,
  stat,
  readdir,
  open,
  lstat,
  realpath,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  StoredMedia,
  UploadOptions,
  ListOptions,
  CleanupResult,
} from './types.js';
import { safePath, assertId, validateUpload } from './validation.js';

/** Private disk storage with per-operation handles and explicit metadata/binary integrity boundaries. */
export class MediaStore {
  /** Canonical lexical root; each operation verifies the filesystem has not redirected it. */
  private readonly root: string;
  /** Configure a private local store without acquiring persistent handles. Each operation owns its file handles; the host owns authorization and scheduling.
   * @param {string} directory - Local root resolved once; symlink components reject when used.
   * @param {number} defaultMaxBytes - Default upload byte ceiling, 10 MiB; explicit upload options may override it.
   */
  constructor(
    directory: string,
    private readonly defaultMaxBytes = 10 * 1024 * 1024
  ) {
    if (
      !directory ||
      !Number.isSafeInteger(defaultMaxBytes) ||
      defaultMaxBytes < 1
    ) {
      throw new TypeError('Invalid media store configuration');
    }
    this.root = resolve(directory);
  }
  /** Resolve a validated opaque ID beneath the configured root.
   * @param {string} id - Opaque UUID, never a caller-supplied path.
   * @returns {string} Contained local binary filename; this does not grant permission.
   */
  private path(id: string): string {
    return safePath(this.root, id);
  }
  /** Verify the root is a real canonical directory before local operations. This is not a cross-process namespace lock.
   * @param {boolean} create - Whether upload may create the directory with private mode; default false.
   * @returns {Promise<void>} Resolves after checks; filesystem/type/symlink failures reject.
   */
  private async secureDirectory(create = false): Promise<void> {
    if (create) {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
    }
    if ((await lstat(this.root)).isSymbolicLink()) {
      throw new Error('Media root must not be a symbolic link');
    }
    if (!(await stat(this.root)).isDirectory()) {
      throw new Error('Media root must be a directory');
    }
    // Ensure no intermediate components redirect the resolved directory elsewhere.
    if ((await realpath(this.root)) !== this.root) {
      throw new Error('Media root must not contain symlink components');
    }
  }
  /** Read a bounded no-follow sidecar and validate its stored shape/expiry. The owned handle closes even if parsing fails.
   * @param {string} id - Expected record ID bound to the sidecar name.
   * @param {boolean} includeExpired - Whether to include valid expired records; default false.
   * @returns {Promise<StoredMedia>} Parsed metadata; missing, malformed or disallowed expired records reject.
   */
  private async readMetadata(
    id: string,
    includeExpired = false
  ): Promise<StoredMedia> {
    await this.secureDirectory();
    /** Owned no-follow file handle, or observed stat record within its handle lifetime. */
    const file = await open(
      this.path(id) + '.json',
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      /** Observed sidecar stat used to enforce regular-file and byte limits before parsing. */
      const info = await file.stat();
      if (!info.isFile() || info.size > 8192) {
        throw new Error('Invalid media metadata file');
      }
      /** Parsed private sidecar facts; only accepted after the following shape checks. */
      const data: StoredMedia = JSON.parse(
        await file.readFile({ encoding: 'utf8' })
      );
      if (
        data.id !== id ||
        typeof data.originalName !== 'string' ||
        typeof data.contentType !== 'string' ||
        !Number.isSafeInteger(data.size) ||
        data.size < 0 ||
        typeof data.createdAt !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.sha256)
      ) {
        throw new Error('Corrupted media metadata');
      }
      if (
        data.expiresAt &&
        (Number.isNaN(Date.parse(data.expiresAt)) ||
          (!includeExpired && Date.parse(data.expiresAt) <= Date.now()))
      ) {
        throw new Error('Media expired');
      }
      return data;
    } finally {
      await file.close();
    }
  }
  /** Store explicit bytes using the same counted/hash-verified write path as streaming uploads. No content is executed or decoded.
   * @param {Uint8Array} data - Caller-owned bytes, consumed without taking ownership of the original array.
   * @param {UploadOptions} options - Validated display/MIME/expiry and optional upload ceiling.
   * @returns {Promise<StoredMedia>} Metadata after binary sync and sidecar creation; not a cross-file crash transaction.
   */
  async upload(data: Uint8Array, options: UploadOptions): Promise<StoredMedia> {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError('Expected binary data');
    }
    return this.uploadStream(
      (async function* () {
        yield data;
      })(),
      options
    );
  }
  /** Count and hash streamed bytes into an exclusive private file, then write its sidecar. Failure attempts cleanup of both entries and preserves the original cause.
   * @param {AsyncIterable<Uint8Array> | Iterable<Uint8Array>} source - Borrowed iterable of byte chunks; iteration errors fail the upload.
   * @param {UploadOptions} options - Declared metadata and optional byte ceiling, validated before writing.
   * @returns {Promise<StoredMedia>} Committed local metadata after successful writes; host owns durable reconciliation after crashes.
   */
  async uploadStream(
    source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: UploadOptions
  ): Promise<StoredMedia> {
    /** Validated upload ceiling and normalized optional expiry before file acquisition. */
    const { max, expiresAt } = validateUpload(options, this.defaultMaxBytes);
    /** Opaque storage identifier; possession alone never authorizes access. */
    const id = randomUUID();
    await this.secureDirectory(true);
    /** Contained binary destination paired with a separately created JSON sidecar. */
    const dest = this.path(id);
    /** Owned file handle released by this operation, never retained by the store. */
    const handle = await open(dest, 'wx', 0o600);
    let bytes = 0;
    /** Incremental SHA-256 of actual written bytes, independent of declared MIME. */
    const hash = createHash('sha256');
    let closed = false;
    try {
      // Count every chunk and await all writes; declared lengths never replace actual-byte limits.
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) {
          throw new TypeError('Chunks must be Uint8Array');
        }
        bytes += chunk.byteLength;
        if (!Number.isSafeInteger(bytes) || bytes > max) {
          throw new RangeError('Media size exceeds limit');
        }
        hash.update(chunk);
        let offset = 0;
        // Filesystem writes may complete partially, so advance only by confirmed bytes.
        while (offset < chunk.byteLength) {
          /** Actual completed write count; zero progress fails rather than spinning. */
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            chunk.byteLength - offset
          );
          if (!bytesWritten) {
            throw new Error('Unable to write media');
          }
          offset += bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      closed = true;
      /** Sidecar facts written after binary completion, or loaded before binary verification. */
      const metadata: StoredMedia = {
        id,
        originalName: options.name,
        contentType: options.contentType,
        size: bytes,
        sha256: hash.digest('hex'),
        createdAt: new Date().toISOString(),
        ...(expiresAt ? { expiresAt } : {}),
      };
      await writeFile(dest + '.json', JSON.stringify(metadata), {
        flag: 'wx',
        mode: 0o600,
      });
      return metadata;
    } catch (error) {
      if (!closed) {
        await handle.close().catch(() => {});
      }
      await unlink(dest).catch(() => {});
      await unlink(dest + '.json').catch(() => {});
      throw error;
    }
  }
  /** Read validated, unexpired metadata without treating possession of an ID as authorization.
   * @param {string} id - Opaque record ID.
   * @returns {Promise<StoredMedia>} Stored sidecar facts; does not read or verify binary bytes.
   */
  async info(id: string): Promise<StoredMedia> {
    assertId(id);
    return this.readMetadata(id);
  }
  /** Buffer a complete object and verify observed length plus SHA-256 before returning bytes. The host must bound permitted object sizes and authorize first.
   * @param {string} id - Authorized opaque record ID.
   * @returns {Promise<object>} Verified bytes and metadata; filesystem/integrity errors reject after closing the handle.
   */
  async download(id: string): Promise<{ data: Buffer; metadata: StoredMedia }> {
    /** Sidecar facts written after binary completion, or loaded before binary verification. */
    const metadata = await this.info(id);
    /** Owned file handle released by this operation, never retained by the store. */
    const handle = await open(
      this.path(id),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    let data: Buffer;
    try {
      /** Owned no-follow file handle, or observed stat record within its handle lifetime. */
      const file = await handle.stat();
      if (!file.isFile() || file.size !== metadata.size) {
        throw new Error('Media integrity size mismatch');
      }
      data = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (
      data.byteLength !== metadata.size ||
      createHash('sha256').update(data).digest('hex') !== metadata.sha256
    ) {
      throw new Error('Media integrity check failed');
    }
    return { data, metadata };
  }
  /** Lazily open a byte range and enforce physical size, yielding bounded blocks. Full content SHA-256 is not checked before bytes are exposed.
   * @param {string} id - Authorized opaque record ID.
   * @param {number} start - Inclusive safe-integer offset, default zero.
   * @param {number} end - Optional inclusive offset clamped to the final stored byte.
   * @returns {AsyncIterable<Buffer>} Owned lazy iterator; consume or return it so its finally block closes the file.
   */
  async *streamRange(
    id: string,
    start = 0,
    end?: number
  ): AsyncIterable<Buffer> {
    /** Sidecar facts written after binary completion, or loaded before binary verification. */
    const metadata = await this.info(id);
    if (
      !Number.isSafeInteger(start) ||
      start < 0 ||
      (end !== undefined && (!Number.isSafeInteger(end) || end < start))
    ) {
      throw new RangeError('Invalid media range');
    }
    /** Owned file handle released by this operation, never retained by the store. */
    const handle = await open(
      this.path(id),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      /** Owned no-follow file handle, or observed stat record within its handle lifetime. */
      const file = await handle.stat();
      if (!file.isFile() || file.size !== metadata.size) {
        throw new Error('Media integrity size mismatch');
      }
      if (start >= file.size) {
        return;
      }
      /** Inclusive last byte clamped to the observed regular-file size. */
      const last = Math.min(end ?? file.size - 1, file.size - 1);
      let offset = start;
      // Yield bounded blocks and retain the handle until completion or iterator cancellation.
      while (offset <= last) {
        /** Bounded read block; only initialized bytes are yielded to the consumer. */
        const buffer = Buffer.allocUnsafe(
          Math.min(64 * 1024, last - offset + 1)
        );
        /** Actual read progress; unexpected truncation fails the stream. */
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset
        );
        if (!bytesRead) {
          throw new Error('Media changed while streaming');
        }
        offset += bytesRead;
        yield buffer.subarray(0, bytesRead);
      }
    } finally {
      await handle.close();
    }
  }
  /** Delegate a complete lazy stream to range handling with the same size-only integrity guarantee.
   * @param {string} id - Authorized opaque record ID.
   * @returns {AsyncIterable<Buffer>} Byte iterator whose consumer must finish or cancel it.
   */
  async *stream(id: string): AsyncIterable<Buffer> {
    yield* this.streamRange(id);
  }
  /** Unlink only recognized regular binary/sidecar entries. Missing entries are tolerated; partial failure is explicit and not rolled back.
   * @param {string} id - Authorized opaque record ID; the host decides deletion policy.
   * @returns {Promise<void>} Resolves after both deletion attempts; unsafe types and other filesystem errors reject.
   */
  async remove(id: string): Promise<void> {
    await this.secureDirectory();
    /** Validated contained filename; deletion inspects each entry without following links. */
    const path = this.path(id);
    // Never follow a replaced symlink. Unlink only entries with expected file type.
    for (const target of [path, path + '.json']) {
      try {
        /** Observed entry type or parsed sidecar used only within the current scan. */
        const item = await lstat(target);
        if (!item.isFile()) {
          throw new Error('Unsafe media entry');
        }
        await unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
  /** Probe metadata and binary type without exposing storage failures. False includes denied, expired, malformed and unavailable records.
   * @param {string} id - Opaque record ID; this is not an authorization check.
   * @returns {Promise<boolean>} Whether readable unexpired metadata and a regular binary file were observed.
   */
  async exists(id: string): Promise<boolean> {
    try {
      await this.info(id);
      /** Owned file handle released by this operation, never retained by the store. */
      const handle = await open(
        this.path(id),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        return (await handle.stat()).isFile();
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }
  /** Scan recognized sidecars in deterministic filename order and then page the valid records. This scans the directory rather than a bounded database cursor.
   * @param {ListOptions} options - Limit defaults to 100 (maximum 10000), offset to zero; expired records are excluded by default.
   * @returns {Promise<StoredMedia[]>} Metadata page; malformed/incomplete records are skipped, other root failures reject.
   */
  async list(options: ListOptions = {}): Promise<StoredMedia[]> {
    /** Requested result count, default 100 and validated against the 10000 ceiling. */
    const limit = options.limit ?? 100;
    /** Nonnegative page offset applied after scanning valid metadata. */
    const offset = options.offset ?? 0;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      limit > 10000 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      throw new RangeError('Invalid pagination');
    }
    try {
      await this.secureDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    /** Sorted recognized sidecar names; unrelated directory entries are ignored. */
    const names = (await readdir(this.root))
      .filter((name) => name.endsWith('.json'))
      .sort();
    /** Operation-local valid metadata collection; pagination does not bound the scan itself. */
    const items: StoredMedia[] = [];
    // Validate sidecars independently; one corrupt record does not hide other valid metadata.
    for (const name of names) {
      /** Opaque storage identifier; possession alone never authorizes access. */
      const id = name.slice(0, -5);
      try {
        /** Validated sidecar selected for this result page, with requested expiry visibility. */
        const meta = await this.readMetadata(id, options.includeExpired);
        items.push(meta);
      } catch {
        /* Skip incomplete or malformed entries. */
      }
    }
    return items.slice(offset, offset + limit);
  }
  /** Explicitly scan recognized local sidecars and remove expired entries. The host authorizes/schedules this operation; no background cleanup is started.
   * @returns {Promise<CleanupResult>} Observed scan/removal counts; malformed entries remain untouched.
   */
  async cleanupExpired(): Promise<CleanupResult> {
    let removed = 0,
      scanned = 0;
    try {
      await this.secureDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { removed, scanned };
      }
      throw error;
    }
    // Restrict cleanup to recognized sidecars; unrelated or malformed entries are preserved.
    for (const name of (await readdir(this.root)).filter((name) =>
      name.endsWith('.json')
    )) {
      /** Opaque storage identifier; possession alone never authorizes access. */
      const id = name.slice(0, -5);
      try {
        assertId(id);
        /** Owned no-follow file handle, or observed stat record within its handle lifetime. */
        const file = await open(
          this.path(id) + '.json',
          constants.O_RDONLY | constants.O_NOFOLLOW
        );
        let item: StoredMedia;
        try {
          if ((await file.stat()).size > 8192) {
            continue;
          }
          item = JSON.parse(
            await file.readFile({ encoding: 'utf8' })
          ) as StoredMedia;
        } finally {
          await file.close();
        }
        if (item.id !== id || typeof item.expiresAt !== 'string') {
          scanned++;
          continue;
        }
        scanned++;
        if (
          !Number.isNaN(Date.parse(item.expiresAt)) &&
          Date.parse(item.expiresAt) <= Date.now()
        ) {
          await this.remove(id);
          removed++;
        }
      } catch {
        /* Skip malformed entries; do not remove unrelated files. */
      }
    }
    return { removed, scanned };
  }
}
/** Configure an inert local store; operations own handles and the host owns permissions.
 * @param {string} root - Private local root; checked for symlinks when an operation runs.
 * @param {number} [maxBytes] - Default upload ceiling in bytes; defaults to 10 MiB.
 * @returns {MediaStore} Store configuration without persistent handles or automatic cleanup.
 */
export const createMediaStore = (root: string, maxBytes?: number): MediaStore =>
  new MediaStore(root, maxBytes);
