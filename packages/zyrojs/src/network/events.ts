/** Abortable fetch-based SSE reader supporting authorization headers and Last-Event-ID. */
export interface EventStreamOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  lastEventId?: string;
  maxEventBytes?: number;
  credentials?: RequestCredentials;
}
export interface ServerEvent { id?: string; event: string; data: string; retry?: number; }
export async function* readEventStream(url: string, options: EventStreamOptions = {}): AsyncGenerator<ServerEvent> {
  const limit = options.maxEventBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4 * 1024 * 1024) throw new RangeError('Invalid SSE event limit');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'text/event-stream');
  if (options.lastEventId) {
    if (/[\r\n\0]/.test(options.lastEventId)) throw new TypeError('Invalid event cursor');
    headers.set('Last-Event-ID', options.lastEventId);
  }
  const response = await (options.fetch ?? fetch)(url, { headers, signal: options.signal, credentials: options.credentials, cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`SSE connection failed: HTTP ${response.status}`);
  if (!/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new TypeError('Expected SSE content type');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let data: string[] = []; let eventBytes = 0; let event = 'message'; let id: string | undefined; let retry: number | undefined;
  const parseLine = (line: string): ServerEvent | undefined => {
    if (!line) {
      if (!data.length) { event = 'message'; return undefined; }
      const result = { event, data: data.join('\n'), ...(id === undefined ? {} : { id }), ...(retry === undefined ? {} : { retry }) };
      data = []; eventBytes = 0; event = 'message'; retry = undefined;
      return result;
    }
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') { eventBytes += new TextEncoder().encode(value).byteLength + 1; if (eventBytes > limit) throw new RangeError('SSE event exceeds limit'); data.push(value); }
    else if (field === 'event' && value) event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Math.min(120000, Number(value));
    return undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (new TextEncoder().encode(buffer).length > limit) throw new RangeError('SSE event exceeds limit');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        const parsed = parseLine(line);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer) parseLine(buffer);
    const last = parseLine(''); if (last) yield last;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
