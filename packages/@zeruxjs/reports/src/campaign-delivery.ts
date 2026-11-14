import type { ChartData } from './types.js';

/** Minimal, PII-free interface produced by @zeruxjs/queue's campaign reporter. */
export interface CampaignDeliverySnapshot {
  /** Opaque authorized campaign reference, never recipient identity. */
  campaignId: string;
  /** Whether the underlying current-state scope is complete; not proof of inbox delivery/history completeness. */
  complete: boolean;
  /** Actual scanned persisted records, distinct from a global population when partial. */
  scanned: number;
  /** Known finite durable SMTP-state totals; sent means transport acceptance only. */
  counts: Record<
    | 'pending'
    | 'claimed'
    | 'sending'
    | 'sent'
    | 'suppressed'
    | 'uncertain'
    | 'rejected',
    number
  >;
  /** Bounded ordered UTC labels and known state/event totals; no synthetic build-time dates. */
  days: Array<{
    /** Source-owned UTC day label; no automatic timezone rebucketing. */
    day: string;
    /** Durable SMTP accepted-state count, not inbox confirmation. */
    sent: number;
    /** Durable suppression count. */
    suppressed: number;
    /** Unknown SMTP acceptance count; never silently reinterpret as failed. */
    uncertain: number;
    /** Remaining known state totals for this day. */
    other: number;
  }>;
}
/** Project current durable SMTP states and ordered UTC-day labels. Complete refers to scan coverage, not inbox delivery or an immutable multi-query snapshot.
 * @param {CampaignDeliverySnapshot} report - Authorized aggregate snapshot; do not pass private recipient records or assume cross-store transactional consistency.
 * @returns {{statuses:ChartData;sentByDay:ChartData}} Finite chart data with honest provenance, or malformed-source rejection; no source query or permission grant occurs.
 */
export function campaignDeliveryCharts(report: CampaignDeliverySnapshot): {
  statuses: ChartData;
  sentByDay: ChartData;
} {
  /** Known durable state categories, never arbitrary report expressions. */
  const labels = [
    'pending',
    'claimed',
    'sending',
    'sent',
    'suppressed',
    'uncertain',
    'rejected',
  ] as const;
  if (
    !report ||
    !Number.isSafeInteger(report.scanned) ||
    report.scanned < 0 ||
    typeof report.complete !== 'boolean' ||
    labels.some(
      (key) =>
        !Number.isSafeInteger(report.counts?.[key]) || report.counts[key] < 0
    ) ||
    labels.reduce((total, key) => total + report.counts[key], 0) !==
      report.scanned ||
    !Array.isArray(report.days) ||
    report.days.length > 5000
  ) {
    throw new TypeError('Invalid campaign snapshot');
  }
  /** Fresh UTC-label sorted daily projection; never mutate the supplied snapshot. */
  const ordered = [...report.days].sort((a, b) => a.day.localeCompare(b.day));
  if (
    ordered.some(
      (d, i) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(d.day) ||
        (i > 0 && d.day === ordered[i - 1]!.day) ||
        !['sent', 'suppressed', 'uncertain', 'other'].every(
          (key) =>
            Number.isSafeInteger(d[key as keyof typeof d]) &&
            Number(d[key as keyof typeof d]!) >= 0
        )
    )
  ) {
    throw new TypeError('Invalid delivery timeline');
  }
  if (
    ordered.reduce(
      (sum, d) => sum + d.sent + d.suppressed + d.uncertain + d.other,
      0
    ) !== report.scanned
  ) {
    throw new TypeError('Delivery report timeline mismatch');
  }
  /** Explicit sample/truncation or transition provenance shared across projections. */
  const shared = { sampledRows: report.scanned, truncated: !report.complete };
  return {
    statuses: {
      ...shared,
      id: 'campaign_delivery_status',
      title: 'Durable SMTP delivery states',
      type: 'bar',
      labels: [...labels],
      values: labels.map((key) => report.counts[key]),
      total: report.scanned,
    },
    sentByDay: {
      ...shared,
      id: 'campaign_sent_by_day',
      title: 'SMTP accepted by UTC day',
      type: 'line',
      labels: ordered.map((d) => d.day),
      values: ordered.map((d) => d.sent),
      total: report.counts.sent,
    },
  };
}

