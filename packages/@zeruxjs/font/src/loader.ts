import { defineFont } from './css.js';
export { createFontRegistry } from './registry.js';
export type { FontRegistry } from './registry.js';
/** Append a trusted authored style element and return its exact removal disposer. This is not a sanitizer or CSP bypass; host policy must permit injection.
 * @param {string} css - Trusted generated/authored CSS, never raw untrusted request content.
 * @param {Document} doc - Borrowed target document; defaults to global document when invoked.
 * @returns {Function} Disposer removing only the owned style element; no host styles are removed.
 */
export function injectFontStyles(
  css: string,
  doc: Document = document
): () => void {
  /** Owned style element; disposer removes only this node from the borrowed document. */
  const style = doc.createElement('style');
  style.setAttribute('data-zerux-font', '');
  style.textContent = css;
  doc.head.appendChild(style);
  return () => style.remove();
}
/** Per-observation browser loading policy; cancellation does not terminate native font downloads. */
export interface LoadFontOptions {
  /** Optional load probe text, at most 4096 UTF-16 code units. */
  sample?: string;
  /** Positive safe-integer observation deadline, default 10000 ms and ceiling 120000 ms. */
  timeoutMs?: number;
  /** Borrowed target document; absent native FontFaceSet returns false. */
  document?: Document;
  /** Caller-owned cooperative observation cancellation, not native font-download cancellation. */
  signal?: AbortSignal;
}
/** Observe native FontFaceSet loading with bounded timeout/cancellation and fixed error messages. Ending observation does not cancel the underlying browser download.
 * @param {string} family - Validated authored family name.
 * @param {LoadFontOptions} options - Optional borrowed document, sample text, timeout and cancellation signal.
 * @returns {Promise<boolean>} False when DOM/FontFaceSet is absent or no faces match; native failure/cancellation/timeout rejects.
 */
export async function loadFont(
  family: string,
  options: LoadFontOptions = {}
): Promise<boolean> {
  defineFont({ family, sources: [{ url: '/validation.woff2' }] });
  /** Validated observation deadline, independent of native browser download lifetime. */
  const timeout = options.timeoutMs ?? 10000;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000 ||
    (options.sample !== undefined &&
      (typeof options.sample !== 'string' || options.sample.length > 4096))
  ) {
    throw new RangeError('Invalid font loading bounds');
  }
  if (options.signal?.aborted) {
    throw new Error('Font loading cancelled');
  }
  /** Borrowed explicit/global document, or absent in a non-DOM runtime. */
  const doc =
    options.document ??
    (typeof document !== 'undefined' ? document : undefined);
  if (!doc?.fonts) {
    return false;
  }
  let handle: ReturnType<typeof setTimeout> | undefined,
    abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => {
          if (options.signal?.aborted) {
            throw new Error('Font loading cancelled');
          }
          return doc.fonts.load(
            `16px ${JSON.stringify(family)}`,
            options.sample
          );
        })
        .then(
          (result) => result.length > 0,
          () => {
            throw new Error('Font loading failed');
          }
        ),
      new Promise<boolean>((_, reject) => {
        handle = setTimeout(
          () => reject(new Error('Font loading timed out')),
          timeout
        );
        abort = () => reject(new Error('Font loading cancelled'));
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) {
          abort();
        }
      }),
    ]);
  } finally {
    if (handle) {
      clearTimeout(handle);
    }
    if (abort) {
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
/** Own bounded per-mount font-load observations and their cancellation listeners/timers. CSS/host font faces remain borrowed.
 * @param {object} options - Optional borrowed document and observation concurrency ceiling.
 * @param {Document} [options.document] - Borrowed host document; otherwise loadFont probes the global DOM.
 * @param {number} [options.maxPending] - Observation cap, default 8 and ceiling 64.
 * @returns {object} Load/dispose facade; disposal stops observation without guaranteeing native network cancellation.
 */
export function createFontLoadScope(
  options: {
    /** Borrowed target document; absent native FontFaceSet returns false. */
    document?: Document;
    /** Observation concurrency cap, default 8 and ceiling 64. */
    maxPending?: number;
  } = {}
) {
  /** Validated per-scope observation cap; not a browser network quota. */
  const max = options.maxPending ?? 8;
  if (!Number.isSafeInteger(max) || max < 1 || max > 64) {
    throw new RangeError('Invalid font loading concurrency');
  }
  /** Owned observation controllers, retained until observation settlement. */
  const pending = new Set<AbortController>();
  let disposed = false;
  return {
    /** Admit one bounded observation, forwarding caller cancellation and releasing scope bookkeeping on observation settlement.
     * @param {string} family - Validated family passed to loadFont.
     * @param {Omit<LoadFontOptions, 'document'>} input - Per-observation sample, timeout and caller-owned cancellation.
     * @returns {Promise<boolean>} Observed loading result; closed/full scopes reject before another observation starts.
     */
    load(family: string, input: Omit<LoadFontOptions, 'document'> = {}) {
      if (disposed) {
        return Promise.reject(new Error('Font loading scope disposed'));
      }
      if (pending.size >= max) {
        return Promise.reject(new Error('Font loading concurrency exceeded'));
      }
      /** Per-observation controller isolated from the caller-owned signal. */
      const controller = new AbortController();
      /** Forward caller cancellation to this owned observation controller.
       * @returns {void} Native font downloading is not forcibly terminated. */
      const abort = () => controller.abort();
      pending.add(controller);
      input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) {
        abort();
      }
      return loadFont(family, {
        ...input,
        document: options.document,
        signal: controller.signal,
      }).finally(() => {
        pending.delete(controller);
        input.signal?.removeEventListener('abort', abort);
      });
    },
    /** Idempotently fence new observations and abort all retained observation controllers.
     * @returns {void} Observers settle and remove listeners asynchronously; native downloads may continue.
     */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // End owned observations only; the browser may continue its native font requests.
      for (const controller of pending) {
        controller.abort();
      }
    },
    get pendingCount() {
      return pending.size;
    },
  };
}
