import type {AnalyticsManager} from '@zeruxjs/analytics';

// Both callbacks come from authenticated server context, never query parameters.
export async function checkoutFunnel(
  analytics: AnalyticsManager,
  verifiedSite: string,
  authorize: () => Promise<boolean>,
  signal: AbortSignal
) {
  const analysis = analytics.createAnalysis({site: verifiedSite, authorize, maxEvents: 5000});
  const until = Date.now();
  try {
    return await analysis.funnel({
      since: until - 86400000, until,
      steps: ['checkout.start', 'purchase'], conversionWindowMs: 3600000
    }, {signal});
  } finally {
    await analysis.close(); // drains reads, never closes the borrowed database
  }
}
