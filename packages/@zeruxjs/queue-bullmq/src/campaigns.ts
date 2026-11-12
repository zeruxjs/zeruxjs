import type { JobProcessor, ZeruxQueue, BullJobLike } from './index.js';
/** Conservative opaque campaign grammar; not a tenant permission check. */
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Publish only an opaque campaign reference and monotonic page sequence through the borrowed native queue. Stable job IDs deduplicate only while retained; host durable idempotency remains required.
 * @param {ZeruxQueue} queue - Borrowed configured native producer; enclosing service owns close.
 * @param {string} id - Validated opaque durable campaign reference.
 * @param {object} options - Explicit sequence and native delay policy.
 * @param {number} [options.sequence] - Monotonic page number, default zero.
 * @param {number} [options.delay] - Native persisted delay milliseconds, default zero.
 * @returns {Promise<BullJobLike>} Native acceptance receipt, not recipient delivery or permanent deduplication.
 */
export async function enqueueCampaignPlan(
  queue: ZeruxQueue,
  id: string,
  options: {
    /** Monotonic page sequence, default zero and at most one billion. */
    sequence?: number; /** Native delay milliseconds, default zero and at most 365 days. */
    delay?: number;
  } = {}
): Promise<BullJobLike> {
  /** Validated page sequence used in stable native job identity. */
  const sequence = options.sequence ?? 0;
  /** Validated native persisted delay; no per-process timer is created. */
  const delay = options.delay ?? 0;
  if (
    !idPattern.test(id) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence > 1_000_000_000 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 365 * 86_400_000
  ) {
    throw new TypeError('Invalid campaign scheduling request');
  }
  return queue.add(
    'campaign.plan',
    { campaignId: id, sequence },
    {
      jobId: `campaign-${id}-${sequence}`,
      delay,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    }
  );
}
/** Bind only explicitly registered trusted durable planners. Process one page and request the next through a host callback; no source discovery, scheduler or exactly-once guarantee.
 * @param {object} options - Code-owned planner allowlist and explicit next-page publisher.
 * @param {Record<string,object>} options.planners - Explicit trusted bounded planner map.
 * @param {function} options.scheduleNext - Host-owned next-page publication respecting scheduled time.
 * @returns {JobProcessor} Explicit processor; the native worker/service owns execution and shutdown.
 */
export function createCampaignPlanningProcessor(options: {
  /** Explicit code-owned durable planner map; unknown campaign IDs reject. */
  planners: Record<
    string,
    {
      /** Trusted bounded planner callback; host owns durable claim/checkpoint and idempotency. */
      runOnce: (
        id: string,
        owner: string
      ) => Promise<{
        /** Explicit planner state; busy is retried under the host/native worker policy. */
        status: string; /** Observed bounded page work, not proof of a complete campaign. */
        processed: number;
      }>;
    }
  >;
  /** Schedule next page; if status is scheduled, respect the campaign's future sendAt. */
  scheduleNext: (
    id: string,
    sequence: number,
    status: 'running' | 'scheduled'
  ) => Promise<unknown>;
}): JobProcessor {
  if (!options || typeof options.scheduleNext !== 'function') {
    throw new TypeError('A campaign scheduling callback is required');
  }
  return async (job) => {
    if (
      job.name !== 'campaign.plan' ||
      typeof job.data?.campaignId !== 'string' ||
      !idPattern.test(job.data.campaignId) ||
      !Number.isSafeInteger(job.data.sequence) ||
      Number(job.data.sequence) < 0 ||
      Number(job.data.sequence) > 1_000_000_000
    ) {
      throw new TypeError('Invalid campaign job');
    }
    /** Validated opaque campaign reference from the fixed job envelope. */
    const id = job.data.campaignId;
    /** Validated page sequence used in stable native job identity. */
    const sequence = Number(job.data.sequence);
    /** Exact code-owned planner selected only after own-property membership validation. */
    const planner = options.planners[id];
    if (!Object.hasOwn(options.planners, id) || !planner) {
      throw new Error('Unknown campaign planner');
    }
    /** Single durable planner page outcome used to decide explicit next scheduling. */
    const result = await planner.runOnce(id, `bullmq-${sequence}`);
    if (result.status === 'running' || result.status === 'scheduled') {
      await options.scheduleNext(id, sequence + 1, result.status);
    }
    // Scheduled (early) and busy results should retry via the application's scheduler.
    if (result.status === 'busy') {
      throw Object.assign(new Error('Campaign planner currently leased'), {
        code: 'CAMPAIGN_BUSY',
      });
    }
    return { status: result.status, processed: result.processed };
  };
}
