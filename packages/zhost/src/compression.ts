/** Explicit application-scoped compression owner. Uses the proxy implementation. */
import type {
  IncomingMessage,
  ServerResponse,
  IncomingHttpHeaders,
} from 'node:http';
import type { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import {
  forwardCompressedResponse,
  validateCompressionOptions,
  appendVary,
  type ProxyCompressionOptions,
} from './portless/proxy-compression.js';
export type { ProxyCompressionOptions } from './portless/proxy-compression.js';
export interface CompressionMeasurement {
  /** Native negotiated codec, excluding identity responses. */
  encoding: 'br' | 'gzip' | 'deflate' | 'zstd';
  /** Encoded bytes observed before native encoder close. */
  outputBytes: number;
  /** Monotonic elapsed encoder lifetime in milliseconds. */
  durationMs: number;
  /** Completed, downstream-cancelled or errored native encoder outcome. */
  outcome: 'completed' | 'cancelled' | 'error';
}
export interface CompressionOwnerOptions extends ProxyCompressionOptions {
  /** Maximum simultaneous encoders, 1–128; defaults to eight and never creates an overflow queue. */
  maxConcurrent?: number;
  /** Trusted optional measurement sink; synchronous errors and returned promise rejection cannot change delivery. */
  onMeasure?: (measurement: Readonly<CompressionMeasurement>) => void;
}
/** Create an application-owned bounded response encoder scope using the existing proxy compression implementation.
 * @param {CompressionOwnerOptions} options - Codec policy, concurrent encoder ceiling and optional isolated measurement callback.
 * @returns {object} Explicit forward/status/async close handle; close before disposing dependent application resources.
 */
export function createCompressionOwner(options: CompressionOwnerOptions = {}) {
  /** Validated policy with a copied codec preference array, isolating later host mutation. */
  const config = validateCompressionOptions(options);
  config.encodings = [...config.encodings];
  /** Validated native encoder capacity; identity responses do not consume encoder slots. */
  const max = options.maxConcurrent ?? 8;
  /** Borrowed isolated observer; no URL, headers, payloads or credentials enter its records. */
  const measure = options.onMeasure;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 128 ||
    (measure !== undefined && typeof measure !== 'function')
  ) {
    throw new TypeError('Invalid compression owner');
  }
  /** Owned encoders mapped to native close promises; capacity is retained until actual close. */
  const active = new Map<Readable, Promise<void>>();
  /** Forwarded response/source pairs retained until response close for cancellation and shutdown. */
  const responses = new Map<
    ServerResponse,
    { source: Readable; done: Promise<void> }
  >();
  let closed = false,
    overloaded = 0;
  return {
    /** Delegate one uncommitted response, using identity or 406 at encoder capacity instead of queuing/replaying.
     * @param {IncomingMessage} request - Borrowed native request; transport and authentication policy remain host-owned.
     * @param {Readable&{headers:IncomingHttpHeaders;statusCode?:number}} source - Source whose destruction is owned by this response scope after forwarding.
     * @param {ServerResponse} response - Borrowed uncommitted response retained until native close.
     * @returns {void} Retains encoder capacity until native encoder close; identity responses still belong to response teardown.
     */
    forward(
      request: IncomingMessage,
      source: Readable & { headers: IncomingHttpHeaders; statusCode?: number },
      response: ServerResponse
    ): void {
      if (closed) {
        throw new Error('Compression owner closed');
      }
      // No queue or replay: identity at capacity, or the common owner's 406 if forbidden.
      /** Whether acquiring another native encoder would exceed the configured ceiling. */
      const saturated = active.size >= max;
      if (saturated) {
        overloaded++;
        source.headers = {
          ...source.headers,
          vary: appendVary(source.headers.vary, 'Accept-Encoding'),
        };
      }
      /** Native response-close promise, removed from ownership tracking only on actual close. */
      const doneResponse = new Promise<void>((resolve) =>
        response.once('close', () => {
          responses.delete(response);
          resolve();
        })
      );
      responses.set(response, { source, done: doneResponse });
      /** Monotonic timestamp captured immediately before forwarding to the shared response implementation. */
      const started = performance.now();
      /** Optional owned native encoder; absent when identity/bodyless/rejected forwarding is selected. */
      const encoder = forwardCompressedResponse(
        request,
        source,
        response,
        saturated ? { ...config, enabled: false } : config
      );
      if (!encoder) {
        return;
      }
      let bytes = 0,
        failed = false;
      /** Codec recorded by the response implementation after successful encoder acquisition. */
      const encoding = response.getHeader(
        'content-encoding'
      ) as CompressionMeasurement['encoding'];
      /** Count encoded bytes without retaining chunks.
       * @param {Buffer} chunk - Encoded output chunk.
       * @returns {void} Updates only the local byte counter.
       */
      const data = (chunk: Buffer) => {
        bytes += chunk.length;
      };
      /** Record a native encoder error without logging private causes.
       * @returns {void} Marks this measurement as failed.
       */
      const error = () => {
        failed = true;
      };
      encoder.on('data', data);
      encoder.on('error', error);
      /** Native encoder-close promise that releases its slot and isolates the measurement callback. */
      const done = new Promise<void>((resolve) =>
        encoder.once('close', () => {
          active.delete(encoder);
          if (!response.writableFinished) {
            source.destroy();
            response.destroy();
          }
          encoder.off('data', data);
          encoder.off('error', error);
          try {
            /** Optional host callback result, observed only to consume a returned promise rejection. */
            const observation: unknown = measure?.(
              Object.freeze({
                encoding,
                outputBytes: bytes,
                durationMs: performance.now() - started,
                outcome: (() => {
                  if (failed) {
                    return 'error';
                  }
                  if (response.writableFinished) {
                    return 'completed';
                  }
                  return 'cancelled';
                })(),
              })
            );
            if (
              observation &&
              typeof (observation as PromiseLike<unknown>).then === 'function'
            ) {
              void Promise.resolve(observation).catch(() => {});
            }
          } catch {
            /* Observation never changes delivery. */
          }
          resolve();
        })
      );
      active.set(encoder, done);
    },
    /** Read path-free encoder load counters without exposing response or source handles.
     * @returns {{active: number; overloaded: number}} Active native encoders and lifetime saturation count; not a durable metric.
     */
    status() {
      return { active: active.size, overloaded };
    },
    /** Fence new forwards, destroy owned sources/responses/encoders and await their actual native close promises.
     * @returns {Promise<void>} Drains all currently retained response/encoder close observations; does not force-cancel arbitrary JavaScript.
     */
    async close() {
      closed = true;
      /** Snapshot of actual encoder and response close promises to drain after cancellation. */
      const pending = [
        ...active.values(),
        ...[...responses.values()].map((v) => v.done),
      ];
      for (const { source } of responses.values()) {
        source.destroy();
      }
      for (const response of responses.keys()) {
        response.destroy();
      }
      for (const encoder of active.keys()) {
        encoder.destroy();
      }
      await Promise.all(pending);
    },
  };
}
