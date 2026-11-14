/** Response controls for ZeruxJS handlers. No global mutable response configuration. */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export interface ResponseCachePolicy {
  /** Defaults to private; public requires an explicit opt-in. */
  visibility?: 'public' | 'private' | 'no-store';
  /** Client freshness window in bounded integer seconds. */
  maxAge?: number;
  /** Shared-cache freshness seconds, honored only for explicit public policy. */
  sharedMaxAge?: number;
  /** HTTP stale allowance in seconds; not a server-side refresh scheduler. */
  staleWhileRevalidate?: number;
  /** Explicitly declare immutable representation semantics to HTTP caches. */
  immutable?: boolean;
  /** Require cache revalidation once freshness expires. */
  mustRevalidate?: boolean;
  /** Validated request-header dimensions merged case-insensitively with existing Vary. */
  vary?: string[];
  /** Generate a content-derived strong ETag for non-streaming bodies. */
  etag?: boolean;
}
export interface ResponseStreamOptions {
  /** Explicit stream status, default200. */
  status?: number;
  /** Trusted bounded end-to-end header projection; transport-owned fields reject. */
  headers?: Record<string, string>;
  /** Streaming responses are never implicitly cacheable. */
  contentType?: string;
  /** Optional total producer byte ceiling checked before each chunk is written. */
  maxBytes?: number;
}
/** Module-private discriminator for explicitly owned stream results. */
const streamMarker = Symbol('zerux.stream');
/** Module-private discriminator for explicit payload cache-policy wrappers. */
const cacheMarker = Symbol('zerux.cached');
export interface StreamResult {
  /** Internal brand distinguishing a stream from ordinary handler data. */
  readonly [streamMarker]: true;
  /** Explicit producer transferred to the sender for iteration/cleanup. */
  readonly source:
    | AsyncIterable<Uint8Array | string>
    | Iterable<Uint8Array | string>
    | Readable;
  /** Stream policy snapshot consumed by the sender. */
  readonly options: ResponseStreamOptions;
}
export interface CachedResult {
  /** Internal brand distinguishing a policy wrapper from ordinary payload data. */
  readonly [cacheMarker]: true;
  /** Original marked payload; wrapper visibility never proves it is public. */
  readonly value: unknown;
  /** Explicit host-selected HTTP cache policy. */
  readonly policy: ResponseCachePolicy;
}

/** Validate a bounded optional HTTP delta-seconds value without coercion.
 * @param {number | undefined} value - Optional safe integer seconds.
 * @param {string} field - Fixed diagnostic field label.
 * @returns {string | null} Serialized seconds or null for omission.
 */
function seconds(value: number | undefined, field: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 31_536_000) {
    throw new RangeError(`Invalid ${field}`);
  }
  return String(value);
}
/** Serialize explicit response cache directives without inferring personalized data is public.
 * @param {ResponseCachePolicy} policy - Host-owned visibility/freshness policy.
 * @returns {string} Validated Cache-Control value, default private.
 */
export function cacheControl(policy: ResponseCachePolicy = {}): string {
  /** Explicit response-cache visibility, default private rather than inferred public. */
  const visibility = policy.visibility ?? 'private';
  if (!['public', 'private', 'no-store'].includes(visibility)) {
    throw new TypeError('Invalid cache visibility');
  }
  if (visibility === 'no-store') {
    return 'no-store';
  }
  /** Validated Cache-Control directives in deterministic declaration order. */
  const values: string[] = [visibility];
  /** Optional bounded max-age seconds, serialized only after validation. */
  const maxAge = seconds(policy.maxAge, 'maxAge');
  /** Optional s-maxage seconds used only for explicit public responses. */
  const sharedMaxAge = seconds(policy.sharedMaxAge, 'sharedMaxAge');
  /** Optional HTTP stale-while-revalidate seconds; it does not start a server refresh job. */
  const stale = seconds(policy.staleWhileRevalidate, 'staleWhileRevalidate');
  if (maxAge !== null) {
    values.push(`max-age=${maxAge}`);
  }
  if (sharedMaxAge !== null && visibility === 'public') {
    values.push(`s-maxage=${sharedMaxAge}`);
  }
  if (stale !== null) {
    values.push(`stale-while-revalidate=${stale}`);
  }
  if (policy.immutable) {
    values.push('immutable');
  }
  if (policy.mustRevalidate) {
    values.push('must-revalidate');
  }
  return values.join(', ');
}
/** Apply cache directives before commitment while preserving existing Vary dimensions.
 * @param {ServerResponse} res - Borrowed native response; committed headers reject mutation.
 * @param {ResponseCachePolicy} policy - Explicit application cache policy after authorization.
 * @returns {void} Header mutation completion; no data cache is allocated.
 */
