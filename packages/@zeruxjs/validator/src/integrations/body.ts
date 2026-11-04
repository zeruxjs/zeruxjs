import { HttpValidationError } from './issues.js';
export interface BodyLimits { maxBytes: number; bodyTimeoutMs: number; maxConcurrentReads: number }
export interface ReaderScope { active: number }

/** Consume one owned Fetch reader with an absolute deadline, byte budget and slot.
 * Cancellation is initiated on every failure; an uncooperative cancel callback
 * cannot hold the deadline open. Its rejection is retained in the internal cause.
 */
export async function readBody<T>(request: Request, signal: AbortSignal, limits: BodyLimits, scope: ReaderScope, checkType: (type: string) => void, decode: (bytes: Uint8Array, type: string) => T | Promise<T>): Promise<T> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let acquired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: unknown) => void = () => {};
  const stop = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const abort = () => rejectStop(new HttpValidationError(400, 'Request disconnected', undefined, { cause: signal.reason }));
  try {
    try { reader = request.body?.getReader(); }
    catch (cause) { throw new HttpValidationError(400, 'Request body is already locked', undefined, { cause }); }
    if (!reader) throw new HttpValidationError(400, 'Missing request body');
    if (signal.aborted) throw new HttpValidationError(400, 'Request disconnected', undefined, { cause: signal.reason });
    if (scope.active >= limits.maxConcurrentReads) throw new HttpValidationError(429, 'Body reader capacity exceeded');
    scope.active++; acquired = true;
    const type = request.headers.get('content-type') ?? '';
    checkType(type);
    const encoding = request.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') throw new HttpValidationError(415, 'Compressed input is not supported');
    const charset = /;\s*charset\s*=\s*"?([^;"\s]+)/i.exec(type)?.[1];
    if (charset && !/^utf-?8$/i.test(charset)) throw new HttpValidationError(415, 'Input must use UTF-8');
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > limits.maxBytes)) throw new HttpValidationError(413, 'Invalid or excessive Content-Length');
    timer = setTimeout(() => rejectStop(new HttpValidationError(408, 'Request body deadline exceeded')), limits.bodyTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    // Recheck after listener registration; no body work runs after pre-abortion.
    if (signal.aborted) abort();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new HttpValidationError(400, 'Request body must contain bytes');
      length += value.byteLength;
      if (length > limits.maxBytes) throw new HttpValidationError(413, 'Request body too large');
      chunks.push(value.slice());
    }
    if (declared !== null && length !== Number(declared)) throw new HttpValidationError(400, 'Content-Length mismatch');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return await Promise.race([Promise.resolve().then(() => decode(bytes, type)), stop]);
  } catch (cause) {
    const error = cause instanceof HttpValidationError ? cause : new HttpValidationError(400, 'Request body failed', undefined, { cause });
    const cleanupErrors: unknown[] = [];
    const priorCause: unknown = error.cause;
    Object.defineProperty(error, 'cause', { value: { error: priorCause, cleanupErrors }, configurable: true });
    if (reader) {
      try { void reader.cancel(error).catch(failure => { cleanupErrors.push(failure); }); }
      catch (failure) { cleanupErrors.push(failure); }
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    reader?.releaseLock();
    if (acquired) scope.active--;
  }
}
