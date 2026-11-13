/** Connect JSON framing (5-byte envelopes) with bounded incremental decoding. */
import {
  ProtocolClientError,
  type ProtocolClientOptions,
  type CallOptions,
} from './client.js';
/**
 * connectJsonStream.
 * @param {string} service - Input value for this operation.
 * @param {string} method - Input value for this operation.
 * @param {AsyncIterable<unknown> | Iterable<unknown>} input - Input value for this operation.
 * @param {ProtocolClientOptions &
    CallOptions & { maxMessageBytes?: number }} options - Input value for this operation.
 * @returns {AsyncGenerator<T>} Result produced by this operation.
 */
export async function* connectJsonStream<T = unknown>(
  service: string,
  method: string,
  input: AsyncIterable<unknown> | Iterable<unknown>,
  options: ProtocolClientOptions &
    CallOptions & { maxMessageBytes?: number } = {}
): AsyncGenerator<T> {
  if (
    !/^[A-Za-z][\w.]{0,127}$/.test(service) ||
    !/^[A-Za-z]\w{0,63}$/.test(method)
  ) {
    throw new TypeError('Invalid Connect service or method');
  }
  /** Stores the max value used by this module. */
  const max = options.maxMessageBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 1 || max > 16 * 1024 * 1024) {
    throw new RangeError('Invalid Connect stream limit');
  }
  /** Stores the base value used by this module. */
  const base =
    options.baseUrl ??
    (typeof location !== 'undefined' ? location.origin : 'http://localhost');
  /** Stores the url value used by this module. */
  const url = new URL(`/${service}/${method}`, base);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Unsupported Connect URL');
  }
  /** Stores the headers value used by this module. */
  const headers = new Headers(
    typeof options.headers === 'function'
      ? await options.headers()
      : options.headers
  );
  headers.set('Accept', 'application/connect+json');
  headers.set('Content-Type', 'application/connect+json');
  /** Stores the encoder value used by this module. */
  const encoder = new TextEncoder();
  /**
   * requestBody.
   * @returns {unknown} Result produced by this operation.
   */
  async function* requestBody() {
    for await (const value of input) {
      /** Stores the body value used by this module. */
      const body = encoder.encode(JSON.stringify(value));
      if (body.length > max) {
        throw new RangeError('Connect request message too large');
      }
      /** Stores the frame value used by this module. */
      const frame = new Uint8Array(body.length + 5);
      /** Stores the view value used by this module. */
      const view = new DataView(frame.buffer);
      view.setUint32(1, body.length);
      frame.set(body, 5);
      yield frame;
    }
  }
  // Browser streaming upload requires duplex: 'half', currently a Fetch extension.
  /** Stores the response value used by this module. */
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({
      /**
       * start.
       * @param {unknown} controller - Input value for this operation.
       * @returns {unknown} Result produced by this operation.
       */
      async start(controller) {
        try {
          for await (const frame of requestBody()) {
            if (options.signal?.aborted) {
              break;
            }
            controller.enqueue(frame);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    }),
    duplex: 'half',
    signal: options.signal,
    credentials: options.credentials,
    cache: 'no-store',
  } as RequestInit & { duplex: 'half' });
  if (!response.ok || !response.body) {
    throw new ProtocolClientError(
      `Connect stream HTTP ${response.status}`,
      response.status
    );
  }
  if (
    !/^application\/connect\+json(?:;|$)/i.test(
      response.headers.get('content-type') ?? ''
    )
  ) {
    throw new ProtocolClientError(
      'Invalid Connect response content type',
      response.status
    );
  }
  /** Stores the reader value used by this module. */
  const reader = response.body.getReader();
  let frame = new Uint8Array(5);
  let received = 0;
  let expected = 5;
  let total = 0;
  try {
    while (true) {
      /** Stores the { value, done } value used by this module. */
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      let offset = 0;
      while (offset < value.length) {
        /** Stores the amount value used by this module. */
        const amount = Math.min(expected - received, value.length - offset);
        frame.set(value.subarray(offset, offset + amount), received);
        received += amount;
        offset += amount;
        if (received !== expected) {
          continue;
        }
        if (expected === 5) {
          /** Stores the length value used by this module. */
          const length = new DataView(frame.buffer).getUint32(1);
          if (length > max) {
            throw new RangeError('Connect response message too large');
          }
          expected = 5 + length;
          if (length > 0) {
            /** Stores the full value used by this module. */
            const full = new Uint8Array(expected);
            full.set(frame);
            frame = full;
            continue;
          }
        }
        // The frame always has a five-byte header; the fallback satisfies strict indexing.
        /** Stores the flags value used by this module. */
        const flags = frame[0] ?? 0;
        /** Stores the payload value used by this module. */
        const payload = new TextDecoder('utf-8', { fatal: true }).decode(
          frame.subarray(5, expected)
        );
        frame = new Uint8Array(5);
        received = 0;
        expected = 5;
        total++;
        if (total > 100000) {
          throw new RangeError('Connect stream message limit exceeded');
        }
        if ((flags & 0x80) !== 0) {
          /** Stores the trailer value used by this module. */
          const trailer = JSON.parse(payload) as {
            error?: { code?: string; message?: string };
          };
          if (trailer.error) {
            throw new ProtocolClientError(
              trailer.error.message ?? 'Connect stream error',
              200,
              trailer.error.code
            );
          }
          return;
        }
        if (flags !== 0) {
          throw new ProtocolClientError('Unsupported Connect frame flags', 502);
        }
        yield JSON.parse(payload) as T;
      }
    }
    if (received) {
      throw new ProtocolClientError('Incomplete Connect frame', 502);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