/** Exact SQL/Mongo grouped state totals. Provider outcomes are event counts only. */
export interface CampaignPerformanceSnapshot {
  /** Opaque authorized campaign reference, never recipient identity. */
  campaignId: string;
  /** Explicit database-native aggregate mode, distinct from sampled raw rows. */
  mode: 'database';
  /** Whether the underlying current-state scope is complete; not proof of inbox delivery/history completeness. */
  complete: true;
  /** Validated persisted record/state/transition total appropriate to this snapshot. */
  total: number;
  /** Known finite durable SMTP-state totals; sent means transport acceptance only. */
  counts: CampaignDeliverySnapshot['counts'];
  /** Not computed by the all-time native reporter; no synthetic timeline. */
  dailyCoverage: 'not-computed';
  /** Not computed from SMTP state/provider notifications. */
  activityCoverage: 'not-computed';
  /** Optional source ratio for current durable acceptance, never a provider reputation score. */
  smtpAcceptedPercent: number | null;
  /** Optional authenticated provider-notification totals; null means unavailable/not configured. */
  provider: null | {
    /** Reported provider event count, not unique messages/people. */
    events: number;
    /** Explicit recorded/reported/observed scope; missing history is not claimed complete. */
    coverage: 'reported-events-only';
    /** Known finite durable SMTP-state totals; sent means transport acceptance only. */
    counts: Record<
      'delivered' | 'deferred' | 'hard-bounce' | 'soft-bounce' | 'complaint',
      number
    >;
  };
}
/** Project native persisted current-state totals with explicit optional provider-notification coverage. Never fabricate unavailable timeline/activity data.
 * @param {CampaignPerformanceSnapshot} report - Authorized aggregate snapshot; do not pass private recipient records or assume cross-store transactional consistency.
 * @returns {{statuses:ChartData;providerOutcomes:ChartData|null}} Finite chart data with honest provenance, or malformed-source rejection; no source query or permission grant occurs.
 */
export function campaignPerformanceCharts(
  report: CampaignPerformanceSnapshot
): { statuses: ChartData; providerOutcomes: ChartData | null } {
  /** Known durable state categories, never arbitrary report expressions. */
  const labels = [
    'pending',
    'claimed',
    'sending',
    'sent',
    'suppressed',
    'uncertain',
    'rejected',
  ] as const;
  if (
    !report ||
    report.mode !== 'database' ||
    report.complete !== true ||
    report.dailyCoverage !== 'not-computed' ||
    report.activityCoverage !== 'not-computed' ||
    !Number.isSafeInteger(report.total) ||
    report.total < 0 ||
    labels.some(
      (label) =>
        !Number.isSafeInteger(report.counts?.[label]) ||
        report.counts[label] < 0
    ) ||
    labels.reduce((sum, k) => sum + report.counts[k], 0) !== report.total ||
    (report.smtpAcceptedPercent !== null &&
      (!Number.isFinite(report.smtpAcceptedPercent) ||
        report.smtpAcceptedPercent < 0 ||
        report.smtpAcceptedPercent > 100))
  ) {
    throw new TypeError('Invalid native campaign performance');
  }
  /** Current durable-state chart, separate from provider outcomes. */
  const statuses: ChartData = {
    id: 'campaign_all_time_statuses',
    title: 'All-time durable SMTP delivery states',
    type: 'bar',
    labels: [...labels],
    values: labels.map((label) => report.counts[label]),
    total: report.total,
    sampledRows: report.total,
    truncated: false,
    queryMode: 'database',
  };
  if (report.provider === null) {
    return { statuses, providerOutcomes: null };
  }
  /** Fixed authenticated provider-notification vocabulary. */
  const providerLabels = [
    'delivered',
    'deferred',
    'hard-bounce',
    'soft-bounce',
    'complaint',
  ] as const;
  /** Borrowed already authorized provider aggregate; no source call or credential ownership. */
  const provider = report.provider;
  if (
    provider.coverage !== 'reported-events-only' ||
    !Number.isSafeInteger(provider.events) ||
    provider.events < 0 ||
    providerLabels.some(
      (label) =>
        !Number.isSafeInteger(provider.counts?.[label]) ||
        provider.counts[label] < 0
    ) ||
    providerLabels.reduce((sum, k) => sum + provider.counts[k], 0) !==
      provider.events
  ) {
    throw new TypeError('Invalid provider event summary');
  }
  return {
    statuses,
    providerOutcomes: {
      id: 'campaign_provider_reported',
      title: 'Authenticated provider notifications (reported events only)',
      type: 'bar',
      labels: [...providerLabels],
      values: providerLabels.map((label) => provider.counts[label]),
      total: provider.events,
      sampledRows: provider.events,
      truncated: false,
      queryMode: 'database',
    },
  };
}

