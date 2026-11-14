/** Adapt explicit campaign operational counters to a borrowed analytics service; committed campaign state remains authoritative.
 * @param {{
    track(event: {
      name: string;
      source: 'email';
      site: string;
      properties: Record<string, string | number>;
    }): Promise<unknown>;
  }} analytics - Explicit borrowed analytics instance; host verifies tenant/site binding and consent policy.
 * @param {(event: {name: string, source: "email", site: string, properties: Record<string, string | number>}) => Promise<unknown>} analytics.track - Borrowed collection callback; its failures must not block mail planning.
 * @param {string} site - Explicit bounded configured site identity; never inferred from incoming event payload.
 * @returns {(event: {campaignId: string, kind: "queued" | "scheduled" | "completed" | "cancelled", at: number, count: number}) => Promise<void>} Best-effort reporter; never enables recipient activity tracking, owns no analytics lifecycle.
 */
export function createCampaignAnalyticsReporter(
  analytics: {
    /** Collect one operational event under the injected analytics service consent/schema/site policy.
 * @param {{
      name: string;
      source: 'email';
      site: string;
      properties: Record<string, string | number>;
    }} event - Fixed operational name/source/site and approved scalar properties.
 * @returns {Promise<unknown>} Collection outcome; failures are isolated from committed campaign planning.
 */
    track(event: {
      /** One of the fixed email.campaign operational event names. */
      name: string;
      /** Fixed email source discriminator. */
      source: 'email';
      /** Host-verified bound site, not a caller-provided authorization claim. */
      site: string;
      /** Only campaignId/count are forwarded; no recipient/body/tracking flags. */
      properties: Record<string, string | number>;
    }): Promise<unknown>;
  },
  site: string
) {
  if (
    typeof analytics?.track !== 'function' ||
    typeof site !== 'string' ||
    !site.trim() ||
    site.length > 200
  ) {
    throw new TypeError('Invalid campaign analytics adapter');
  }
  return async (event: {
    /** Bounded opaque campaign reference; host must avoid embedding personal values. */
    campaignId: string;
    /** Explicit queued/scheduled/completed/cancelled operation kind. */
    kind: 'queued' | 'scheduled' | 'completed' | 'cancelled';
    /** Accepted caller metadata; this adapter does not forward it or synthesize persistence time. */
    at: number;
    /** Caller-provided counter forwarded to analytics validation; not independently validated here. */
    count: number;
  }) => {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(event.campaignId) ||
      !['queued', 'scheduled', 'completed', 'cancelled'].includes(event.kind)
    ) {
      return;
    }
    try {
      await analytics.track({
        name: `email.campaign.${event.kind}`,
        source: 'email',
        site,
        properties: { campaignId: event.campaignId, count: event.count },
      });
    } catch {
      /* telemetry may never block mail planning */
    }
  };
}
