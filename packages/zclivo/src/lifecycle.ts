/** Per-invocation/plugin ownership; no process signal handlers or global resources. */
export type Disposer = () => void | Promise<void>;
export class ResourceScope {
  private controller = new AbortController();
  private callbacks: Disposer[] = [];
  private unlink: (() => void)[] = [];
  private closing?: Promise<unknown[]>;
  readonly signal = this.controller.signal;
  constructor(signals: readonly (AbortSignal | undefined)[] = []) {
    for (const signal of signals) {
      if (signal === undefined) continue;
      if (!(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
      const abort = () => this.controller.abort(signal.reason);
      if (signal.aborted) abort();
      else { signal.addEventListener('abort', abort, { once: true }); this.unlink.push(() => signal.removeEventListener('abort', abort)); }
    }
  }
  readonly onDispose = (callback: Disposer): void => {
    if (typeof callback !== 'function' || this.closing || this.callbacks.length >= 1024) throw new TypeError('Invalid or closed resource scope');
    this.callbacks.push(callback);
  };
  abort(): void { if (!this.signal.aborted) this.controller.abort(); }
  close(): Promise<unknown[]> {
    if (!this.closing) this.closing = Promise.resolve().then(async () => {
      this.abort();
      for (const unlink of this.unlink.splice(0)) unlink();
      const errors: unknown[] = [];
      for (const callback of this.callbacks.splice(0).reverse()) { try { await callback(); } catch (error) { errors.push(error); } }
      return errors;
    });
    return this.closing;
  }
}