/** Database-native daily trends. Counts reflect the last durable state update,
 * not an immutable event log or inbox delivery. Provider results are notifications,
 * which can include multiple events for a single message. */
export interface CampaignDailyTrendsSnapshot {
  /** Opaque authorized campaign reference, never recipient identity. */
  campaignId: string;
  /** Inclusive source-owned UTC day boundary. */
  from: string;
  /** Inclusive source-owned UTC day boundary. */
  to: string;
  /** Explicit database-native aggregate mode, distinct from sampled raw rows. */
  mode: 'database';
  /** Whether the underlying current-state scope is complete; not proof of inbox delivery/history completeness. */
  complete: true;
  /** Last-state-update-day provenance, not immutable transition history. */
  deliveryCoverage: 'last-state-update-day';
  /** Reported-events-only or not-configured; null coverage is not zero events. */
  providerCoverage: 'reported-events-only' | 'not-configured';
  /** False: separate underlying reads are not a pinned cross-query snapshot. */
  snapshotConsistent: false;
  /** Validated persisted record/state/transition total appropriate to this snapshot. */
  total: number;
  /** Observed notification total or null when no provider source exists. */
  providerEvents: number | null;
  /** Bounded ordered UTC labels and known state/event totals; no synthetic build-time dates. */
  days: Array<{
    /** Source-owned UTC day label; no automatic timezone rebucketing. */
    day: string;
    /** Known finite durable SMTP-state totals; sent means transport acceptance only. */
    counts: CampaignDeliverySnapshot['counts'];
    /** Validated persisted record/state/transition total appropriate to this snapshot. */
    total: number;
    /** Optional authenticated provider-notification totals; null means unavailable/not configured. */
    provider: Record<
      'delivered' | 'deferred' | 'hard-bounce' | 'soft-bounce' | 'complaint',
      number
    > | null;
    /** Observed notification total or null when no provider source exists. */
    providerEvents: number | null;
  }>;
}
/** Project bounded ordered last-state-update-day and provider-notification counts. These measure separate facts; snapshotConsistent remains false.
 * @param {CampaignDailyTrendsSnapshot} report - Authorized aggregate snapshot; do not pass private recipient records or assume cross-store transactional consistency.
 * @returns {{smtpSentByDay:ChartData;providerDeliveredByDay:ChartData|null}} Finite chart data with honest provenance, or malformed-source rejection; no source query or permission grant occurs.
 */
