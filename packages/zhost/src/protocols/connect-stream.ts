/** Bounded Connect stream framing (JSON). This is a Connect subset, not gRPC transcoding. */
import type { RpcContext } from './json-rpc.js';
export interface ConnectStreamOptions {
  /** Per-envelope body ceiling; default 1 MiB, maximum 16 MiB. */
  maxMessageBytes?: number;
  /** Maximum yielded data messages; default 256, maximum 10000. */
  maxMessages?: number;
  /** Total input bytes including framing; default 16 MiB, maximum 64 MiB. */
  maxTotalBytes?: number;
  /** Cooperative cancellation checked between chunks/frames; cannot interrupt a borrowed iterator stuck in next(). */
  signal?: AbortSignal;
}
/** Default JSON envelope body ceiling shared by encoding and decoding. */
const DEFAULT_MAX_MESSAGE = 1024 * 1024;
/** Default maximum decoded data-message count. */
const DEFAULT_MAX_COUNT = 256;
/** Encode one bounded JSON Connect-subset envelope; unsupported JSON values reject through serialization.
 * @param {unknown} message - Inert JSON-serializable message; never evaluated or executed.
 * @param {boolean} end - Whether to emit the end-stream flag instead of a data-message flag.
 * @returns {Buffer} Five-byte header plus UTF-8 JSON bytes; no compression or protobuf encoding.
 */
export function encodeConnectEnvelope(message: unknown, end = false): Buffer {
  /** Serialized UTF-8 JSON bytes checked before allocating the output frame. */
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > DEFAULT_MAX_MESSAGE) {
    throw new RangeError('Connect stream message too large');
  }
  /** Owned complete envelope buffer; every allocated byte is initialized before exposure. */
  const frame = Buffer.allocUnsafe(5 + body.length);
  frame[0] = end ? 2 : 0;
  frame.writeUInt32BE(body.length, 1);
  body.copy(frame, 5);
  return frame;
}
/** Decode fragmented bounded JSON envelopes without accumulating the whole request or executing message content.
 * @param {AsyncIterable<Uint8Array> | Iterable<Uint8Array>} source - Borrowed iterable of byte chunks; iterator cleanup follows for-await semantics.
 * @param {ConnectStreamOptions} options - Per-message, count and total byte budgets plus cooperative cancellation.
 * @returns {AsyncGenerator<unknown>} Parsed data messages; end envelopes stop accepting further bytes and are not yielded.
 */
