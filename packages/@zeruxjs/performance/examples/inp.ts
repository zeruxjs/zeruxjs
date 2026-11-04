import {onINP} from 'web-vitals';
import type {createBrowserPerformanceAnalytics} from '@zeruxjs/performance/analytics';

/** One source per document, created only by an explicitly consented page owner.
 * web-vitals 5 has no public observer unsubscribe; detach only removes this bridge.
 */
export function createPageINPSource() {
  let receive: ((metric: Parameters<ReturnType<typeof createBrowserPerformanceAnalytics>['receiveWebVital']>[0]) => unknown) | undefined;
  let started = false;
  return {
    attach(bridge: ReturnType<typeof createBrowserPerformanceAnalytics>) {
      const state = bridge.snapshot();
      if (state.consent !== 'granted' || state.coverage.INP === 'unsupported') return () => {};
      const callback = bridge.receiveWebVital;
      receive = callback;
      if (!started) { started = true; onINP(metric => receive?.(metric), {reportAllChanges: true}); }
      return () => { if (receive === callback) receive = undefined; };
    }
  };
}
