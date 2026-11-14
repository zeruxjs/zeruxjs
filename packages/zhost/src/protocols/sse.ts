import type { ServerResponse } from 'node:http';
export interface SseEvent {
  /** Numeric stream-local event identifier; not a durable delivery ID. */
  id: string;
  /** Bounded event name containing only supported framing-safe characters. */
  event: string;
  /** Inert string data; readers must not treat it as trusted HTML. */
  data: string;
}
export interface SseOptions {
  /** Maximum live subscriptions, 1–10000; defaults to 100. */
  maxClients?: number;
  /** Volatile replay events retained, 0–1000; defaults to 100. */
  historySize?: number;
  /** Per-client heartbeat interval, 1000–120000 ms; defaults to 15000. */
  heartbeatMs?: number;
  /** Authenticated event streams must not enter shared/private HTTP caches. */ privateCache?: boolean;
}
/** Remove carriage returns and NUL bytes before splitting inert SSE data into protocol lines.
 * @param {string} text - Already serialized event data.
 * @returns {string} Data text with carriage returns and NULs removed; not HTML sanitization.
 */
function lineSafe(text: string): string {
  return text.replace(/[\r\0]/g, '');
}
/** Validate event-name/ID framing and prefix every data line, without rendering data as HTML or executable code.
 * @param {SseEvent} event - Explicit event ID, name and string data.
 * @returns {string} Complete SSE event block ending with a blank line.
 */
