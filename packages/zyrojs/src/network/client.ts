/** Framework-independent JSON-RPC, MCP, Connect and tRPC clients (browser or Node fetch). */
export class ProtocolClientError extends Error {
  /**
   * Create a transport or protocol failure with its HTTP status and optional code.
   *
   * @param {string} message - Safe failure message.
   * @param {number} status - HTTP status associated with the failure.
   * @param {number|string} code - Optional protocol or application code.
   * @param {unknown} details - Optional private diagnostic details.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number | string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'ProtocolClientError';
  }
}
export interface ProtocolClientOptions {
  /** Absolute origin used to resolve protocol-relative request paths. */
  baseUrl?: string;
  /** Fetch implementation owned by the host or global runtime. */
  fetch?: typeof fetch;
  /** Request headers or a lazy header provider. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Fetch credential mode for the request. */
  credentials?: RequestCredentials;
  /** Cooperative request deadline in milliseconds. */
  timeoutMs?: number;
  /** Maximum response body size accepted by the client. */
  maxResponseBytes?: number;
}
export interface CallOptions {
  /** Signal that cancels this caller's request. */
  signal?: AbortSignal;
  /** Per-call headers merged with client headers. */
  headers?: HeadersInit;
}
/**
 * Resolve an authored absolute path using standard URL semantics; reject non-HTTP(S) schemes.
 * @param {string} base - Trusted configured HTTP(S) base URL.
 * @param {string} path - Trusted absolute request path; this helper is not an SSRF allowlist.
 * @returns {string} Resolved HTTP(S) request URL; not a destination authorization guarantee.
 */
const absolute = (base: string, path: string): string => {
  if (!path.startsWith('/')) {
    throw new TypeError('Protocol path must be absolute');
  }
  /** Resolved HTTP(S) endpoint; host-owned base/path inputs still require destination authorization. */
  const url = new URL(path, base);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Unsupported protocol URL');
  }
  return url.toString();
};
/**
 * Restrict authored service/procedure identifiers before inserting them in request paths.
 * @param {string} value - Trusted authored service/procedure name to check against the supported grammar.
 * @returns {boolean} Whether the identifier fits the supported path grammar.
 */
