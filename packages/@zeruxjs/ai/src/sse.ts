import { AiProviderError } from './types.js';
/**
 * Decode bounded UTF-8 SSE data frames without evaluating provider content.
 * @param {ReadableStream<Uint8Array>} source - Borrowed stream; this iterator owns its reader.
 * @param {number} maxBytes - Aggregate byte ceiling from 1 through 64 MiB.
 * @param {AbortSignal | undefined} signal - Optional request cancellation.
 * @returns {AsyncIterable<string>} Joined data lines, with a 128 KiB code-unit frame bound.
 * @throws {AiProviderError} On oversized frames/responses or invalid UTF-8; abort reasons propagate.
 */
export async function* parseAiSseEvents(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal
): AsyncIterable<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864) {
    throw new RangeError('Invalid stream budget');
  }
  /** Exclusive reader is cancelled and unlocked on completion, failure or early return. */
  const reader = source.getReader();
  /** Streaming fatal decode preserves split multibyte characters and rejects corruption. */
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '',
    received = 0,
    current: string[] = [],
    frame = 0;
  /**
   * Request reader cancellation; final cleanup still awaits cancellation settlement.
   * @returns {void} Cancellation rejection is isolated from the request's terminal outcome.
   */
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  /**
   * Accumulate one logical line and flush data only on a frame boundary.
   * @param {string} value - CR-stripped line; empty string terminates the frame.
   * @returns {string | undefined} Joined data or undefined when no data frame is ready.
   * @throws {AiProviderError} When the current frame exceeds its code-unit budget.
   */
  function line(value: string): string | undefined {
    if (!value) {
      /** Empty/comment-only frames yield nothing; data lines retain embedded newlines. */
      const data = current.length ? current.join('\n') : undefined;
      current = [];
      frame = 0;
      return data;
    }
    frame += value.length;
    if (frame > 131072) {
      throw new AiProviderError('AI stream frame is too large');
    }
    if (value.startsWith('data:')) {
      current.push(value.slice(5).replace(/^ /, ''));
    }
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      /** Count raw bytes before decoding, independently of JavaScript string length. */
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        throw new AiProviderError('Provider stream exceeds size limit');
      }
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        /** Complete lines alone are consumed; incomplete UTF-8/text stays buffered. */
        const data = line(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
        if (data !== undefined) {
          yield data;
        }
      }
      if (buffer.length + frame > 131072) {
        throw new AiProviderError('AI stream frame is too large');
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      /** Flush an unterminated final line without discarding decoder tail bytes. */
      const data = line(buffer.replace(/\r$/, ''));
      if (data !== undefined) {
        yield data;
      }
    }
    /** EOF closes the last frame even when the source omitted the blank separator. */
    const final = line('');
    if (final !== undefined) {
      yield final;
    }
  } catch (error) {
    if (error instanceof TypeError && !signal?.aborted) {
      throw new AiProviderError('Invalid AI stream encoding');
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/**
 * Project legacy OpenAI SSE choice deltas into text only.
 * @param {ReadableStream<Uint8Array>} source - Response body consumed by the framing owner.
 * @param {number} maxBytes - Aggregate response byte ceiling passed to the SSE parser.
 * @param {AbortSignal | undefined} signal - Optional cancellation inherited by the reader.
 * @returns {AsyncIterable<string>} Text fragments; metadata/tool fragments are not exposed here.
 * @throws {AiProviderError} On malformed JSON, provider errors or nontext deltas.
 */
export async function* parseAiSse(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal
): AsyncIterable<string> {
  // Framing owns cancellation; return on the terminal marker also closes its iterator.
  for await (const data of parseAiSseEvents(source, maxBytes, signal)) {
    if (data === '[DONE]') {
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new AiProviderError('Malformed AI stream event');
    }
    if (payload?.error) {
      throw new AiProviderError('AI streaming provider reported an error');
    }
    /** Only the first choice text projection is part of this legacy contract. */
    const delta = payload?.choices?.[0]?.delta?.content;
    if (delta === undefined || delta === null) {
      continue;
    }
    if (typeof delta !== 'string') {
      throw new AiProviderError('Invalid streamed AI content');
    }
    yield delta;
  }
}
