import { createPerformanceMetric } from '../timing.js';
import type { PerformanceMetric, VitalName } from '../types.js';
export interface VitalObserverOptions {
  /** Explicit observation sink; host owns consent, privacy and callback behavior. */
  onMetric: (metric: PerformanceMetric) => void;
  /** Override for tests or embedded browsers; uses global PerformanceObserver otherwise. */
  createObserver?: (callback: (entries: PerformanceEntry[]) => void) => {
    /** Register the requested buffered native entry type on the injected observer.
     * @param {PerformanceObserverInit} options - Explicit native observer configuration.
     * @returns {void} May throw for unsupported types; the owner disconnects acquired observers.
     */
    observe(options: PerformanceObserverInit): void;
    /** Disconnect only the observer owned by this lease.
     * @returns {void} Stops future native observation for this owner.
     */
    disconnect(): void;
  };
  /** Optional declared native entry support; unsupported types are skipped/reported. */
  supportedEntryTypes?: readonly string[];
  /** Optional fixed entry-type coverage observer. */
  onUnsupported?: (type: string) => void;
  /** Optional borrowed navigation timing getter for embedded/test environments. */
  navigation?: () =>
    | {
        /** Observed native response-start time in milliseconds. */
        responseStart: number;
        /** Observed native request-start time in milliseconds. */
        requestStart: number;
      }
    | undefined;
}
/** Own limited native LCP/CLS/FCP/navigation timing observations; never rename event durations as INP. Host obtains consent before calling and owns one page/component lifetime.
 * @param {VitalObserverOptions} options - Explicit sink and optional injected native observer/navigation capabilities.
 * @returns {function} Idempotent observer disposer; unsupported types are reported, not zero-filled.
 */
export function observeWebVitals(options: VitalObserverOptions): () => void {
  /** Optional native observer constructor, read at explicit collection time. */
  const Observer =
    typeof PerformanceObserver === 'undefined'
      ? undefined
      : PerformanceObserver;
  /** Borrowed injected observer factory or native wrapper; no observer starts at import.
   * @param {function} cb - Owned native entry callback supplied by this collection scope.
   * @returns {object} Native observer lease; callers disconnect it on failure or disposal.
   */
  const factory =
    options.createObserver ??
    (Observer
      ? (cb: (entries: PerformanceEntry[]) => void) =>
          new Observer((list) => cb(list.getEntries()))
      : undefined);
  if (!factory) {
    return () => {};
  }
  /** Last emitted finite value per metric, suppressing unchanged duplicate observations. */
  const last = new Map<VitalName, number>();
  let cls = 0,
    session = 0,
    sessionStart = 0,
    sessionLast = 0;
  let active = true;
  /** Publish only active finite changed observations through the explicit sink.
   * @param {VitalName} name - Supported native metric name.
   * @param {number} value - Observed nonnegative timing/score value.
   * @returns {void} Emits only changed valid values while active.
   */
  const publish = (name: VitalName, value: number) => {
    if (
      !active ||
      !Number.isFinite(value) ||
      value < 0 ||
      last.get(name) === value
    ) {
      return;
    }
    last.set(name, value);
    options.onMetric(createPerformanceMetric(name, value));
  };
  /** Owned native observer leases disconnected by the returned disposer. */
  const observers: Array<{
    /** Disconnect only the observer owned by this lease.
     * @returns {void} Stops future native observation for this owner.
     */
    disconnect(): void;
  }> = [];
  /** Declared native entry support; absent injected metadata permits native registration attempts. */
  const supported =
    options.supportedEntryTypes ??
    (options.createObserver ? undefined : Observer?.supportedEntryTypes);
  /** Register one explicit native metric observer, cleaning an acquired observer on failure.
   * @param {string} type - Fixed native entry type.
   * @param {function} callback - Entry observer owned by this scope.
   * @returns {void} Owns/disconnects registration; unsupported types remain coverage gaps.
   */
  const watch = (type: string, callback: (entry: PerformanceEntry) => void) => {
    if (supported && !supported.includes(type)) {
      options.onUnsupported?.(type);
      return;
    }
    let observer: ReturnType<NonNullable<typeof factory>> | undefined;
    try {
      observer = factory((entries) => {
        // Process only the explicit representation bytes, native entries or fixed report fields for this call.
        for (const entry of entries) {
          if (active) {
            callback(entry);
          }
        }
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      observer?.disconnect();
      options.onUnsupported?.(type);
    }
  };
  watch('largest-contentful-paint', (entry) => publish('LCP', entry.startTime));
  watch('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') {
      publish('FCP', entry.startTime);
    }
  });
  watch('layout-shift', (entry) => {
    /** Native layout-shift record narrowed only for score/recent-input processing. */
    const e = entry as PerformanceEntry & {
      /** Finite nonnegative observation; milliseconds for timing and score for CLS. */
      value?: number;
      /** Native layout-shift flag excluding recent-input changes from this limited observation. */
      hadRecentInput?: boolean;
    };
    if (
      e.hadRecentInput ||
      !Number.isFinite(e.value) ||
      !e.value ||
      e.value < 0
    ) {
      return;
    }
    if (
      !sessionStart ||
      entry.startTime - sessionLast > 1000 ||
      entry.startTime - sessionStart > 5000
    ) {
      session = 0;
      sessionStart = entry.startTime;
    }
    session += e.value;
    sessionLast = entry.startTime;
    cls = Math.max(cls, session);
    publish('CLS', cls);
  });
  try {
    /** Explicit/native navigation timing record, if available. */
    const nav =
      options.navigation?.() ??
      (typeof performance !== 'undefined'
        ? (performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined)
        : undefined);
    if (nav) {
      publish('TTFB', Math.max(0, nav.responseStart - nav.requestStart));
    }
  } catch {
    /* unsupported */
  }
  return () => {
    if (!active) {
      return;
    }
    active = false;
    // Process only the explicit representation bytes, native entries or fixed report fields for this call.
    for (const observer of observers) {
      observer.disconnect();
    }
  };
}
