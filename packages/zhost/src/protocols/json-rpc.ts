/** JSON-RPC 2.0 dispatcher: batch/notification semantics and transport-independent handlers. */
export type RpcId = string | number | null;
export type RpcError = {
  /** Public protocol error code deliberately supplied by the host. */
  code: number;
  /** Public protocol error text; must not contain secrets. */
  message: string;
  /** Optional deliberately public error detail; unknown thrown errors are not copied here. */
  data?: unknown;
};
export type RpcResponse = {
  /** Fixed JSON-RPC protocol discriminator. */
  jsonrpc: '2.0';
  /** Request correlation identifier; undefined request IDs are notifications. */
  id: RpcId;
  /** Inert handler result serialized by the owning transport. */
  result?: unknown;
  /** Explicit protocol error instead of a successful result. */
  error?: RpcError;
};
export type RpcMethod = (
  params: unknown,
  context: RpcContext
) => unknown | Promise<unknown>;
export interface RpcContext {
  /** Borrowed cooperative cancellation signal; not forced JavaScript interruption. */
  signal?: AbortSignal;
  /** Optional host deadline metadata; the router itself does not schedule a deadline timer. */
  deadline?: number;
  /** Verified peer address supplied by the transport, not a user role or tenant claim. */
  remoteAddress?: string;
  /** Whether the host transport verified its direct proxy boundary. */
  trustedProxy?: boolean;
  /** Borrowed host-provided request metadata, never a substitute for fresh authorization. */
  headers?: Record<string, string | string[] | undefined>;
}
/** Explicitly public protocol fault; hosts must keep secrets out of its message and data. */
export class RpcFault extends Error {
  /**
   * Create a fault whose selected fields may be serialized to the caller.
   * @param {number} code - Public protocol error code.
   * @param {string} message - Safe public error message.
   * @param {unknown} data - Optional deliberately public structured detail.
   */
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
  }
}
/** Construct a protocol error without copying unknown private causes.
 * @param {RpcId} id - Correlation identifier.
 * @param {number} code - Public protocol error code.
 * @param {string} message - Safe public error text.
 * @returns {RpcResponse} JSON-RPC error response.
 */
const invalid = (id: RpcId, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});
/** Recognize a non-null non-array record before reading request fields.
 * @param {unknown} input - Untrusted parsed value.
 * @returns {boolean} Whether input has object-record shape; not semantic authorization.
 */
const isRecord = (input: unknown): input is Record<string, unknown> =>
  !!input && typeof input === 'object' && !Array.isArray(input);
