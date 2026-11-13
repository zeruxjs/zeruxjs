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
 * readEventStream.
 * @param {string} url - Input value for this operation.
 * @param {EventStreamOptions} options - Input value for this operation.
 * @returns {AsyncGenerator<ServerEvent>} Result produced by this operation.
 */
export async function* readEventStream(
  url: string,
  options: EventStreamOptions = {}
): AsyncGenerator<ServerEvent> {
  /** Stores the limit value used by this module. */
  const limit = options.maxEventBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4 * 1024 * 1024) {
    throw new RangeError('Invalid SSE event limit');
  }
  /** Stores the headers value used by this module. */
  const headers = new Headers(options.headers);
  headers.set('Accept', 'text/event-stream');
  if (options.lastEventId) {
    if (/[\r\n\0]/.test(options.lastEventId)) {
      throw new TypeError('Invalid event cursor');
    }
    headers.set('Last-Event-ID', options.lastEventId);
  }
  /** Stores the response value used by this module. */
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
  /** Stores the reader value used by this module. */
  const reader = response.body.getReader();
  /** Stores the decoder value used by this module. */
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let eventBytes = 0;
  let event = 'message';
  let id: string | undefined;
  let retry: number | undefined;
  /**
   * Application function parseLine.
   * @param {string} line - Input value for this operation.
   * @returns {ServerEvent | undefined} Result produced by this operation.
   */
  const parseLine = (line: string): ServerEvent | undefined => {
    if (!line) {
      if (!data.length) {
        event = 'message';
        return undefined;
      }
      /** Stores the result value used by this module. */
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
    /** Stores the colon value used by this module. */
    const colon = line.indexOf(':');
    /** Stores the field value used by this module. */
    const field = colon < 0 ? line : line.slice(0, colon);
    /** Stores the value value used by this module. */
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
      /** Stores the { value, done } value used by this module. */
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
        /** Stores the line value used by this module. */
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        /** Stores the parsed value used by this module. */
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
    /** Stores the last value used by this module. */
    const last = parseLine('');
    if (last) {
      yield last;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
