import {createBrowserPerformanceAnalytics, type BrowserPerformanceOptions} from '@zeruxjs/performance/analytics';

export function installConsentedPerformance(
  verifiedSite: string,
  send: BrowserPerformanceOptions['send'],
  consent: 'granted' | 'denied' | 'unknown'
) {
  const performance = createBrowserPerformanceAnalytics({site: verifiedSite, consent, send});
  performance.start(); // inert unless explicitly granted
  return performance;
}
// Host calls destroy() and awaits whenClosed() on teardown.
// Optional INP: a host-owned web-vitals@5 source can call receiveWebVital after consent;
// configure webVitals:{version:'5.2.0',inpSupported:actualBrowserCapability} first.
