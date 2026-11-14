/** Browser-only ESM entry. No Node imports, globals, storage or network work on import. */
export interface TransferProgress {
  /** Observed consumed/written bytes; upload progress is not proof of server commit. */
  loaded: number;
  /** Optional declared/known complete byte count; actual bytes are independently counted. */
  total?: number;
}
export interface BrowserMediaOptions {
  /** Explicit HTTP(S) base mount without credentials/query/fragment. */
  baseUrl: string;
  /** Optional borrowed Fetch implementation; never closed by this client. */
  fetch?: typeof fetch;
  /** Exact allowed origins, maximum 32; default current browser origin only. */
  allowedOrigins?: readonly string[];
  /** Optional borrowed URL implementation; only created leases are revoked. */
  objectUrls?: {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
  };
  /** Process-local concurrent transfer ceiling, default 4 and maximum 64. */
  maxPending?: number;
}
export interface TransferOptions {
  /** Optional initiating request cancellation; does not imply session deletion. */
  signal?: AbortSignal;
  /** Optional byte-progress observer; its failure propagates through the transfer. */
  onProgress?: (progress: TransferProgress) => void;
}
/** Fixed public transfer failure without private URLs, bodies or provider causes. */
export class MediaTransferError extends Error {
  /** Expose a fixed transfer failure code and optional known/unknown commit state without response bodies or URLs.
   * @param {string} code - Fixed sanitized failure code.
   * @param {boolean | 'unknown'} committed - Known commit flag or unknown after an ambiguous completion.
   */
  constructor(
    readonly code: string,
    readonly committed?: boolean | 'unknown'
  ) {
    super(code.toLowerCase().replaceAll('_', ' '));
    this.name = 'MediaTransferError';
  }
}
/** Construct a fixed transfer error without private response content or destination URLs.
 * @param {string} code - Fixed public failure discriminator.
 * @returns {MediaTransferError} Redacted transfer failure.
 */
const fail = (code: string) => new MediaTransferError(code);
/** Restricted lowercase SHA-256 syntax for protocol integrity metadata. */
const hashPattern = /^[a-f0-9]{64}$/;
/** Restricted opaque server session ID syntax. */
const idPattern = /^[a-f0-9]{48}$/;
/** Validate a nonnegative safe-integer transfer budget.
 * @param {number} value - Requested counter/ceiling.
 * @param {number} max - Maximum permitted value, default Number.MAX_SAFE_INTEGER.
 * @returns {number} Validated value; invalid budgets reject before transfer work.
 */
function limit(value: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw fail('TRANSFER_LIMIT');
  }
  return value;
}
/** Hash explicit bounded bytes with native Web Crypto; no source content is executed.
 * @param {ArrayBuffer} bytes - Bounded owned buffer to hash.
 * @returns {Promise<string>} Lowercase SHA-256, or explicit unavailable error without Web Crypto.
 */
async function sha256(bytes: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) {
    throw fail('HASH_UNAVAILABLE');
  }
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (value) => value.toString(16).padStart(2, '0')
  ).join('');
}
interface Session {
  /** Fixed V1 server protocol discriminator. */
  protocol: 'zerux-media-resumable-v1';
  /** Opaque server-issued session identifier; never an authorization credential alone. */
  id: string;
  /** Validated server session state. */
  status: string;
  /** Declared complete byte length, checked against the selected Blob during resume. */
  size: number;
  /** Expected lowercase digest; complete integrity is server-verified on finalization. */
  sha256: string;
  /** Server-declared session expiry in epoch milliseconds. */
  expiresAt: number;
  /** Positive planned part size, maximum 64 MiB. */
  partBytes: number;
  /** At most 1000 unique accepted part receipts. */
  parts: {
    /** One-based part number, maximum 1000. */
    number: number;
    /** Declared complete byte length, checked against the selected Blob during resume. */
    size: number;
    /** Expected lowercase digest; complete integrity is server-verified on finalization. */
    sha256: string;
  }[];
}
/** Validate the bounded V1 server receipt and unique part metadata before planning any resumed bytes.
 * @param {unknown} value - Untrusted decoded server response.
 * @returns {Session} Validated protocol shape; this is not server authorization or a whole-file hash check.
 */
