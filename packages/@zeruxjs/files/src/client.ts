/** Create an inert browser-safe Fetch facade. The transport is borrowed; no timer, listener, request or close owner is created here.
 * @param {object} options - Trusted HTTP(S) baseUrl, optional borrowed fetch transport and host-controlled headers. Server authorization remains authoritative.
 * @param {string} options.baseUrl - HTTP(S) endpoint; key segments are appended to its path.
 * @param {typeof fetch} [options.fetch] - Borrowed Fetch transport; defaults to global Fetch.
 * @param {Record<string, string>} [options.headers] - Host-controlled headers merged into each request.
 * @returns {object} Upload, streaming download, bounded byte-read, HEAD and deletion methods.
 */
export function createFilesClient(options: {
  /** Trusted HTTP(S) object endpoint; segments are appended to its path. */
  baseUrl: string;
  /** Borrowed Fetch implementation; defaults to global Fetch at construction. */
  fetch?: typeof fetch;
  /** Host-controlled request headers; server credentials must not be shipped to browsers. */
  headers?: Record<string, string>;
}) {
  /** Borrowed transport selected at construction; importing the module sends no requests. */
  const fetcher = options.fetch ?? fetch;
  /** Parsed host endpoint; clone it before appending each object path. */
  const base = new URL(options.baseUrl);
  if (!['https:', 'http:'].includes(base.protocol)) {
    throw new TypeError('Invalid files URL');
  }
  /** Append encoded object segments without mutating the configured base URL.
   * @param {string} key - Relative object key without empty or dot segments.
   * @returns {string} Request URL retaining the base endpoint query and fragment.
   */
  function path(key: string) {
    if (!key || key.split('/').some((s) => !s || s === '.' || s === '..')) {
      throw new TypeError('Invalid file key');
    }
    /** Per-request URL preserving the configured endpoint without mutating shared state. */
    const url = new URL(base.toString());
    url.pathname =
      base.pathname.replace(/\/?$/, '/') +
      key.split('/').map(encodeURIComponent).join('/');
    return url.toString();
  }
  /** Dispatch once and reject unsuccessful HTTP statuses; writes are never replayed automatically.
   * @param {string} key - Relative object key validated during URL construction.
   * @param {RequestInit} init - Method, body, headers and optional caller-owned cancellation signal.
   * @returns {Promise<Response>} Successful response whose consumer owns body consumption or cancellation.
   */
  async function request(key: string, init: RequestInit) {
    /** Native response; HTTP failure is reported without retrying this operation. */
    const result = await fetcher(path(key), {
      ...init,
      headers: { ...options.headers, ...init.headers },
    });
    if (!result.ok) {
      throw Object.assign(new Error(`File request failed: ${result.status}`), {
        status: result.status,
      });
    }
    return result;
  }
  return {
    /** Upload borrowed binary data and decode the server JSON receipt without evaluating its content.
     * @param {string} key - Relative destination key subject to server policy.
     * @param {Blob | Uint8Array | ReadableStream<Uint8Array>} data - Borrowed binary source; streaming upload support depends on the host Fetch implementation.
     * @param {object} opts - Optional contentType (default application/octet-stream) and caller-owned signal.
     * @param {string} [opts.contentType] - Declared MIME type; defaults to application/octet-stream.
     * @param {AbortSignal} [opts.signal] - Caller-owned cancellation signal.
     * @returns {Promise<any>} Server JSON receipt; no independent FileInfo schema validation is performed.
     */
    upload(
      key: string,
      data: Blob | Uint8Array | ReadableStream<Uint8Array>,
      opts: {
        /** Declared MIME type; server MIME and size policies remain authoritative. */
        contentType?: string;
        /** Caller-owned cooperative request cancellation. */
        signal?: AbortSignal;
      } = {}
    ) {
      return request(key, {
        method: 'PUT',
        headers: {
          'Content-Type': opts.contentType ?? 'application/octet-stream',
        },
        body: data as BodyInit,
        signal: opts.signal,
        ...(data instanceof ReadableStream
          ? ({ duplex: 'half' } as RequestInit)
          : {}),
      }).then((r) => r.json());
    },
    /** Return the streaming response without materializing the object.
     * @param {string} key - Relative object key.
     * @param {object} opts - Optional caller-owned signal and Range header interpreted by the server.
     * @param {AbortSignal} [opts.signal] - Caller-owned cancellation signal.
     * @param {string} [opts.range] - Range header interpreted and validated by the server.
     * @returns {Promise<Response>} Successful response; caller must consume or cancel its body.
     */
    download(
      key: string,
      opts: {
        /** Caller-owned cooperative request cancellation. */
        signal?: AbortSignal;
        /** Range header interpreted and validated by the server. */
        range?: string;
      } = {}
    ) {
      return request(key, {
        method: 'GET',
        headers: opts.range ? { Range: opts.range } : {},
        signal: opts.signal,
      });
    },
    /** Buffer a small response, counting actual chunks independently of advertised Content-Length.
     * @param {string} key - Relative object key.
     * @param {number} maxBytes - Trusted positive finite byte ceiling; defaults to 16 MiB.
     * @returns {Promise<Uint8Array>} Fresh combined bytes; overflow rejects and releases an acquired reader.
     */
    async bytes(key: string, maxBytes = 16 * 1024 * 1024) {
      /** Successful response whose reader is owned during buffering. */
      const response = await request(key, { method: 'GET' });
      /** Advertised length used only as an early check; actual chunks are counted separately. */
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > maxBytes) {
        throw new RangeError('File too large');
      }
      /** Retained chunks bounded by the trusted caller ceiling. */
      const chunks: Uint8Array[] = [];
      let total = 0;
      /** Exclusive body reader cancelled and unlocked after read success or failure. */
      const reader = response.body?.getReader();
      if (!reader) {
        return new Uint8Array();
      }
      try {
        // Count each actual chunk before retaining it; the advertised length is only a hint.
        while (true) {
          /** Next stream observation; done terminates the read loop. */
          const part = await reader.read();
          if (part.done) {
            break;
          }
          total += part.value.byteLength;
          if (total > maxBytes) {
            throw new RangeError('File too large');
          }
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      /** Fresh exact-size destination for retained chunks in network order. */
      const output = new Uint8Array(total);
      let i = 0;
      // Copy in network order into the exact-size result without exposing bookkeeping arrays.
      for (const chunk of chunks) {
        output.set(chunk, i);
        i += chunk.byteLength;
      }
      return output;
    },
    /** Request metadata without downloading object bytes.
     * @param {string} key - Relative object key.
     * @returns {Promise<Headers>} Successful server response headers.
     */
    head(key: string) {
      return request(key, { method: 'HEAD' }).then((r) => r.headers);
    },
    /** Request deletion once; permissions and idempotence remain server responsibilities.
     * @param {string} key - Relative object key.
     * @returns {Promise<undefined>} Completion after a successful HTTP response.
     */
    remove(key: string) {
      return request(key, { method: 'DELETE' }).then(() => undefined);
    },
  };
}
