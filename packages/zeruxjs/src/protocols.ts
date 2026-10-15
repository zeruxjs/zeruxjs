/** ZeruxJS registration facade for ZSRV's in-process protocol gateway. */
import type { IncomingMessage } from 'node:http';
import {
  createProtocolGateway, createMcpServer,
  type ProtocolGatewayOptions, type McpServerOptions,
  type RpcMethod, type ConnectMethod,
  type McpServer
} from 'zsrv/protocols';

export type ZeruxProtocolOptions = Partial<Pick<ProtocolGatewayOptions, 'authorize' | 'allowedOrigins' | 'maxBodyBytes'>> & {
  enabled?: boolean;
  mcp?: Pick<McpServerOptions, 'name' | 'version' | 'protocolVersion'>;
};
export type ZeruxProtocolGateway = ReturnType<typeof createProtocolGateway>;
export interface ZeruxProtocols {
  readonly gateway: ZeruxProtocolGateway;
  readonly mcp: McpServer;
  rpc(name: string, handler: RpcMethod): () => void;
  connect(service: string, method: string, handler: ConnectMethod): () => void;
  trpc(name: string, handler: ConnectMethod): () => void;
  tool(name: string, description: string, schema: Record<string, unknown>, handler: (args: Record<string, unknown>) => unknown | Promise<unknown>): () => void;
  resource(uri: string, text: string, mimeType?: string): () => void;
  publish(event: string, payload: unknown): string;
  /** Explicit route-level authorization belongs to the application. */
  authorize(request: IncomingMessage): Promise<boolean>;
  close(): void;
}
export function createZeruxProtocols(options: ZeruxProtocolOptions = {}): ZeruxProtocols {
  const gateway = createProtocolGateway({ authorize: options.authorize, allowedOrigins: options.allowedOrigins, maxBodyBytes: options.maxBodyBytes });
  const mcp = createMcpServer({ name: options.mcp?.name ?? 'zerux-app', version: options.mcp?.version ?? '1.0.0', protocolVersion: options.mcp?.protocolVersion });
  gateway.mcp = mcp;
  return {
    gateway, mcp,
    rpc: (name, handler) => gateway.rpc.register(name, handler),
    connect: (service, method, handler) => gateway.connect.register(service, method, handler),
    trpc: (name, handler) => gateway.trpc.register(name, handler),
    tool: (name, description, schema, handler) => { mcp.tools.register({ name, description, inputSchema: schema, handler }); return () => { mcp.tools.unregister(name); }; },
    resource: (uri, text, mimeType) => { mcp.resources.register({ uri, name: uri, text, mimeType }); return () => { mcp.resources.remove(uri); }; },
    publish: (event, payload) => gateway.events.publish(event, payload).id,
    authorize: async (request) => options.authorize ? !!(await options.authorize(request)) : request.socket.remoteAddress === '127.0.0.1' || request.socket.remoteAddress === '::1',
    close: () => gateway.close()
  };
}
