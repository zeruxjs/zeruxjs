import type {
  FileAddress,
  FileInfo,
  PutFileOptions,
  StorageManager,
} from './types.js';
import { chunks, validateAddress } from './validation.js';
export interface FileHttpOptions {
  /** Called before each access, including public files. Required to access private files. */
  authorize?: (
    request: Request,
    address: FileAddress,
    operation: 'read' | 'write' | 'delete',
    info?: FileInfo
  ) => boolean | Promise<boolean>;
  /** Explicit storage and bucket mapping; never accept arbitrary locations from a URL. */
  storage?: string;
  /** Required fixed bucket; untrusted request paths cannot choose another bucket. */
  bucket: string;
  /** Optional literal object-key prefix; host must arrange route mount stripping. */
  prefix?: string;
  /** Positive safe-integer request byte ceiling; defaults to 16 MiB. */
  maxUploadBytes?: number;
  /** Optional public response cache override; private objects always force private, no-store. */
  cacheControl?: string;
  /** Enable DELETE only with explicit authorization; defaults false. */
  allowDelete?: boolean;
}

/** Build an attachment disposition from a bounded inert filename, replacing unsafe separators/control characters.
 * @param {string} value - Untrusted display filename, not a local filesystem path.
 * @returns {string} ASCII-safe fallback and percent-encoded UTF-8 filename parameters.
 */
