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
 * Application function absolute.
 * @param {string} base - Input value for this operation.
 * @param {string} path - Input value for this operation.
 * @returns {string} Result produced by this operation.
 */
const absolute = (base: string, path: string): string => {
  if (!path.startsWith('/')) {
    throw new TypeError('Protocol path must be absolute');
  }
  /** Stores the url value used by this module. */
  const url = new URL(path, base);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Unsupported protocol URL');
  }
  return url.toString();
};
/**
 * Application function validSegment.
 * @param {string} value - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
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
    /** Stores the base value used by this module. */
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
   * post.
   * @param {string} path - Input value for this operation.
   * @param {unknown} data - Input value for this operation.
   * @param {CallOptions} options - Input value for this operation.
   * @param {Record<string, string>} extraHeaders - Input value for this operation.
   * @returns {Promise<{ status: number; body: unknown }>} Result produced by this operation.
   */
  async post(
    path: string,
    data: unknown,
    options: CallOptions = {},
    extraHeaders: Record<string, string> = {}
  ): Promise<{ status: number; body: unknown }> {
    /** Stores the parent value used by this module. */
    const parent = options.signal;
    /** Stores the controller value used by this module. */
    const controller = new AbortController();
    /**
     * Application function abort.
     * @returns {unknown} Result produced by this operation.
     */
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) {
      abort();
    } else {
      parent?.addEventListener('abort', abort, { once: true });
    }
    /** Stores the timeout value used by this module. */
    const timeout = this.config.timeoutMs
      ? setTimeout(
          () => controller.abort(new Error('Protocol request timed out')),
          this.config.timeoutMs
        )
      : undefined;
    try {
      /** Stores the initial value used by this module. */
      const initial =
        typeof this.config.headers === 'function'
          ? await this.config.headers()
          : this.config.headers;
      /** Stores the headers value used by this module. */
      const headers = new Headers(initial);
      new Headers(options.headers).forEach((value, name) =>
        headers.set(name, value)
      );
      headers.set('Accept', extraHeaders.Accept ?? 'application/json');
      headers.set('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
      /** Stores the response value used by this module. */
      const response = await this.transport(absolute(this.base, path), {
        method: 'POST',
        headers,
        credentials: this.config.credentials,
        signal: controller.signal,
        body: JSON.stringify(data),
        cache: 'no-store',
      });
      /** Stores the limit value used by this module. */
      const limit = this.config.maxResponseBytes ?? 4 * 1024 * 1024;
      /** Stores the length value used by this module. */
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
      /** Stores the reader value used by this module. */
      const reader = response.body.getReader();
      /** Stores the chunks value used by this module. */
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          /** Stores the next value used by this module. */
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
      /** Stores the bytes value used by this module. */
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
   * rpc.
   * @param {string} method - Input value for this operation.
   * @param {unknown} params - Input value for this operation.
   * @param {CallOptions} options - Input value for this operation.
   * @returns {Promise<T>} Result produced by this operation.
   */
  async rpc<T = unknown>(
    method: string,
    params?: unknown,
    options?: CallOptions
  ): Promise<T> {
    if (!/^[a-zA-Z][\w.:/-]{0,127}$/.test(method)) {
      throw new TypeError('Invalid RPC method');
    }
    /** Stores the id value used by this module. */
    const id = ++this.sequence;
    /** Stores the { body } value used by this module. */
    const { body } = await this.post(
      '/rpc',
      { jsonrpc: '2.0', id, method, params },
      options
    );
    /** Stores the result value used by this module. */
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
   * notify.
   * @param {string} method - Input value for this operation.
   * @param {unknown} params - Input value for this operation.
   * @param {CallOptions} options - Input value for this operation.
   * @returns {Promise<void>} Result produced by this operation.
   */
  async notify(
    method: string,
    params?: unknown,
    options?: CallOptions
  ): Promise<void> {
    /** Stores the { status } value used by this module. */
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
   * mcp.
   * @param {string} method - Input value for this operation.
   * @param {unknown} params - Input value for this operation.
   * @param {CallOptions} options - Input value for this operation.
   * @returns {Promise<T>} Result produced by this operation.
   */
  async mcp<T = unknown>(
    method: string,
    params?: unknown,
    options?: CallOptions
  ): Promise<T> {
    /** Stores the id value used by this module. */
    const id = ++this.sequence;
    /** Stores the { body } value used by this module. */
    const { body } = await this.post(
      '/mcp',
      { jsonrpc: '2.0', id, method, params },
      options,
      {
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      }
    );
    /** Stores the result value used by this module. */
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
   * connect.
   * @param {string} service - Input value for this operation.
   * @param {string} method - Input value for this operation.
   * @param {unknown} message - Input value for this operation.
   * @param {CallOptions} options - Input value for this operation.
   * @returns {Promise<T>} Result produced by this operation.
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
   * trpc.
   * @param {string} name - Input value for this operation.
   * @param {unknown} input - Input value for this operation.
   * @param {CallOptions} options - Input value for this operation.
   * @returns {Promise<T>} Result produced by this operation.
   */
  async trpc<T = unknown>(
    name: string,
    input: unknown,
    options?: CallOptions
  ): Promise<T> {
    if (!validSegment(name)) {
      throw new TypeError('Invalid tRPC method');
    }
    /** Stores the result value used by this module. */
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
 * Application function createProtocolClient.
 * @param {ProtocolClientOptions} options - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
export const createProtocolClient = (options?: ProtocolClientOptions) =>
  new ProtocolClient(options);