function session(value: unknown): Session {
  /** Untrusted server receipt subjected to shape, budget and duplicate-part checks. */
  const s = value as Session;
  if (
    !s ||
    s.protocol !== 'zerux-media-resumable-v1' ||
    !idPattern.test(s.id) ||
    !['open', 'initiating', 'finalizing', 'complete', 'aborted'].includes(
      s.status
    ) ||
    !hashPattern.test(s.sha256) ||
    !Array.isArray(s.parts) ||
    s.parts.length > 1000
  ) {
    throw fail('INVALID_PROTOCOL');
  }
  limit(s.size);
  limit(s.expiresAt);
  limit(s.partBytes, 64 * 1024 * 1024);
  if (!s.partBytes || !s.size) {
    throw fail('INVALID_PROTOCOL');
  }
  /** Receipt-local part-number set preventing duplicate planned parts. */
  const seen = new Set<number>();
  // Reject duplicate/invalid receipts before any resumed part is skipped.
  for (const part of s.parts) {
    limit(part.number, 1000);
    limit(part.size, s.partBytes);
    if (
      !part.number ||
      !part.size ||
      !hashPattern.test(part.sha256) ||
      seen.has(part.number)
    ) {
      throw fail('INVALID_PROTOCOL');
    }
    seen.add(part.number);
  }
  return s;
}
/** Own bounded browser Fetch operations and object-URL leases. Import is inert; close aborts observation/requests and awaits actual settlement, never abandons durable sessions implicitly.
 * @param {BrowserMediaOptions} options - Explicit base URL, exact origin policy and optional borrowed browser primitives.
 * @returns {object} Transfer/session APIs plus an awaited close; callers own returned response bodies.
 */