export function applyCachePolicy(
  res: ServerResponse,
  policy: ResponseCachePolicy
): void {
  if (res.headersSent) {
    throw new Error('Response headers already sent');
  }
  res.setHeader('Cache-Control', cacheControl(policy));
  if (policy.vary?.length) {
    /** Current Vary fields retained before adding validated case-insensitive unique dimensions. */
    const existing = String(res.getHeader('Vary') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const field of policy.vary) {
      if (!/^[a-z\d-]{1,64}$/i.test(field)) {
        throw new TypeError('Invalid Vary field');
      }
      if (!existing.some((x) => x.toLowerCase() === field.toLowerCase())) {
        existing.push(field);
      }
    }
    res.setHeader('Vary', existing.join(', '));
  }
}
/** Mark one payload with an explicit validated HTTP cache policy.
 * @param {unknown} value - Handler-owned payload; this wrapper does not authorize or anonymize it.
 * @param {ResponseCachePolicy} policy - Explicit response policy.
 * @returns {CachedResult} Marked payload consumed by the existing response path.
 */
export function cached(
  value: unknown,
  policy: ResponseCachePolicy
): CachedResult {
  cacheControl(policy);
  return { [cacheMarker]: true, value, policy };
}
/** Recognize the module-private cache wrapper discriminator.
 * @param {unknown} value - Unknown handler result.
 * @returns {boolean} Whether this module marked the result as cached.
 */
export function isCached(value: unknown): value is CachedResult {
  return !!value && typeof value === 'object' && cacheMarker in value;
}
/** Mark an explicit iterable producer and validate basic byte/status policy without pulling it.
 * @param {StreamResult['source']} source - Producer whose cleanup transfers to the response sender.
 * @param {ResponseStreamOptions} options - Explicit byte/status/content-type/header policy.
 * @returns {StreamResult} Marked producer result; the response owner must await sending and cleanup.
 */
export function stream(
  source: StreamResult['source'],
  options: ResponseStreamOptions = {}
): StreamResult {
  if (
    !source ||
    !(
      Symbol.asyncIterator in Object(source) ||
      Symbol.iterator in Object(source)
    )
  ) {
    throw new TypeError('Stream must be iterable');
  }
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
  ) {
    throw new RangeError('Invalid stream limit');
  }
  if (
    options.status !== undefined &&
    (!Number.isInteger(options.status) ||
      options.status < 200 ||
      options.status > 599)
  ) {
    throw new RangeError('Invalid stream status');
  }
  return { [streamMarker]: true, source, options };
}
/** Recognize the module-private stream result discriminator.
 * @param {unknown} value - Unknown handler result.
 * @returns {boolean} Whether this module marked the result as streaming.
 */
export function isStream(value: unknown): value is StreamResult {
  return !!value && typeof value === 'object' && streamMarker in value;
}

/** Compute an exact-byte strong validator and handle conditional GET/HEAD without changing authorization.
 * @param {IncomingMessage} req - Borrowed request containing conditional preferences.
 * @param {ServerResponse} res - Borrowed response receiving validator/status changes.
 * @param {Buffer} body - Exact selected representation bytes; encoding changes require a different validator owner.
 * @returns {boolean} True when a matching conditional request has completed as304.
 */
export function conditionalEtag(
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer
): boolean {
  /** Strong SHA-256 validator for these exact unencoded body bytes. */
  const tag = `"${createHash('sha256').update(body).digest('hex')}"`;
  res.setHeader('ETag', tag);
  /** Caller If-None-Match preference; it never grants authorization. */
  const incoming = req.headers['if-none-match'];
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  if (typeof incoming !== 'string') {
    return false;
  }
  if (
    incoming.trim() === '*' ||
    incoming.split(',').some((x) => x.trim().replace(/^W\//, '') === tag)
  ) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.end();
    return true;
  }
  return false;
}

/** Validate an entire trusted-adapter header bag, refusing transport/representation ownership overrides.
 * @param {Record<string, string>} headers - Bounded candidate string headers.
 * @returns {void} Validation completion; no response is mutated here.
 */
export function validateResponseHeaders(headers: Record<string, string>): void {
  if (
    !headers ||
    typeof headers !== 'object' ||
    Array.isArray(headers) ||
    Object.keys(headers).length > 64
  ) {
    throw new TypeError('Invalid response headers');
  }
  for (const [key, value] of Object.entries(headers)) {
    if (
      !/^[a-z\d-]{1,64}$/i.test(key) ||
      /^(?:connection|transfer-encoding|content-length|content-encoding)$/i.test(
        key
      ) ||
      typeof value !== 'string' ||
      value.length > 16384 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x1f\x7f]/.test(value)
    ) {
      throw new TypeError('Invalid response header');
    }
  }
}

/** Own backpressured stream sending and actual iterator cleanup; postcommit errors terminate rather than rewrite output.
 * @param {ServerResponse} res - Borrowed native response owning transport events.
 * @param {StreamResult} result - Explicit producer/options result.
 * @param {IncomingMessage} request - Optional native request for HEAD and upload-abort handling.
 * @returns {Promise<void>} Actual sending/cleanup settlement; arbitrary iterators must cooperate with cancellation.
 */
