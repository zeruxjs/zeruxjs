/** Abortable fetch-based SSE reader supporting authorization headers and Last-Event-ID. */
export interface EventStreamOptions {
  /** Additional request headers. */
  headers?: HeadersInit;
  /** Signal that cancels the caller's stream wait. */
  signal?: AbortSignal;
  /** Fetch implementation owned by the host or global runtime. */
  fetch?: typeof fetch;
  /** Last-Event-ID cursor sent to the server. */
  lastEventId?: string;
  /** Maximum decoded event size in bytes. */
  maxEventBytes?: number;
  /** Fetch credential mode for the stream request. */
  credentials?: RequestCredentials;
}
export interface ServerEvent {
  /** Optional server-assigned event identifier. */
  id?: string;
  /** Event type, defaulting to the SSE message type when absent. */
  event: string;
  /** Event payload assembled from data lines. */
  data: string;
  /** Optional reconnection delay requested by the server. */
  retry?: number;
}
/**
 * Lazily read bounded SSE text; iterator return cancels and releases the acquired reader.
 * @param {string} url - Explicit endpoint; Fetch/network destination authorization is host policy.
 * @param {EventStreamOptions} options - Borrowed Fetch/signal plus headers, credentials, cursor and per-event budget.
 * @returns {AsyncGenerator<ServerEvent>} Inert text events; caller validates payload schemas and handles reconnection.
 */
export async function* readEventStream(
  url: string,
  options: EventStreamOptions = {}
): AsyncGenerator<ServerEvent> {
  /** Finite UTF-8 event/buffer budget checked while consuming fragmented chunks. */
  const limit = options.maxEventBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4 * 1024 * 1024) {
    throw new RangeError('Invalid SSE event limit');
  }
  /** Fresh per-request headers; caller input is never mutated. */
  const headers = new Headers(options.headers);
  headers.set('Accept', 'text/event-stream');
  if (options.lastEventId) {
    if (/[\r\n\0]/.test(options.lastEventId)) {
      throw new TypeError('Invalid event cursor');
    }
    headers.set('Last-Event-ID', options.lastEventId);
  }
  /** Borrowed transport result; reader ownership begins only after status/type validation. */
  const response = await (options.fetch ?? fetch)(url, {
    headers,
    signal: options.signal,
    credentials: options.credentials,
    cache: 'no-store',
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: HTTP ${response.status}`);
  }
  if (
    !/^text\/event-stream(?:;|$)/i.test(
      response.headers.get('content-type') ?? ''
    )
  ) {
    throw new TypeError('Expected SSE content type');
  }
  /** Single stream reader, cancelled and released on completion, failure or iterator return. */
  const reader = response.body.getReader();
  /** Incremental UTF-8 decoder retains incomplete code points between transport chunks. */
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let eventBytes = 0;
  let event = 'message';
  let id: string | undefined;
  let retry: number | undefined;
  /**
   * Update SSE framing state and emit only when a complete data block ends.
   * @param {string} line - One decoded line without its transport newline.
   * @returns {ServerEvent | undefined} Completed data event at its boundary, otherwise undefined.
   */
  const parseLine = (line: string): ServerEvent | undefined => {
    if (!line) {
      if (!data.length) {
        event = 'message';
        return undefined;
      }
      /** Detached event assembled at a blank-line boundary; cursor may persist across events. */
      const result = {
        event,
        data: data.join('\n'),
        ...(id === undefined ? {} : { id }),
        ...(retry === undefined ? {} : { retry }),
      };
      data = [];
      eventBytes = 0;
      event = 'message';
      retry = undefined;
      return result;
    }
    if (line.startsWith(':')) {
      return undefined;
    }
    /** First field delimiter; one optional leading value space is removed per SSE framing. */
    const colon = line.indexOf(':');
    /** SSE field name; unsupported fields/comments do not execute or alter application code. */
    const field = colon < 0 ? line : line.slice(0, colon);
    /** Decoded field data; event payload remains inert text for the caller to validate. */
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') {
      eventBytes += new TextEncoder().encode(value).byteLength + 1;
      if (eventBytes > limit) {
        throw new RangeError('SSE event exceeds limit');
      }
      data.push(value);
    } else if (field === 'event' && value) {
      event = value;
    } else if (field === 'id' && !value.includes('\0')) {
      id = value;
    } else if (field === 'retry' && /^\d+$/.test(value)) {
      retry = Math.min(120000, Number(value));
    }
    return undefined;
  };
  try {
    while (true) {
      /** One borrowed stream chunk; parser state survives arbitrary network fragmentation. */
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (new TextEncoder().encode(buffer).length > limit) {
        throw new RangeError('SSE event exceeds limit');
      }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        /** Complete logical line with an optional CR removed from CRLF framing. */
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        /** Only a completed data event is yielded; comments/metadata lines remain parser state. */
        const parsed = parseLine(line);
        if (parsed) {
          yield parsed;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      parseLine(buffer);
    }
    /** Flush the final accumulated event after decoder completion. */
    const last = parseLine('');
    if (last) {
      yield last;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