export async function* readConnectEnvelopes(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: ConnectStreamOptions = {}
): AsyncGenerator<unknown> {
  /** Validated per-message body ceiling. */
  const max = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE;
  /** Validated maximum count of yielded data frames. */
  const countLimit = options.maxMessages ?? DEFAULT_MAX_COUNT;
  /** Validated total input byte ceiling, including headers and end frames. */
  const totalLimit = options.maxTotalBytes ?? 16 * 1024 * 1024;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(totalLimit) ||
    totalLimit < 1 ||
    totalLimit > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(countLimit) ||
    countLimit < 1 ||
    countLimit > 10_000
  ) {
    throw new RangeError('Invalid Connect frame limits');
  }
  /** Fixed five-byte staging header; byte zero is read only after all five bytes arrive. */
  const header = Buffer.alloc(5);
  let headerSize = 0,
    body: Buffer | undefined,
    bodySize = 0,
    flags = 0,
    count = 0,
    total = 0,
    ended = false;
  for await (const input of source) {
    options.signal?.throwIfAborted();
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('Invalid Connect chunk');
    }
    total += input.byteLength;
    if (total > totalLimit) {
      throw new RangeError('Connect request stream too large');
    }
    let offset = 0;
    while (offset < input.byteLength) {
      options.signal?.throwIfAborted();
      if (ended) {
        throw new Error('Data after end-stream');
      }
      if (!body) {
        /** Bytes available to copy into the current bounded header or body. */
        const size = Math.min(5 - headerSize, input.byteLength - offset);
        header.set(input.subarray(offset, offset + size), headerSize);
        headerSize += size;
        offset += size;
        if (headerSize < 5) {
          continue;
        }
        flags = header[0]!;
        /** Declared big-endian body length, bounded before allocation. */
        const length = header.readUInt32BE(1);
        if (flags !== 0 && flags !== 2) {
          throw new Error('Unsupported Connect flags');
        }
        if (length > max) {
          throw new RangeError('Connect frame too large');
        }
        body = Buffer.alloc(length);
        bodySize = 0;
      }
      /** Bytes available to copy into the current bounded header or body. */
      const size = Math.min(body.length - bodySize, input.byteLength - offset);
      body.set(input.subarray(offset, offset + size), bodySize);
      bodySize += size;
      offset += size;
      if (bodySize === body.length) {
        /** Owned complete envelope buffer; every allocated byte is initialized before exposure. */
        const frame = body;
        body = undefined;
        headerSize = 0;
        if (flags === 2) {
          ended = true;
          continue;
        }
        if (++count > countLimit) {
          throw new RangeError('Too many Connect messages');
        }
        let message: unknown;
        try {
          message = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(frame)
          );
        } catch {
          throw new Error('Invalid Connect JSON frame');
        }
        yield message;
      }
    }
  }
  if (headerSize || body) {
    throw new Error('Truncated Connect frame');
  }
}
export type ConnectStreamHandler = (
  messages: AsyncIterable<unknown>,
  context: RpcContext
) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
/** Inert per-application Connect JSON stream registry; transport and authorization stay host-owned. */
export class ConnectStreamRouter {
  /** Explicit trusted handlers, retained until their registration handles are released. */
  private readonly methods = new Map<string, ConnectStreamHandler>();
  /** Register explicitly trusted handler code without starting a transport or authorizing callers.
   * @param {string} service - Validated service identifier.
   * @param {string} method - Validated method identifier.
   * @param {ConnectStreamHandler} handler - Trusted application callback; the host must authorize its invocation.
   * @returns {() => void} Idempotent registration removal, fenced against replacing another handler.
   */
  register(
    service: string,
    method: string,
    handler: ConnectStreamHandler
  ): () => void {
    if (
      !/^[A-Za-z][\w.]{0,127}$/.test(service) ||
      !/^[A-Za-z]\w{0,63}$/.test(method) ||
      typeof handler !== 'function'
    ) {
      throw new TypeError('Invalid Connect stream route');
    }
    /** Exact validated service/method key used for explicit registration. */
    const path = `/${service}/${method}`;
    if (this.methods.has(path)) {
      throw new Error('Duplicate Connect stream route');
    }
    this.methods.set(path, handler);
    return () => {
      if (this.methods.get(path) === handler) {
        this.methods.delete(path);
      }
    };
  }
  /** Copy registered stream paths without exposing the mutable handler map.
   * @returns {string[]} Paths in registration order.
   */
  paths(): string[] {
    return [...this.methods.keys()];
  }
  /** Check exact registered path membership without invoking a handler.
   * @param {string} path - Exact service/method route path.
   * @returns {boolean} Whether this router currently has that path.
   */
  has(path: string): boolean {
    return this.methods.has(path);
  }
  /** Invoke one explicitly registered handler with host-authorized context and a bounded message source.
   * @param {string} path - Exact registered route; unknown paths reject.
   * @param {AsyncIterable<unknown>} messages - Inert parsed messages; consuming them remains the handler’s responsibility.
   * @param {RpcContext} context - Verified host request context; schemas do not replace authorization.
   * @returns {Promise<AsyncIterable<unknown>>} Borrowed handler output; the transport owns consumption, output limits and cancellation.
   */
  async call(
    path: string,
    messages: AsyncIterable<unknown>,
    context: RpcContext
  ): Promise<AsyncIterable<unknown>> {
    /** Trusted registered callback selected by exact path; no model/data-supplied code is loaded. */
    const handler = this.methods.get(path);
    if (!handler) {
      throw new Error('Unknown Connect stream route');
    }
    return handler(messages, context);
  }
}
/** Create an inert application-local registry without sockets, timers or global registrations.
 * @returns {ConnectStreamRouter} Router whose acquired registration handles should be released on module unload.
 */
export function createConnectStreamRouter() {
  return new ConnectStreamRouter();
}
