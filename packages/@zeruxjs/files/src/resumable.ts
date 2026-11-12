import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  lstat,
  realpath,
  open,
  rename,
  unlink,
  rmdir,
  rm,
  opendir,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { FileAddress, FileInfo, PutFileOptions } from './types.js';
import type {
  ResumableUploadOptions,
  ResumableUploads,
  UploadSession,
  UploadIdentity,
  UploadCleanupCandidate,
  UploadPart,
} from './multipart-types.js';
import { chunks, validateAddress, validatePut } from './validation.js';
interface Record extends UploadSession {
  /** Private journal schema version, fixed at one. */
  version: 1;
  /** SHA-256 of verified tenant/subject tuple; not an auth token or anonymization proof. */
  binding: string;
  /** Private canonical destination under manager policy. */
  address: FileAddress;
  /** Validated write metadata excluding request-local signals. */
  options: PutFileOptions;
  /** Private provider upload ID, never returned as a public authorization mechanism. */
  nativeId?: string;
  /** Committed metadata retained for idempotent finalization. */
  result?: FileInfo;
}
/** Hash inert bytes/text for journal binding or integrity, never authorship.
 * @param {string | Uint8Array} value - Borrowed inert hash input.
 * @returns {string} Lowercase SHA-256 hex. */
const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
/** Construct fixed diagnostic errors without private payloads/paths.
 * @param {string} code - Internal fixed status code.
 * @returns {Error} Error carrying the supplied fixed code. */
const fail = (code: string) =>
  Object.assign(new Error(code.replaceAll('_', ' ').toLowerCase()), { code });
/** 192-bit lowercase hexadecimal coordinator reference syntax. */
const idPattern = /^[a-f0-9]{48}$/;
/** Lowercase SHA-256 digest syntax for journal/part validation. */
const digestPattern = /^[a-f0-9]{64}$/;
/** Validate a finite safe-integer resource bound before work.
 * @param {number} value - Configured or observed value.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {number} Accepted value; otherwise UPLOAD_LIMIT.
 */
function integer(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw fail('UPLOAD_LIMIT');
  }
  return value;
}
/** Hash the verified tenant/subject tuple without storing their raw values in the journal.
 * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
 * @returns {string} Stable private binding digest; hashing is not authentication or anonymization.
 */
function binding(identity: UploadIdentity) {
  if (
    !identity ||
    [identity.tenant, identity.subject].some(
      (v) =>
        typeof v !== 'string' ||
        !v ||
        v.length > 256 ||
        // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in verified identity labels.
        /[\x00-\x1f\x7f]/.test(v)
    )
  ) {
    throw fail('UPLOAD_IDENTITY');
  }
  return hash(JSON.stringify([identity.tenant, identity.subject]));
}
/** Create a private durable-journal coordinator with bounded actual pending work. No watcher, cleanup timer or server starts automatically.
 * @param {ResumableUploadOptions} options - Trusted host configuration, borrowed policy-aware manager and required fresh authorization.
 * @returns {ResumableUploads} Session owner; close before the borrowed manager, preserving unfinished sessions.
 */
