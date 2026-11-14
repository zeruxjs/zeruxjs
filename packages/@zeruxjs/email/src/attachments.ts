import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { EmailManagerOptions, MailAttachment } from './types.js';

export interface AttachmentScope {
  /** Prepared private Nodemailer metadata and owned lazy stream wrappers; do not expose publicly. */
  attachments: Record<string, unknown>[];
  /** Remove cancellation observation, destroy wrappers and wait for actual stream close.
   * @returns {Promise<void>} Idempotent cleanup barrier; noncooperative native iterators can delay settlement.
   */
  dispose(): Promise<void>;
}
/** Prepare bounded lazy attachment readers and own wrapper disposal; the injected files manager remains borrowed.
 * @param {readonly MailAttachment[]} attachments - Up to forty explicit attachment sources; default empty.
 * @param {Pick<
    EmailManagerOptions,
    'files' | 'maxAttachmentBytes' | 'maxAttachmentStreams'
  >} options - Borrowed files manager and raw-byte/stream ceilings; default only on the compatibility helper.
 * @param {boolean} allowLocalPaths - Explicit trusted server local-path opt-in; default false.
 * @param {AbortSignal} signal - Optional cooperative cancellation signal for reads and wrapper disposal.
 * @returns {Promise<AttachmentScope>} Prepared metadata/streams; caller must await dispose, including unconsumed streams.
 */