export function campaignDailyTrendsCharts(
  report: CampaignDailyTrendsSnapshot
): { smtpSentByDay: ChartData; providerDeliveredByDay: ChartData | null } {
  if (
    !report ||
    report.mode !== 'database' ||
    report.complete !== true ||
    report.snapshotConsistent !== false ||
    report.deliveryCoverage !== 'last-state-update-day' ||
    !['reported-events-only', 'not-configured'].includes(
      report.providerCoverage
    ) ||
    !/^\d{4}-\d\d-\d\d$/.test(report.from) ||
    !/^\d{4}-\d\d-\d\d$/.test(report.to) ||
    !Array.isArray(report.days) ||
    report.days.length > 366 ||
    !Number.isSafeInteger(report.total) ||
    report.total < 0
  ) {
    throw new TypeError('Invalid campaign daily trends');
  }
  /** Fixed current SMTP state vocabulary for day-total consistency checks. */
  const states = [
    'pending',
    'claimed',
    'sending',
    'sent',
    'suppressed',
    'uncertain',
    'rejected',
  ] as const;
  /** Fixed provider event vocabulary; events are not unique recipients. */
  const kinds = [
    'delivered',
    'deferred',
    'hard-bounce',
    'soft-bounce',
    'complaint',
  ] as const;
  /** Sum explicit validated finite counts for consistency; no hidden source scan.
   * @param {number[]} values - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {number} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);
  let previous = '';
  // Validate only the bounded ordered source-day set; never reconstruct absent events.
  for (const day of report.days) {
    if (
      !day ||
      !/^\d{4}-\d\d-\d\d$/.test(day.day) ||
      day.day <= previous ||
      day.day < report.from ||
      day.day > report.to ||
      !Number.isSafeInteger(day.total) ||
      day.total < 0 ||
      states.some(
        (key) => !Number.isSafeInteger(day.counts?.[key]) || day.counts[key] < 0
      ) ||
      sum(states.map((k) => day.counts[k])) !== day.total
    ) {
      throw new TypeError('Invalid campaign daily state counts');
    }
    previous = day.day;
    if (report.providerCoverage === 'reported-events-only') {
      if (
        !day.provider ||
        kinds.some(
          (k) =>
            !Number.isSafeInteger(day.provider?.[k]) || day.provider![k] < 0
        ) ||
        !Number.isSafeInteger(day.providerEvents) ||
        sum(kinds.map((k) => day.provider![k])) !== day.providerEvents
      ) {
        throw new TypeError('Invalid daily provider notifications');
      }
    } else if (day.provider !== null || day.providerEvents !== null) {
      throw new TypeError('Unexpected provider trend data');
    }
  }
  if (
    sum(report.days.map((d) => d.total)) !== report.total ||
    (report.providerCoverage === 'reported-events-only'
      ? sum(report.days.map((d) => d.providerEvents!)) !== report.providerEvents
      : report.providerEvents !== null)
  ) {
    throw new TypeError('Inconsistent daily campaign trend totals');
  }
  /** Shared source-owned UTC labels and native mode, not a snapshot guarantee. */
  const common = {
    labels: report.days.map((d) => d.day),
    truncated: false,
    queryMode: 'database' as const,
  };
  /** Current SMTP-sent states grouped by last update date, not transition counts. */
  const smtpSentByDay: ChartData = {
    ...common,
    id: 'campaign_daily_last_update_sent',
    title: 'Current SMTP-sent state by last update UTC day',
    type: 'line',
    values: report.days.map((d) => d.counts.sent),
    total: sum(report.days.map((d) => d.counts.sent)),
    sampledRows: report.total,
  };
  /** Provider-reported delivery notifications; null when unconfigured, never fabricated zeros. */
  const providerDeliveredByDay: ChartData | null =
    report.providerCoverage === 'reported-events-only'
      ? {
          ...common,
          id: 'campaign_daily_provider_delivered',
          title: 'Provider-reported delivery notifications by UTC day',
          type: 'line',
          values: report.days.map((d) => d.provider!.delivered),
          total: sum(report.days.map((d) => d.provider!.delivered)),
          sampledRows: report.providerEvents!,
        }
      : null;
  return { smtpSentByDay, providerDeliveredByDay };
}

/** Immutable transition history (as observed and journaled).
 * Counts are transitions into a state, not current delivery states or unique recipients. */
