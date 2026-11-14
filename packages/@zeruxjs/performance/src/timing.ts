import type { PerformanceMetric, VitalName } from './types.js';
/** Read the first native navigation entry without starting observers. TTFB retains responseStart minus requestStart, not a full browser lifecycle algorithm.
 * @returns {object | null} Native timing milliseconds, or null without a navigation entry.
 */
export function getNavigationTiming(): {
  /** Observed responseStart minus requestStart in milliseconds. */
  ttfb: number;
  /** Observed DOMContentLoaded completion relative to navigation start. */
  domContentLoaded: number;
  /** Observed load-event completion relative to navigation start. */
  load: number;
} | null {
  if (typeof performance === 'undefined') {
    return null;
  }
  /** First native navigation entry, read without starting observation. */
  const entry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!entry) {
    return null;
  }
  return {
    ttfb: Math.max(0, entry.responseStart - entry.requestStart),
    domContentLoaded: entry.domContentLoadedEventEnd - entry.startTime,
    load: entry.loadEventEnd - entry.startTime,
  };
}
/** Own one explicit native PerformanceObserver; unsupported environments return an inert disposer.
 * @param {string} type - Native entry type selected by the host.
 * @param {function} callback - Borrowed observer callback; host owns privacy and exception handling.
 * @returns {function} Disconnect this observer on page/component teardown.
 */
export function observePerformance(
  type: string,
  callback: (entry: PerformanceEntry) => void
): () => void {
  if (typeof PerformanceObserver === 'undefined') {
    return () => {};
  }
  /** Owned native observer disconnected on setup failure or returned disposal. */
  const observer = new PerformanceObserver((list) => {
    // Process only the explicit representation bytes, native entries or fixed report fields for this call.
    for (const entry of list.getEntries()) {
      callback(entry);
    }
  });
  try {
    observer.observe({ type, buffered: true });
  } catch {
    observer.disconnect();
    return () => {};
  }
  return () => observer.disconnect();
}
/** Fixed per-vital good/poor thresholds; timing uses milliseconds and CLS uses score. */
const thresholds: Record<VitalName, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};
/** Rate a finite nonnegative observed value against the fixed per-metric thresholds; does not collect or claim final population statistics.
 * @param {VitalName} name - Supported metric name from VitalName.
 * @param {number} value - Observed milliseconds, or CLS score.
 * @returns {string} Good, needs-improvement or poor under the fixed threshold table.
 */
export function rateWebVital(
  name: VitalName,
  value: number
): 'good' | 'needs-improvement' | 'poor' {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Invalid metric value');
  }
  /** Threshold pair for the explicitly typed metric name. */
  const [good, poor] = thresholds[name];
  if (value <= good) {
    return 'good';
  }
  return value <= poor ? 'needs-improvement' : 'poor';
}
/** Create an inert timestamped rated metric without observers, identity or network work.
 * @param {VitalName} name - Supported native/maintained metric name.
 * @param {number} value - Finite nonnegative observed milliseconds or CLS score.
 * @returns {PerformanceMetric} Fresh metric; consent/coverage provenance is supplied by the owning adapter.
 */
export function createPerformanceMetric(
  name: VitalName,
  value: number
): PerformanceMetric {
  return {
    name,
    value,
    rating: rateWebVital(name, value),
    timestamp: Date.now(),
  };
}
/** Measure one synchronous callback using the available monotonic clock; preserve its result and thrown failure.
 * @param {string} name - Compatible caller label; this helper does not emit or retain it.
 * @param {function} run - Explicit callback invoked exactly once.
 * @returns {object} Original result plus elapsed milliseconds; no automatic telemetry.
 */
export function measureFunction<T>(
  name: string,
  run: () => T
): { result: T; duration: number } {
  /** Select monotonic native timing when available, otherwise epoch milliseconds.
   * @returns {number} Current local timing clock reading.
   */
  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  /** Clock reading immediately before the one explicit callback invocation. */
  const start = now();
  /** Original measured callback or lab-runner outcome; no automatic retry. */
  const result = run();
  return { result, duration: Math.max(0, now() - start) };
}
/** Measure one awaited callback through actual settlement, without retries or automatic telemetry.
 * @param {string} name - Compatible caller label; not recorded by this helper.
 * @param {function} run - Explicit asynchronous callback invoked exactly once.
 * @returns {Promise<object>} Original result plus elapsed milliseconds; rejected work propagates.
 */
export async function measureAsync<T>(
  name: string,
  run: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  /** Select monotonic native timing when available, otherwise epoch milliseconds.
   * @returns {number} Current local timing clock reading.
   */
  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  /** Clock reading immediately before the one explicit callback invocation. */
  const start = now();
  /** Original measured callback or lab-runner outcome; no automatic retry. */
  const result = await run();
  return { result, duration: Math.max(0, now() - start) };
}
