/** Framework-independent JSON-RPC, MCP, Connect and tRPC clients (browser or Node fetch). */
export class ProtocolClientError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number | string, readonly details?: unknown) { super(message); this.name = 'ProtocolClientError'; }
}
export interface ProtocolClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface CallOptions { signal?: AbortSignal; headers?: HeadersInit; }
const absolute = (base: string, path: string): string => {
  if (!path.startsWith('/')) throw new TypeError('Protocol path must be absolute');
  const url = new URL(path, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Unsupported protocol URL');
  return url.toString();
};
const validSegment = (value: string) => /^[A-Za-z][\w.]{0,127}$/.test(value);
export class ProtocolClient {
  private readonly base: string;
  private readonly transport: typeof fetch;
  private readonly config: ProtocolClientOptions;
  private sequence = 0;
  constructor(config: ProtocolClientOptions = {}) {
    const base = config.baseUrl ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost');
    if (!/^https?:\/\//i.test(base)) throw new TypeError('HTTP or HTTPS baseUrl required');
    this.base = new URL(base).toString();
    this.transport = config.fetch ?? fetch;
    this.config = config;
    if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)) throw new RangeError('Invalid timeout');
    if (config.maxResponseBytes !== undefined && (!Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes < 1)) throw new RangeError('Invalid response limit');
  }
  /** Never retries side-effecting RPC calls implicitly. */
  async post(path: string, data: unknown, options: CallOptions = {}, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
    const parent = options.signal;
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
    const timeout = this.config.timeoutMs ? setTimeout(() => controller.abort(new Error('Protocol request timed out')), this.config.timeoutMs) : undefined;
    try {
      const initial = typeof this.config.headers === 'function' ? await this.config.headers() : this.config.headers;
      const headers = new Headers(initial);
      new Headers(options.headers).forEach((value, name) => headers.set(name, value));
      headers.set('Accept', extraHeaders.Accept ?? 'application/json');
      headers.set('Content-Type', 'application/json');
      for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
      const response = await this.transport(absolute(this.base, path), { method: 'POST', headers, credentials: this.config.credentials, signal: controller.signal, body: JSON.stringify(data), cache: 'no-store' });
      const limit = this.config.maxResponseBytes ?? 4 * 1024 * 1024;
      const length = response.headers.get('content-length');
      if (length && Number(length) > limit) throw new ProtocolClientError('Response too large', 413);
      if (response.status === 204 || response.status === 202) {
        if (!response.ok) throw new ProtocolClientError(`HTTP ${response.status}`, response.status);
        return { status: response.status, body: null };
      }
      if (!response.body) throw new ProtocolClientError('Missing response body', response.status);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) throw new ProtocolClientError('Response too large', 413);
        chunks.push(next.value);
      } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new ProtocolClientError('Invalid JSON response', response.status); }
      if (!response.ok) throw new ProtocolClientError(`HTTP ${response.status}`, response.status, undefined, body);
      return { status: response.status, body };
    } finally { if (timeout) clearTimeout(timeout); parent?.removeEventListener('abort', abort); }
  }
  async rpc<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T> {
    if (!/^[a-zA-Z][\w.:/-]{0,127}$/.test(method)) throw new TypeError('Invalid RPC method');
    const id = ++this.sequence;
    const { body } = await this.post('/rpc', { jsonrpc: '2.0', id, method, params }, options);
    const result = body as { id?: unknown; jsonrpc?: unknown; result?: T; error?: { code?: number; message?: string; data?: unknown } };
    if (!result || result.jsonrpc !== '2.0' || result.id !== id) throw new ProtocolClientError('Invalid RPC response ID', 502);
    if (result.error) throw new ProtocolClientError(result.error.message ?? 'RPC error', 200, result.error.code, result.error.data);
    if (!Object.prototype.hasOwnProperty.call(result, 'result')) throw new ProtocolClientError('Missing RPC result', 502);
    return result.result as T;
  }
  async notify(method: string, params?: unknown, options?: CallOptions): Promise<void> {
    const { status } = await this.post('/rpc', { jsonrpc: '2.0', method, params }, options);
    if (status !== 204) throw new ProtocolClientError('Unexpected RPC notification response', status);
  }
  async mcp<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T> {
    const id = ++this.sequence;
    const { body } = await this.post('/mcp', { jsonrpc: '2.0', id, method, params }, options, { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' });
    const result = body as { jsonrpc?: string; id?: unknown; result?: T; error?: { code?: number; message?: string; data?: unknown } };
    if (!result || result.jsonrpc !== '2.0' || result.id !== id) throw new ProtocolClientError('Invalid MCP response', 502);
    if (result.error) throw new ProtocolClientError(result.error.message ?? 'MCP error', 200, result.error.code, result.error.data);
    return result.result as T;
  }
  async connect<T = unknown>(service: string, method: string, message: unknown, options?: CallOptions): Promise<T> {
    if (!validSegment(service) || !/^[A-Za-z]\w{0,63}$/.test(method)) throw new TypeError('Invalid Connect method');
    return (await this.post(`/${service}/${method}`, message, options)).body as T;
  }
  async trpc<T = unknown>(name: string, input: unknown, options?: CallOptions): Promise<T> {
    if (!validSegment(name)) throw new TypeError('Invalid tRPC method');
    const result = (await this.post(`/trpc/${name}`, input, options)).body as { result?: { data: T }; error?: unknown };
    if (result?.error || !result?.result) throw new ProtocolClientError('tRPC error', 500, undefined, result?.error);
    return result.result.data;
  }
}
export const createProtocolClient = (options?: ProtocolClientOptions) => new ProtocolClient(options);
