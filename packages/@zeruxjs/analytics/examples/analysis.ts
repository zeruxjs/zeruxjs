import type { AnalyticsManager } from '@zeruxjs/analytics';

// Both callbacks come from authenticated server context, never query parameters.
/** Run a bounded synthetic checkout report using authenticated host context. Query parameters must not choose site or authorization.
 * @param {AnalyticsManager} analytics - Borrowed application manager.
 * @param {string} verifiedSite - Host-verified tenant/site.
 * @param {() => Promise<boolean>} authorize - Fresh host permission check.
 * @param {AbortSignal} signal - Caller cancellation; native work is still drained in finally.
 * @returns {Promise<Awaited<ReturnType<ReturnType<AnalyticsManager['createAnalysis']>['funnel']>>>} Observed funnel and coverage; reporting failures reject.
 */
export async function checkoutFunnel(
  analytics: AnalyticsManager,
  verifiedSite: string,
  authorize: () => Promise<boolean>,
  signal: AbortSignal
) {
  /** Owned tenant-bound cooperative analysis scope; finally drains it without closing the host database. */
  const analysis = analytics.createAnalysis({
    site: verifiedSite,
    authorize,
    maxEvents: 5000,
  });
  /** Server-time exclusive end of the bounded last-day funnel window. */
  const until = Date.now();
  try {
    return await analysis.funnel(
      {
        since: until - 86400000,
        until,
        steps: ['checkout.start', 'purchase'],
        conversionWindowMs: 3600000,
      },
      { signal }
    );
  } finally {
    await analysis.close(); // drains reads, never closes the borrowed database
  }
}
