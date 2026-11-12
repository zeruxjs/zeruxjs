/** Validate a raw POST/PUT body and expose a lazy bounded byte iterator; never parse multipart/form-data or execute content.
 * @param {Request} request - Borrowed raw request; host authenticates/authorizes before invoking this helper.
 * @param {object} options - Optional trusted ceiling/exact size/MIME expectations.
 * @param {number} [options.maxBytes] - Positive actual-byte ceiling checked while reading.
 * @param {number} [options.expectedBytes] - Trusted exact byte length checked at completion.
 * @param {string} [options.contentType] - Expected bare MIME type; no content decoding is performed.
 * @returns {object} Normalized declared MIME and lazy source; no reader is acquired until source iteration starts.
 */
export function mediaRequestBody(
  request: Request,
  options: {
    /** Optional positive safe-integer actual-byte ceiling; helper/store defaults remain owner-specific. */
    maxBytes?: number;
    /** Trusted exact byte declaration from a separately validated host record. */
    expectedBytes?: number;
    /** Declared bare MIME metadata, not antivirus/sniffing or decoding certification. */
    contentType?: string;
  } = {}
) {
  if (!['POST', 'PUT'].includes(request.method) || !request.body) {
    throw new TypeError('Upload requires POST/PUT body');
  }
  if (
    request.headers.has('content-encoding') &&
    request.headers.get('content-encoding') !== 'identity'
  ) {
    throw new TypeError('Encoded uploads unsupported');
  }
  /** Normalized declared MIME header; not content sniffing or permission. */
  const contentType = (
    request.headers.get('content-type') ?? 'application/octet-stream'
  )
    .split(';', 1)[0]
    .trim();
  if (
    options.contentType !== undefined &&
    contentType !== options.contentType
  ) {
    throw new TypeError('Upload content type mismatch');
  }
  /** Optional declared Content-Length, syntax checked before source iteration. */
  const length = request.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
  ) {
    throw new RangeError('Invalid Content-Length');
  }
  if (
    options.expectedBytes !== undefined &&
    length !== null &&
    Number(length) !== options.expectedBytes
  ) {
    throw new RangeError('Upload length mismatch');
  }
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
  ) {
    throw new RangeError('Invalid upload limit');
  }
  if (
    length !== null &&
    options.maxBytes !== undefined &&
    Number(length) > options.maxBytes
  ) {
    throw new RangeError('Media size exceeds limit');
  }
  /** Trusted expected length or valid request declaration, checked against actual bytes. */
  const declared = length === null ? options.expectedBytes : Number(length);
  /** Count actual chunks/bytes before yielding and reject declared-length mismatch before downstream commit.
   * @returns {AsyncGenerator<Uint8Array>} Borrowed binary chunks; cancellation releases the acquired reader/listener/lock in finally.
   */
  async function* source() {
    // Lazy acquisition also avoids leaking a reader if a downstream store rejects its options first.
    /** Lazy exclusive request-body reader retained until its source finally completes. */
    const reader = request.body!.getReader();
    let bytes = 0,
      count = 0;
    /** Request cooperative cancellation of the owned reader.
     * @returns {void} Native cancellation errors are isolated while final cleanup retains ownership. */
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        if (request.signal.aborted) {
          throw new Error('Upload cancelled');
        }
        /** One native body observation, counted/typed before yielding to storage. */
        const next = await reader.read();
        if (next.done) {
          break;
        }
        if (!(next.value instanceof Uint8Array)) {
          throw new TypeError('Invalid binary chunk');
        }
        bytes += next.value.byteLength;
        if (
          !Number.isSafeInteger(bytes) ||
          (options.maxBytes !== undefined && bytes > options.maxBytes) ||
          ++count > 65536
        ) {
          throw new RangeError('Media size exceeds limit');
        }
        if (declared !== undefined && bytes > declared) {
          throw new RangeError('Upload length mismatch');
        }
        yield next.value;
      }
      if (request.signal.aborted) {
        throw new Error('Upload cancelled');
      }
      if (declared !== undefined && bytes !== declared) {
        throw new RangeError('Upload length mismatch');
      }
    } finally {
      request.signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return { contentType, source: source() };
}
