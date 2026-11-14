/** ZeruxJS registration facade for ZHOST's in-process protocol gateway. */
import type { IncomingMessage } from 'node:http';
import {
  createProtocolGateway,
  createMcpServer,
  type ProtocolGatewayOptions,
  type McpServerOptions,
  type RpcMethod,
  type ConnectMethod,
  type McpServer,
} from 'zhost/protocols';

export type ZeruxProtocolOptions = Partial<
  Pick<ProtocolGatewayOptions, 'authorize' | 'allowedOrigins' | 'maxBodyBytes'>
> & {
  /** Explicit application opt-out checked by the runtime before gateway creation. */
  enabled?: boolean;
  /** Inert MCP server metadata; it does not enable arbitrary code discovery. */
  mcp?: Pick<McpServerOptions, 'name' | 'version' | 'protocolVersion'>;
};
export type ZeruxProtocolGateway = ReturnType<typeof createProtocolGateway>;
export interface ZeruxProtocols {
  /** Owned in-process zhost gateway exposed for explicit host transport registration. */
  readonly gateway: ZeruxProtocolGateway;
  /** Inert MCP server metadata; it does not enable arbitrary code discovery. */
  readonly mcp: McpServer;
  /** Register one explicitly trusted JSON-RPC handler.
   * @param {string} name - Registered method name.
   * @param {RpcMethod} handler - Application-owned handler enforcing resource permissions.
   * @returns {() => void} Registration disposer owned by the calling plugin.
   */
  rpc(name: string, handler: RpcMethod): () => void;
  /** Register one explicit Connect service/method handler.
   * @param {string} service - Registered service name.
   * @param {string} method - Registered method name.
   * @param {ConnectMethod} handler - Trusted handler enforcing resource permissions.
   * @returns {() => void} Registration disposer owned by the calling plugin.
   */
  connect(service: string, method: string, handler: ConnectMethod): () => void;
  /** Register one explicit tRPC-style gateway method.
   * @param {string} name - Registered method name.
   * @param {ConnectMethod} handler - Trusted application handler.
   * @returns {() => void} Registration disposer.
   */
  trpc(name: string, handler: ConnectMethod): () => void;
  /** Register a trusted MCP handler with a declared input schema; schema validation is not authorization.
   * @param {string} name - Explicit tool name.
   * @param {string} description - Inert tool description.
   * @param {Record<string, unknown>} schema - Structured declared input schema.
   * @param {(args: Record<string, unknown>) => unknown | Promise<unknown>} handler - Allowlisted application code, never a model-provided URL or command.
   * @returns {() => void} Removes this named tool registration.
   */
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => unknown | Promise<unknown>
  ): () => void;
  /** Register explicit inert resource text without remote fetching.
   * @param {string} uri - Application-selected resource identity.
   * @param {string} text - Inert resource content.
   * @param {string} mimeType - Optional declared content type.
   * @returns {() => void} Removes this resource registration.
   */
  resource(uri: string, text: string, mimeType?: string): () => void;
  /** Publish one structured event through the existing bounded gateway event owner.
   * @param {string} event - Explicit event name.
   * @param {unknown} payload - Application-approved event data; never emit secrets publicly.
   * @returns {string} Gateway-assigned event identity, not a durable delivery guarantee.
   */
  publish(event: string, payload: unknown): string;
  /** Apply the explicit gateway authorizer or legacy direct-peer loopback check; handlers still authorize their resources.
   * @param {IncomingMessage} request - Borrowed native incoming request.
   * @returns {Promise<boolean>} Gateway admission result without trusting forwarded identity.
   */
  authorize(request: IncomingMessage): Promise<boolean>;
  /** Release this facade’s gateway registry and stream resources.
   * @returns {void} Immediate gateway cleanup according to the zhost contract.
   */
  close(): void;
}
/** Create an explicit application gateway/MCP facade without starting a network listener.
 * @param {ZeruxProtocolOptions} options - Application-owned admission/origin/body/MCP metadata policy.
 * @returns {ZeruxProtocols} Owned gateway facade; close during generation teardown.
 */
export function createZeruxProtocols(
  options: ZeruxProtocolOptions = {}
): ZeruxProtocols {
  /** Owned in-process zhost gateway; this facade does not bind a listener. */
  const gateway = createProtocolGateway({
    authorize: options.authorize,
    allowedOrigins: options.allowedOrigins,
    maxBodyBytes: options.maxBodyBytes,
  });
  /** Owned explicit MCP tool/resource registry attached to this gateway. */
  const mcp = createMcpServer({
    name: options.mcp?.name ?? 'zerux-app',
    version: options.mcp?.version ?? '1.0.0',
    protocolVersion: options.mcp?.protocolVersion,
  });
  gateway.mcp = mcp;
  return {
    gateway,
    mcp,
    rpc: (name, handler) => gateway.rpc.register(name, handler),
    connect: (service, method, handler) =>
      gateway.connect.register(service, method, handler),
    trpc: (name, handler) => gateway.trpc.register(name, handler),
    tool: (name, description, schema, handler) => {
      mcp.tools.register({ name, description, inputSchema: schema, handler });
      return () => {
        mcp.tools.unregister(name);
      };
    },
    resource: (uri, text, mimeType) => {
      mcp.resources.register({ uri, name: uri, text, mimeType });
      return () => {
        mcp.resources.remove(uri);
      };
    },
    publish: (event, payload) => gateway.events.publish(event, payload).id,
    authorize: async (request) =>
      options.authorize
        ? !!(await options.authorize(request))
        : request.socket.remoteAddress === '127.0.0.1' ||
          request.socket.remoteAddress === '::1',
    close: () => gateway.close(),
  };
}
