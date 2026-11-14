/** Connect JSON framing (5-byte envelopes) with bounded incremental decoding. */
import {
  ProtocolClientError,
  type ProtocolClientOptions,
  type CallOptions,
} from './client.js';
/**
 * Exchange bounded JSON frames; host signal owns cancellation and upload support depends on Fetch.
 * @param {string} service - Validated trusted service identifier.
 * @param {string} method - Validated trusted method identifier.
 * @param {AsyncIterable<unknown> | Iterable<unknown>} input - Trusted message iterable; asynchronous iteration itself is not forcibly cancellable.
 * @param {ProtocolClientOptions &
    CallOptions & { maxMessageBytes?: number }} options - Borrowed transport/signal, framing budget and headers; timeoutMs is not applied by this streaming helper.
 * @returns {AsyncGenerator<T>} Parsed messages; returning the iterator cancels/releases its response reader.
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
  /** Per-message byte ceiling; response message count has a separate hard bound. */
  const max = options.maxMessageBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 1 || max > 16 * 1024 * 1024) {
    throw new RangeError('Invalid Connect stream limit');
  }
  /** Trusted configured base or browser/standalone fallback. */
  const base =
    options.baseUrl ??
    (typeof location !== 'undefined' ? location.origin : 'http://localhost');
  /** Validated HTTP(S) service path; host egress authorization remains separate. */
  const url = new URL(`/${service}/${method}`, base);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Unsupported Connect URL');
  }
  /** Fresh negotiated framing headers; lazy credential providers are trusted application code. */
  const headers = new Headers(
    typeof options.headers === 'function'
      ? await options.headers()
      : options.headers
  );
  headers.set('Accept', 'application/connect+json');
  headers.set('Content-Type', 'application/connect+json');
  /** UTF-8 request encoder; every JSON message is bounded before framing. */
  const encoder = new TextEncoder();
  /**
   * Serialize one input message at a time into the supported five-byte envelope.
   * @returns {AsyncGenerator<Uint8Array>} Bounded framed request messages from the trusted input iterable.
   */
  async function* requestBody() {
    for await (const value of input) {
      /** One serialized message; arbitrary input iterables remain trusted host code. */
      const body = encoder.encode(JSON.stringify(value));
      if (body.length > max) {
        throw new RangeError('Connect request message too large');
      }
      /** Five-byte header plus one bounded payload, never an executable module. */
      const frame = new Uint8Array(body.length + 5);
      /** Network-order length writer for the frame header. */
      const view = new DataView(frame.buffer);
      view.setUint32(1, body.length);
      frame.set(body, 5);
      yield frame;
    }
  }
  // Browser streaming upload requires duplex: 'half', currently a Fetch extension.
  /** One streaming Fetch response; no automatic replay after emitted request bytes. */
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({
      /**
       * Feed the request stream explicitly; this implementation does not promise pull-based upload backpressure.
       * @param {unknown} controller - Native request-body stream controller owned by this call.
       * @returns {Promise<void>} Request stream feeding settlement; arbitrary input iteration is cooperative.
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
  /** Acquired response reader; generator finally cancels it and releases its lock. */
  const reader = response.body.getReader();
  let frame = new Uint8Array(5);
  let received = 0;
  let expected = 5;
  let total = 0;
  try {
    while (true) {
      /** Transport chunk may contain partial or multiple frames. */
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      let offset = 0;
      while (offset < value.length) {
        /** Copy only the remaining bytes for the current header/payload boundary. */
        const amount = Math.min(expected - received, value.length - offset);
        frame.set(value.subarray(offset, offset + amount), received);
        received += amount;
        offset += amount;
        if (received !== expected) {
          continue;
        }
        if (expected === 5) {
          /** Untrusted announced payload length checked before allocating a full frame. */
          const length = new DataView(frame.buffer).getUint32(1);
          if (length > max) {
            throw new RangeError('Connect response message too large');
          }
          expected = 5 + length;
          if (length > 0) {
            /** Bounded payload allocation after validating the network-order length. */
            const full = new Uint8Array(expected);
            full.set(frame);
            frame = full;
            continue;
          }
        }
        // The frame always has a five-byte header; the fallback satisfies strict indexing.
        /** Framing flags; unsupported compression/flag combinations reject. */
        const flags = frame[0] ?? 0;
        /** Fatal UTF-8 decoding rejects malformed wire text before JSON parsing. */
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
          /** Terminal error metadata; no arbitrary callbacks or code are executed. */
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
