import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import { ResourceRegistry, ToolRegistry } from './registry.js';
export interface McpServerOptions { name: string; version: string; tools?: ToolRegistry; resources?: ResourceRegistry; protocolVersion?: string }
const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
const fail = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
/** MCP core tools and resources, suitable for stateless Streamable HTTP JSON responses.
 * Advanced MCP capabilities (sampling, elicitation, subscriptions) are not implemented. */
export function createMcpServer(options: McpServerOptions) {
  if (!options?.name || !options.version) throw new TypeError('MCP server name and version required');
  const tools = options.tools ?? new ToolRegistry();
  const resources = options.resources ?? new ResourceRegistry();
  const protocolVersion = options.protocolVersion ?? '2025-11-25';
  return { tools, resources, protocolVersion, async handle(request: unknown): Promise<JsonRpcResponse | null> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return fail(null, -32600, 'Invalid Request');
    const item = request as Partial<JsonRpcRequest>;
    if (item.jsonrpc !== '2.0' || typeof item.method !== 'string' ||
      (item.id !== undefined && item.id !== null && typeof item.id !== 'string' && (typeof item.id !== 'number' || !Number.isFinite(item.id)))) return fail(null, -32600, 'Invalid Request');
    const id = item.id ?? null;
    if (item.method === 'notifications/initialized') return null;
    if (item.id === undefined) return null;
    try {
      switch (item.method) {
        case 'initialize': return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }, serverInfo: { name: options.name, version: options.version } });
        case 'ping': return ok(id, {});
        case 'tools/list': return ok(id, { tools: tools.list() });
        case 'resources/list': return ok(id, { resources: resources.list() });
        case 'resources/read': {
          const p = item.params as { uri?: unknown } | undefined;
          if (typeof p?.uri !== 'string') return fail(id, -32602, 'Resource URI required');
          const resource = resources.read(p.uri);
          return ok(id, { contents: [{ uri: resource.uri, mimeType: resource.mimeType ?? 'text/plain', text: resource.text }] });
        }
        case 'tools/call': {
          const p = item.params as { name?: unknown; arguments?: Record<string, unknown> } | undefined;
          if (typeof p?.name !== 'string') return fail(id, -32602, 'Tool name required');
          try {
            const result = await tools.call(p.name, p.arguments ?? {});
            return ok(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) ?? 'null' }] });
          } catch (err) { return ok(id, { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : 'Tool execution failed' }] }); }
        }
        default: return fail(id, -32601, 'Method not found');
      }
    } catch { return fail(id, -32602, 'Invalid params'); }
  } };
}
export type McpServer = ReturnType<typeof createMcpServer>;
