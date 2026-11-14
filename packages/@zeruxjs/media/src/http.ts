import type { MediaStore } from './store.js';
import type { StoredMedia } from './types.js';

export interface MediaResponseOptions {
  /** The caller must authorize access before calling this function. */
  request?: Request;
  /** Optional inert display-name override; does not choose a local path. */
  downloadName?: string;
  /** Explicit inline request limited to the fixed MIME allowlist; default attachment. */
  inline?: boolean;
  /** Deliberate host override; otherwise private, no-store. This helper does not classify principals. */
  cacheControl?: string;
}

/** Replace unsafe display-name separators/controls and encode fixed Content-Disposition parameters.
 * @param {string} name - Untrusted display filename, not a local filesystem path.
 * @returns {string} Bounded safe fallback plus UTF-8 encoded display parameter.
 */
function quotedFilename(name: string): string {
  /** Bounded display name with separators/controls replaced, never a file path. */
  const normalized =
    // eslint-disable-next-line no-control-regex -- Intentionally reject or replace control characters in validated media input.
    name.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 255) || 'download';
  return `"${normalized.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}

/** Parse one standard/suffix byte range and clamp its end to observed logical size.
 * @param {string} value - Single Range header; multipart ranges reject.
 * @param {number} size - Known object byte length from metadata.
 * @returns {object | null} Inclusive start/end or null for invalid/unsatisfiable input.
 */
function parseRange(
  value: string,
  size: number
): { start: number; end: number } | null {
  // Only single RFC 9110 byte ranges are supported. Reject rather than incorrectly combining ranges.
  /** Single byte-range syntax match, without executing arbitrary query regexes. */
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) {
    return null;
  }
  /** Inclusive response range start; suffix requests derive it from logical size. */
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  /** Inclusive response end clamped to known metadata length. */
  let end: number;
  if (match[1]) {
    end = match[2] ? Number(match[2]) : size - 1;
  } else {
    end = size - 1;
  }
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

/** Match exact comma-separated validators or wildcard under the compatible response contract.
 * @param {string} header - Incoming If-None-Match value.
 * @param {string} etag - Quoted metadata SHA-256 representation validator.
 * @returns {boolean} Whether an exact candidate/wildcard matches; no body hash is recomputed here.
 */
function matchesEtag(header: string, etag: string): boolean {
  return header
    .split(',')
    .some((part) => part.trim() === etag || part.trim() === '*');
}

/** Create an attachment/allowlisted-inline GET/HEAD response over a borrowed private store. The host authorizes before calling; streaming verifies size rather than a full pre-exposure digest.
 * @param {MediaStore} store - Borrowed disk store; opened read iterators own their per-operation handles.
 * @param {string} id - Validated opaque stored ID, never sufficient authorization.
 * @param {MediaResponseOptions} options - Optional request, display policy and deliberate cache override.
 * @returns {Promise<Response>} Conditional/range/full response; caller consumes/cancels its body. HEAD/304 do not open binary content.
 */
export async function createMediaResponse(
  store: MediaStore,
  id: string,
  options: MediaResponseOptions = {}
): Promise<Response> {
  /** Borrowed optional method/validator source, not a verified identity. */
  const { request } = options;
  /** Normalized GET default or explicit request method. */
  const method = request?.method.toUpperCase() ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  /** Private stored metadata used for headers; body SHA-256 is not recomputed during streaming. */
  const meta: StoredMedia = await store.info(id);
  /** Quoted stored SHA-256 validator; full verification before exposure requires download(). */
  const etag = `"${meta.sha256}"`;
  /** Fixed MIME allowlist; does not scan content or relax host authorization/CSP. */
  const safeInline =
    /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[A-Za-z0-9.+-]+|video\/[A-Za-z0-9.+-]+|application\/pdf|text\/plain)$/.test(
      meta.contentType.toLowerCase()
    );
  /** Fresh response metadata with explicit private default and host cache override. */
  const headers = new Headers({
    'Content-Type': meta.contentType,
    'Content-Disposition': `${options.inline && safeInline ? 'inline' : 'attachment'}; filename=${quotedFilename(options.downloadName ?? meta.originalName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': options.cacheControl ?? 'private, no-store',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': new Date(meta.createdAt).toUTCString(),
  });
  /** Borrowed conditional/range headers, not arbitrary response-header forwarding. */
  const reqHeaders = request?.headers;
  if (
    reqHeaders?.has('if-none-match') &&
    matchesEtag(reqHeaders.get('if-none-match')!, etag)
  ) {
    return new Response(null, { status: 304, headers });
  }
  /** Optional incoming single-range declaration. */
  const requestedRange = reqHeaders?.get('range');
  /** Optional exact/date guard; mismatch selects the full representation. */
  const ifRange = reqHeaders?.get('if-range');
  /** Representation guard deciding whether to validate/serve a partial response. */
  const allowRange =
    requestedRange &&
    (!ifRange ||
      ifRange === etag ||
      (Date.parse(ifRange) >= Date.parse(meta.createdAt) &&
        !Number.isNaN(Date.parse(ifRange))));
  /** Validated inclusive range, undefined for full response or null when unsatisfiable. */
  const range = allowRange ? parseRange(requestedRange, meta.size) : undefined;
  if (allowRange && !range) {
    headers.set('Content-Range', `bytes */${meta.size}`);
    return new Response(null, { status: 416, headers });
  }
  /** Inclusive response range start; suffix requests derive it from logical size. */
  const start = range?.start ?? 0;
  /** Inclusive response end clamped to known metadata length. */
  const end = range?.end ?? Math.max(0, meta.size - 1);
  headers.set('Content-Length', String(range ? end - start + 1 : meta.size));
  if (range) {
    headers.set('Content-Range', `bytes ${start}-${end}/${meta.size}`);
  }
  /** 206 for a validated range, otherwise 200. */
  const status = range ? 206 : 200;
  if (method === 'HEAD') {
    return new Response(null, { status, headers });
  }
  // The async generator opens securely when pulled; cancellation forwards iterator return for handle cleanup.
  /** Lazy store iterator; secure binary opening happens on pull rather than response construction. */
  const chunks = store.streamRange(id, start, range ? end : undefined);
  /** Owned source iterator whose return releases any acquired native handle. */
  const iterator = chunks[Symbol.asyncIterator]();
  /** Backpressured response stream; consumer must consume or cancel it. */
  const body = new ReadableStream<Uint8Array>({
    /** Observe one lazy storage-iterator chunk under Fetch backpressure and forward source failures.
     * @param {ReadableStreamDefaultController<Uint8Array>} controller - Borrowed native response stream controller.
     * @returns {Promise<void>} One read observation; no prefetching or automatic replay.
     */
    async pull(controller) {
      try {
        /** Settled source observation; completion closes the response stream. */
        const result = await iterator.next();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    /** Return the owned read iterator when the response consumer cancels.
     * @returns {Promise<void>} Native iterator cleanup observation when iteration has started.
     */
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(body, { status, headers });
}
