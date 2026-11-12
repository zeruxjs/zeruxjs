/** Bounded crash recovery for durable email records. Never retries a possibly submitted message. */
import type {
  DurableEmailDeliveryRecord,
  DurableEmailDeliveryStore,
} from './delivery.js';
import type { CampaignDeliverySource } from './reporting.js';
/** Conservative opaque campaign grammar; host still authorizes the selected campaign. */
const campaignIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Conservative opaque durable message/cursor grammar; never a recipient identity. */
const messageIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Create an explicit bounded campaign scan over a borrowed durable store. Expired pre-SMTP claims may return to pending; sending claims become uncertain and are never automatically resent.
 * @param {object} options - Durable CAS/page source and optional trusted clock; host owns authorization and store lifetime.
 * @param {DurableEmailDeliveryStore & CampaignDeliverySource} options.store - Borrowed linearizable durable store and ordered source.
 * @param {function} [options.now] - Trusted current clock.
 * @returns {function} Explicit paged scanner, preview-only by default; no background job or new close owner.
 */
export function createEmailDeliveryRecoveryScanner(options: {
  /** Borrowed durable CAS store with bounded campaign pagination; never closed by the scanner. */
  store: DurableEmailDeliveryStore & CampaignDeliverySource;
  /** Optional trusted epoch-millisecond clock, default Date.now. */
  now?: () => number;
}) {
  if (
    !options ||
    typeof options.store?.load !== 'function' ||
    typeof options.store?.save !== 'function' ||
    typeof options.store?.pageCampaign !== 'function'
  ) {
    throw new TypeError('Durable store with campaign pagination required');
  }
  /** Borrowed trusted clock; each recovery scan validates its reading. */
  const clock = options.now ?? Date.now;
  /** Process one bounded authorized campaign page, preserving preview and uncertain-send semantics.
   * @param {string} campaignId - Explicit authorized durable campaign ID.
   * @param {object} options - Bounded cursor/limit and explicit preview policy.
   * @param {string | null} [options.cursor] - Exclusive ordered message continuation.
   * @param {number} [options.limit] - Default 100, maximum 200 selected records.
   * @param {boolean} [options.dryRun] - Default true; false enables guarded writes.
   * @returns {Promise<object>} Coverage-labelled observed counters and bounded continuation, never recipient data.
   */
  return async function scan(
    campaignId: string,
    {
      cursor = null,
      limit = 100,
      dryRun = true,
    }: {
      /** Exclusive bounded opaque message continuation or null. */
      cursor?: string | null;
      /** Selected records per scan, default 100 and maximum 200. */
      limit?: number;
      /** Preview-only by default; explicit false enables guarded state/intent writes. */
      dryRun?: boolean;
    } = {}
  ) {
    if (
      !campaignIdPattern.test(campaignId) ||
      (cursor !== null && !messageIdPattern.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      typeof dryRun !== 'boolean'
    ) {
      throw new TypeError('Invalid delivery recovery bounds');
    }
    /** Validated current epoch milliseconds for one explicit recovery page. */
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Invalid recovery clock');
    }
    /** Finite ordered campaign page including one lookahead record. */
    const rows = await options.store.pageCampaign(
      campaignId,
      cursor,
      limit + 1
    );
    if (!Array.isArray(rows) || rows.length > limit + 1) {
      throw new Error('Recovery source page invalid');
    }
    /** Whether a lookahead record proves this page has a continuation. */
    const more = rows.length > limit;
    /** Selected bounded records, excluding the lookahead. */
    const chosen = rows.slice(0, limit);
    let expiredClaims = 0,
      uncertainSubmissions = 0,
      recoveredClaims = 0,
      markedUncertain = 0,
      contended = 0,
      previous = cursor;
    // Check only the bounded ordered page, reloading durable state before any guarded mutation.
    for (const row of chosen) {
      if (
        row.campaignId !== campaignId ||
        !messageIdPattern.test(row.id) ||
        (previous !== null && row.id <= previous)
      ) {
        throw new Error('Out-of-scope recovery page');
      }
      previous = row.id;
      if (row.state !== 'claimed' && row.state !== 'sending') {
        continue;
      }
      /** Fresh durable record reloaded before deciding lease recovery; stale page facts are insufficient. */
      const current = await options.store.load(row.id);
      if (
        !current ||
        current.id !== row.id ||
        current.campaignId !== campaignId ||
        current.state !== row.state ||
        !current.lease ||
        !Number.isSafeInteger(current.lease.expiresAt) ||
        current.lease.expiresAt > now
      ) {
        continue;
      }
      if (current.state === 'claimed') {
        expiredClaims++;
      } else {
        uncertainSubmissions++;
      }
      if (dryRun) {
        continue;
      }
      /** Exact next durable revision with claim recovery or explicit uncertainty, never SMTP replay. */
      const next: DurableEmailDeliveryRecord = {
        ...current,
        version: current.version + 1,
        updatedAt: now,
        state: current.state === 'claimed' ? 'pending' : 'uncertain',
        lease: null,
        ...(current.state === 'sending' ? { completedAt: now } : {}),
      };
      if (await options.store.save(row.id, next, current.version)) {
        if (next.state === 'pending') {
          recoveredClaims++;
        } else {
          markedUncertain++;
        }
      } else {
        contended++;
      }
    }
    return {
      campaignId,
      scanned: chosen.length,
      expiredClaims,
      uncertainSubmissions,
      recoveredClaims,
      markedUncertain,
      contended,
      dryRun,
      nextCursor: more ? chosen.at(-1)!.id : null,
      done: !more,
      automaticSmtpRetry: false as const,
    };
  };
}

