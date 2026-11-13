/** WebTransport session registration for a QUIC/HTTP3 terminator bridge.
 * Node.js HTTP/1/2 does NOT implement WebTransport natively. This adapter
 * deliberately requires a verified external transport to hand over sessions. */
export interface WebTransportSession {
  /** Verified external session route path. */
  readonly path: string;
  /** Optional peer address verified by the external transport host. */
  readonly remoteAddress?: string;
  /** Native external session settlement promise; request cancellation alone does not resolve it. */
  readonly closed: Promise<unknown>;
  /** Request closure from the host-supplied native/external session owner.
   * @param {number} code - Optional transport-specific close code.
   * @param {string} reason - Optional safe peer-visible close reason; never include secrets.
   * @returns {void} Native settlement is observed through closed, not inferred from this call.
   */
  close(code?: number, reason?: string): void;
  /** Transport-dependent WebTransport session (incoming streams/datagrams). */
  readonly transport: unknown;
}
export type WebTransportHandler = (
  session: WebTransportSession
) => Promise<void> | void;
/** Inert router over host-verified external sessions; it neither creates nor owns a QUIC transport. */
export class WebTransportRouter {
  /** Explicit trusted bridge callbacks released through registration disposers. */
  private readonly handlers = new Map<string, WebTransportHandler>();
  /** Register trusted bridge code for one validated path without implementing QUIC or starting a listener.
   * @param {string} path - Explicit bounded route path without repeated slashes.
   * @param {WebTransportHandler} handler - Trusted callback for already verified external sessions.
   * @returns {() => void} Idempotent generation-fenced registration removal.
   */
  register(path: string, handler: WebTransportHandler): () => void {
    if (
      typeof path !== 'string' ||
      !/^\/[A-Za-z0-9/_-]{0,255}$/.test(path) ||
      path.includes('//') ||
      typeof handler !== 'function'
    ) {
      throw new TypeError('Invalid WebTransport route');
    }
    if (this.handlers.has(path)) {
      throw new Error('WebTransport route already registered');
    }
    this.handlers.set(path, handler);
    return () => {
      if (this.handlers.get(path) === handler) {
        this.handlers.delete(path);
      }
    };
  }
  /** Check exact bridge registration membership without accepting a session.
   * @param {string} path - Validated transport route path.
   * @returns {boolean} Whether the route currently has a registered callback.
   */
  has(path: string): boolean {
    return this.handlers.has(path);
  }
  /** Dispatch an already host-verified external session; this registry performs no network authentication itself.
   * @param {WebTransportSession} session - Borrowed verified external transport session, with lifecycle ownership retained by its host.
   * @returns {Promise<boolean>} False for an unknown path; true after handler settlement. Handler failures reject.
   */
  async accept(session: WebTransportSession): Promise<boolean> {
    /** Explicit trusted handler selected by the verified external session path. */
    const handler = this.handlers.get(session.path);
    if (!handler) {
      return false;
    }
    await handler(session);
    return true;
  }
  /** Copy registered bridge paths without exposing executable callbacks.
   * @returns {string[]} Paths in registration order.
   */
  list(): string[] {
    return [...this.handlers.keys()];
  }
  /** Expose the same detached bridge path list for transport registration consumers.
   * @returns {string[]} Current explicit paths.
   */
  paths(): string[] {
    return this.list();
  }
}
/** Create an inert external-session bridge registry; Node HTTP/1 and HTTP/2 do not become native WebTransport.
 * @returns {WebTransportRouter} Explicit handler registry; registering modules retain disposer ownership.
 */
export function createWebTransportRouter() {
  return new WebTransportRouter();
}
