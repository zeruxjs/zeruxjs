import type { RpcContext } from './json-rpc.js';
/** Connect Protocol unary JSON subset; streaming/protobuf requires a dedicated protocol adapter. */
export type ConnectMethod = (
  message: unknown,
  context: RpcContext
) => unknown | Promise<unknown>;
/** Explicit unary JSON procedure registry; transport startup and authentication remain separate. */
export class ConnectRouter {
  /** Trusted callbacks retained until their registration disposers are invoked. */
  private readonly handlers = new Map<string, ConnectMethod>();
  /** Install explicitly trusted procedure code; the caller must separately authorize transport invocation.
   * @param {string} service - Validated Connect service name.
   * @param {string} method - Validated Connect method name.
   * @param {ConnectMethod} handler - Trusted callback receiving inert message data and host request context.
   * @returns {() => void} Idempotent registration removal fenced against another callback.
   */
  register(
    service: string,
    method: string,
    handler: ConnectMethod
  ): () => void {
    if (
      !/^[A-Za-z][\w.]{0,127}$/.test(service) ||
      !/^[A-Za-z][\w]{0,63}$/.test(method) ||
      typeof handler !== 'function'
    ) {
      throw new TypeError('Invalid Connect procedure');
    }
    /** Validated exact Connect route built only from explicit service and method names. */
    const path = `/${service}/${method}`;
    if (this.handlers.has(path)) {
      throw new Error('Connect procedure already registered');
    }
    this.handlers.set(path, handler);
    return () => {
      if (this.handlers.get(path) === handler) {
        this.handlers.delete(path);
      }
    };
  }
  /** Copy registered transport paths in insertion order without invoking handlers.
   * @returns {string[]} Detached Connect paths or /trpc-prefixed procedure paths.
   */
  paths(): string[] {
    return [...this.handlers.keys()];
  }
  /** Check the exact registry key without resolving code dynamically.
   * @param {string} path - Exact Connect service/method path.
   * @returns {boolean} Whether the key is explicitly registered.
   */
  has(path: string): boolean {
    return this.handlers.has(path);
  }
  /** Invoke one trusted registered procedure; input validation, authorization and runtime budgets remain host responsibilities.
   * @param {string} path - Exact Connect service/method path.
   * @param {unknown} input - Inert parsed data, never source code to evaluate.
   * @param {RpcContext} context - Host-authorized request metadata and cooperative cancellation signal.
   * @returns {Promise<unknown>} Handler result; unknown procedures and handler failures reject.
   */
  async call(
    path: string,
    input: unknown,
    context: RpcContext = {}
  ): Promise<unknown> {
    /** Trusted callback selected by exact registry membership; no user-supplied module loading occurs. */
    const handler = this.handlers.get(path);
    if (typeof handler !== 'function') {
      throw new Error('Unknown Connect procedure');
    }
    return handler(input, context);
  }
}
/** Create an inert application-local Connect unary JSON registry, without protobuf or native gRPC support.
 * @returns {ConnectRouter} Router whose dynamic registration disposers belong to the registering module.
 */
export function createConnectRouter() {
  return new ConnectRouter();
}
/** Lightweight tRPC-style JSON procedure bridge; not a replacement for @trpc/server. */
export class TrpcRouter {
  /** Explicit trusted callbacks; browser or request input never supplies executable handlers. */
  private handlers = new Map<string, ConnectMethod>();
  /** Install explicitly trusted procedure code; the caller must separately authorize transport invocation.
   * @param {string} name - Validated tRPC-style procedure name.
   * @param {ConnectMethod} handler - Trusted callback receiving inert message data and host request context.
   * @returns {() => void} Idempotent registration removal fenced against another callback.
   */
  register(name: string, handler: ConnectMethod): () => void {
    if (!/^[A-Za-z][\w.]{0,127}$/.test(name) || typeof handler !== 'function') {
      throw new TypeError('Invalid tRPC procedure');
    }
    if (this.handlers.has(name)) {
      throw new Error('Duplicate tRPC procedure');
    }
    this.handlers.set(name, handler);
    return () => {
      if (this.handlers.get(name) === handler) {
        this.handlers.delete(name);
      }
    };
  }
  /** Copy registered transport paths in insertion order without invoking handlers.
   * @returns {string[]} Detached Connect paths or /trpc-prefixed procedure paths.
   */
  paths(): string[] {
    return [...this.handlers.keys()].map((name) => `/trpc/${name}`);
  }
  /** Check the exact registry key without resolving code dynamically.
   * @param {string} name - Exact tRPC-style procedure name, without the /trpc/ prefix.
   * @returns {boolean} Whether the key is explicitly registered.
   */
  has(name: string): boolean {
    return this.handlers.has(name);
  }
  /** Invoke one trusted registered procedure; input validation, authorization and runtime budgets remain host responsibilities.
   * @param {string} name - Exact tRPC-style procedure name.
   * @param {unknown} input - Inert parsed data, never source code to evaluate.
   * @param {RpcContext} context - Host-authorized request metadata and cooperative cancellation signal.
   * @returns {Promise<unknown>} Handler result; unknown procedures and handler failures reject.
   */
  async call(
    name: string,
    input: unknown,
    context: RpcContext = {}
  ): Promise<unknown> {
    /** Trusted callback selected by exact registry membership; no user-supplied module loading occurs. */
    const handler = this.handlers.get(name);
    if (typeof handler !== 'function') {
      throw new Error('Unknown procedure');
    }
    return handler(input, context);
  }
}
/** Create an inert narrow tRPC-style JSON bridge; it does not load @trpc/server or claim its protocol parity.
 * @returns {TrpcRouter} Explicit registry without sockets or automatic code discovery.
 */
export function createTrpcRouter() {
  return new TrpcRouter();
}
