import { createObservable, type Observable } from './observable.js';
/** Latest committed resource state; error objects remain private application data. */
export type AsyncState<T> = {
  /** Lifecycle status of the current request, independent of older unsettled loaders. */
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Last committed data retained during loading, cancellation and failures. */
  data: T | undefined;
  /** Private current failure; never render or serialize it without redaction. */
  error: unknown;
  /** Host Date.now timestamp of the last successful commit, or zero before success. */
  updatedAt: number;
};
/** Owned latest-request-wins resource; cancellation does not prove effects rolled back. */
export interface AsyncObservable<T> extends Observable<AsyncState<T>> {
  /** Explicitly start a load; stale promises can resolve raw results without committing state. */
  refresh(): Promise<T | undefined>;
  /** Fence the active result and abort cooperatively without destroying the resource. */
  cancel(): void;
  /** Cancel active work and restore initial data with idle status. */
  reset(): void;
  /** Fence results, detach the parent signal and destroy the owned state source. */
  destroy(): void;
}
/** Bounded cooperative resource policy; construction itself never calls the loader. */
export interface AsyncObservableOptions<T> {
  /** Initial borrowed value; undefined starts idle, another value starts successful with timestamp zero. */
  initial?: T;
  /** Optional integer 1–300000ms native timer; does not release a slot until settlement. */
  timeoutMs?: number;
  /** Borrowed parent lifetime signal; an aborted parent rejects future refreshes. */
  signal?: AbortSignal;
  /** Maximum unsettled loaders, integer 1–128, default eight. */
  maxPending?: number;
}
/** Construct a fixed abort failure with an optional private cause.
 * @param {unknown} cause - Private cancellation reason.
 * @returns {Error & {name: string}} AbortError-shaped failure without serializing the cause.
 */
const aborted = (cause?: unknown) =>
  Object.assign(new Error('Async observable aborted', { cause }), {
    name: 'AbortError',
  });
/** Latest-request-wins state. Cancellation is cooperative; unsettled loaders keep their pending slots.
 * @param {(signal: AbortSignal) => Promise<T>} load - Trusted application loader; must cooperate with its signal.
 * @param {AsyncObservableOptions<T>} options - Explicit lifetime, deadline and unsettled-work limits.
 * @returns {AsyncObservable<T>} Owned resource; refresh starts work and destroy releases local ownership.
 */
export function createAsyncObservable<T>(
  load: (signal: AbortSignal) => Promise<T>,
  options: AsyncObservableOptions<T> = {}
): AsyncObservable<T> {
  if (typeof load !== 'function') {
    throw new TypeError('Async observable requires a loader');
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 300000)
  ) {
    throw new RangeError('Invalid timeout');
  }
  /** Reject overload before replacing the active request; parent cancellation stays borrowed. */
  const maxPending = options.maxPending ?? 8,
    parent = options.signal;
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 128) {
    throw new RangeError('Invalid pending limit');
  }
  if (parent !== undefined && !(parent instanceof AbortSignal)) {
    throw new TypeError('Invalid abort signal');
  }
  /** Owned observable storing only the latest committed state; no remote work begins here. */
  const state = createObservable<AsyncState<T>>({
    status: options.initial === undefined ? 'idle' : 'success',
    data: options.initial,
    error: undefined,
    updatedAt: 0,
  });
  let active: AbortController | undefined,
    activeTimer: ReturnType<typeof setTimeout> | undefined,
    sequence = 0,
    disposed = false,
    pending = 0;
  /** Fence the active generation before aborting its loader and clearing its timer.
   * @param {unknown} reason - Private cancellation cause forwarded to the owned controller.
   * @returns {void} Invalidates the active result without releasing unsettled-work capacity.
   */
  const cancelActive = (reason?: unknown) => {
    sequence++;
    /** Detach the old controller before notifying its potentially reentrant abort listeners. */
    const previous = active;
    active = undefined;
    if (activeTimer !== undefined) {
      clearTimeout(activeTimer);
    }
    activeTimer = undefined;
    previous?.abort(reason);
  };
  /** Cancel active work and leave loading only when no reentrant request replaced it.
   * @param {unknown} reason - Optional private cancellation cause.
   * @returns {void} Cancels cooperatively while retaining previously committed data.
   */
  const cancel = (reason?: unknown) => {
    /** Fence reentrant cancellation so an older operation cannot overwrite a newer request. */
    const expected = sequence + 1;
    cancelActive(reason);
    if (
      !disposed &&
      sequence === expected &&
      state.get().status === 'loading'
    ) {
      state.set((s) => ({ ...s, status: 'idle', error: undefined }));
    }
  };
  /** Forward the borrowed parent lifetime into the current request.
   * @returns {void} Cancels active work; later refresh also checks the aborted parent.
   */
  const parentAbort = () => cancel(parent?.reason);
  parent?.addEventListener('abort', parentAbort, { once: true });
  return {
    get: state.get,
    subscribe: state.subscribe,
    cancel,
    async refresh() {
      if (disposed) {
        throw new Error('Async observable is destroyed');
      }
      if (parent?.aborted) {
        throw aborted(parent.reason);
      }
      if (pending >= maxPending) {
        throw new Error('Async observable pending limit exceeded');
      }
      /** Expected generation after canceling the previous request; abort callbacks may reenter. */
      const expected = sequence + 1;
      cancelActive();
      // Aborting the previous loader may synchronously start a newer refresh from its listener.
      if (disposed || sequence !== expected || parent?.aborted) {
        throw aborted(parent?.reason);
      }
      /** Pinned request generation and controller retained until its loader settles. */
      const id = sequence,
        controller = new AbortController();
      active = controller;
      pending++;
      /** Optional owned deadline timer for this request, cleared in finally. */
      const timer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              if (active === controller) {
                controller.abort(aborted());
                if (!disposed && id === sequence) {
                  state.set((s) => ({
                    ...s,
                    status: 'idle',
                    error: undefined,
                  }));
                }
              }
            }, options.timeoutMs);
      activeTimer = timer;
      try {
        state.set((s) => ({ ...s, status: 'loading', error: undefined }));
        // An observer may synchronously cancel/destroy the resource during the loading notification.
        if (disposed || id !== sequence || controller.signal.aborted) {
          throw aborted();
        }
        /** Raw loader result; only the still-current, active generation may publish it. */
        const result = await load(controller.signal);
        if (!disposed && id === sequence && !controller.signal.aborted) {
          state.set({
            status: 'success',
            data: result,
            error: undefined,
            updatedAt: Date.now(),
          });
        }
        // Compatibility: old refresh promises can resolve even when their result was fenced from state.
        return result;
      } catch (error) {
        if (!disposed && id === sequence) {
          state.set((s) => ({
            ...s,
            status: controller.signal.aborted ? 'idle' : 'error',
            error: controller.signal.aborted ? undefined : error,
          }));
        }
        throw error;
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        if (activeTimer === timer) {
          activeTimer = undefined;
        }
        pending--;
        if (active === controller) {
          active = undefined;
        }
      }
    },
    reset() {
      /** Reset only if abort callbacks did not install a newer generation. */
      const expected = sequence + 1;
      cancelActive();
      if (!disposed && sequence === expected) {
        state.set({
          status: 'idle',
          data: options.initial,
          error: undefined,
          updatedAt: 0,
        });
      }
    },
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      parent?.removeEventListener('abort', parentAbort);
      try {
        cancelActive();
      } finally {
        state.destroy();
      }
    },
  };
}