export async function resolveAttachmentScope(
  attachments: readonly MailAttachment[] = [],
  options: Pick<
    EmailManagerOptions,
    'files' | 'maxAttachmentBytes' | 'maxAttachmentStreams'
  >,
  allowLocalPaths = false,
  signal?: AbortSignal
): Promise<AttachmentScope> {
  /** Aggregate raw-byte budget, default 25 MiB; reserved before any stream is opened. */
  const max = options.maxAttachmentBytes ?? 25 * 1024 * 1024;
  /** Actual unsettled source-reader ceiling, default four; not a buffered-attachment count. */
  const concurrency = options.maxAttachmentStreams ?? 4;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 1024 * 1024 * 1024 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 40 ||
    !Array.isArray(attachments) ||
    attachments.length > 40
  ) {
    throw new RangeError('Invalid attachment limit');
  }
  /** Owned wrapper handles retained through their actual close events. */
  const streams = new Set<Readable>();
  /** Native wrapper-close barriers awaited by disposal; caller timeout does not release them early. */
  const settlements: Promise<void>[] = [];
  // Counters describe reserved bytes and actual unsettled readers, not caller observation.
  let sum = 0,
    active = 0,
    disposed = false,
    closing: Promise<void> | undefined;
  /** Reject cooperative work after scope disposal or caller cancellation.

 * @returns {void} Throws a fixed cancellation error; cannot interrupt arbitrary iterator code. */
  const check = () => {
    if (disposed || signal?.aborted) {
      throw Object.assign(new Error('Attachment operation cancelled'), {
        code: 'EMAIL_ATTACHMENT_CANCELLED',
      });
    }
  };
  /** Destroy every active wrapper on cancellation; settlement remains separately awaited.

 * @returns {void} Cancellation requested without promising immediate source termination. */
  const abort = () => {
    // Request cancellation on each wrapper; close events retain actual cleanup ownership.
    for (const stream of streams) {
      stream.destroy(
        Object.assign(new Error('Attachment cancelled'), {
          code: 'EMAIL_ATTACHMENT_CANCELLED',
        })
      );
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  /** Single cleanup owner for all prepared wrappers and abort observation. */
  const scope: AttachmentScope = {
    attachments: [],
    /** Remove cancellation observation, destroy wrappers and wait for actual stream close.
     * @returns {Promise<void>} Idempotent cleanup barrier; noncooperative native iterators can delay settlement.
     */
    dispose() {
      return (closing ??= (async () => {
        disposed = true;
        signal?.removeEventListener('abort', abort);
        // Destroy unconsumed wrappers as well, then await every registered close barrier.
        for (const stream of streams) {
          stream.destroy();
        }
        await Promise.allSettled(settlements);
      })());
    },
  };
  /** Reserve each declared raw byte length against the aggregate attachment budget.
   * @param {number} size - Safe nonnegative recorded source size.
   * @returns {void} Budget consumed before lazy source acquisition. */
  const reserve = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RangeError('Invalid attachment size');
    }
    sum += size;
    if (sum > max) {
      throw new RangeError('Attachments exceed aggregate limit');
    }
  };
  /** Wrap a lazily opened byte source while enforcing recorded length and concurrent-reader capacity.
   * @param {() => Promise<AsyncIterable<Uint8Array>> | AsyncIterable<Uint8Array>} open - Trusted lazy byte-source factory; not arbitrary remote dispatch.
   * @param {number} size - Validated recorded length; both overflow and underflow reject.
   * @returns {Readable} Owned Node stream whose close participates in this scope disposal.
   */
  function stream(
    open: () => Promise<AsyncIterable<Uint8Array>> | AsyncIterable<Uint8Array>,
    size: number
  ) {
    /** Read only while the scope is live and return the iterator before releasing its active slot.
     * @returns {AsyncGenerator<Uint8Array, void, unknown>} Exact recorded byte sequence; overflow/underflow/invalid chunks reject.
     */
    async function* bounded() {
      check();
      if (active >= concurrency) {
        throw Object.assign(new Error('Attachment stream limit'), {
          code: 'EMAIL_ATTACHMENT_LIMIT',
        });
      }
      active++;
      let iterator: AsyncIterator<Uint8Array> | undefined,
        consumed = 0;
      try {
        /** Lazily opened borrowed byte source; its iterator is explicitly returned during cleanup. */
        const iterable = await open();
        iterator = iterable[Symbol.asyncIterator]();
        check();
        // Enforce recorded length for every chunk without buffering the complete attachment.
        while (true) {
          /** One awaited source iteration result checked after cooperative cancellation. */
          const next = await iterator.next();
          check();
          if (next.done) {
            break;
          }
          if (!(next.value instanceof Uint8Array)) {
            throw new TypeError('Invalid attachment bytes');
          }
          consumed += next.value.byteLength;
          if (consumed > size) {
            throw new RangeError('Attachment exceeds recorded size');
          }
          yield next.value;
        }
        if (consumed !== size) {
          throw new RangeError('Attachment shorter than recorded size');
        }
      } finally {
        try {
          await iterator?.return?.();
        } finally {
          active--;
        }
      }
    }
    /** Owned Node wrapper around the bounded asynchronous iterator. */
    const readable = Readable.from(bounded(), { objectMode: false });
    streams.add(readable);
    readable.on('error', () => {});
    settlements.push(
      new Promise((resolve) =>
        readable.once('close', () => {
          streams.delete(readable);
          resolve();
        })
      )
    );
    return readable;
  }
  try {
    // Validate all source metadata and reserve bytes before opening any lazy reader.
    for (const a of attachments) {
      check();
      if (
        !a ||
        typeof a !== 'object' ||
        Object.keys(a).some(
          (k) =>
            ![
              'filename',
              'file',
              'path',
              'content',
              'cid',
              'contentType',
              'contentDisposition',
              'encoding',
            ].includes(k)
        ) ||
        Object.values(Object.getOwnPropertyDescriptors(a)).some(
          (d) => !('value' in d)
        ) ||
        typeof a.filename !== 'string' ||
        !a.filename ||
        a.filename.length > 255 ||
        /[\r\n\0/\\]/.test(a.filename)
      ) {
        throw new TypeError('Invalid attachment filename/options');
      }
      if (
        (a.cid !== undefined &&
          (typeof a.cid !== 'string' ||
            /[\r\n\0]/.test(a.cid) ||
            a.cid.length > 255)) ||
        (a.contentType !== undefined &&
          (typeof a.contentType !== 'string' ||
            /[\r\n\0]/.test(a.contentType) ||
            a.contentType.length > 200)) ||
        (a.contentDisposition !== undefined &&
          !['attachment', 'inline'].includes(a.contentDisposition))
      ) {
        throw new TypeError('Invalid attachment metadata');
      }
      if (
        [
          a.file !== undefined,
          a.path !== undefined,
          a.content !== undefined,
        ].filter(Boolean).length !== 1
      ) {
        throw new TypeError('Exactly one attachment source is required');
      }
      /** Allowlisted private attachment metadata; raw/href/executable options are never forwarded. */
      const result: Record<string, unknown> = {
        filename: a.filename,
        ...(a.cid ? { cid: a.cid } : {}),
        ...(a.contentType ? { contentType: a.contentType } : {}),
        ...(a.contentDisposition
          ? { contentDisposition: a.contentDisposition }
          : {}),
      };
      if (a.file) {
        if (!options.files) {
          throw new TypeError('File manager required for storage attachments');
        }
        /** Snapshotted files address; application/files authorization remains host-owned. */
        const address = { ...a.file };
        /** Recorded source size/type or local regular-file metadata used before lazy read. */
        const stat = await options.files.stat(address);
        check();
        if (!stat) {
          throw Object.assign(new Error('File attachment missing'), {
            code: 'ENOENT',
          });
        }
        if (
          typeof stat.contentType !== 'string' ||
          /[\r\n\0]/.test(stat.contentType) ||
          stat.contentType.length > 200
        ) {
          throw new TypeError('Invalid stored attachment type');
        }
        reserve(stat.size);
        result.content = stream(
          () => options.files!.read(address, { signal }),
          stat.size
        );
        if (!result.contentType) {
          result.contentType = stat.contentType;
        }
      } else if (a.path !== undefined) {
        if (!allowLocalPaths) {
          throw new TypeError(
            'Filesystem-path attachments are disabled; use @zeruxjs/files'
          );
        }
        if (
          typeof a.path !== 'string' ||
          !isAbsolute(a.path) ||
          /[\r\n\0]/.test(a.path)
        ) {
          throw new TypeError('Absolute local attachment path required');
        }
        /** Explicit trusted absolute file path; final symlinks reject but ancestry remains host-owned. */
        const path = a.path;
        /** Recorded source size/type or local regular-file metadata used before lazy read. */
        const stat = await lstat(path);
        check();
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new TypeError('Regular local attachment required');
        }
        reserve(stat.size);
        result.content = stream(
          () => createReadStream(path, { signal }),
          stat.size
        );
      } else {
        let bytes: Buffer;
        if (typeof a.content === 'string') {
          if (a.encoding !== undefined && !Buffer.isEncoding(a.encoding)) {
            throw new TypeError('Invalid attachment encoding');
          }
          bytes = Buffer.from(
            a.content,
            a.encoding as BufferEncoding | undefined
          );
        } else if (a.content instanceof Uint8Array) {
          bytes = Buffer.from(a.content);
        } else {
          throw new TypeError('Use @zeruxjs/files for streamed attachments');
        }
        reserve(bytes.byteLength);
        result.content = bytes;
      }
      scope.attachments.push(result);
    }
    return scope;
  } catch (error) {
    await scope.dispose();
    throw error;
  }
}
/** Compatibility attachment preparation; direct callers must destroy unconsumed returned streams.
 * @param {readonly MailAttachment[]} attachments - Up to forty explicit attachment sources; default empty.
 * @param {Pick<
    EmailManagerOptions,
    'files' | 'maxAttachmentBytes' | 'maxAttachmentStreams'
  >} options - Borrowed files manager and raw-byte/stream ceilings; default only on the compatibility helper.
 * @param {boolean} allowLocalPaths - Explicit trusted server local-path opt-in; default false.
 * @returns {Promise<Record<string, unknown>[]>} Prepared private transport attachments; use resolveAttachmentScope for explicit awaitable cleanup.
 */
export async function resolveAttachments(
  attachments: readonly MailAttachment[] = [],
  options: Pick<
    EmailManagerOptions,
    'files' | 'maxAttachmentBytes' | 'maxAttachmentStreams'
  > = {},
  allowLocalPaths = false
): Promise<Record<string, unknown>[]> {
  return (await resolveAttachmentScope(attachments, options, allowLocalPaths))
    .attachments;
}
