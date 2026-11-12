import type { ChartData, MarketingReportPage } from './types.js';

/** Finite recipient-state vocabulary; includes missing/notQueued and distinct SMTP acceptance. */
const deliveryLabels = [
  'notQueued',
  'pending',
  'claimed',
  'sending',
  'smtpAccepted',
  'suppressed',
  'uncertain',
  'rejected',
  'missing',
] as const;
/** Require safe nonnegative integer source counts.
 * @param {unknown} n - Explicit value for this documented owner/projection; host authorization remains separate.
 * @returns {boolean} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
 */
const num = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
/** Project bounded recipient states and verify page/total/cursor consistency. The underlying marketing service independently authorizes the tenant; page coverage never becomes a campaign-wide total.
 * @param {MarketingReportPage} page - Already host-authorized campaign recipient-state page; continuation/coverage must remain explicit.
 * @returns {{statuses:ChartData;coverage:object}} Finite chart data with honest provenance, or malformed-source rejection; no source query or permission grant occurs.
 */
export function marketingDeliveryPageCharts(page: MarketingReportPage): {
  statuses: ChartData;
  /** Explicit recorded/reported/observed scope; missing history is not claimed complete. */
  coverage: {
    scope: 'complete' | 'page';
    /** Actual scanned persisted records, distinct from a global population when partial. */
    scanned: number;
    nextCursor: string | null;
    done: boolean;
    disclaimer: string;
  };
} {
  if (
    !page ||
    typeof page.campaignCode !== 'string' ||
    !num(page.scanned) ||
    !['complete', 'page'].includes(page.scope) ||
    typeof page.done !== 'boolean' ||
    (page.nextCursor !== null && typeof page.nextCursor !== 'string') ||
    (page.done && page.nextCursor !== null) ||
    (!page.done && (!page.nextCursor || page.nextCursor.length > 1024)) ||
    typeof page.disclaimer !== 'string' ||
    !page.disclaimer.includes('not confirmed') ||
    deliveryLabels.some((k) => !num(page.states?.[k])) ||
    deliveryLabels.reduce((n, k) => n + page.states[k], 0) !== page.scanned ||
    (page.scope === 'complete' && (!page.done || page.nextCursor !== null))
  ) {
    throw new TypeError('Invalid marketing delivery page');
  }
  /** Page-versus-complete provenance retained separately from numeric totals. */
  const coverage = {
    scope: page.scope,
    scanned: page.scanned,
    nextCursor: page.nextCursor,
    done: page.done,
    disclaimer:
      'SMTP accepted is not proof of inbox delivery; this is a recipient page unless scope is complete.',
  };
  return {
    statuses: {
      id: 'marketing_delivery_states',
      title: 'Recipient states (SMTP acceptance only)',
      type: 'bar',
      labels: [...deliveryLabels],
      values: deliveryLabels.map((k) => page.states[k]),
      total: page.scanned,
      sampledRows: page.scanned,
      truncated: !page.done,
      queryMode: page.scope === 'complete' ? 'database' : 'sampled',
      coverage:
        page.scope === 'complete'
          ? 'complete-recipient-scan'
          : 'page-of-recipient-states',
    },
    coverage,
  };
}

export interface CampaignActivitySnapshot {
  /** Opaque host-authorized campaign reference. */
  campaignCode: string;
  /** Inclusive source-owned UTC day boundary. */
  from: string;
  /** Inclusive source-owned UTC day boundary. */
  to: string;
  /** Explicit recorded/reported/observed scope; missing history is not claimed complete. */
  coverage: 'observed-tracking-events-only';
  /** Event totals are not unique recipients or confirmed views; mail clients and blockers affect opens. */
  opens: number;
  /** Observed consent-aware click event count, not unique humans. */
  clicks: number;
  /** Observed download-link click events. */
  downloadClicks: number;
  /** Observed completed downloads from available tracking. */
  downloads: number;
  /** Unique verified recipients must not be asserted by this interface. */
  uniqueRecipients: null;
}
/** Project only observed consent-aware tracking totals. Pixels may be prefetched/blocked; clicks/opens are not unique people or proof of delivery.
 * @param {CampaignActivitySnapshot} input - Authorized observed tracking totals, not unique recipients or confirmed mailbox views.
 * @returns {{activity:ChartData;disclaimer:string}} Finite chart data with honest provenance, or malformed-source rejection; no source query or permission grant occurs.
 */
export function campaignActivityCharts(input: CampaignActivitySnapshot): {
  activity: ChartData;
  disclaimer: string;
} {
  if (
    !input ||
    typeof input.campaignCode !== 'string' ||
    input.coverage !== 'observed-tracking-events-only' ||
    !/^\d{4}-\d\d-\d\d$/.test(input.from) ||
    !/^\d{4}-\d\d-\d\d$/.test(input.to) ||
    input.from > input.to ||
    input.uniqueRecipients !== null ||
    !['opens', 'clicks', 'downloadClicks', 'downloads'].every((k) =>
      num(input[k as keyof CampaignActivitySnapshot])
    )
  ) {
    throw new TypeError('Invalid campaign activity snapshot');
  }
  /** Fixed observed tracking categories; never private recipient labels. */
  const keys = ['opens', 'clicks', 'downloadClicks', 'downloads'] as const;
  /** Known finite observed counts in the declared category order. */
  const values = keys.map((k) => input[k]);
  return {
    activity: {
      id: 'marketing_activity',
      title: 'Observed tracking events (not unique people)',
      type: 'bar',
      labels: [...keys],
      values,
      total: values.reduce((a, b) => a + b, 0),
      sampledRows: 0,
      truncated: false,
      coverage: 'observed-tracking-events-only',
    },
    disclaimer:
      'Open pixels can be blocked or prefetched; clicks are observed events, not unique users or confirmed deliveries. Tracking must be explicitly enabled and permitted.',
  };
}