const validSegment = (value: string) => /^[A-Za-z][\w.]{0,127}$/.test(value);
/** Client for bounded protocol calls over an injected or captured Fetch transport. */
export class ProtocolClient {
  private readonly base: string;
  private readonly transport: typeof fetch;
  private readonly config: ProtocolClientOptions;
  private sequence = 0;
  /**
   * Create a client with validated origin, timeout and response-size policy.
   *
   * @param {ProtocolClientOptions} config - Client transport and budget options.
   */
  constructor(config: ProtocolClientOptions = {}) {
    /** Explicit configured base, browser origin or standalone localhost fallback. */
    const base =
      config.baseUrl ??
      (typeof location !== 'undefined' ? location.origin : 'http://localhost');
    if (!/^https?:\/\//i.test(base)) {
      throw new TypeError('HTTP or HTTPS baseUrl required');
    }
    this.base = new URL(base).toString();
    // Calling a captured native Window.fetch as `this.transport()` supplies the
    // client as its receiver and fails browser Web IDL brand checks. Keep the
    // native global receiver; explicitly injected transports remain borrowed.
    this.transport = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.config = config;
    if (
      config.timeoutMs !== undefined &&
      (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)
    ) {
      throw new RangeError('Invalid timeout');
    }
    if (
      config.maxResponseBytes !== undefined &&
      (!Number.isSafeInteger(config.maxResponseBytes) ||
        config.maxResponseBytes < 1)
    ) {
      throw new RangeError('Invalid response limit');
    }
  }
  /** Never retries side-effecting RPC calls implicitly. */
  /**
   * Send one bounded JSON request without retrying potentially side-effecting work.
   * @param {string} path - Trusted absolute request path; this helper is not an SSRF allowlist.
   * @param {unknown} data - Trusted application payload serialized as JSON; never interpreted as executable source.
   * @param {CallOptions} options - Borrowed cancellation and per-call headers.
   * @param {Record<string, string>} extraHeaders - Trusted protocol-required headers applied after generic headers.
   * @returns {Promise<{ status: number; body: unknown }>} Bounded parsed JSON body and HTTP status; private causes/details remain caller-owned.
   */
  async post(
    path: string,
    data: unknown,
    options: CallOptions = {},
    extraHeaders: Record<string, string> = {}
  ): Promise<{ status: number; body: unknown }> {
    /** Borrowed per-call signal; its listener is removed on every terminal path. */
    const parent = options.signal;
    /** Per-request cancellation owner, also used by the optional cooperative deadline. */
    const controller = new AbortController();
    /**
     * Forward borrowed cancellation without taking ownership of the parent signal.
     * @returns {void} Forwards cancellation to the request-owned controller.
     */
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) {
      abort();
    } else {
      parent?.addEventListener('abort', abort, { once: true });
    }
    /** Owned request timer, cleared in finally; no retry or side-effect replay is scheduled. */
    const timeout = this.config.timeoutMs
      ? setTimeout(
          () => controller.abort(new Error('Protocol request timed out')),
          this.config.timeoutMs
        )
      : undefined;
    try {
      /** Trusted lazy headers may contain credentials and must never be logged. */
      const initial =
        typeof this.config.headers === 'function'
          ? await this.config.headers()
          : this.config.headers;
      /** Fresh merged headers; protocol-required fields override generic call headers. */
      const headers = new Headers(initial);
      new Headers(options.headers).forEach((value, name) =>
        headers.set(name, value)
      );
      headers.set('Accept', extraHeaders.Accept ?? 'application/json');
      headers.set('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
      /** Single Fetch outcome; successful parsing does not establish application authorization. */
      const response = await this.transport(absolute(this.base, path), {
        method: 'POST',
        headers,
        credentials: this.config.credentials,
        signal: controller.signal,
        body: JSON.stringify(data),
        cache: 'no-store',
      });
      /** Finite response accumulation ceiling, checked against declared and actual bytes. */
      const limit = this.config.maxResponseBytes ?? 4 * 1024 * 1024;
      /** Content-Length is an early guard only; actual stream bytes are counted independently. */
      const length = response.headers.get('content-length');
      if (length && Number(length) > limit) {
        throw new ProtocolClientError('Response too large', 413);
      }
      if (response.status === 204 || response.status === 202) {
        if (!response.ok) {
          throw new ProtocolClientError(
            `HTTP ${response.status}`,
            response.status
          );
        }
        return { status: response.status, body: null };
      }
      if (!response.body) {
        throw new ProtocolClientError('Missing response body', response.status);
      }
      /** Exclusive response reader, released in finally after bounded accumulation. */
      const reader = response.body.getReader();
      /** Bounded binary pieces retained until decoding; no unbounded response.json buffering. */
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          /** Next native stream result; byte accounting happens before retaining the chunk. */
          const next = await reader.read();
          if (next.done) {
            break;
          }
          size += next.value.byteLength;
          if (size > limit) {
            throw new ProtocolClientError('Response too large', 413);
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      /** One exact-sized buffer assembled only after all chunks fit the response budget. */
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ProtocolClientError('Invalid JSON response', response.status);
      }
      if (!response.ok) {
        throw new ProtocolClientError(
          `HTTP ${response.status}`,
          response.status,
          undefined,
          body
        );
      }
      return { status: response.status, body };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      parent?.removeEventListener('abort', abort);
    }
  }
  /**
   * Call JSON-RPC and require the matching protocol version/correlation ID.
   * @param {string} method - Trusted registered remote method; authorization is enforced by the remote host.
   * @param {unknown} params - Inert JSON parameters; remote handlers remain explicitly registered code.
   * @param {CallOptions} options - Borrowed cancellation and per-call headers.
   * @returns {Promise<T>} Correlated result; T is a host schema assertion, not runtime result validation.
   */
  async rpc<T = unknown>(
    method: string,
    params?: unknown,
    options?: CallOptions
  ): Promise<T> {
    if (!/^[a-zA-Z][\w.:/-]{0,127}$/.test(method)) {
      throw new TypeError('Invalid RPC method');
    }
    /** Per-client correlation counter; not an idempotency key or tenant identifier. */
    const id = ++this.sequence;
    /** Transport body still requires operation-specific envelope validation. */
    const { body } = await this.post(
      '/rpc',
      { jsonrpc: '2.0', id, method, params },
      options
    );
    /** Untrusted response envelope checked by the selected protocol operation. */
    const result = body as {
      id?: unknown;
      jsonrpc?: unknown;
      result?: T;
      error?: { code?: number; message?: string; data?: unknown };
    };
    if (!result || result.jsonrpc !== '2.0' || result.id !== id) {
      throw new ProtocolClientError('Invalid RPC response ID', 502);
    }
    if (result.error) {
      throw new ProtocolClientError(
        result.error.message ?? 'RPC error',
        200,
        result.error.code,
        result.error.data
      );
    }
    if (!Object.prototype.hasOwnProperty.call(result, 'result')) {
      throw new ProtocolClientError('Missing RPC result', 502);
    }
    return result.result as T;
  }
  /**
   * Send a JSON-RPC notification and require HTTP 204 without inventing a delivery receipt.
   * @param {string} method - Trusted registered remote method; authorization is enforced by the remote host.
   * @param {unknown} params - Inert JSON parameters; remote handlers remain explicitly registered code.
   * @param {CallOptions} options - Borrowed cancellation and per-call headers.
   * @returns {Promise<void>} Resolves on HTTP 204; this is not exactly-once processing.
   */
  async notify(
    method: string,
    params?: unknown,
    options?: CallOptions
  ): Promise<void> {
    /** Notifications require the expected no-content acknowledgement. */
    const { status } = await this.post(
      '/rpc',
      { jsonrpc: '2.0', method, params },
      options
    );
    if (status !== 204) {
      throw new ProtocolClientError(
        'Unexpected RPC notification response',
        status
      );
    }
  }
  /**
   * Call the JSON-response MCP subset; this method does not parse an SSE response body.
   * @param {string} method - Trusted registered remote method; authorization is enforced by the remote host.
   * @param {unknown} params - Inert JSON parameters; remote handlers remain explicitly registered code.
   * @param {CallOptions} options - Borrowed cancellation and per-call headers.
   * @returns {Promise<T>} Supported JSON MCP result; SSE responses require a separate reader.
   */
  async mcp<T = unknown>(
    method: string,
    params?: unknown,
    options?: CallOptions
  ): Promise<T> {
    /** Per-client correlation counter; not an idempotency key or tenant identifier. */
    const id = ++this.sequence;
    /** Transport body still requires operation-specific envelope validation. */
    const { body } = await this.post(
      '/mcp',
      { jsonrpc: '2.0', id, method, params },
      options,
      {
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      }
    );
    /** Untrusted response envelope checked by the selected protocol operation. */
    const result = body as {
      jsonrpc?: string;
      id?: unknown;
      result?: T;
      error?: { code?: number; message?: string; data?: unknown };
    };
    if (!result || result.jsonrpc !== '2.0' || result.id !== id) {
      throw new ProtocolClientError('Invalid MCP response', 502);
    }
    if (result.error) {
      throw new ProtocolClientError(
        result.error.message ?? 'MCP error',
        200,
        result.error.code,
        result.error.data
      );
    }
    return result.result as T;
  }
  /**
   * Call the supported unary JSON Connect endpoint; streaming has a separate API.
   * @param {string} service - Validated authored service identifier.
   * @param {string} method - Trusted registered remote method; authorization is enforced by the remote host.
   * @param {unknown} message - JSON request message; not executable code.
   * @param {CallOptions} options - Borrowed cancellation and per-call headers.
   * @returns {Promise<T>} Unary JSON message; native codec/schema validation remains host-owned.
   */
  async connect<T = unknown>(
    service: string,
    method: string,
    message: unknown,
    options?: CallOptions
  ): Promise<T> {
    if (!validSegment(service) || !/^[A-Za-z]\w{0,63}$/.test(method)) {
      throw new TypeError('Invalid Connect method');
    }
    return (await this.post(`/${service}/${method}`, message, options))
      .body as T;
  }
  /**
   * Call one named tRPC JSON procedure and unwrap its supported response envelope.
   * @param {string} name - Validated authored procedure identifier.
   * @param {unknown} input - JSON procedure input; server validation/authorization remain required.
   * @param {CallOptions} options - Borrowed cancellation and per-call headers.
   * @returns {Promise<T>} Unwrapped supported result envelope.
   */
  async trpc<T = unknown>(
    name: string,
    input: unknown,
    options?: CallOptions
  ): Promise<T> {
    if (!validSegment(name)) {
      throw new TypeError('Invalid tRPC method');
    }
    /** Untrusted response envelope checked by the selected protocol operation. */
    const result = (await this.post(`/trpc/${name}`, input, options)).body as {
      result?: { data: T };
      error?: unknown;
    };
    if (result?.error || !result?.result) {
      throw new ProtocolClientError(
        'tRPC error',
        500,
        undefined,
        result?.error
      );
    }
    return result.result.data;
  }
}
/**
 * Create an inert protocol client borrowing the configured Fetch transport.
 * @param {ProtocolClientOptions} options - Borrowed cancellation and per-call headers.
 * @returns {ProtocolClient} Inert client borrowing the configured transport.
 */
export const createProtocolClient = (options?: ProtocolClientOptions) =>
  new ProtocolClient(options);