export function formatSse(event: SseEvent): string {
  if (!/^[\w.-]{1,64}$/.test(event.event) || !/^\d{1,20}$/.test(event.id)) {
    throw new TypeError('Invalid SSE event');
  }
  return `id: ${event.id}\nevent: ${event.event}\n${lineSafe(event.data)
    .split('\n')
    .map((line) => `data: ${line}\n`)
    .join('')}\n`;
}
/** Bounded event stream with Last-Event-ID replay and cleanup on disconnect. */
export class SseHub {
  /** Monotonic process-local event counter; not persisted across hub recreation. */
  private nextId = 0;
  /** Fences new subscriptions and publications after teardown. */
  private closed = false;
  /** Per-response release callbacks, removed on terminal events or close. */
  private readonly cleanups = new Map<ServerResponse, () => void>();
  /** Responses whose stream lifetime is currently owned by this hub. */
  private readonly clients = new Set<ServerResponse>();
  /** Bounded volatile replay copies, cleared during hub close. */
  private readonly history: SseEvent[] = [];
  /** Validated simultaneous subscription ceiling. */
  private readonly maxClients: number;
  /** Validated maximum replay count; zero disables history. */
  private readonly historySize: number;
  /** Validated heartbeat interval in milliseconds. */
  private readonly heartbeatMs: number;
  /** Explicit authenticated stream cache classification chosen by the host. */
  private readonly privateCache: boolean;
  /** Validate per-hub client/history/heartbeat limits without starting a timer until a client subscribes.
   * @param {SseOptions} options - Explicit stream limits and optional authenticated private/no-store cache policy.
   */
  constructor(options: SseOptions = {}) {
    this.maxClients = options.maxClients ?? 100;
    this.historySize = options.historySize ?? 100;
    this.heartbeatMs = options.heartbeatMs ?? 15000;
    if (
      options.privateCache !== undefined &&
      typeof options.privateCache !== 'boolean'
    ) {
      throw new TypeError('Invalid SSE cache policy');
    }
    this.privateCache = options.privateCache ?? false;
    if (
      ![this.maxClients, this.historySize, this.heartbeatMs].every(
        Number.isSafeInteger
      ) ||
      this.maxClients < 1 ||
      this.maxClients > 10000 ||
      this.historySize < 0 ||
      this.historySize > 1000 ||
      this.heartbeatMs < 1000 ||
      this.heartbeatMs > 120000
    ) {
      throw new RangeError('Invalid SSE options');
    }
  }
  /**
   * Count subscriptions that still belong to this hub.
   * @returns {number} Current client count, without exposing response handles.
   */
  get clientCount(): number {
    return this.clients.size;
  }
  /** Own one response subscription and heartbeat until finish, close, error or hub teardown; authorization must precede this call.
   * @param {ServerResponse} res - Borrowed uncommitted response whose event-stream lifetime is delegated to this hub.
   * @param {string} lastEventId - Optional numeric cursor for best-effort replay from bounded in-memory history.
   * @returns {boolean} True after subscribing; false after ending an over-capacity or closed-hub request with 503.
   */
  subscribe(res: ServerResponse, lastEventId?: string): boolean {
    if (this.closed || this.clients.size >= this.maxClients) {
      res.writeHead(503);
      res.end('SSE client limit reached');
      return false;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': this.privateCache
        ? 'private, no-store, no-transform'
        : 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    if (lastEventId && /^\d{1,20}$/.test(lastEventId)) {
      /** Numeric replay cursor used only against retained volatile stream IDs. */
      const id = Number(lastEventId);
      for (const event of this.history) {
        if (Number(event.id) > id && !res.write(formatSse(event))) {
          break;
        }
      }
    }
    this.clients.add(res);
    /** Owned per-client unreferenced heartbeat, cleared by terminal cleanup or hub close. */
    const timer = setInterval(() => {
      if (!res.destroyed && !res.write(': heartbeat\n\n')) {
        res.end();
      }
    }, this.heartbeatMs);
    timer.unref?.();
    /** Release only this subscription’s timer, set membership and response listeners.
     * @returns {void} Safe to call repeatedly from overlapping terminal events.
     */
    const cleanup = () => {
      clearInterval(timer);
      this.clients.delete(res);
      this.cleanups.delete(res);
      res.off('close', cleanup);
      res.off('finish', cleanup);
      res.off('error', cleanup);
    };
    this.cleanups.set(res, cleanup);
    res.once('finish', cleanup);
    res.once('close', cleanup);
    res.once('error', cleanup);
    return true;
  }
  /** Serialize and bound one event, retain optional replay history and end slow clients rather than growing an unbounded write queue.
   * @param {string} event - Validated event name passed to the shared framing encoder.
   * @param {unknown} value - Inert string or JSON-serializable application value, bounded to 64 KiB of data.
   * @returns {SseEvent} Detached event receipt; publication is neither durable nor an acknowledgement of client processing.
   */
  publish(event: string, value: unknown): SseEvent {
    if (this.closed) {
      throw new Error('SSE hub closed');
    }
    /** Serialized string checked against the event byte ceiling before framing. */
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof data !== 'string' || Buffer.byteLength(data) > 64 * 1024) {
      throw new RangeError('SSE event too large');
    }
    /** Detached event receipt copied before retaining bounded replay history. */
    const item = { id: String(++this.nextId), event, data };
    /** Validated framed bytes written to each current client without retaining another queue. */
    const formatted = formatSse(item);
    if (this.historySize) {
      this.history.push({ ...item });
      if (this.history.length > this.historySize) {
        this.history.shift();
      }
    }
    for (const client of this.clients) {
      if (!client.write(formatted)) {
        client.end();
      }
    }
    return item;
  }
  /** Fence publishing/subscription, release owned timers/listeners, end client responses and clear replay history.
   * @returns {void} Idempotent synchronous cleanup; native response/socket close may settle afterward.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const client of [...this.clients]) {
      this.cleanups.get(client)?.();
      client.end();
    }
    this.history.length = 0;
  }
}
/** Create an isolated event-stream owner; subscribing acquires resources that require hub close during teardown.
 * @param {SseOptions} options - Optional explicit limits and private-cache classification.
 * @returns {SseHub} Owned hub with bounded volatile replay; no server is started.
 */
export function createSseHub(options?: SseOptions) {
  return new SseHub(options);
}