export function createMediaTransfers(options: BrowserMediaOptions) {
  if (!options || typeof options.baseUrl !== 'string') {
    throw fail('INVALID_DESTINATION');
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl, globalThis.location?.href);
  } catch {
    throw fail('INVALID_DESTINATION');
  }

  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
    /[\x00-\x20\x7f\\]/.test(options.baseUrl)
  ) {
    throw fail('INVALID_DESTINATION');
  }
  /** Exact configured destination origins, or the current browser origin only. */
  const origins =
    options.allowedOrigins ?? (globalThis.location ? [location.origin] : []);
  if (
    !Array.isArray(origins) ||
    origins.length > 32 ||
    origins.some((origin) => {
      try {
        return new URL(origin).origin !== origin;
      } catch {
        return true;
      }
    }) ||
    !origins.includes(base.origin)
  ) {
    throw fail('DESTINATION_DENIED');
  }
  base.pathname = base.pathname.replace(/\/?$/, '/');
  /** Borrowed Fetch primitive selected explicitly or from the browser global. */
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') {
    throw fail('FETCH_UNAVAILABLE');
  }
  /** Validated process-local admitted-transfer ceiling. */
  const maxPending = options.maxPending ?? 4;
  limit(maxPending, 64);
  if (!maxPending) {
    throw fail('TRANSFER_LIMIT');
  }
  let closed = false,
    closing: Promise<void> | undefined;
  /** Owned per-operation controllers retained until actual callback settlement. */
  const active = new Set<AbortController>();
  /** Outstanding object-URL leases created by this client, maximum 32. */
  const urls = new Set<string>();
  /** Actual operation settlement barriers used by close, independent of abort signals. */
  const settlements = new Map<AbortController, Promise<void>>();
  /** Borrowed native/injected URL primitive; only owned leases are revoked. */
  const objectUrls = options.objectUrls ?? globalThis.URL;

  /** Resolve a relative operation path inside the configured origin and mount without accepting credentials, fragments or traversal escapes.
   * @param {string} path - Relative path bounded to 2048 characters.
   * @returns {string} Allowed absolute URL; Fetch separately rejects redirects.
   */
  function destination(path: string) {
    if (
      typeof path !== 'string' ||
      path.length > 2048 ||
      path.startsWith('/') ||
      // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
      /[\x00-\x20\x7f\\]/.test(path)
    ) {
      throw fail('INVALID_DESTINATION');
    }
    let url: URL;
    try {
      url = new URL(path, base);
    } catch {
      throw fail('INVALID_DESTINATION');
    }
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw fail('DESTINATION_DENIED');
    }
    return url.href;
  }
  /** Reserve one local transfer slot through actual callback settlement and forward caller cancellation.
   * @param {AbortSignal | undefined} signal - Optional borrowed cancellation signal.
   * @param {function} fn - Single operation using the owned signal; no automatic retries.
   * @returns {Promise<T>} Operation result after releasing its exact admission slot.
   */
  async function owned<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>
  ) {
    if (closed) {
      throw fail('TRANSFER_CLOSED');
    }
    if (active.size >= maxPending) {
      throw fail('TRANSFER_BUSY');
    }
    /** Owned per-operation cancellation controller. */
    const controller = new AbortController();
    active.add(controller);
    let finish!: () => void;
    settlements.set(
      controller,
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    /** Forward caller cancellation without treating it as durable session deletion.
     * @returns {void} Signals only this request; actual settlement remains tracked.
     */
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
    try {
      if (controller.signal.aborted) {
        throw fail('TRANSFER_CANCELLED');
      }
      return await fn(controller.signal);
    } finally {
      signal?.removeEventListener('abort', abort);
      active.delete(controller);
      settlements.delete(controller);
      finish();
    }
  }
  /** Fetch only a validated destination with redirects rejected and same-origin credentials. Failure cancels the unread body.
   * @param {string} path - Relative path under the configured mount.
   * @param {RequestInit} init - Host-selected request options with operation cancellation.
   * @returns {Promise<Response>} Successful borrowed response whose body must be consumed/cancelled by its next owner.
   */
  async function fetchResponse(path: string, init: RequestInit) {
    /** Borrowed successful/protocol response; each consuming operation owns body cleanup. */
    const response = await fetcher(destination(path), {
      ...init,
      redirect: 'error',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw fail('HTTP_FAILED');
    }
    return response;
  }
  /** Read bounded protocol JSON with fatal UTF-8 decoding, chunk/byte limits and reader cleanup. Preserve only fixed failure codes and commit certainty.
   * @param {string} path - Relative protocol operation path.
   * @param {RequestInit} init - Fixed method/body/headers and owned cancellation signal.
   * @returns {Promise<any>} Decoded inert protocol data, independently validated by each caller.
   */
  async function json(path: string, init: RequestInit): Promise<any> {
    /** Borrowed successful/protocol response; each consuming operation owns body cleanup. */
    const response = await fetcher(destination(path), {
      ...init,
      redirect: 'error',
      credentials: 'same-origin',
    });
    /** Owned reader lock released in finally, including cancellation/error paths. */
    const reader = response.body?.getReader();
    if (!reader) {
      throw fail('INVALID_PROTOCOL');
    }
    let bytes = 0,
      count = 0;
    /** Bounded copied chunks retained only for explicit JSON/Blob assembly. */
    const parts: Uint8Array[] = [];
    /** Forward cancellation to active stream readers/writers; settlement is awaited separately.
     * @returns {void} Begins cooperative native cancellation without releasing capacity early.
     */
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    init.signal?.addEventListener('abort', cancel, { once: true });
    if (init.signal?.aborted) {
      cancel();
    }
    try {
      // Retain bounded read ownership until completion, failure or cancellation.
      while (true) {
        /** Observed native reader result; chunk type/length limits precede exposure. */
        const next = await reader.read();
        if (next.done) {
          break;
        }
        bytes += next.value.byteLength;
        if (bytes > 256 * 1024 || ++count > 4096) {
          throw fail('INVALID_PROTOCOL');
        }
        parts.push(next.value);
      }
      if (init.signal?.aborted) {
        throw fail('TRANSFER_CANCELLED');
      }
      /** Exact-sized buffer after bounded chunks are counted. */
      const data = new Uint8Array(bytes);
      let offset = 0;
      // Assemble only chunks already admitted by the JSON byte/chunk budget.
      for (const part of parts) {
        data.set(part, offset);
        offset += part.length;
      }
      /** Decoded inert JSON value, never executable source. */
      const value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(data)
      );
      if (!response.ok) {
        throw new MediaTransferError(
          typeof value?.code === 'string' && /^[A-Z_]{1,64}$/.test(value.code)
            ? value.code
            : 'HTTP_FAILED',
          (() => {
            if (value?.committed === true) {
              return true;
            }
            return value?.committed === 'unknown' ? 'unknown' : undefined;
          })()
        );
      }
      return value;
    } finally {
      init.signal?.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  /** Pipe counted byte chunks under sink backpressure and cancellation. Streaming can expose bytes before a late length failure and does not check a full SHA-256.
   * @param {string} path - Relative download path.
   * @param {WritableStream<Uint8Array>} sink - Borrowed sink; this operation owns/relinquishes its writer lock.
   * @param {TransferOptions & {maxBytes?: number}} input - Optional progress and actual-byte ceiling, default 1 GiB.
   * @param {AbortSignal} signal - Owned transfer cancellation signal.
   * @returns {Promise<TransferProgress>} Observed byte counts after sink close; errors abort the sink and release locks.
   */
  async function stream(
    path: string,
    sink: WritableStream<Uint8Array>,
    input: TransferOptions & {
      /** Explicit actual-byte ceiling; Blob downloads require a positive value at most 64 MiB. */
      maxBytes?: number;
    },
    signal: AbortSignal
  ) {
    /** Validated actual-byte ceiling; declaration headers cannot replace counted bytes. */
    const max = limit(input.maxBytes ?? 1024 * 1024 * 1024);
    /** Borrowed successful/protocol response; each consuming operation owns body cleanup. */
    const response = await fetchResponse(path, { signal });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
      writer: WritableStreamDefaultWriter<Uint8Array> | undefined,
      cancelled = false;
    /** Forward cancellation to active stream readers/writers; settlement is awaited separately.
     * @returns {void} Begins cooperative native cancellation without releasing capacity early.
     */
    const cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      void reader?.cancel().catch(() => {});
      void writer?.abort(fail('TRANSFER_CANCELLED')).catch(() => {});
    };
    try {
      /** Declared content encoding; encoded streams reject to preserve byte-count semantics. */
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') {
        throw fail('ENCODED_TRANSFER_UNSUPPORTED');
      }
      /** Optional declared Content-Length checked for safe integer syntax. */
      const raw = response.headers.get('content-length');
      if (
        raw !== null &&
        (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      ) {
        throw fail('TRANSFER_LENGTH');
      }
      /** Known declared byte count or deterministic planned part count. */
      const total = raw === null ? undefined : Number(raw);
      if (total !== undefined && total > max) {
        throw fail('TRANSFER_LIMIT');
      }
      if (!response.body) {
        throw fail('BODY_UNAVAILABLE');
      }
      reader = response.body.getReader();
      writer = sink.getWriter();
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
      }
      let loaded = 0,
        count = 0;
      // Retain bounded read ownership until completion, failure or cancellation.
      while (true) {
        if (signal.aborted) {
          throw fail('TRANSFER_CANCELLED');
        }
        /** Observed native reader result; chunk type/length limits precede exposure. */
        const next = await reader.read();
        if (next.done) {
          break;
        }
        if (!(next.value instanceof Uint8Array)) {
          throw fail('INVALID_BYTES');
        }
        loaded += next.value.byteLength;
        if (loaded > max || ++count > 65536) {
          throw fail('TRANSFER_LIMIT');
        }
        if (total !== undefined && loaded > total) {
          throw fail('TRANSFER_LENGTH');
        }
        await writer.write(next.value);
        input.onProgress?.({
          loaded,
          ...(total !== undefined ? { total } : {}),
        });
      }
      if (signal.aborted) {
        throw fail('TRANSFER_CANCELLED');
      }
      if (total !== undefined && loaded !== total) {
        throw fail('TRANSFER_LENGTH');
      }
      await writer.close();
      return { loaded, ...(total !== undefined ? { total } : {}) };
    } catch (error) {
      await writer?.abort(error).catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      } else {
        await response.body?.cancel().catch(() => {});
      }
      writer?.releaseLock();
    }
  }
  return {
    /** Stream into a caller-selected sink without buffering the complete file or promising pre-exposure digest verification.
     * @param {string} path - Relative authorized download path.
     * @param {WritableStream<Uint8Array>} sink - Borrowed writable destination.
     * @param {TransferOptions & {maxBytes?: number}} input - Optional progress/cancellation/byte limit, default 1 GiB.
     * @returns {Promise<TransferProgress>} Completed observed counts; partial sink bytes may exist on failure.
     */
    downloadTo(
      path: string,
      sink: WritableStream<Uint8Array>,
      input: TransferOptions & {
        /** Explicit actual-byte ceiling; Blob downloads require a positive value at most 64 MiB. */
        maxBytes?: number;
      } = {}
    ) {
      return owned(input.signal, (signal) => stream(path, sink, input, signal));
    },
    /** Explicitly buffer a small download and optionally verify its expected SHA-256 before exposing the Blob.
     * @param {string} path - Relative authorized download path.
     * @param {TransferOptions & {maxBytes: number; sha256?: string}} input - Required positive ceiling at most 64 MiB, optional trusted expected digest.
     * @returns {Promise<Blob>} Complete bounded Blob after optional integrity verification; no object URL is created automatically.
     */
    downloadBlob(
      path: string,
      input: TransferOptions & {
        /** Explicit actual-byte ceiling; Blob downloads require a positive value at most 64 MiB. */
        maxBytes: number;
        /** Expected lowercase digest; complete integrity is server-verified on finalization. */
        sha256?: string;
      }
    ) {
      return owned(input?.signal, async (signal) => {
        if (
          !input ||
          !Number.isSafeInteger(input.maxBytes) ||
          input.maxBytes < 1 ||
          input.maxBytes > 64 * 1024 * 1024 ||
          (input.sha256 !== undefined && !hashPattern.test(input.sha256))
        ) {
          throw fail('TRANSFER_LIMIT');
        }
        /** Bounded copied chunks retained only for explicit JSON/Blob assembly. */
        const parts: Uint8Array<ArrayBuffer>[] = [];
        await stream(
          path,
          new WritableStream({
            /** Copy one already counted download chunk into the bounded Blob assembly.
             * @param {Uint8Array} chunk - Borrowed stream chunk copied before retaining.
             * @returns {void} Retains only a copied bounded chunk.
             */
            write(chunk) {
              parts.push(new Uint8Array(chunk));
            },
          }),
          input,
          signal
        );
        /** Complete bounded Blob, returned only after an optional expected hash check. */
        const blob = new Blob(parts);
        if (
          input.sha256 !== undefined &&
          (await sha256(await blob.arrayBuffer())) !== input.sha256
        ) {
          throw fail('TRANSFER_INTEGRITY');
        }
        if (signal.aborted) {
          throw fail('TRANSFER_CANCELLED');
        }
        return blob;
      });
    },
    /** Create one of at most 32 owned object-URL leases; revoke explicitly when the UI no longer needs it.
     * @param {Blob} blob - Explicit bounded Blob; this method does not validate its MIME for rendering.
     * @returns {object} URL and idempotent revoke; close revokes outstanding leases.
     */
    objectUrl(blob: Blob) {
      if (closed) {
        throw fail('TRANSFER_CLOSED');
      }
      if (
        !(blob instanceof Blob) ||
        urls.size >= 32 ||
        typeof objectUrls?.createObjectURL !== 'function' ||
        typeof objectUrls.revokeObjectURL !== 'function'
      ) {
        throw fail('OBJECT_URL_UNAVAILABLE');
      }
      /** Owned native object URL recorded for explicit revocation or close. */
      const url = objectUrls.createObjectURL(blob);
      urls.add(url);
      let revoked = false;
      return {
        url,
        /** Revoke only this owned object-URL lease once.
         * @returns {void} Removes the native lease if still owned; repeated calls do nothing.
         */
        revoke() {
          if (revoked) {
            return;
          }
          revoked = true;
          if (urls.delete(url)) {
            objectUrls.revokeObjectURL(url);
          }
        },
      };
    },
    /** Trigger a native attachment through an ephemeral anchor. Native browser transfer is not tracked or cancellable by this client.
     * @param {string} path - Relative authorized attachment path.
     * @param {string} name - Bounded inert display name, without path separators/control characters.
     * @param {Document} document - Borrowed DOM document, default global document; absent DOM rejects.
     * @returns {void} Removes the temporary anchor even if activation fails.
     */
    downloadAttachment(
      path: string,
      name: string,
      document: Document = globalThis.document
    ) {
      if (closed) {
        throw fail('TRANSFER_CLOSED');
      }
      if (
        !document?.createElement ||
        typeof name !== 'string' ||
        !name ||
        name.length > 180 ||
        // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
        /[\\/\x00-\x1f\x7f]/.test(name)
      ) {
        throw fail('ATTACHMENT_UNAVAILABLE');
      }
      /** Temporary native attachment anchor removed in finally. */
      const anchor = document.createElement('a');
      anchor.href = destination(path);
      anchor.download = name;
      anchor.rel = 'noopener';
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    },
    /** Stream exact-size explicit bytes after checking native Fetch duplex support. Progress measures source consumption, not durable server commit.
     * @param {string} path - Relative authorized upload path.
     * @param {Blob | ReadableStream<Uint8Array>} source - Borrowed Blob or byte stream; operation owns its reader lock.
     * @param {TransferOptions & {size: number; contentType: string; method?: string}} input - Required exact length/MIME and optional POST/PUT, progress and signal.
     * @returns {Promise<Response>} Successful response whose body is caller-owned; ambiguous side effects are never auto-retried.
     */
    upload(
      path: string,
      source: Blob | ReadableStream<Uint8Array>,
      input: TransferOptions & {
        /** Declared complete byte length, checked against the selected Blob during resume. */
        size: number;
        /** Declared MIME checked by host server policy; never code execution permission. */
        contentType: string;
        /** Optional POST/PUT upload method, default PUT. */
        method?: 'POST' | 'PUT';
      }
    ) {
      return owned(input?.signal, async (signal) => {
        if (
          !input ||
          !Number.isSafeInteger(input.size) ||
          input.size < 0 ||
          !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(input.contentType) ||
          (input.method !== undefined &&
            !['POST', 'PUT'].includes(input.method))
        ) {
          throw fail('INVALID_UPLOAD');
        }
        let duplexAccessed = false;
        try {
          /** Inert native request used only to detect streaming duplex support. */
          const probe = new Request(destination(path), {
            method: 'POST',
            body: new ReadableStream(),
            get duplex() {
              duplexAccessed = true;
              return 'half';
            },
          } as RequestInit);
          if (!duplexAccessed || probe.headers.has('content-type')) {
            throw fail('STREAM_UPLOAD_UNAVAILABLE');
          }
        } catch {
          throw fail('STREAM_UPLOAD_UNAVAILABLE');
        }
        /** Owned reader lock released in finally, including cancellation/error paths. */
        const reader = (
          source instanceof Blob ? source.stream() : source
        ).getReader();
        let loaded = 0,
          count = 0;
        /** Forward cancellation to active stream readers/writers; settlement is awaited separately.
         * @returns {void} Begins cooperative native cancellation without releasing capacity early.
         */
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener('abort', cancel, { once: true });
        /** Owned outgoing byte stream enforcing exact size and bounded chunks. */
        const body = new ReadableStream<Uint8Array>({
          /** Pull/count one upload chunk, rejecting length/type/chunk violations before enqueueing it.
           * @param {ReadableStreamDefaultController<Uint8Array>} controller - Owned outgoing request-body controller.
           * @returns {Promise<void>} Enqueues bytes or errors the stream; no server persistence guarantee.
           */
          async pull(controller) {
            try {
              if (signal.aborted) {
                throw fail('TRANSFER_CANCELLED');
              }
              /** Observed native reader result; chunk type/length limits precede exposure. */
              const next = await reader.read();
              if (next.done) {
                if (loaded !== input.size) {
                  throw fail('TRANSFER_LENGTH');
                }
                controller.close();
                return;
              }
              if (!(next.value instanceof Uint8Array)) {
                throw fail('INVALID_BYTES');
              }
              loaded += next.value.byteLength;
              if (loaded > input.size || ++count > 65536) {
                throw fail('TRANSFER_LENGTH');
              }
              input.onProgress?.({ loaded, total: input.size });
              controller.enqueue(next.value);
            } catch (error) {
              controller.error(error);
            }
          },
          /** Cancel the outgoing source reader when Fetch abandons this upload stream.
           * @returns {Promise<void>} Settles native reader cancellation; surrounding finally releases the lock.
           */
          async cancel() {
            await reader.cancel();
          },
        });
        try {
          /** Borrowed successful/protocol response; each consuming operation owns body cleanup. */
          const response = await fetchResponse(path, {
            method: input.method ?? 'PUT',
            headers: { 'Content-Type': input.contentType },
            body,
            signal,
            duplex: 'half',
          } as RequestInit);
          if (loaded !== input.size) {
            throw fail('TRANSFER_LENGTH');
          }
          return response;
        } finally {
          signal.removeEventListener('abort', cancel);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      });
    },
    /** Read a tenant-bound persistent session through the explicit server protocol; browser request cancellation does not erase it.
     * @param {string} path - Relative protocol mount.
     * @param {string} id - Opaque server-issued session ID.
     * @param {AbortSignal} signal - Optional request cancellation.
     * @returns {Promise<Session>} Validated server receipt; host authorization remains enforced on the server.
     */
    getSession(path: string, id: string, signal?: AbortSignal) {
      return owned(signal, async (signal) => {
        if (!idPattern.test(id)) {
          throw fail('INVALID_PROTOCOL');
        }
        return session(await json(path + '/' + id, { signal }));
      });
    },
    /** Request a durable server-owned session with declared complete integrity facts; no bytes are uploaded yet.
     * @param {string} path - Relative protocol mount.
     * @param {object} input - Explicit display name, complete size, expected digest and MIME.
     * @param {string} input.name - Inert display name validated on the server.
     * @param {number} input.size - Exact complete byte length.
     * @param {string} input.sha256 - Expected complete SHA-256.
     * @param {string} input.contentType - Declared MIME under server policy.
     * @param {AbortSignal} signal - Optional request cancellation; uncertain initiation is not automatically replayed.
     * @returns {Promise<Session>} Validated accepted session, separate from a browser AbortController.
     */
    initiateSession(
      path: string,
      input: {
        /** Inert display name validated by the server; not a storage path. */
        name: string;
        /** Declared complete byte length, checked against the selected Blob during resume. */
        size: number;
        /** Expected lowercase digest; complete integrity is server-verified on finalization. */
        sha256: string;
        /** Declared MIME checked by host server policy; never code execution permission. */
        contentType: string;
      },
      signal?: AbortSignal
    ) {
      return owned(signal, async (signal) =>
        session(
          await json(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal,
          })
        )
      );
    },
    /** Hash each bounded Blob slice, verify existing receipts and upload missing parts in order. Never finalize/reinsert automatically.
     * @param {string} path - Relative protocol mount.
     * @param {string} id - Opaque server session reference.
     * @param {Blob} file - Borrowed complete Blob matching the declared size.
     * @param {TransferOptions & {sha256: string}} input - Expected complete digest, progress callback and optional request signal.
     * @returns {Promise<object>} Ordered part references for a separate explicit finalization; server verifies the complete hash.
     */
    uploadSession(
      path: string,
      id: string,
      file: Blob,
      input: TransferOptions & {
        /** Expected lowercase digest; complete integrity is server-verified on finalization. */
        sha256: string;
      }
    ) {
      return owned(input?.signal, async (signal) => {
        if (
          !idPattern.test(id) ||
          !(file instanceof Blob) ||
          !hashPattern.test(input.sha256)
        ) {
          throw fail('INVALID_PROTOCOL');
        }
        /** Validated live server session matched to the selected complete Blob. */
        const current = session(await json(path + '/' + id, { signal }));
        if (
          current.status !== 'open' ||
          current.size !== file.size ||
          current.sha256 !== input.sha256 ||
          current.expiresAt <= Date.now()
        ) {
          throw fail('SESSION_MISMATCH');
        }
        /** Known declared byte count or deterministic planned part count. */
        const total = Math.ceil(file.size / current.partBytes);
        if (total > 1000) {
          throw fail('TRANSFER_LIMIT');
        }
        let loaded = 0;
        // Hash deterministic slices; saved receipts never authorize skipping mismatched bytes.
        for (let number = 1; number <= total; number++) {
          if (signal.aborted) {
            throw fail('TRANSFER_CANCELLED');
          }
          /** Bounded Blob slice for one deterministic one-based part. */
          const part = file.slice(
            (number - 1) * current.partBytes,
            number * current.partBytes
          );
          /** Actual slice SHA-256 checked against saved receipts before skipping any bytes. */
          const hash = await sha256(await part.arrayBuffer());
          /** Already accepted part receipt; size/hash must match this exact slice. */
          const existing = current.parts.find((p) => p.number === number);
          if (existing) {
            if (existing.size !== part.size || existing.sha256 !== hash) {
              throw fail('SESSION_MISMATCH');
            }
          } else {
            /** Server-accepted part facts, rechecked before advancing progress. */
            const receipt = await json(path + '/' + id + '/parts/' + number, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Media-Part-Size': String(part.size),
                'X-Media-Part-SHA256': hash,
              },
              body: part,
              signal,
            });
            if (
              receipt.number !== number ||
              receipt.size !== part.size ||
              receipt.sha256 !== hash
            ) {
              throw fail('INVALID_PROTOCOL');
            }
          }
          loaded += part.size;
          input.onProgress?.({ loaded, total: file.size });
        }
        return { id, parts: Array.from({ length: total }, (_, i) => i + 1) };
      });
    },
    /** Explicitly request completion with ordered parts and preserve unknown commit outcomes rather than replaying mutations.
     * @param {string} path - Relative protocol mount.
     * @param {string} id - Opaque server session reference.
     * @param {readonly number[]} parts - Nonempty contiguous one-based part sequence, maximum 1000.
     * @param {AbortSignal} signal - Optional request cancellation; loss after commit may remain uncertain.
     * @returns {Promise<any>} Validated completion receipt; invalid/ambiguous response marks commit unknown.
     */
    finalizeSession(
      path: string,
      id: string,
      parts: readonly number[],
      signal?: AbortSignal
    ) {
      return owned(signal, async (signal) => {
        if (
          !idPattern.test(id) ||
          !Array.isArray(parts) ||
          !parts.length ||
          parts.length > 1000 ||
          parts.some((v, i) => v !== i + 1)
        ) {
          throw fail('INVALID_PROTOCOL');
        }
        /** Decoded inert JSON value, never executable source. */
        const value = await json(path + '/' + id + '/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parts }),
          signal,
        });
        if (
          !value ||
          value.protocol !== 'zerux-media-resumable-v1' ||
          value.id !== id ||
          value.status !== 'complete' ||
          !hashPattern.test(value.sha256) ||
          !Number.isSafeInteger(value.size) ||
          value.size < 1
        ) {
          throw new MediaTransferError('INVALID_PROTOCOL', 'unknown');
        }
        return value;
      });
    },
    /** Explicitly abandon a durable server session through DELETE, separately from aborting one Fetch request.
     * @param {string} path - Relative protocol mount.
     * @param {string} id - Opaque server session reference.
     * @param {AbortSignal} signal - Optional request cancellation.
     * @returns {Promise<any>} Server protocol outcome; no implicit retry or crash-recovery guarantee.
     */
    abortSession(path: string, id: string, signal?: AbortSignal) {
      return owned(signal, async (signal) => {
        if (!idPattern.test(id)) {
          throw fail('INVALID_PROTOCOL');
        }
        return json(path + '/' + id, { method: 'DELETE', signal });
      });
    },
    /** Stop admission, abort active requests, revoke owned URLs and await actual callback settlement. Does not close borrowed Fetch pools or delete durable sessions.
     * @returns {Promise<void>} Shared drain promise; uncooperative borrowed transports can delay settlement.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      // Signal each active request before awaiting all retained settlement barriers.
      for (const controller of active) {
        controller.abort();
      }
      // Revoke only URLs created by this client, leaving borrowed browser state untouched.
      for (const url of urls) {
        objectUrls.revokeObjectURL(url);
      }
      urls.clear();
      return (closing = Promise.allSettled([...settlements.values()]).then(
        () => {}
      ));
    },
  };
}
