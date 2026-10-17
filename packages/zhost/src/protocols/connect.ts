import type { RpcContext } from './json-rpc.js';
/** Connect Protocol unary JSON subset; streaming/protobuf requires a dedicated protocol adapter. */
export type ConnectMethod = (message: unknown, context: RpcContext) => unknown | Promise<unknown>;
export class ConnectRouter {
  private readonly handlers = new Map<string, ConnectMethod>();
  register(service: string, method: string, handler: ConnectMethod): () => void {
    if (!/^[A-Za-z][\w.]{0,127}$/.test(service) || !/^[A-Za-z][\w]{0,63}$/.test(method) || typeof handler !== 'function') throw new TypeError('Invalid Connect procedure');
    const path = `/${service}/${method}`;
    if (this.handlers.has(path)) throw new Error('Connect procedure already registered');
    this.handlers.set(path, handler);
    return () => { if (this.handlers.get(path) === handler) this.handlers.delete(path); };
  }
  has(path: string): boolean { return this.handlers.has(path); }
  async call(path: string, input: unknown, context: RpcContext = {}): Promise<unknown> {
    const handler = this.handlers.get(path);
    if (!handler) throw new Error('Unknown Connect procedure');
    return handler(input, context);
  }
}
export function createConnectRouter() { return new ConnectRouter(); }
/** Lightweight tRPC-style JSON procedure bridge; not a replacement for @trpc/server. */
export class TrpcRouter {
  private handlers = new Map<string, ConnectMethod>();
  register(name: string, handler: ConnectMethod): () => void {
    if (!/^[A-Za-z][\w.]{0,127}$/.test(name) || typeof handler !== 'function') throw new TypeError('Invalid tRPC procedure');
    if (this.handlers.has(name)) throw new Error('Duplicate tRPC procedure');
    this.handlers.set(name, handler);
    return () => { if (this.handlers.get(name) === handler) this.handlers.delete(name); };
  }
  has(name: string): boolean { return this.handlers.has(name); }
  async call(name: string, input: unknown, context: RpcContext = {}): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error('Unknown procedure');
    return handler(input, context);
  }
}
export function createTrpcRouter() { return new TrpcRouter(); }