export interface CampaignTransitionHistorySnapshot {
  /** Opaque authorized campaign reference, never recipient identity. */
  campaignId: string;
  /** Inclusive source-owned UTC day boundary. */
  from: string;
  /** Inclusive source-owned UTC day boundary. */
  to: string;
  /** Explicit recorded/reported/observed scope; missing history is not claimed complete. */
  coverage: 'recorded-transitions-only';
  /** False: separate underlying reads are not a pinned cross-query snapshot. */
  snapshotConsistent: false;
  /** Bounded ordered UTC labels and known state/event totals; no synthetic build-time dates. */
  days: Array<{
    /** Source-owned UTC day label; no automatic timezone rebucketing. */
    day: string;
    /** Known finite durable SMTP-state totals; sent means transport acceptance only. */
    counts: CampaignDeliverySnapshot['counts'];
    /** Validated persisted record/state/transition total appropriate to this snapshot. */
    total: number;
  }>;
}
/** Project only observed/journaled transitions into states, not current states or unique recipients. Missing historical transitions cannot be reconstructed by a chart.
 * @param {CampaignTransitionHistorySnapshot} report - Authorized aggregate snapshot; do not pass private recipient records or assume cross-store transactional consistency.
 * @returns {{sentTransitions:ChartData;uncertainTransitions:ChartData}} Finite chart data with honest provenance, or malformed-source rejection; no source query or permission grant occurs.
 */
export function campaignTransitionHistoryCharts(
  report: CampaignTransitionHistorySnapshot
): { sentTransitions: ChartData; uncertainTransitions: ChartData } {
  if (
    !report ||
    report.coverage !== 'recorded-transitions-only' ||
    report.snapshotConsistent !== false ||
    !/^\d{4}-\d{2}-\d{2}$/.test(report.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(report.to) ||
    !Array.isArray(report.days) ||
    report.days.length > 366
  ) {
    throw new TypeError('Invalid campaign transition history');
  }
  /** Current durable-state chart, separate from provider outcomes. */
  const statuses = [
    'pending',
    'claimed',
    'sending',
    'sent',
    'suppressed',
    'uncertain',
    'rejected',
  ] as const;
  let previous = '';
  let total = 0;
  // Validate only the bounded ordered source-day set; never reconstruct absent events.
  for (const day of report.days) {
    if (
      !day ||
      !/\d{4}-\d{2}-\d{2}/.test(day.day) ||
      day.day <= previous ||
      day.day < report.from ||
      day.day > report.to ||
      !Number.isSafeInteger(day.total) ||
      day.total < 0 ||
      statuses.some(
        (key) => !Number.isSafeInteger(day.counts?.[key]) || day.counts[key] < 0
      ) ||
      statuses.reduce((sum, key) => sum + day.counts[key], 0) !== day.total
    ) {
      throw new TypeError('Invalid historical transition day');
    }
    total += day.total;
    previous = day.day;
  }
  if (!Number.isSafeInteger(total)) {
    throw new TypeError('Transition count overflow');
  }
  /** Explicit sample/truncation or transition provenance shared across projections. */
  const shared = {
    labels: report.days.map((d) => d.day),
    queryMode: 'database' as const,
    sampledRows: total,
    truncated: false,
  };
  /** Project one known journaled state into a transition chart without inventing missing history.
   * @param {"sent" | "uncertain"} key - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {string} name - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {ChartData} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const chart = (key: 'sent' | 'uncertain', name: string): ChartData => ({
    ...shared,
    id: `campaign_history_${key}`,
    title: name,
    type: 'line',
    values: report.days.map((d) => d.counts[key]),
    total: report.days.reduce((sum, day) => sum + day.counts[key], 0),
  });
  return {
    sentTransitions: chart('sent', 'Observed transitions into SMTP-sent state'),
    uncertainTransitions: chart(
      'uncertain',
      'Observed uncertain SMTP transitions'
    ),
  };
}
