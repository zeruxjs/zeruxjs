import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import { ResourceRegistry, ToolRegistry } from './registry.js';
export interface McpServerOptions {
  /** Host-declared public server label. */
  name: string;
  /** Host-declared public server version, separate from the wire protocol version. */
  version: string;
  /** Optional explicit trusted tool registry; no package discovery occurs. */
  tools?: ToolRegistry;
  /** Optional inert resource registry; resource URIs are lookup keys only. */
  resources?: ResourceRegistry;
  /** Explicit supported wire-version declaration; the retained default is not a claim of latest/upstream certification. */
  protocolVersion?: string;
  /** Optional synchronous private tool-cause observer; hosts own any asynchronous sink failure handling. */
  onError?: (error: unknown) => void;
}
/** Build one inert successful protocol envelope.
 * @param {string | number | null} id - Validated correlation identifier.
 * @param {unknown} result - Public supported result.
 * @returns {JsonRpcResponse} JSON-RPC result envelope.
 */
const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});
/** Build a fixed public protocol error without unknown native causes.
 * @param {string | number | null} id - Correlation identifier.
 * @param {number} code - Public protocol error code.
 * @param {string} message - Safe public text.
 * @returns {JsonRpcResponse} Error envelope.
 */
const fail = (
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
/** Create the implemented stateless JSON MCP tools/resources subset using explicit trusted registries, without opening a transport.
 * @param {McpServerOptions} options - Host metadata, declared protocol version, optional registries and a synchronous private cause observer.
 * @returns {object} Inert server/registries plus handle; advanced sampling, elicitation, subscriptions and full vendor parity are not implemented.
 */
export function createMcpServer(options: McpServerOptions) {
  if (!options?.name || !options.version) {
    throw new TypeError('MCP server name and version required');
  }
  /** Explicit borrowed registry or inert app-local default; no executable definitions are discovered automatically. */
  const tools = options.tools ?? new ToolRegistry();
  /** Explicit borrowed inert registry or local default; no URI fetch occurs. */
  const resources = options.resources ?? new ResourceRegistry();
  /** Existing declared wire version retained independently of package release metadata. */
  const protocolVersion = options.protocolVersion ?? '2025-11-25';
  return {
    tools,
    resources,
    protocolVersion,
    /** Validate a supported inert request envelope and dispatch only explicit protocol methods under host transport authorization.
     * @param {unknown} request - Unknown parsed JSON, never executable source.
     * @param {import('../json-rpc.js').RpcContext} context - Verified host context propagated to trusted handlers; execution limits remain with the transport/handler owners.
     * @returns {Promise<JsonRpcResponse | null>} Supported response or notification null; tool failures return an isError result without serializing native causes.
     */
    async handle(
      request: unknown,
      context: import('../json-rpc.js').RpcContext = {}
    ): Promise<JsonRpcResponse | null> {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return fail(null, -32600, 'Invalid Request');
      }
      /** Unknown envelope viewed through the supported partial shape while required fields are checked. */
      const item = request as Partial<JsonRpcRequest>;
      if (
        item.jsonrpc !== '2.0' ||
        typeof item.method !== 'string' ||
        (item.id !== undefined &&
          item.id !== null &&
          typeof item.id !== 'string' &&
          (typeof item.id !== 'number' || !Number.isFinite(item.id)))
      ) {
        return fail(null, -32600, 'Invalid Request');
      }
      /** Validated correlation value; notifications return without invoking request handlers. */
      const id = item.id ?? null;
      if (item.method === 'notifications/initialized') {
        return null;
      }
      if (item.id === undefined) {
        return null;
      }
      try {
        switch (item.method) {
          case 'initialize':
            return ok(id, {
              protocolVersion,
              capabilities: {
                tools: { listChanged: false },
                resources: { listChanged: false },
              },
              serverInfo: { name: options.name, version: options.version },
            });
          case 'ping':
            return ok(id, {});
          case 'tools/list':
            return ok(id, { tools: tools.list() });
          case 'resources/list':
            return ok(id, { resources: resources.list() });
          case 'resources/read': {
            /** Supported method parameters inspected as inert data before registry access. */
            const p = item.params as { uri?: unknown } | undefined;
            if (typeof p?.uri !== 'string') {
              return fail(id, -32602, 'Resource URI required');
            }
            /** Registered inert text record projected explicitly into the supported response. */
            const resource = resources.read(p.uri);
            return ok(id, {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType ?? 'text/plain',
                  text: resource.text,
                },
              ],
            });
          }
          case 'tools/call': {
            /** Supported method parameters inspected as inert data before registry access. */
            const p = item.params as
              | {
                  /** Host-declared public server label. */
                  name?: unknown;
                  arguments?: Record<string, unknown>;
                }
              | undefined;
            if (typeof p?.name !== 'string') {
              return fail(id, -32602, 'Tool name required');
            }
            try {
              /** Actual trusted tool outcome serialized as text, never evaluated as HTML or source. */
              const result = await tools.call(
                p.name,
                p.arguments ?? {},
                context
              );
              return ok(id, {
                content: [
                  {
                    type: 'text',
                    text:
                      typeof result === 'string'
                        ? result
                        : (JSON.stringify(result) ?? 'null'),
                  },
                ],
              });
            } catch (err) {
              try {
                options.onError?.(err);
              } catch {
                /* Host diagnostic callbacks must not replace the primary operation outcome. */
              }
              return ok(id, {
                isError: true,
                content: [{ type: 'text', text: 'Tool execution failed' }],
              });
            }
          }
          default:
            return fail(id, -32601, 'Method not found');
        }
      } catch {
        return fail(id, -32602, 'Invalid params');
      }
    },
  };
}
export type McpServer = ReturnType<typeof createMcpServer>;
