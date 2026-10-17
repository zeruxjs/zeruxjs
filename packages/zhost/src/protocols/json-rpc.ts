/** JSON-RPC 2.0 dispatcher: batch/notification semantics and transport-independent handlers. */
export type RpcId = string | number | null;
export type RpcError = { code: number; message: string; data?: unknown };
export type RpcResponse = { jsonrpc: '2.0'; id: RpcId; result?: unknown; error?: RpcError };
export type RpcMethod = (params: unknown, context: RpcContext) => unknown | Promise<unknown>;
export interface RpcContext { signal?: AbortSignal; headers?: Record<string, string | string[] | undefined> }
export class RpcFault extends Error { constructor(public readonly code: number, message: string, public readonly data?: unknown) { super(message); } }
const invalid = (id: RpcId, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
const isRecord = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
export class JsonRpcRouter {
  private readonly handlers = new Map<string, RpcMethod>();
  constructor(methods?: Record<string, RpcMethod>) { if (methods) for (const [name, handler] of Object.entries(methods)) this.register(name, handler); }
  register(name: string, handler: RpcMethod): () => void {
    if (!/^[a-zA-Z][a-zA-Z\d_.:/-]{0,127}$/.test(name) || name.startsWith('rpc.') || typeof handler !== 'function') throw new TypeError('Invalid RPC method');
    if (this.handlers.has(name)) throw new Error(`Duplicate RPC method: ${name}`);
    this.handlers.set(name, handler);
    return () => { if (this.handlers.get(name) === handler) this.handlers.delete(name); };
  }
  methods(): string[] { return [...this.handlers.keys()]; }
  async dispatch(input: unknown, context: RpcContext = {}): Promise<RpcResponse | RpcResponse[] | null> {
    if (Array.isArray(input)) {
      if (!input.length) return invalid(null, -32600, 'Invalid Request');
      if (input.length > 64) return invalid(null, -32600, 'Batch too large');
      const output = await Promise.all(input.map(item => this.one(item, context)));
      const responses = output.filter((value): value is RpcResponse => value !== null);
      return responses.length ? responses : null;
    }
    return this.one(input, context);
  }
  private async one(input: unknown, context: RpcContext): Promise<RpcResponse | null> {
    if (!isRecord(input) || input.jsonrpc !== '2.0' || typeof input.method !== 'string' ||
      (input.params !== undefined && !isRecord(input.params) && !Array.isArray(input.params)) ||
      (input.id !== undefined && input.id !== null && typeof input.id !== 'string' && (typeof input.id !== 'number' || !Number.isFinite(input.id)))) return invalid(null, -32600, 'Invalid Request');
    const id = input.id as RpcId | undefined;
    const handler = this.handlers.get(input.method);
    if (id === undefined) { if (handler) { try { await handler(input.params, context); } catch { /* notifications never receive a reply */ } } return null; }
    if (!handler) return invalid(id, -32601, 'Method not found');
    try { return { jsonrpc: '2.0', id, result: await handler(input.params, context) ?? null }; }
    catch (err) {
      if (err instanceof RpcFault) return { jsonrpc: '2.0', id, error: { code: err.code, message: err.message, ...(err.data === undefined ? {} : { data: err.data }) } };
      return invalid(id, -32603, 'Internal error'); // Never leak handler internals over the network.
    }
  }
}
export function createJsonRpcRouter(methods?: Record<string, RpcMethod>) { return new JsonRpcRouter(methods); }
