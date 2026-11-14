import {
  createBrowserPerformanceAnalytics,
  type BrowserPerformanceOptions,
} from '@zeruxjs/performance/analytics';

/** Create an explicitly consented browser metrics owner with a host-authorized transport.
 * @param {string} verifiedSite - Host-verified public nonpersonal site label.
 * @param {BrowserPerformanceOptions['send']} send - Explicit host-authorized private metric transport.
 * @param {'granted' | 'denied' | 'unknown'} consent - Required host-resolved collection state.
 * @returns {ReturnType<typeof createBrowserPerformanceAnalytics>} Adapter whose host calls destroy then awaits whenClosed.
 */
export function installConsentedPerformance(
  verifiedSite: string,
  send: BrowserPerformanceOptions['send'],
  consent: 'granted' | 'denied' | 'unknown'
) {
  /** Owned consent-gated browser adapter returned to the host for explicit teardown. */
  const performance = createBrowserPerformanceAnalytics({
    site: verifiedSite,
    consent,
    send,
  });
  performance.start(); // inert unless explicitly granted
  return performance;
}
// Host calls destroy() and awaits whenClosed() on teardown.
// Optional INP: a host-owned web-vitals@5 source can call receiveWebVital after consent;
// configure webVitals:{version:'5.2.0',inpSupported:actualBrowserCapability} first.
