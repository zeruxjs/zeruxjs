/** WebTransport session registration for a QUIC/HTTP3 terminator bridge.
 * Node.js HTTP/1/2 does NOT implement WebTransport natively. This adapter
 * deliberately requires a verified external transport to hand over sessions. */
export interface WebTransportSession {
  readonly path: string;
  readonly remoteAddress?: string;
  readonly closed: Promise<unknown>;
  close(code?: number, reason?: string): void;
  /** Transport-dependent WebTransport session (incoming streams/datagrams). */
  readonly transport: unknown;
}
export type WebTransportHandler = (session: WebTransportSession) => Promise<void> | void;
export class WebTransportRouter {
  private readonly handlers = new Map<string, WebTransportHandler>();
  register(path: string, handler: WebTransportHandler): () => void {
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_-]{0,255}$/.test(path) || path.includes('//') || typeof handler !== 'function') throw new TypeError('Invalid WebTransport route');
    if (this.handlers.has(path)) throw new Error('WebTransport route already registered');
    this.handlers.set(path, handler);
    return () => { if (this.handlers.get(path) === handler) this.handlers.delete(path); };
  }
  has(path: string): boolean { return this.handlers.has(path); }
  async accept(session: WebTransportSession): Promise<boolean> {
    const handler = this.handlers.get(session.path);
    if (!handler) return false;
    await handler(session);
    return true;
  }
  list(): string[] { return [...this.handlers.keys()]; }
  paths(): string[] { return this.list(); }
}
export function createWebTransportRouter() { return new WebTransportRouter(); }
