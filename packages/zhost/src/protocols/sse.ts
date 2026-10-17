import type { ServerResponse } from 'node:http';
export interface SseEvent { id: string; event: string; data: string; }
export interface SseOptions { maxClients?: number; historySize?: number; heartbeatMs?: number; }
function lineSafe(text: string): string { return text.replace(/[\r\0]/g, ''); }
export function formatSse(event: SseEvent): string {
  if (!/^[\w.-]{1,64}$/.test(event.event) || !/^\d{1,20}$/.test(event.id)) throw new TypeError('Invalid SSE event');
  return `id: ${event.id}\nevent: ${event.event}\n${lineSafe(event.data).split('\n').map(line => `data: ${line}\n`).join('')}\n`;
}
/** Bounded event stream with Last-Event-ID replay and cleanup on disconnect. */
export class SseHub {
  private nextId = 0;
  private readonly clients = new Set<ServerResponse>();
  private readonly history: SseEvent[] = [];
  private readonly maxClients: number;
  private readonly historySize: number;
  private readonly heartbeatMs: number;
  constructor(options: SseOptions = {}) {
    this.maxClients = options.maxClients ?? 100;
    this.historySize = options.historySize ?? 100;
    this.heartbeatMs = options.heartbeatMs ?? 15000;
    if (![this.maxClients, this.historySize, this.heartbeatMs].every(Number.isSafeInteger) || this.maxClients < 1 || this.maxClients > 10000 || this.historySize < 0 || this.historySize > 1000 || this.heartbeatMs < 1000 || this.heartbeatMs > 120000) throw new RangeError('Invalid SSE options');
  }
  get clientCount(): number { return this.clients.size; }
  subscribe(res: ServerResponse, lastEventId?: string): boolean {
    if (this.clients.size >= this.maxClients) { res.writeHead(503); res.end('SSE client limit reached'); return false; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    if (lastEventId && /^\d{1,20}$/.test(lastEventId)) {
      const id = Number(lastEventId);
      for (const event of this.history) if (Number(event.id) > id && !res.write(formatSse(event))) break;
    }
    this.clients.add(res);
    const timer = setInterval(() => { if (!res.destroyed && !res.write(': heartbeat\n\n')) res.end(); }, this.heartbeatMs);
    timer.unref?.();
    const cleanup = () => { clearInterval(timer); this.clients.delete(res); };
    res.once('close', cleanup);
    res.once('error', cleanup);
    return true;
  }
  publish(event: string, value: unknown): SseEvent {
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof data !== 'string' || Buffer.byteLength(data) > 64 * 1024) throw new RangeError('SSE event too large');
    const item = { id: String(++this.nextId), event, data };
    const formatted = formatSse(item);
    if (this.historySize) { this.history.push(item); if (this.history.length > this.historySize) this.history.shift(); }
    for (const client of this.clients) if (!client.write(formatted)) client.end();
    return item;
  }
  close(): void { for (const client of this.clients) client.end(); this.clients.clear(); }
}
export function createSseHub(options?: SseOptions) { return new SseHub(options); }