/** Inert application-local registry with bounded handler admission; transport authentication remains separate. */
export class JsonRpcRouter {
  /** Handlers still awaiting actual settlement, including notifications. */
  private active = 0;
  /** Trusted methods retained until removed; registration is capped at 1024 entries. */
  private readonly handlers = new Map<string, RpcMethod>();
  /**
   * Register an optional trusted initial method map without invoking its callbacks.
   * @param {Record<string, RpcMethod> | undefined} methods - Initial application-owned callbacks.
   */
  constructor(methods?: Record<string, RpcMethod>) {
    if (methods) {
      for (const [name, handler] of Object.entries(methods)) {
        this.register(name, handler);
      }
    }
  }
  /** Register one explicitly trusted method within the bounded application-local map; registration does not authorize invocation.
   * @param {string} name - Validated method name; reserved rpc. names reject.
   * @param {RpcMethod} handler - Trusted callback receiving inert parameters and host request context.
   * @returns {() => void} Idempotent generation-fenced registration removal.
   */
  register(name: string, handler: RpcMethod): () => void {
    if (
      !/^[a-zA-Z][a-zA-Z\d_.:/-]{0,127}$/.test(name) ||
      name.startsWith('rpc.') ||
      typeof handler !== 'function'
    ) {
      throw new TypeError('Invalid RPC method');
    }
    if (this.handlers.has(name)) {
      throw new Error(`Duplicate RPC method: ${name}`);
    }
    if (this.handlers.size >= 1024) {
      throw new RangeError('RPC method limit');
    }
    this.handlers.set(name, handler);
    return () => {
      if (this.handlers.get(name) === handler) {
        this.handlers.delete(name);
      }
    };
  }
  /** Copy currently registered method names without exposing callbacks.
   * @returns {string[]} Names in registration order.
   */
  methods(): string[] {
    return [...this.handlers.keys()];
  }
  /** Validate one request or a batch of at most 64, executing batch items sequentially and omitting notification replies.
   * @param {unknown} input - Untrusted parsed JSON-RPC value; this method never evaluates source code.
   * @param {RpcContext} context - Host-authorized context; signal is checked before admission and handlers own cooperative cancellation.
   * @returns {Promise<RpcResponse | RpcResponse[] | null>} Response, nonempty response batch or null for notifications only.
   */
  async dispatch(
    input: unknown,
    context: RpcContext = {}
  ): Promise<RpcResponse | RpcResponse[] | null> {
    if (Array.isArray(input)) {
      if (!input.length) {
        return invalid(null, -32600, 'Invalid Request');
      }
      if (input.length > 64) {
        return invalid(null, -32600, 'Batch too large');
      }
      /** Ordered batch outcomes before notification responses are removed. */
      const output: (RpcResponse | null)[] = [];
      for (const item of input) {
        output.push(await this.one(item, context));
      }
      /** Only actual replies; an all-notification batch returns null. */
      const responses = output.filter(
        (value): value is RpcResponse => value !== null
      );
      return responses.length ? responses : null;
    }
    return this.one(input, context);
  }
  /** Validate and admit one request under the shared 32-handler ceiling, retaining capacity until actual handler settlement.
   * @param {unknown} input - One untrusted parsed request value.
   * @param {RpcContext} context - Borrowed authorized request context; deadline metadata is not enforced by this dispatcher.
   * @returns {Promise<RpcResponse | null>} Safe protocol response or null for a notification; unknown exceptions never expose private causes.
   */
  private async one(
    input: unknown,
    context: RpcContext
  ): Promise<RpcResponse | null> {
    if (
      !isRecord(input) ||
      input.jsonrpc !== '2.0' ||
      typeof input.method !== 'string' ||
      (input.params !== undefined &&
        !isRecord(input.params) &&
        !Array.isArray(input.params)) ||
      (input.id !== undefined &&
        input.id !== null &&
        typeof input.id !== 'string' &&
        (typeof input.id !== 'number' || !Number.isFinite(input.id)))
    ) {
      return invalid(null, -32600, 'Invalid Request');
    }
    /** Validated request identifier; absence marks a notification. */
    const id = input.id as RpcId | undefined;
    /** Explicitly registered trusted callback, selected only after envelope validation. */
    const handler = this.handlers.get(input.method);
    if (context.signal?.aborted || this.active >= 32) {
      return id === undefined
        ? null
        : invalid(id, -32000, 'Request unavailable');
    }
    if (id === undefined) {
      if (handler) {
        this.active++;
        try {
          await handler(input.params, context);
        } catch {
          /* notifications never receive a reply */
        } finally {
          this.active--;
        }
      }
      return null;
    }
    if (!handler) {
      return invalid(id, -32601, 'Method not found');
    }
    this.active++;
    try {
      return {
        jsonrpc: '2.0',
        id,
        result: (await handler(input.params, context)) ?? null,
      };
    } catch (err) {
      if (err instanceof RpcFault) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: err.code,
            message: err.message,
            ...(err.data === undefined ? {} : { data: err.data }),
          },
        };
      }
      return invalid(id, -32603, 'Internal error'); // Never leak handler internals over the network.
    } finally {
      this.active--;
    }
  }
}
/** Create an inert explicit method registry without sockets, timers or automatic handler discovery.
 * @param {Record<string, RpcMethod>} methods - Optional trusted initial method map registered through the same validation.
 * @returns {JsonRpcRouter} Application-local dispatcher; retain registration disposers when methods are installed dynamically.
 */
export function createJsonRpcRouter(methods?: Record<string, RpcMethod>) {
  return new JsonRpcRouter(methods);
}
