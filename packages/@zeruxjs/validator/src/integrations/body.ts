import { HttpValidationError } from './issues.js';
export interface BodyLimits {
  /** Validated total streamed byte ceiling; actual length must also match declared Content-Length. */
  maxBytes: number;
  /** Absolute body/decode observation deadline, never reset by incoming chunks. */
  bodyTimeoutMs: number;
  /** Instance-owned simultaneous reader ceiling; separate adapters do not share slots. */
  maxConcurrentReads: number;
}
export interface ReaderScope {
  /** Current owned active reader count; not a process-wide/native socket count. */
  active: number;
}

/** Consume one owned Fetch reader under an absolute deadline, actual byte limit and instance reader slot. Initiate cancellation on failure without waiting indefinitely for an uncooperative producer cancel callback; native decode work is not forcibly preempted.
 * @param {Request} request - Borrowed Fetch request whose body reader is acquired only by this operation.
 * @param {AbortSignal} signal - Combined initiating/owner cooperative signal; disconnect diagnostics remain private.
 * @param {BodyLimits} limits - Validated byte/deadline/concurrency limits selected by the owning adapter.
 * @param {ReaderScope} scope - Instance-owned active-reader counter, not a global or distributed quota.
 * @param {(type: string) => void} checkType - Trusted synchronous media-type validator called before body accumulation.
 * @param {(bytes: Uint8Array, type: string) => T | Promise<T>} decode - Trusted bounded-byte decoder; async decoding observes the same absolute deadline.
 * @returns {Promise<T>} Decoded bounded body or typed HTTP failure; finally releases timer, listener, lock and acquired slot.
 */
export async function readBody<T>(
  request: Request,
  signal: AbortSignal,
  limits: BodyLimits,
  scope: ReaderScope,
  checkType: (type: string) => void,
  decode: (bytes: Uint8Array, type: string) => T | Promise<T>
): Promise<T> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let acquired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: unknown) => void = () => {};
  /** Observation rejection shared by disconnect/deadline races; not a replay or rollback mechanism. */
  const stop = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  /** Reject caller observation when the initiating signal aborts.
   * @returns {void} Rejects the shared stop promise; finally still owns reader cleanup.
   */
  const abort = () =>
    rejectStop(
      new HttpValidationError(400, 'Request disconnected', undefined, {
        cause: signal.reason,
      })
    );
  try {
    try {
      reader = request.body?.getReader();
    } catch (cause) {
      throw new HttpValidationError(
        400,
        'Request body is already locked',
        undefined,
        { cause }
      );
    }
    if (!reader) {
      throw new HttpValidationError(400, 'Missing request body');
    }
    if (signal.aborted) {
      throw new HttpValidationError(400, 'Request disconnected', undefined, {
        cause: signal.reason,
      });
    }
    if (scope.active >= limits.maxConcurrentReads) {
      throw new HttpValidationError(429, 'Body reader capacity exceeded');
    }
    scope.active++;
    acquired = true;
    /** Raw declared media type validated before decoding or body accumulation. */
    const type = request.headers.get('content-type') ?? '';
    checkType(type);
    /** Declared content encoding; only absent/identity input is supported. */
    const encoding = request.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') {
      throw new HttpValidationError(415, 'Compressed input is not supported');
    }
    /** Optional declared charset; only UTF-8 spellings are supported. */
    const charset = /;\s*charset\s*=\s*"?([^;"\s]+)/i.exec(type)?.[1];
    if (charset && !/^utf-?8$/i.test(charset)) {
      throw new HttpValidationError(415, 'Input must use UTF-8');
    }
    /** Optional Content-Length validated before reading and compared with final actual bytes. */
    const declared = request.headers.get('content-length');
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) ||
        !Number.isSafeInteger(Number(declared)) ||
        Number(declared) > limits.maxBytes)
    ) {
      throw new HttpValidationError(413, 'Invalid or excessive Content-Length');
    }
    timer = setTimeout(
      () =>
        rejectStop(
          new HttpValidationError(408, 'Request body deadline exceeded')
        ),
      limits.bodyTimeoutMs
    );
    signal.addEventListener('abort', abort, { once: true });
    // Recheck after listener registration; no body work runs after pre-abortion.
    if (signal.aborted) {
      abort();
    }
    /** Owned copies of bounded chunks; no caller-controlled mutable buffer is retained. */
    const chunks: Uint8Array[] = [];
    let length = 0;
    // Enforce actual bytes before copying another chunk; trickle input never resets the deadline.
    while (true) {
      /** One native reader outcome raced against the shared absolute deadline/disconnect promise. */
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new HttpValidationError(400, 'Request body must contain bytes');
      }
      length += value.byteLength;
      if (length > limits.maxBytes) {
        throw new HttpValidationError(413, 'Request body too large');
      }
      chunks.push(value.slice());
    }
    if (declared !== null && length !== Number(declared)) {
      throw new HttpValidationError(400, 'Content-Length mismatch');
    }
    /** One bounded contiguous decode input assembled after all length checks. */
    const bytes = new Uint8Array(length);
    let offset = 0;
    // Assemble only validated bounded copies after final Content-Length verification.
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return await Promise.race([
      Promise.resolve().then(() => decode(bytes, type)),
      stop,
    ]);
  } catch (cause) {
    /** Typed HTTP failure carrying private operational cause and owned cleanup diagnostics. */
    const error =
      cause instanceof HttpValidationError
        ? cause
        : new HttpValidationError(400, 'Request body failed', undefined, {
            cause,
          });
    /** Private cancellation failures observed without blocking slot/lock release. */
    const cleanupErrors: unknown[] = [];
    /** Original private error cause retained without exposing it through public responses. */
    const priorCause: unknown = error.cause;
    Object.defineProperty(error, 'cause', {
      value: { error: priorCause, cleanupErrors },
      configurable: true,
    });
    if (reader) {
      try {
        void reader.cancel(error).catch((failure) => {
          cleanupErrors.push(failure);
        });
      } catch (failure) {
        cleanupErrors.push(failure);
      }
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    signal.removeEventListener('abort', abort);
    reader?.releaseLock();
    if (acquired) {
      scope.active--;
    }
  }
}