function filename(value: string) {
  /** Bounded download display name; does not create a filesystem path. */
  const safe =
    // eslint-disable-next-line no-control-regex -- Intentionally replace control characters in download filenames.
    value.replace(/[\x00-\x1f\x7f"\\/]/g, '_').slice(0, 180) || 'file';
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
/** Parse one byte range, including suffix ranges, and clamp its end to the known object size.
 * @param {string} header - Single Range header; multiple ranges are unsupported.
 * @param {number} size - Known logical byte length.
 * @returns {object | null} Inclusive start/end or null for malformed/unsatisfiable ranges.
 */
function rangeFrom(
  header: string,
  size: number
): { start: number; end: number } | null {
  /** Single-range syntax match; empty bounds and zero-size objects reject. */
  const found = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!found || (!found[1] && !found[2]) || size === 0) {
    return null;
  }
  /** Inclusive range/read start; suffix requests derive it from logical object size. */
  const start = found[1]
    ? Number(found[1])
    : Math.max(0, size - Number(found[2]));
  /** Inclusive end clamped by range validation or the known object size. */
  const end = (() => {
    if (found[1]) {
      return found[2] ? Number(found[2]) : size - 1;
    }
    return size - 1;
  })();
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}
/** Adapt an owned read iterator to backpressured Fetch streaming and forward body cancellation to iterator.return.
 * @param {AsyncIterable<Uint8Array>} iterator - Opened byte iterable; underlying driver owns resource release.
 * @returns {ReadableStream<Uint8Array>} Stream forwarding one iterator observation per pull.
 */
function iterableBody(
  iterator: AsyncIterable<Uint8Array>
): ReadableStream<Uint8Array> {
  /** Owned source iterator; response cancellation invokes its return hook. */
  const reader = iterator[Symbol.asyncIterator]();
  return new ReadableStream({
    /** Read one source chunk; close on done or surface a source failure.
     * @param {ReadableStreamDefaultController<Uint8Array>} c - Native stream controller borrowed for this pull.
     * @returns {Promise<void>} One pull observation; no source replay.
     */
    async pull(c) {
      try {
        /** One settled source read; no speculative buffering or automatic replay. */
        const next = await reader.next();
        if (next.done) {
          c.close();
        } else {
          c.enqueue(next.value);
        }
      } catch (err) {
        c.error(err);
      }
    },
    /** Release the underlying iterator when the Fetch consumer cancels.
     * @returns {Promise<void>} Completion of the native iterator return hook, when present.
     */
    async cancel() {
      await reader.return?.();
    },
  });
}
/** Authorize before conditional/range response creation. Private objects force no-store; public metadata is not tenant authentication.
 * @param {StorageManager} manager - Borrowed policy-aware manager; response/handler factories never close it.
 * @param {FileAddress} address - Host-selected storage/bucket/key; not an authorization credential.
 * @param {Request} request - Incoming Fetch request; host owns principal verification and CSRF/origin policy.
 * @param {object} options - Optional authorization, inline MIME policy, public cache override and download name.
 * @param {FileHttpOptions['authorize']} [options.authorize] - Borrowed host permission callback, including public-file reads.
 * @param {boolean} [options.inline] - Request inline only for the fixed MIME allowlist.
 * @param {string} [options.cacheControl] - Public cache override; private responses remain no-store.
 * @param {string} [options.downloadName] - Inert filename displayed in Content-Disposition.
 * @returns {Promise<Response>} GET/HEAD, conditional or range response; caller/consumer owns body consumption or cancellation.
 */
export async function createFileResponse(
  manager: StorageManager,
  address: FileAddress,
  request: Request,
  options: {
    authorize?: FileHttpOptions['authorize'];
    /** Request inline rendering only for the fixed safe MIME allowlist. */
    inline?: boolean;
    /** Optional public response cache override; private objects always force private, no-store. */
    cacheControl?: string;
    /** Optional inert display filename; unsafe separators/controls are replaced. */
    downloadName?: string;
  } = {}
): Promise<Response> {
  validateAddress(address);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  /** Provider metadata observed before authorization/response; not principal identity. */
  const info = await manager.stat(address);
  if (!info) {
    return new Response('Not found', { status: 404 });
  }
  if (info.visibility === 'private' && !options.authorize) {
    return new Response('Forbidden', { status: 403 });
  }
  if (
    options.authorize &&
    !(await options.authorize(request, address, 'read', info))
  ) {
    return new Response('Forbidden', { status: 403 });
  }
  /** Fixed MIME allowlist excluding executable HTML/SVG inline rendering. */
  const safeInline =
    /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[A-Za-z0-9.+-]+|video\/[A-Za-z0-9.+-]+|application\/pdf|text\/plain)$/.test(
      info.contentType.toLowerCase()
    );
  /** Chosen download policy after inline allowlisting and inert filename encoding. */
  const disposition = (() => {
    if (options.inline && safeInline) {
      return (
        'inline; ' +
        filename(options.downloadName ?? address.key.split('/').at(-1)!)
      );
    }
    if (info.contentDisposition?.toLowerCase().startsWith('attachment')) {
      return info.contentDisposition;
    }
    return filename(options.downloadName ?? address.key.split('/').at(-1)!);
  })();
  /** Per-response representation metadata; private records force no-store. */
  const headers = new Headers({
    'Content-Type': info.contentType,
    ETag: info.etag,
    'Last-Modified': new Date(info.modifiedAt).toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control':
      info.visibility === 'private'
        ? 'private, no-store'
        : (options.cacheControl ?? info.cacheControl ?? 'public, max-age=60'),
    'Content-Disposition': disposition,
    'Accept-Ranges': info.rangeSupported === false ? 'none' : 'bytes',
  });
  /** If-None-Match candidates checked before opening a binary stream. */
  const match = request.headers.get('if-none-match');
  if (
    match &&
    match
      .split(',')
      .some((item) => item.trim() === info.etag || item.trim() === '*')
  ) {
    return new Response(null, { status: 304, headers });
  }
  /** Optional date validator used only when If-None-Match was absent. */
  const modified = request.headers.get('if-modified-since');
  if (
    !match &&
    modified &&
    Number.isFinite(Date.parse(modified)) &&
    Date.parse(modified) >= new Date(info.modifiedAt).setMilliseconds(0)
  ) {
    return new Response(null, { status: 304, headers });
  }
  /** Requested single byte range, evaluated only when driver capabilities allow it. */
  const rangeHeader = request.headers.get('range');
  /** Optional representation guard; mismatches fall back to the whole object. */
  const ifRange = request.headers.get('if-range');
  /** Capability/validator decision; unsupported ranges never reach encrypted local reads. */
  const useRange =
    info.rangeSupported !== false &&
    rangeHeader &&
    (!ifRange ||
      ifRange === info.etag ||
      (Number.isFinite(Date.parse(ifRange)) &&
        Date.parse(ifRange) >= Date.parse(info.modifiedAt)));
  /** Validated inclusive range, undefined for full objects or null for rejection. */
  const range = useRange ? rangeFrom(rangeHeader, info.size) : undefined;
  if (useRange && !range) {
    headers.set('Content-Range', `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  /** Inclusive range/read start; suffix requests derive it from logical object size. */
  const start = range?.start ?? 0;
  /** Inclusive end clamped by range validation or the known object size. */
  const end = range?.end ?? Math.max(0, info.size - 1);
  /** 206 for a validated partial response, otherwise 200. */
  const status = range ? 206 : 200;
  headers.set('Content-Length', String(range ? end - start + 1 : info.size));
  if (range) {
    headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status, headers });
  }
  /** Opened provider byte source; response body owns iterator cancellation. */
  const iterable = await manager.read(
    address,
    range ? { start, end, signal: request.signal } : { signal: request.signal }
  );
  return new Response(iterableBody(iterable), { status, headers });
}
/** Stream a raw binary PUT/POST with length/size checks before create-only persistence. Direct use requires host authorization; the handler separately enforces a write callback.
 * @param {StorageManager} manager - Borrowed policy-aware manager; response/handler factories never close it.
 * @param {FileAddress} address - Host-selected storage/bucket/key; not an authorization credential.
 * @param {Request} request - Incoming Fetch request; host owns principal verification and CSRF/origin policy.
 * @param {PutFileOptions & object} options - Write options plus optional authorization callback; defaults to private driver policy and 16 MiB ceiling.
 * @returns {Promise<FileInfo>} Storage receipt after successful commit; failures/uncertain outcomes propagate without automatic deletion/retry.
 */
export async function uploadFileRequest(
  manager: StorageManager,
  address: FileAddress,
  request: Request,
  options: PutFileOptions & { authorize?: FileHttpOptions['authorize'] } = {}
): Promise<FileInfo> {
  if (!['PUT', 'POST'].includes(request.method) || !request.body) {
    throw new TypeError('PUT/POST body required');
  }
  if (
    options.authorize &&
    !(await options.authorize(request, address, 'write'))
  ) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  }
  // Require explicit authorization when this helper is used as a public HTTP endpoint.
  /** Content-Encoding guard; this endpoint never silently decompresses request bytes. */
  const encoded = request.headers.get('content-encoding');
  if (encoded && encoded !== 'identity') {
    throw new TypeError('Encoded upload unsupported');
  }
  /** Optional declared byte count, syntactically bounded before any write dispatch. */
  const length = request.headers.get('content-length');
  if (
    length &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
  ) {
    throw new RangeError('Invalid Content-Length');
  }
  if (options.ifNoneMatch === false) {
    throw new TypeError('HTTP upload helper requires create-only semantics');
  }
  /** Positive request byte ceiling, independent of connection-level storage limits. */
  const max = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('Invalid upload limit');
  }
  if (length && Number(length) > max) {
    throw new RangeError('File exceeds upload limit');
  }
  /** Explicit MIME option or normalized request declaration; not content sniffing. */
  const contentType =
    options.contentType ??
    request.headers.get('content-type')?.split(';')[0].trim() ??
    'application/octet-stream';
  // Validate the declared length *during* streaming, before a storage driver
  // commits an object. Deleting after a completed upload is unsafe: another
  // writer could have replaced that key in the meantime.
  /** Optional exact expected length checked during stream consumption. */
  const declared = length === null ? undefined : Number(length);
  /** Count actual request bytes before yielding and reject declared-length mismatches before driver commit.
   * @returns {AsyncGenerator<Uint8Array>} Validated borrowed request chunks; upstream stream cancellation remains cooperative.
   */
  async function* verifiedBody(): AsyncGenerator<Uint8Array> {
    let bytes = 0;
    // Enforce both the ceiling and declared length before yielding bytes to the storage commit path.
    for await (const part of chunks(request.body!, request.signal)) {
      bytes += part.byteLength;
      if (!Number.isSafeInteger(bytes) || bytes > max) {
        throw new RangeError('File exceeds upload limit');
      }
      if (declared !== undefined && bytes > declared) {
        throw new RangeError('Upload length mismatch');
      }
      yield part;
    }
    if (declared !== undefined && bytes !== declared) {
      throw new RangeError('Upload length mismatch');
    }
  }
  return manager.put(address, verifiedBody(), {
    ...options,
    contentType,
    maxBytes: max,
    signal: request.signal,
  });
}
/** Bind a fixed bucket/storage namespace to raw binary HTTP operations; authorize every enabled write/delete explicitly.
 * @param {StorageManager} manager - Borrowed policy-aware manager; response/handler factories never close it.
 * @param {FileHttpOptions} options - Trusted fixed location, authorization, upload ceiling, cache policy and explicit delete enablement.
 * @returns {Function} Async Fetch handler with structured status mapping; unknown provider errors propagate privately to the host.
 */
export function createFileHttpHandler(
  manager: StorageManager,
  options: FileHttpOptions
): (request: Request) => Promise<Response> {
  if (!options?.bucket) {
    throw new TypeError('Fixed bucket required');
  }
  /** Trusted fixed object prefix; this handler does not infer router mount paths. */
  const prefix = options.prefix ?? '';
  return async (request: Request) => {
    let key: string;
    try {
      key = decodeURIComponent(
        new URL(request.url).pathname.replace(/^\/+/, '')
      );
      if (prefix) {
        key = prefix + key;
      }
      validateAddress({
        storage: options.storage,
        bucket: options.bucket,
        key,
      });
    } catch {
      return new Response('Invalid object key', { status: 400 });
    }
    /** Fixed connection/bucket with validated decoded key, subject to per-operation authorization. */
    const address = { storage: options.storage, bucket: options.bucket, key };
    try {
      if (['GET', 'HEAD'].includes(request.method)) {
        return createFileResponse(manager, address, request, {
          authorize: options.authorize,
          cacheControl: options.cacheControl,
        });
      }
      if (['POST', 'PUT'].includes(request.method)) {
        // HTTP writes always require an auth callback; private-by-default.
        if (
          !options.authorize ||
          !(await options.authorize(request, address, 'write'))
        ) {
          return new Response('Forbidden', { status: 403 });
        }
        /** Provider metadata observed before authorization/response; not principal identity. */
        const info = await uploadFileRequest(manager, address, request, {
          maxBytes: options.maxUploadBytes,
          contentType:
            request.headers.get('content-type')?.split(';')[0].trim() ||
            'application/octet-stream',
        });
        return Response.json(info, {
          status: 201,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      if (request.method === 'DELETE' && options.allowDelete) {
        if (
          !options.authorize ||
          !(await options.authorize(request, address, 'delete'))
        ) {
          return new Response('Forbidden', { status: 403 });
        }
        await manager.delete(address);
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: 405,
        headers: {
          Allow: options.allowDelete
            ? 'GET, HEAD, POST, PUT, DELETE'
            : 'GET, HEAD, POST, PUT',
        },
      });
    } catch (err) {
      /** Provider error code used only for fixed HTTP error messages, without private causes. */
      const code = (err as { code?: string }).code;
      if (code === 'FILE_EXISTS') {
        return new Response('File exists', { status: 409 });
      }
      if (code === 'ENOENT') {
        return new Response('Not found', { status: 404 });
      }
      if (code === 'FILE_EXPIRED') {
        return new Response('File expired', { status: 410 });
      }
      if (code === 'FORBIDDEN') {
        return new Response('Forbidden', { status: 403 });
      }
      if (err instanceof RangeError) {
        return new Response('File too large or invalid range', { status: 413 });
      }
      if (err instanceof TypeError) {
        return new Response('Invalid file request', { status: 400 });
      }
      throw err;
    }
  };
}