/** Repair only the database crash window between a pending delivery record and publish-intent registration after explicit campaign permission. Never reads recipients or creates intent for possibly sent work.
 * @param {object} options - Borrowed durable source/outbox and required fresh campaign approval.
 * @param {CampaignDeliverySource} options.source - Borrowed ordered campaign source.
 * @param {object} options.outbox - Durable publish-intent ledger.
 * @param {function} options.outbox.get - Read an existing intent by opaque message ID.
 * @param {function} options.outbox.register - Persist only the explicitly approved missing intent.
 * @param {function} options.allowCampaign - Fresh verified campaign permission.
 * @returns {function} Explicit bounded preview-first scanner; no Redis send, automatic timer or durable idempotency replacement.
 */
export function createMissingEmailPublishIntentScanner(options: {
  /** Borrowed bounded campaign source scoped by explicit campaign authorization. */
  source: CampaignDeliverySource;
  /** Borrowed durable intent ledger; no raw recipients or MIME bodies enter it. */
  outbox: {
    /** Read the existing publish intent for this opaque durable message reference.
     * @param {string} id - Opaque synthetic/application durable message ID, not an email address.
     * @returns {Promise<unknown>} Borrowed outbox record or absence; host store policy remains authoritative.
     */
    get(id: string): Promise<unknown>;
    /** Create durable publish intent with stable original schedule/retry policy, not a direct SMTP send.
     * @param {string} id - Existing authorized pending message ID.
     * @param {object} opts - Explicit persisted schedule/attempt policy.
     * @param {number} opts.scheduledAt - Immutable intended publication time.
     * @param {number} opts.attempts - Configured native retry count.
     * @returns {Promise<unknown>} Owning outbox receipt after durable registration; no broker acceptance implied.
     */
    register(
      id: string,
      opts: {
        /** Explicit immutable intended publication time in epoch milliseconds. */
        scheduledAt: number;
        /** Explicit native attempt count, default five and valid 1 through 20. */
        attempts: number;
      }
    ): Promise<unknown>;
  };
  /** Required fresh host campaign permission callback; literal true only. */
  allowCampaign: (campaignId: string) => Promise<boolean> | boolean;
}) {
  if (
    !options?.source ||
    typeof options.source.pageCampaign !== 'function' ||
    typeof options.outbox?.get !== 'function' ||
    typeof options.outbox?.register !== 'function' ||
    typeof options.allowCampaign !== 'function'
  ) {
    throw new TypeError(
      'Missing-intent repair requires durable source, outbox and permission gate'
    );
  }
  /** Process one bounded authorized campaign page, preserving preview and uncertain-send semantics.
   * @param {string} campaignId - Explicit authorized durable campaign ID.
   * @param {object} options - Bounded cursor/limit and explicit preview policy.
   * @param {string | null} [options.cursor] - Exclusive ordered message continuation.
   * @param {number} [options.limit] - Default 100, maximum 200 selected records.
   * @param {boolean} [options.dryRun] - Default true; false enables guarded writes.
   * @param {number} options.scheduledAt - Explicit intended publication time.
   * @param {number} [options.attempts] - Native attempt count, default five.
   * @returns {Promise<object>} Coverage-labelled observed counters and bounded continuation, never recipient data.
   */
  return async function scan(
    campaignId: string,
    {
      cursor = null,
      limit = 100,
      scheduledAt,
      attempts = 5,
      dryRun = true,
    }: {
      /** Exclusive bounded opaque message continuation or null. */
      cursor?: string | null;
      /** Selected records per scan, default 100 and maximum 200. */
      limit?: number;
      /** Explicit immutable intended publication time in epoch milliseconds. */
      scheduledAt: number;
      /** Explicit native attempt count, default five and valid 1 through 20. */
      attempts?: number;
      /** Preview-only by default; explicit false enables guarded state/intent writes. */
      dryRun?: boolean;
    }
  ) {
    if (
      !campaignIdPattern.test(campaignId) ||
      (cursor !== null && !messageIdPattern.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isSafeInteger(scheduledAt) ||
      scheduledAt < 0 ||
      !Number.isSafeInteger(attempts) ||
      attempts < 1 ||
      attempts > 20 ||
      typeof dryRun !== 'boolean'
    ) {
      throw new TypeError('Invalid missing-intent repair bounds');
    }
    if ((await options.allowCampaign(campaignId)) !== true) {
      throw new Error('Campaign outbox repair forbidden');
    }
    /** Finite ordered campaign page including one lookahead record. */
    const rows = await options.source.pageCampaign(
      campaignId,
      cursor,
      limit + 1
    );
    if (!Array.isArray(rows) || rows.length > limit + 1) {
      throw new Error('Invalid missing-intent campaign page');
    }
    /** Whether a lookahead record proves this page has a continuation. */
    const more = rows.length > limit;
    /** Bounded selected pending-intent candidates, excluding lookahead. */
    const items = rows.slice(0, limit);
    let missing = 0,
      registered = 0,
      previous = cursor;
    // Check only the bounded ordered page, reloading durable state before any guarded mutation.
    for (const row of items) {
      if (
        row.campaignId !== campaignId ||
        !messageIdPattern.test(row.id) ||
        (previous !== null && row.id <= previous)
      ) {
        throw new Error('Out-of-scope missing-intent page');
      }
      previous = row.id;
      // Only new/pending records are eligible; completed or possibly submitted
      // messages cannot gain a new enqueue by running reconciliation.
      if (row.state !== 'pending') {
        continue;
      }
      /** Existing durable publish intent; a present record is never blindly replaced. */
      const present = await options.outbox.get(row.id);
      if (present) {
        continue;
      }
      missing++;
      if (!dryRun) {
        await options.outbox.register(row.id, { scheduledAt, attempts });
        registered++;
      }
    }
    return {
      campaignId,
      scanned: items.length,
      missing,
      registered,
      dryRun,
      done: !more,
      nextCursor: more ? items.at(-1)!.id : null,
    };
  };
}