export async function sendStream(
  res: ServerResponse,
  result: StreamResult,
  request?: IncomingMessage
): Promise<void> {
  /** Borrowed producer transferred into this send operation for iterator cleanup. */
  const source = result.source;
  /** Per-send stream policy snapshot, including an independent header record. */
  const options = { ...result.options, headers: { ...result.options.headers } };
  /** Candidate async-iterable view used only to select the native iterator protocol. */
  const asyncSource = source as AsyncIterable<string | Uint8Array>;
  /** Owned producer iterator, returned once after success, cancellation or failure. */
  const iterator =
    typeof asyncSource[Symbol.asyncIterator] === 'function'
      ? asyncSource[Symbol.asyncIterator]()
      : (source as Iterable<string | Uint8Array>)[Symbol.iterator]();
  let returning: Promise<unknown> | undefined;
  /** Return the producer once and retain the same actual-settlement cleanup promise.
   * @returns {Promise<unknown>} Iterator cleanup completion.
   */
  const release = () =>
    (returning ??= Promise.resolve().then(() => iterator.return?.()));
  let wake: (() => void) | undefined, transportError: Error | undefined;
  /** Wake the current transport/backpressure waiter at most once.
   * @returns {void} Detaches the current wake callback.
   */
  const ready = () => {
    /** Current transport waiter captured before clearing its shared slot. */
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  /** Capture a native response failure and stop the owned producer.
   * @param {Error} error - Native transport cause.
   * @returns {void} Signals cleanup and wakes any backpressure wait.
   */
  const failed = (error: Error) => {
    transportError = error;
    close();
  };
  /** Destroy owned Readable work or return an arbitrary iterator cooperatively.
   * @returns {void} Requests cleanup without claiming forced JavaScript cancellation.
   */
  const close = () => {
    if (source instanceof Readable) {
      source.destroy();
    }
    void release().catch(() => {});
    ready();
  };
  res.once('close', close);
  request?.once('aborted', close);
  res.on('drain', ready);
  res.on('error', failed);
  let bytes = 0,
    workFailed = false,
    workError: unknown;
  /** Read and validate one producer chunk before adding it to the byte budget.
   * @returns {Promise<IteratorResult<Uint8Array>>} Completion or a validated byte chunk.
   */
  const next = async () => {
    /** Current producer result; no subsequent chunk is pulled while the socket is backpressured. */
    const item = await iterator.next();
    if (item.done) {
      return item;
    }
    if (typeof item.value !== 'string' && !(item.value instanceof Uint8Array)) {
      throw new TypeError('Invalid stream chunk');
    }
    /** Owned byte representation of one admitted string/Uint8Array chunk. */
    const value = Buffer.from(item.value);
    bytes += value.length;
    if (options.maxBytes !== undefined && bytes > options.maxBytes) {
      throw new RangeError('Stream response limit exceeded');
    }
    return { done: false as const, value };
  };
  try {
    if (res.headersSent || res.writableEnded || res.destroyed) {
      return;
    }
    // Validate the complete header bag before changing the response.
    /** Complete candidate header bag validated before any native header mutation. */
    const headers = { ...options.headers };
    validateResponseHeaders(result.options.headers ?? {});
    validateResponseHeaders(headers);
    if (
      options.contentType !== undefined &&
      (typeof options.contentType !== 'string' ||
        // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
        /[\x00-\x1f\x7f]/.test(options.contentType))
    ) {
      throw new TypeError('Invalid stream content type');
    }
    // HEAD never executes the producer, but still relinquishes ownership.
    let first =
      request?.method === 'HEAD'
        ? { done: true as const, value: undefined }
        : await next();
    while (!first.done && first.value.length === 0) {
      first = await next();
    }
    if (transportError) {
      throw transportError;
    }
    if (res.destroyed || request?.aborted) {
      return;
    }
    res.statusCode = options.status ?? 200;
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.setHeader('Cache-Control', 'no-store, no-transform');
    if (options.contentType) {
      res.setHeader('Content-Type', options.contentType);
    }
    if (options.contentType?.startsWith('text/event-stream')) {
      res.setHeader('X-Accel-Buffering', 'no');
    }
    if (first.done) {
      res.end();
      return;
    }
    // Write one chunk at a time; never pull another while the socket is backpressured.
    let item: Awaited<ReturnType<typeof next>> = first;
    while (!item.done && !res.destroyed) {
      if (transportError) {
        throw transportError;
      }
      if (!res.write(item.value)) {
        if (!res.destroyed && !transportError) {
          await new Promise<void>((resolve) => (wake = resolve));
        }
        if (transportError) {
          throw transportError;
        }
        if (res.destroyed) {
          break;
        }
      }
      item = await next();
    }
    if (!res.destroyed) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        res.end(ready);
      });
      if (transportError) {
        throw transportError;
      }
    }
  } catch (error) {
    workFailed = true;
    workError = error;
    throw error;
  } finally {
    try {
      await release();
    } catch (error) {
      if (workFailed) {
        // eslint-disable-next-line no-unsafe-finally -- Preserve both production and cleanup failures after releasing the iterator.
        throw new AggregateError(
          [workError, error],
          'Stream production and cleanup failed'
        );
      }
      // eslint-disable-next-line no-unsafe-finally -- A failed owned iterator release must remain observable to the caller.
      throw error;
    } finally {
      res.off('close', close);
      res.off('drain', ready);
      res.off('error', failed);
      request?.off('aborted', close);
    }
  }
}
