/** Per-invocation/plugin ownership; no process signal handlers or global resources. */
export type Disposer = () => void | Promise<void>;
/** Internal invocation/plugin cleanup owner; signals request cooperation rather than forced cancellation. */
export class ResourceScope {
  /** Owned cooperative lifetime signal source. */
  private controller = new AbortController();
  /** Bounded LIFO cleanup registrations transferred by trusted handlers/plugins. */
  private callbacks: Disposer[] = [];
  /** Borrowed upstream signal listeners detached during close. */
  private unlink: (() => void)[] = [];
  /** Shared actual-settlement promise for idempotent close. */
  private closing?: Promise<unknown[]>;
  /** Signal aborted before teardown callbacks begin. */
  readonly signal = this.controller.signal;
  /** Attach explicit borrowed lifetimes without installing process signal listeners.
   * @param {readonly (AbortSignal | undefined)[]} signals - Native upstream signals, validated before use.
   */
  constructor(signals: readonly (AbortSignal | undefined)[] = []) {
    for (const signal of signals) {
      if (signal === undefined) {
        continue;
      }
      if (!(signal instanceof AbortSignal)) {
        throw new TypeError('signal must be an AbortSignal');
      }
      /** Forward one borrowed signal reason into this scope only.
       * @returns {void} Cooperatively aborts the owned controller.
       */
      const abort = () => this.controller.abort(signal.reason);
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener('abort', abort, { once: true });
        this.unlink.push(() => signal.removeEventListener('abort', abort));
      }
    }
  }
  /** Transfer trusted cleanup into this scope before awaiting more work.
   * @param {Disposer} callback - Synchronous/asynchronous owned cleanup; at most 1024 registrations.
   * @returns {void} Registers while open or throws; callbacks are not invoked immediately.
   */
  readonly onDispose = (callback: Disposer): void => {
    if (
      typeof callback !== 'function' ||
      this.closing ||
      this.callbacks.length >= 1024
    ) {
      throw new TypeError('Invalid or closed resource scope');
    }
    this.callbacks.push(callback);
  };
  /** Request cooperative cancellation without running cleanup or interrupting JavaScript.
   * @returns {void} Aborts the owned signal once.
   */
  abort(): void {
    if (!this.signal.aborted) {
      this.controller.abort();
    }
  }
  /** Abort, unlink upstream signals and attempt all transferred callbacks in reverse order.
   * @returns {Promise<unknown[]>} Private cleanup failures after actual callback settlement; repeated calls share the result.
   */
  close(): Promise<unknown[]> {
    if (!this.closing) {
      this.closing = Promise.resolve().then(async () => {
        this.abort();
        for (const unlink of this.unlink.splice(0)) {
          unlink();
        }
        /** Private cleanup causes returned after all callbacks have been attempted. */
        const errors: unknown[] = [];
        for (const callback of this.callbacks.splice(0).reverse()) {
          try {
            await callback();
          } catch (error) {
            errors.push(error);
          }
        }
        return errors;
      });
    }
    return this.closing;
  }
}
