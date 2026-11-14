import { onINP } from 'web-vitals';
import type { createBrowserPerformanceAnalytics } from '@zeruxjs/performance/analytics';

/** One source per document, created only by an explicitly consented page owner.
 * web-vitals 5 has no public observer unsubscribe; detach only removes this bridge.
 * @returns {object} Explicit attach/detach bridge without automatic observer startup.
 */
export function createPageINPSource() {
  let receive:
    | ((
        metric: Parameters<
          ReturnType<
            typeof createBrowserPerformanceAnalytics
          >['receiveWebVital']
        >[0]
      ) => unknown)
    | undefined;
  let started = false;
  return {
    /** Attach one explicitly consented supported bridge; register the maintained source only once per page.
     * @param {ReturnType<typeof createBrowserPerformanceAnalytics>} bridge - Borrowed explicitly consented page bridge.
     * @returns {function} Detach only this bridge callback; the library observer remains page-owned.
     */
    attach(bridge: ReturnType<typeof createBrowserPerformanceAnalytics>) {
      /** Borrowed sanitized bridge snapshot checked before attaching the optional INP source. */
      const state = bridge.snapshot();
      if (state.consent !== 'granted' || state.coverage.INP === 'unsupported') {
        return () => {};
      }
      /** Current bridge receiver; detach removes only this exact callback, not library observers. */
      const callback = bridge.receiveWebVital;
      receive = callback;
      if (!started) {
        started = true;
        onINP((metric) => receive?.(metric), { reportAllChanges: true });
      }
      return () => {
        if (receive === callback) {
          receive = undefined;
        }
      };
    },
  };
}
