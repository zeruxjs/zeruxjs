export interface McpTool {
  /** Explicit public tool/resource label chosen by trusted host registration. */
  name: string;
  /** Optional inert public description; do not place credentials or private traits here. */
  description?: string;
  /** Trusted shallow argument schema; it does not authorize execution or implement all JSON Schema keywords. */
  inputSchema?: Record<string, unknown>;
  /** Explicit trusted code registered by the application; never source supplied inside a model/network payload. */
  handler: (
    args: Record<string, unknown>,
    context?: import('../json-rpc.js').RpcContext
  ) => unknown | Promise<unknown>;
}
export interface JsonRpcRequest {
  /** Fixed JSON-RPC protocol discriminator. */
  jsonrpc: '2.0';
  /** Optional request correlation ID; absent IDs represent notifications. */
  id?: string | number | null;
  /** Explicit supported wire method, not a module path, shell command or arbitrary URL. */
  method: string;
  /** Inert parsed request parameters validated by the selected supported method. */
  params?: unknown;
}
export interface JsonRpcResponse {
  /** Fixed JSON-RPC protocol discriminator. */
  jsonrpc: '2.0';
  /** Optional request correlation ID; absent IDs represent notifications. */
  id: string | number | null;
  /** Inert public handler result, serialized by the owning transport. */
  result?: unknown;
  /** Fixed public protocol error rather than an unknown private native cause. */
  error?: {
    /** Public protocol error code. */
    code: number;
    /** Safe public error text, excluding private causes. */
    message: string;
  };
}
export interface McpResource {
  /** Exact local registered resource key; no scheme is fetched automatically. */
  uri: string;
  /** Explicit public tool/resource label chosen by trusted host registration. */
  name: string;
  /** Optional inert public description; do not place credentials or private traits here. */
  description?: string;
  /** Optional public text-resource media metadata. */
  mimeType?: string;
  /** Inert registered resource content; consumers own HTML/content sanitization before rendering. */
  text: string;
}