export function createResumableUploads(
  options: ResumableUploadOptions
): ResumableUploads {
  if (
    !options ||
    typeof options.root !== 'string' ||
    !options.root ||
    options.root.includes('\0') ||
    typeof options.authorize !== 'function' ||
    typeof options.files?.validateWrite !== 'function'
  ) {
    throw new TypeError(
      'Resumable root, authorization and policy-aware file manager required'
    );
  }
  /** Private canonical journal root; host owns durable permissions and recovery. */
  const root = resolve(options.root);
  /** Borrowed policy-aware storage manager; coordinator close never closes it. */
  const files = options.files;
  /** Required trusted host callback, invoked after identity binding checks. */
  const authorize = options.authorize;
  /** Validated maximum session bytes, default 1 GiB. */
  const maxBytes = integer(
    options.maxBytes ?? 1024 * 1024 * 1024,
    1,
    Number.MAX_SAFE_INTEGER
  );
  /** Validated maximum per-part buffered bytes, default 8 MiB and ceiling 64 MiB. */
  const maxPartBytes = integer(
    options.maxPartBytes ?? 8 * 1024 * 1024,
    1,
    64 * 1024 * 1024
  );
  /** Validated per-session part cap, default/ceiling 1000. */
  const maxParts = integer(options.maxParts ?? 1000, 1, 1000);
  /** Validated retained-session cap, default 100 and ceiling 10000. */
  const maxSessions = integer(options.maxSessions ?? 100, 1, 10000);
  /** Validated actual pending-call cap, default 8 and ceiling 64. */
  const maxPending = integer(options.maxPending ?? 8, 1, 64);
  /** Validated session TTL, default one hour and ceiling seven days. */
  const ttlMs = integer(options.ttlMs ?? 3600000, 1, 7 * 86400000);
  /** Trusted clock, injectable for deterministic synthetic checks. */
  const now = options.now ?? Date.now;
  if (
    typeof now !== 'function' ||
    (options.approveCleanup !== undefined &&
      typeof options.approveCleanup !== 'function')
  ) {
    throw new TypeError('Invalid upload callbacks');
  }
  let closed = false;
  /** Actual admitted work promises; observation cancellation never releases capacity early. */
  const pending = new Set<Promise<unknown>>();
  /** Read the trusted clock within a range that leaves room for the configured TTL.
   * @returns {number} Epoch milliseconds suitable for expiry arithmetic.
   */
  function clock() {
    return integer(now(), 0, Number.MAX_SAFE_INTEGER - ttlMs);
  }
  /** Check private canonical non-symlink directories, optionally creating exactly this directory.
   * @param {string} path - Internal canonical private journal/session path, never caller-supplied arbitrary file access.
   * @param {boolean} create - Create with private mode when true; defaults false.
   * @returns {Promise<void>} Unsafe/noncanonical paths reject; host filesystem ownership is still required.
   */
  async function secure(path: string, create = false) {
    if (create) {
      await mkdir(path, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      });
    }
    /** No-follow physical shape/size observation before reading or trusting staging data. */
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(path)) !== path
    ) {
      throw fail('UPLOAD_UNSAFE_PATH');
    }
  }
  /** Claim an exclusive directory lease and release it after actual callback settlement. Existing leases are never broken automatically.
   * @param {string} path - Internal canonical private journal/session path, never caller-supplied arbitrary file access.
   * @param {Function} fn - Borrowed async operation executed at most once while the lease is held.
   * @returns {Promise<T>} Callback result or failure; lease contention rejects UPLOAD_BUSY.
   */
  async function lock<T>(path: string, fn: () => Promise<T>) {
    await secure(root, true);
    if (path !== root) {
      await secure(path);
    }
    /** Exclusive directory lease; existing ownership is never broken on a transient retry. */
    const lease = join(path, '.lock');
    try {
      await mkdir(lease, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw fail('UPLOAD_BUSY');
      }
      throw error;
    }
    try {
      return await fn();
    } finally {
      await rmdir(lease).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
  }
  /** Resolve only a syntactically valid opaque session ID beneath the journal root.
   * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
   * @returns {string} Internal fixed-root session path.
   */
  function location(id: string) {
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw fail('UPLOAD_ID');
    }
    return join(root, id);
  }
  /** Serialize a bounded journal into a private exclusive temporary file, fsync and rename.
   * @param {string} path - Internal canonical private journal/session path, never caller-supplied arbitrary file access.
   * @param {unknown} value - Trusted serializable record, capped at 1 MiB UTF-8.
   * @returns {Promise<void>} Journal promotion observation; temporary file/handle cleanup runs in finally.
   */
  async function atomic(path: string, value: unknown) {
    /** UTF-8-budgeted inert journal JSON, never executable source. */
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 1024 * 1024) {
      throw fail('UPLOAD_LIMIT');
    }
    /** Unique private temporary file path removed in finally. */
    const tmp = path + '.tmp-' + randomUUID();
    /** Operation-owned exclusive/no-follow file handle with local finally cleanup. */
    const handle = await open(tmp, 'wx', 0o600);
    try {
      await handle.writeFile(serialized);
      await handle.sync();
      await handle.close();
      await rename(tmp, path);
    } finally {
      await handle.close().catch(() => {});
      await unlink(tmp).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
  }
  /** Read bounded no-follow session metadata and validate version, binding, parts and destination before use.
   * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
   * @returns {Promise<Record>} Private validated journal; malformed/corrupt records reject without mutation.
   */
  async function load(id: string): Promise<Record> {
    /** Internal session/part path derived only from validated IDs/numbers. */
    const path = location(id);
    await secure(path);
    /** Operation-owned exclusive/no-follow file handle with local finally cleanup. */
    const handle = await open(
      join(path, 'session.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      /** No-follow physical shape/size observation before reading or trusting staging data. */
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) {
        throw fail('UPLOAD_CORRUPT');
      }
      /** Private validated journal state under lease; public callers receive projections/clones. */
      const record = JSON.parse(
        await handle.readFile({ encoding: 'utf8' })
      ) as Record;
      if (
        record.version !== 1 ||
        record.id !== id ||
        !digestPattern.test(record.binding) ||
        !digestPattern.test(record.sha256) ||
        !['initiating', 'open', 'finalizing', 'complete', 'aborted'].includes(
          record.status
        ) ||
        !Array.isArray(record.parts) ||
        record.parts.length > maxParts
      ) {
        throw fail('UPLOAD_CORRUPT');
      }
      integer(record.size, 1, maxBytes);
      integer(record.expiresAt, 0, Number.MAX_SAFE_INTEGER);
      validateAddress(record.address);
      validatePut({ ...record.options, expiresAt: undefined });
      /** Seen part numbers used to reject duplicate/corrupt journal receipts. */
      const numbers = new Set<number>();
      // Reject duplicate/corrupt receipts before any loaded journal state is used.
      for (const part of record.parts) {
        integer(part.number, 1, maxParts);
        integer(part.size, 1, maxPartBytes);
        if (
          numbers.has(part.number) ||
          !digestPattern.test(part.sha256) ||
          (part.etag !== undefined &&
            (typeof part.etag !== 'string' || part.etag.length > 1024))
        ) {
          throw fail('UPLOAD_CORRUPT');
        }
        numbers.add(part.number);
      }
      if (
        record.nativeId !== undefined &&
        (typeof record.nativeId !== 'string' ||
          !record.nativeId ||
          record.nativeId.length > 2048)
      ) {
        throw fail('UPLOAD_CORRUPT');
      }
      return record;
    } finally {
      await handle.close();
    }
  }
  /** Persist the current bounded session journal atomically.
   * @param {Record} record - Private validated state under lease.
   * @returns {Promise<void>} Journal promotion observation. */
  const save = (record: Record) =>
    atomic(join(location(record.id), 'session.json'), record);
  /** Project a detached public session without private binding, native IDs or storage location.
   * @param {Record} record - Private validated journal record under its session lease.
   * @returns {UploadSession} New outer session and cloned part receipts.
   */
  function view(record: Record): UploadSession {
    return {
      id: record.id,
      size: record.size,
      sha256: record.sha256,
      expiresAt: record.expiresAt,
      status: record.status,
      parts: record.parts.map((part) => ({ ...part })),
    };
  }
  /** Recheck the initiating identity binding and fresh host authorization.
   * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
   * @param {Record} record - Private validated journal record under its session lease.
   * @param {string} action - Explicit initiate/part/list/finalize/abort operation owned by this boundary.
   * @returns {Promise<void>} Literal true authorization is required; denial throws UPLOAD_FORBIDDEN.
   */
  async function permission(
    identity: UploadIdentity,
    record: Record,
    action: Parameters<ResumableUploadOptions['authorize']>[2]
  ) {
    if (
      binding(identity) !== record.binding ||
      (await authorize({ ...identity }, { ...record.address }, action)) !== true
    ) {
      throw fail('UPLOAD_FORBIDDEN');
    }
  }
  /** Acquire the session lease, load state and authorize before invoking a mutation/read callback.
   * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
   * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
   * @param {string} action - Host authorization operation.
   * @param {Function} fn - Borrowed callback receiving the validated private record.
   * @returns {Promise<T>} Authorized callback result; no retry or lease stealing.
   */
  async function authorized<T>(
    identity: UploadIdentity,
    id: string,
    action: Parameters<ResumableUploadOptions['authorize']>[2],
    fn: (record: Record) => Promise<T>
  ) {
    binding(identity);
    return lock(location(id), async () => {
      /** Private validated journal state under lease; public callers receive projections/clones. */
      const record = await load(id);
      await permission(identity, record, action);
      return fn(record);
    });
  }
  /** Require an unexpired open session before accepting more mutable work.
   * @param {Record} record - Private validated journal record under its session lease.
   * @returns {void} Expired/non-open states reject explicitly.
   */
  function live(record: Record) {
    if (record.expiresAt <= clock()) {
      throw fail('UPLOAD_EXPIRED');
    }
    if (record.status !== 'open') {
      throw fail('UPLOAD_STATE');
    }
  }
  /** Bound admitted work until actual settlement; close stops admission and drains this set.
   * @param {Function} fn - Borrowed async operation, scheduled once after admission.
   * @returns {Promise<T>} Actual work result; closed/full admission rejects without starting it.
   */
  function run<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) {
      return Promise.reject(fail('UPLOAD_CLOSED'));
    }
    if (pending.size >= maxPending) {
      return Promise.reject(fail('UPLOAD_BUSY'));
    }
    /** Actual admitted operation tracked until its native/source settlement. */
    const work = Promise.resolve().then(fn);
    pending.add(work);
    work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
    return work;
  }
  /** Scan the bounded private session root and reject unexpected capacity or symlink entries.
   * @returns {Promise<string[]>} Sorted valid session IDs; directory iteration closes through native for-await ownership.
   */
  async function ids() {
    await secure(root, true);
    /** Bounded recognized session IDs sorted before paging. */
    const entries: string[] = [];
    let count = 0;
    /** Owned native directory iterator released by for-await completion/return. */
    const directory = await opendir(root);
    // Bound and validate private directory entries; native iteration owns directory cleanup.
    for await (const entry of directory) {
      if (++count > maxSessions + 1) {
        throw fail('UPLOAD_SESSION_LIMIT');
      }
      if (idPattern.test(entry.name)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw fail('UPLOAD_UNSAFE_PATH');
        }
        entries.push(entry.name);
      }
    }
    return entries.sort();
  }
  /** Read staged parts in numeric order through exclusive no-follow file handles.
   * @param {Record} record - Private validated journal record under its session lease.
   * @param {AbortSignal | undefined} signal - Caller-owned cooperative cancellation; a dispatched completion may already have committed.
   * @returns {AsyncGenerator<Uint8Array>} Bounded blocks; each part handle closes on iterator exit/failure.
   */
  async function* bytes(record: Record, signal?: AbortSignal) {
    // Read staged parts in declared numeric order while owning one file handle at a time.
    for (const part of [...record.parts].sort((a, b) => a.number - b.number)) {
      await secure(location(record.id));
      /** Operation-owned exclusive/no-follow file handle with local finally cleanup. */
      const handle = await open(
        join(location(record.id), part.number + '.part'),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        /** No-follow physical shape/size observation before reading or trusting staging data. */
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== part.size) {
          throw fail('UPLOAD_INTEGRITY');
        }
        let offset = 0;
        // Read bounded blocks until the declared exact part length is consumed.
        while (offset < part.size) {
          if (signal?.aborted) {
            throw fail('UPLOAD_CANCELLED');
          }
          /** At most 64 KiB read block; full-object verification remains bounded in memory. */
          const buffer = Buffer.allocUnsafe(
            Math.min(65536, part.size - offset)
          );
          /** Actual staged read count; zero before expected completion is an integrity error. */
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            offset
          );
          if (!bytesRead) {
            throw fail('UPLOAD_INTEGRITY');
          }
          offset += bytesRead;
          yield buffer.subarray(0, bytesRead);
        }
      } finally {
        await handle.close();
      }
    }
  }
  /** Stream ordered bytes while checking aggregate length/SHA-256 at EOF before local driver commit.
   * @param {Record} record - Private validated journal record under its session lease.
   * @param {AbortSignal | undefined} signal - Caller-owned cooperative cancellation; a dispatched completion may already have committed.
   * @returns {AsyncGenerator<Uint8Array>} Borrowed staged blocks; mismatch rejects before successful source completion.
   */
  async function* verifiedBytes(record: Record, signal?: AbortSignal) {
    /** Incremental SHA-256 over actual observed part/full-object bytes. */
    const digest = createHash('sha256');
    let total = 0;
    // Hash/count every staged byte before accepting aggregate integrity.
    for await (const chunk of bytes(record, signal)) {
      total += chunk.byteLength;
      digest.update(chunk);
      yield chunk;
    }
    if (total !== record.size || digest.digest('hex') !== record.sha256) {
      throw fail('UPLOAD_INTEGRITY');
    }
  }
  /** Remove bounded known staging filenames, including unacknowledged temporary writes; never scan/delete provider buckets.
   * @param {Record} record - Private validated journal record under its session lease.
   * @returns {Promise<void>} Local staging cleanup only; unexpected directory expansion rejects.
   */
  async function removeParts(record: Record) {
    // Include unacknowledged files left between part rename and journal commit.
    /** Internal session/part path derived only from validated IDs/numbers. */
    const path = location(record.id);
    await secure(path);
    /** Owned native directory iterator released by for-await completion/return. */
    const directory = await opendir(path);
    let count = 0;
    // Bound and validate private directory entries; native iteration owns directory cleanup.
    for await (const entry of directory) {
      if (++count > maxParts + 8) {
        throw fail('UPLOAD_LIMIT');
      }
      if (
        /^(?:[0-9]{1,4}\.part(?:\.tmp-[a-f0-9-]{36})?|session\.json\.tmp-[a-f0-9-]{36})$/.test(
          entry.name
        )
      ) {
        await unlink(join(path, entry.name)).catch((error) => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        });
      }
    }
  }
  /** Abort only nonfinalizing sessions, awaiting native cleanup before journaling aborted state.
   * @param {Record} record - Private validated journal record under its session lease.
   * @returns {Promise<void>} Transient provider failure retains accepted state; uncertain finalizing outcomes stay fenced.
   */
  async function abortRecord(record: Record) {
    if (record.status === 'complete') {
      throw fail('UPLOAD_STATE');
    }
    if (record.status === 'finalizing') {
      throw fail('UPLOAD_UNCERTAIN');
    }
    if (record.nativeId) {
      /** Explicit provider multipart boundary; no capability or completion semantics are fabricated. */
      const native = files.getDriver(
        record.address.storage
      ).multipartOperations;
      if (!native) {
        throw fail('UNSUPPORTED_CAPABILITY');
      }
      await native.abort(record.address, record.nativeId);
    }
    record.status = 'aborted';
    await save(record);
    await removeParts(record);
  }
  return {
    /** Authorize and reserve a private session, persisting initiating state before native creation and open state afterward.
     * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
     * @param {FileAddress} address - Host-policy destination, canonicalized before authorization.
     * @param {PutFileOptions & object} input - Exact full size/hash plus validated write metadata; request signals cannot be persisted.
     * @returns {Promise<UploadSession>} Authorized public open session, not a committed binary object.
     */
    initiate(identity, address, input) {
      return run(async () => {
        /** Verified tenant/subject digest stored without raw identity values. */
        const bound = binding(identity);
        validateAddress(address);
        validatePut(input);
        integer(input.size, 1, maxBytes);
        if (!digestPattern.test(input.sha256)) {
          throw fail('UPLOAD_INTEGRITY');
        }
        if (input.signal !== undefined) {
          throw new TypeError('Initiation does not persist request signals');
        }
        /** Separate required whole-object integrity declaration from inert write metadata. */
        const { size, sha256, ...put } = input;
        if (
          Object.keys(put.metadata ?? {}).length > 30 ||
          Object.keys(put.metadata ?? {}).some((key) =>
            key.startsWith('zx-upload-')
          )
        ) {
          throw fail('UPLOAD_METADATA');
        }
        if (
          size > maxPartBytes * maxParts ||
          (put.maxBytes !== undefined && size > put.maxBytes)
        ) {
          throw fail('UPLOAD_LIMIT');
        }
        /** Canonical bounded write options with adapter-owned integrity markers. */
        const write: PutFileOptions = {
          ...put,
          maxBytes: size,
          metadata: { ...put.metadata, 'zx-upload-sha256': sha256 },
        };
        address = files.validateWrite!(address, write);
        if (
          (await authorize({ ...identity }, { ...address }, 'initiate')) !==
          true
        ) {
          throw fail('UPLOAD_FORBIDDEN');
        }
        /** Selected manager driver after write policy and fresh authorization. */
        const driver = files.getDriver(address.storage);
        if (!driver.multipartOperations && driver.kind !== 'local-s3-lite') {
          throw fail('UNSUPPORTED_CAPABILITY');
        }
        if (
          driver.multipartOperations &&
          put.ifNoneMatch !== false &&
          !driver.multipartOperations.createOnly
        ) {
          throw fail('UNSUPPORTED_CAPABILITY');
        }
        return lock(root, async () => {
          if ((await ids()).length >= maxSessions) {
            throw fail('UPLOAD_SESSION_LIMIT');
          }
          /** New 192-bit opaque session reference; possession is not authorization. */
          const id = randomBytes(24).toString('hex');
          /** Internal session/part path derived only from validated IDs/numbers. */
          const path = location(id);
          await mkdir(path, { mode: 0o700 });
          write.metadata!['zx-upload-id'] = id;
          /** Private validated journal state under lease; public callers receive projections/clones. */
          const record: Record = {
            version: 1,
            id,
            binding: bound,
            address: { ...address },
            options: write,
            size,
            sha256,
            expiresAt: clock() + ttlMs,
            status: 'initiating',
            parts: [],
          };
          await save(record);
          if (driver.multipartOperations) {
            record.nativeId = await driver.multipartOperations.initiate(
              record.address,
              write
            );
          }
          record.status = 'open';
          await save(record);
          return view(record);
        });
      });
    },
    /** Authorize and ingest one immutable size/hash-checked part; identical declared receipt retries return the existing receipt.
     * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
     * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
     * @param {number} number - 1-based bounded part number.
     * @param {FileSource} source - Borrowed binary input, bounded by declared size and chunk count.
     * @param {object} input - Exact part size, lowercase SHA-256 and optional cancellation signal.
     * @returns {Promise<UploadPart>} Accepted receipt after native confirmation/staging/journal save.
     */
    uploadPart(identity, id, number, source, input) {
      return run(() =>
        authorized(identity, id, 'part', async (record) => {
          live(record);
          files.validateWrite!(record.address, record.options);
          integer(number, 1, maxParts);
          integer(input.size, 1, maxPartBytes);
          if (!digestPattern.test(input.sha256)) {
            throw fail('UPLOAD_INTEGRITY');
          }
          /** Existing immutable receipt; identical size/hash retries do not replace accepted bytes. */
          const old = record.parts.find((p) => p.number === number);
          if (old) {
            if (old.size !== input.size || old.sha256 !== input.sha256) {
              throw fail('UPLOAD_PART_CONFLICT');
            }
            return { ...old };
          }
          if (
            record.parts.reduce((total, p) => total + p.size, 0) + input.size >
            record.size
          ) {
            throw fail('UPLOAD_LIMIT');
          }
          /** Exact declared-size part buffer, bounded before allocation. */
          const data = Buffer.alloc(input.size);
          let size = 0,
            count = 0;
          /** Incremental SHA-256 over actual observed part/full-object bytes. */
          const digest = createHash('sha256');
          // Bound each actual source chunk before writing it into the exact-size part buffer.
          for await (const chunk of chunks(source, input.signal)) {
            /** Destination position before retaining the next validated source chunk. */
            const offset = size;
            size += chunk.byteLength;
            if (size > input.size) {
              throw fail('UPLOAD_LENGTH');
            }
            if (++count > 65536) {
              throw fail('UPLOAD_LIMIT');
            }
            digest.update(chunk);
            data.set(chunk, offset);
          }
          if (size !== input.size) {
            throw fail('UPLOAD_LENGTH');
          }
          if (digest.digest('hex') !== input.sha256) {
            throw fail('UPLOAD_INTEGRITY');
          }
          live(record);
          if (input.signal?.aborted) {
            throw fail('UPLOAD_CANCELLED');
          }
          /** Internal session/part path derived only from validated IDs/numbers. */
          const path = join(location(id), number + '.part');
          /** Unique private temporary file path removed in finally. */
          const tmp = path + '.tmp-' + randomUUID();
          /** Operation-owned exclusive/no-follow file handle with local finally cleanup. */
          const handle = await open(tmp, 'wx', 0o600);
          try {
            await handle.writeFile(data);
            await handle.sync();
            await handle.close();
            /** Accepted immutable part receipt, journaled after byte/native confirmation. */
            const part: UploadPart = { number, size, sha256: input.sha256 };
            if (record.nativeId) {
              /** Explicit provider multipart boundary; no capability or completion semantics are fabricated. */
              const native = files.getDriver(
                record.address.storage
              ).multipartOperations;
              if (!native) {
                throw fail('UNSUPPORTED_CAPABILITY');
              }
              part.etag = await native.upload(
                record.address,
                record.nativeId,
                part,
                data,
                input.signal
              );
            }
            live(record);
            if (input.signal?.aborted) {
              throw fail('UPLOAD_CANCELLED');
            }
            await rename(tmp, path);
            record.parts.push(part);
            record.parts.sort((a, b) => a.number - b.number);
            await save(record);
            return { ...part };
          } finally {
            await handle.close().catch(() => {});
            await unlink(tmp).catch((error) => {
              if (error.code !== 'ENOENT') {
                throw error;
              }
            });
          }
        })
      );
    },
    /** Authorize and return a detached public session view without changing its lifecycle.
     * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
     * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
     * @returns {Promise<UploadSession>} Current session/part metadata; expiry is not silently rewritten.
     */
    listParts(identity, id) {
      return run(() =>
        authorized(identity, id, 'list', async (record) => view(record))
      );
    },
    /** Verify ordering, full bytes/hash and native receipts, then journal finalizing before commit. Uncertain retries reconcile observed metadata instead of blindly replaying completion.
     * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
     * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
     * @param {readonly number[]} partNumbers - Contiguous complete 1-based part sequence.
     * @param {AbortSignal | undefined} signal - Caller-owned cooperative cancellation; a dispatched completion may already have committed.
     * @returns {Promise<FileInfo>} Committed result clone; definite create-only conflicts reopen, unknown outcomes stay fenced.
     */
    finalize(identity, id, partNumbers, signal) {
      return run(() =>
        authorized(identity, id, 'finalize', async (record) => {
          if (
            !Array.isArray(partNumbers) ||
            !partNumbers.length ||
            partNumbers.length > maxParts ||
            partNumbers.length !== record.parts.length ||
            partNumbers.some(
              (number, i) =>
                number !== i + 1 ||
                !record.parts.some((p) => p.number === number)
            )
          ) {
            throw fail('UPLOAD_PART_ORDER');
          }
          if (record.status === 'complete') {
            if (!record.result) {
              throw fail('UPLOAD_CORRUPT');
            }
            return structuredClone(record.result);
          }
          files.validateWrite!(record.address, record.options);
          if (record.status === 'finalizing') {
            /** Observed committed metadata used to reconcile finalizing state without replaying a write. */
            const found = await files.stat(record.address);
            if (
              !found ||
              found.size !== record.size ||
              found.metadata['zx-upload-id'] !== id ||
              found.metadata['zx-upload-sha256'] !== record.sha256
            ) {
              throw fail('UPLOAD_UNCERTAIN');
            }
            record.result = found;
            record.status = 'complete';
            await save(record);
            await removeParts(record);
            return structuredClone(found);
          }
          live(record);
          if (signal?.aborted) {
            throw fail('UPLOAD_CANCELLED');
          }
          /** Incremental SHA-256 over actual observed part/full-object bytes. */
          const digest = createHash('sha256');
          let total = 0;
          // Hash/count every staged byte before accepting aggregate integrity.
          for await (const chunk of bytes(record, signal)) {
            total += chunk.byteLength;
            digest.update(chunk);
          }
          if (total !== record.size || digest.digest('hex') !== record.sha256) {
            throw fail('UPLOAD_INTEGRITY');
          }
          /** Explicit provider multipart boundary; no capability or completion semantics are fabricated. */
          const native = files.getDriver(
            record.address.storage
          ).multipartOperations;
          if (record.nativeId) {
            if (!native) {
              throw fail('UNSUPPORTED_CAPABILITY');
            }
            if (
              record.parts
                .slice(0, -1)
                .some((p) => p.size < native.minPartBytes)
            ) {
              throw fail('UPLOAD_PART_SIZE');
            }
            /** Bounded native receipt set compared against every journaled part before completion. */
            const actual = await native.list(
              record.address,
              record.nativeId,
              maxParts
            );
            if (
              actual.length !== record.parts.length ||
              record.parts.some(
                (p) =>
                  !actual.some(
                    (a) =>
                      a.number === p.number &&
                      a.size === p.size &&
                      a.etag === p.etag &&
                      a.sha256 === p.sha256
                  )
              )
            ) {
              throw fail('UPLOAD_INTEGRITY');
            }
          }
          live(record);
          if (signal?.aborted) {
            throw fail('UPLOAD_CANCELLED');
          }
          record.status = 'finalizing';
          await save(record);
          try {
            let result: FileInfo;
            if (record.nativeId) {
              await native!.complete(
                record.address,
                record.nativeId,
                record.parts,
                record.options.ifNoneMatch !== false,
                signal
              );
              /** Observed committed metadata used to reconcile finalizing state without replaying a write. */
              const found = await files.stat(record.address);
              if (
                !found ||
                found.size !== record.size ||
                found.metadata['zx-upload-id'] !== id ||
                found.metadata['zx-upload-sha256'] !== record.sha256
              ) {
                throw fail('UPLOAD_UNCERTAIN');
              }
              result = found;
            } else {
              result = await files.put(
                record.address,
                verifiedBytes(record, signal),
                { ...record.options, signal }
              );
            }
            record.result = result;
            record.status = 'complete';
            await save(record);
            await removeParts(record);
            files.invalidate(record.address);
            return structuredClone(result);
          } catch (error) {
            // Only a definite create-only conflict is retryable. Unknown commit outcomes stay fenced.
            if (
              ['FILE_EXISTS', 'EEXIST'].includes(
                (error as { code?: string }).code ?? ''
              )
            ) {
              record.status = 'open';
              await save(record);
              throw fail('FILE_EXISTS');
            }
            throw error;
          }
        })
      );
    },
    /** Authorize explicit abandonment under the session lease.
     * @param {UploadIdentity} identity - Trusted host-verified tenant/subject, rechecked on each invocation.
     * @param {string} id - Opaque 192-bit coordinator session reference, not an authorization credential.
     * @returns {Promise<void>} Aborted state after cleanup; finalizing uncertainty remains protected.
     */
    abort(identity, id) {
      return run(() => authorized(identity, id, 'abort', abortRecord));
    },
    /** Page expired nonfinalizing candidates without deletion or implicit approval.
     * @param {object} input - Optional session cursor and page size, default 50 and ceiling 100.
     * @returns {Promise<object>} Revision-bound candidates and optional continuation; private bodies never leave the journal.
     */
    previewCleanup(input = {}) {
      return run(async () => {
        /** Validated cleanup preview page size, default 50 and ceiling 100. */
        const limit = integer(input.limit ?? 50, 1, 100);
        if (input.cursor !== undefined && !idPattern.test(input.cursor)) {
          throw fail('UPLOAD_ID');
        }
        /** Bounded sorted IDs after the supplied validated cursor. */
        const all = (await ids()).filter(
          (id) => !input.cursor || id > input.cursor
        );
        /** Selected session IDs for this one cleanup preview page. */
        const page = all.slice(0, limit);
        /** Expired revision-bound preview candidates, with no deletion performed. */
        const items: UploadCleanupCandidate[] = [];
        // Inspect only this bounded preview page; do not delete candidates here.
        for (const id of page) {
          /** Private validated journal state under lease; public callers receive projections/clones. */
          const record = await load(id);
          if (record.expiresAt <= clock() && record.status !== 'finalizing') {
            items.push({
              id,
              expiresAt: record.expiresAt,
              status: record.status,
              revision: hash(JSON.stringify(record)),
            });
          }
        }
        return {
          items,
          ...(all.length > limit ? { nextCursor: page.at(-1) } : {}),
        };
      });
    },
    /** Require trusted batch approval and recheck revision, expiry and lease before bounded local removal.
     * @param {readonly UploadCleanupCandidate[]} candidates - At most 100 reviewed candidate records; stale/live candidates are not deleted.
     * @returns {Promise<number>} Removed session count; provider abort failure preserves resumable state.
     */
    cleanup(candidates) {
      return run(async () => {
        if (!Array.isArray(candidates) || candidates.length > 100) {
          throw fail('UPLOAD_LIMIT');
        }
        /** Frozen validated approval batch; host approval cannot silently mutate candidate evidence. */
        const snapshot = candidates.map((c) => {
          location(c.id);
          if (!digestPattern.test(c.revision)) {
            throw fail('UPLOAD_CORRUPT');
          }
          return Object.freeze({ ...c });
        });
        if (
          !options.approveCleanup ||
          (await options.approveCleanup(Object.freeze(snapshot))) !== true
        ) {
          throw fail('UPLOAD_FORBIDDEN');
        }
        let count = 0;
        // Reauthorize approved evidence under each session lease without breaking live work.
        for (const candidate of snapshot) {
          await lock(location(candidate.id), async () => {
            /** Private validated journal state under lease; public callers receive projections/clones. */
            const record = await load(candidate.id);
            if (
              record.expiresAt > clock() ||
              record.status === 'finalizing' ||
              hash(JSON.stringify(record)) !== candidate.revision
            ) {
              return;
            }
            if (record.status !== 'complete') {
              await abortRecord(record);
            }
            await secure(location(record.id));
            await rm(location(record.id), { recursive: true });
            count++;
          });
        }
        return count;
      });
    },
    /** Fence new calls and await actual pending settlement, retaining unfinished sessions and borrowed manager ownership.
     * @returns {Promise<void>} Drain completion; noncooperating sources are not forcibly terminated.
     */
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
    },
  };
}
