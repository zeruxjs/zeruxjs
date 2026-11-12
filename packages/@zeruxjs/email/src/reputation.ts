import { createHash } from 'node:crypto';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
import { addressString, validateEmailAddress } from './validation.js';

export type ReputationEventKind =
  | 'accepted'
  | 'hard-bounce'
  | 'soft-bounce'
  | 'complaint';
export interface ReputationEvent {
  /** Authenticated SMTP result or trusted, signature-verified provider feedback. */
  id: string;
  /** Exact configured account identity; the ledger itself is not a tenant authorization boundary. */
  account: string;
  /** Authenticated observed accepted/bounce/complaint event kind. */
  kind: ReputationEventKind;
  /** Epoch observation/event time from authenticated host input. */
  at: number;
  /** Hash of recipient to avoid storing plaintext email in the reputation ledger. */
  recipientHash: string;
}
export interface ReputationLedger {
  /** Insert one private immutable identity once in the supplied ledger.
   * @param {ReputationEvent} event - Private authenticated SMTP/provider event; no payload/body is stored.
   * @returns {Promise<boolean>} New insert true, existing identity false; host qualifies actual durable uniqueness.
   */
  record(event: ReputationEvent): Promise<boolean>;
  /** Read an ordered bounded account/time page without claiming snapshot isolation.
   * @param {string} account - Exact configured account identity; host tenant binding remains external.
   * @param {number} since - Inclusive epoch lower bound for the recorded window.
   * @param {number} offset - Explicit page offset; no cursor/snapshot isolation is implied.
   * @param {number} limit - Requested bounded page size; service additionally validates response count.
   * @returns {Promise<ReputationEvent[]>} Private events sorted by immutable identity; concurrent changes may alter later pages.
   */
  page(
    account: string,
    since: number,
    offset: number,
    limit: number
  ): Promise<ReputationEvent[]>;
}
/** Bounded explicit configured account syntax; not a principal/tenant credential. */
const accountPattern = /^[a-z][a-z0-9_-]{0,63}$/;
/** Allowed provider-event identity syntax; verification remains host-owned. */
const trustedId = /^[A-Za-z0-9:_./-]{1,160}$/;
/** Validate and lowercase a private mailbox without authenticating its owner.
 * @param {string} email - Private literal mailbox.
 * @returns {string} Canonical mailbox for this legacy ledger. */
const canonical = (email: string) =>
  addressString(validateEmailAddress(email)).toLowerCase();
/** Hash a private canonical linkage value without claiming irreversible anonymization.
 * @param {string} input - Private account/message/recipient linkage data.
 * @returns {string} Legacy SHA-256 identity. */
const hash = (input: string) =>
  createHash('sha256').update(input).digest('hex');
/** Create a process-local cloned-event ledger for fixtures/development only.
 * @returns {ReputationLedger} Local unique event map; not a production durable or bounded retention store.
 */
export function createMemoryReputationLedger(): ReputationLedger {
  /** Process-local event map with unique IDs; host owns retained-history/resource budgets. */
  const entries = new Map<string, ReputationEvent>();
  return {
    /** Insert one private immutable identity once in the supplied ledger.
     * @param {ReputationEvent} event - Private authenticated SMTP/provider event; no payload/body is stored.
     * @returns {Promise<boolean>} New insert true, existing identity false; host qualifies actual durable uniqueness.
     */
    async record(event) {
      if (entries.has(event.id)) {
        return false;
      }
      entries.set(event.id, { ...event });
      return true;
    },
    /** Read an ordered bounded account/time page without claiming snapshot isolation.
     * @param {string} account - Exact configured account identity; host tenant binding remains external.
     * @param {number} since - Inclusive epoch lower bound for the recorded window.
     * @param {number} offset - Explicit page offset; no cursor/snapshot isolation is implied.
     * @param {number} limit - Requested bounded page size; service additionally validates response count.
     * @returns {Promise<ReputationEvent[]>} Private events sorted by immutable identity; concurrent changes may alter later pages.
     */
    async page(account, since, offset, limit) {
      return [...entries.values()]
        .filter((r) => r.account === account && r.at >= since)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(offset, offset + limit)
        .map((r) => ({ ...r }));
    },
  };
}
/** Adapt a borrowed structured database to unique insertion and ordered account/time scans.
 * @param {CampaignDatabaseConnection} db - Borrowed structured database; host qualifies unique insertion, committed reads and scope.
 * @param {string} table - Validated host table, default zerux_email_reputation_events.
 * @returns {ReputationLedger} Lazy schema owner only; native/database lifecycle and tenant scoping stay with the host.
 */
export function createDatabaseReputationLedger(
  db: CampaignDatabaseConnection,
  table = 'zerux_email_reputation_events'
): ReputationLedger {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) {
    throw new TypeError('Invalid reputation table');
  }
  let ready: Promise<void> | undefined;
  /** Coalesce lazy ledger schema initialization; failed attempts release the initialization promise.

 * @returns {Promise<void>} Schema accepted by the borrowed host database. */
  const ensure = () =>
    (ready ??= (async () => {
      /** Private native initialization/page result checked before reporting a heuristic. */
      const result = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: 'id',
            type: 'varchar',
            length: 64,
            primary: true,
            notNull: true,
          },
          { name: 'account', type: 'varchar', length: 64, notNull: true },
          { name: 'kind', type: 'varchar', length: 32, notNull: true },
          { name: 'occurred_at', type: 'bigint', notNull: true },
          {
            name: 'recipient_hash',
            type: 'varchar',
            length: 64,
            notNull: true,
          },
        ],
      });
      if (!result?.ok) {
        throw new Error('Reputation ledger initialization failed');
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  return {
    /** Insert one private immutable identity once in the supplied ledger.
     * @param {ReputationEvent} event - Private authenticated SMTP/provider event; no payload/body is stored.
     * @returns {Promise<boolean>} New insert true, existing identity false; host qualifies actual durable uniqueness.
     */
    async record(event) {
      await ensure();
      try {
        /** Private native insertion result or row projection, never provider delivery evidence. */
        const r = await db.insert({
          table,
          values: {
            id: event.id,
            account: event.account,
            kind: event.kind,
            occurred_at: event.at,
            recipient_hash: event.recipientHash,
          },
        });
        if (r?.ok) {
          return true;
        }
      } catch (error) {
        /** Exact existing event-ID lookup used to distinguish duplicates after failed insertion. */
        const prior = await db.select({
          table,
          columns: ['id'],
          where: { field: 'id', operator: 'eq', value: event.id },
          limit: 1,
        });
        if (prior?.ok && prior.rows?.length) {
          return false;
        }
        throw error;
      }
      /** Exact existing event-ID lookup used to distinguish duplicates after failed insertion. */
      const prior = await db.select({
        table,
        columns: ['id'],
        where: { field: 'id', operator: 'eq', value: event.id },
        limit: 1,
      });
      if (prior?.ok && prior.rows?.length) {
        return false;
      }
      throw new Error('Reputation event write failed');
    },
    /** Read an ordered bounded account/time page without claiming snapshot isolation.
     * @param {string} account - Exact configured account identity; host tenant binding remains external.
     * @param {number} since - Inclusive epoch lower bound for the recorded window.
     * @param {number} offset - Explicit page offset; no cursor/snapshot isolation is implied.
     * @param {number} limit - Requested bounded page size; service additionally validates response count.
     * @returns {Promise<ReputationEvent[]>} Private events sorted by immutable identity; concurrent changes may alter later pages.
     */
    async page(account, since, offset, limit) {
      await ensure();
      /** Private native initialization/page result checked before reporting a heuristic. */
      const result = await db.select({
        table,
        columns: ['id', 'account', 'kind', 'occurred_at', 'recipient_hash'],
        where: {
          and: [
            { field: 'account', operator: 'eq', value: account },
            { field: 'occurred_at', operator: 'gte', value: since },
          ],
        },
        orderBy: [{ by: 'id', direction: 'asc' }],
        offset,
        limit,
      });
      if (!result?.ok || !Array.isArray(result.rows)) {
        throw new Error('Reputation history lookup failed');
      }
      return result.rows.map((row) => {
        /** Private native insertion result or row projection, never provider delivery evidence. */
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id),
          account: String(r.account),
          kind: String(r.kind) as ReputationEventKind,
          at: Number(r.occurred_at),
          recipientHash: String(r.recipient_hash),
        };
      });
    },
  };
}
export interface ReputationPolicy {
  /** Rolling evaluation window. Default 7 days. */
  windowMs?: number;
  /** Minimum SMTP-accepted recipients required before automatically pausing. */
  minimumAccepted?: number;
  /** Warn/hold ratios, in percent rather than fractional values. */
  warnBouncePercent?: number;
  /** Hard-bounce pause percentage, default five. */
  pauseBouncePercent?: number;
  /** Complaint warning percentage, default 0.05. */
  warnComplaintPercent?: number;
  /** Complaint pause percentage, default 0.1. */
  pauseComplaintPercent?: number;
  /** Optional soft-bounce monitoring thresholds. Unset keeps the existing hard-bounce/complaint policy. */
  warnSoftBouncePercent?: number;
  /** Optional soft-bounce pause percentage; requires its warning threshold too. */
  pauseSoftBouncePercent?: number;
  /** Explicit opt in for blocking critical transactional emails on account reputation. */
  protectTransactional?: boolean;
  /** Maximum rows to scan before refusing to issue an incomplete verdict. */
  scanLimit?: number;
}
export interface ReputationSnapshot {
  /** Exact configured account identity; the ledger itself is not a tenant authorization boundary. */
  account: string;
  /** Inclusive lower timestamp for the evaluated rolling window. */
  since: number;
  /** Epoch observation/event time from authenticated host input. */
  at: number;
  /** Count of retained recorded SMTP-accepted recipient events, not inbox delivery. */
  accepted: number;
  /** Count of retained reported hard-bounce events, not guaranteed cohort-complete delivery outcomes. */
  hardBounces: number;
  /** Count of retained reported soft-bounce events. */
  softBounces: number;
  /** Count of retained authenticated complaint observations. */
  complaints: number;
  /** Legacy hard-bounce/accepted percentage; zero when denominator is zero, inspect sampleSufficient. */
  bouncePercent: number;
  /** Legacy soft-bounce/accepted percentage; zero with no accepted events. */
  softBouncePercent: number;
  /** Legacy complaint/accepted percentage; zero with no accepted events. */
  complaintPercent: number;
  /** Local heuristic label; healthy with insufficient samples is not provider reputation evidence. */
  status: 'healthy' | 'warning' | 'paused';
  /** False when fewer than minimumAccepted recipients were observed; no healthy-reputation claim is implied. */
  sampleSufficient: boolean;
  /** The ledger only includes reports that were actually received from providers. */
  feedbackCoverage: 'reported-only';
}
/** Calculate a bounded local reported-feedback heuristic without claiming provider/DNS reputation.
 * @param {{
  ledger: ReputationLedger;
  policy?: ReputationPolicy;
  now?: () => number;
}} options - Explicit ledger, bounded heuristic policy and optional trusted clock.
 * @param {ReputationLedger} options.ledger - Explicit committed ledger or deliberately selected local fixture.
 * @param {ReputationPolicy} options.policy - Optional bounded local heuristic thresholds.
 * @param {() => number} options.now - Optional trusted epoch clock.
 * @returns {object} Recording/snapshot/admission helpers over the explicitly supplied ledger.
 */
export function createEmailReputationService(options: {
  /** Explicit record/page ledger; host owns persistence and retained history. */
  ledger: ReputationLedger;
  /** Optional bounded local heuristic thresholds; no provider-specific grade is inferred. */
  policy?: ReputationPolicy;
  /** Optional trusted epoch clock, default Date.now. */
  now?: () => number;
}) {
  /** Explicit record/page backend; no silent fallback when it is unavailable. */
  const ledger = options?.ledger;
  if (
    !ledger ||
    typeof ledger.record !== 'function' ||
    typeof ledger.page !== 'function'
  ) {
    throw new TypeError('Reputation ledger required');
  }
  /** Explicit heuristic policy; default percentages are local rules, not provider grades. */
  const p = options.policy ?? {};
  /** Trusted clock used consistently for the current operation. */
  const now = options.now ?? Date.now;
  /** Rolling window 1 hour–90 days, default seven days. */
  const windowMs = p.windowMs ?? 7 * 86_400_000;
  /** Minimum recorded accepted events for an actionable sample, default 100. */
  const min = p.minimumAccepted ?? 100;
  /** Maximum scan rows 100–1000000, default 100000; overflow rejects. */
  const limit = p.scanLimit ?? 100_000;
  /** Local hard-bounce warning threshold, default two percent. */
  const warnBounce = p.warnBouncePercent ?? 2;
  /** Local hard-bounce pause threshold, default five percent. */
  const pauseBounce = p.pauseBouncePercent ?? 5;
  /** Local complaint warning threshold, default 0.05 percent. */
  const warnComplaint = p.warnComplaintPercent ?? 0.05;
  /** Local complaint pause threshold, default 0.1 percent. */
  const pauseComplaint = p.pauseComplaintPercent ?? 0.1;
  /** Optional soft-bounce warning threshold requiring paired pause policy. */
  const warnSoft = p.warnSoftBouncePercent;
  /** Optional soft-bounce pause threshold requiring paired warning policy. */
  const pauseSoft = p.pauseSoftBouncePercent;
  if ((warnSoft === undefined) !== (pauseSoft === undefined)) {
    throw new RangeError(
      'Soft-bounce warning and pause limits must be configured together'
    );
  }
  if (
    !Number.isSafeInteger(windowMs) ||
    windowMs < 3_600_000 ||
    windowMs > 90 * 86_400_000 ||
    !Number.isSafeInteger(min) ||
    min < 1 ||
    min > 100_000 ||
    !Number.isSafeInteger(limit) ||
    limit < 100 ||
    limit > 1_000_000 ||
    [
      warnBounce,
      pauseBounce,
      warnComplaint,
      pauseComplaint,
      ...(warnSoft === undefined ? [] : [warnSoft, pauseSoft!]),
    ].some((n) => !Number.isFinite(n) || n < 0 || n > 100) ||
    warnBounce > pauseBounce ||
    warnComplaint > pauseComplaint ||
    (warnSoft !== undefined && warnSoft > pauseSoft!)
  ) {
    throw new RangeError('Invalid reputation policy');
  }
  /** Validate configured account spelling before storage or report access.
   * @param {string} account - Host-bound account identity.
   * @returns {string} Validated identity; does not authorize a tenant. */
  const verifyAccount = (account: string) => {
    if (typeof account !== 'string' || !accountPattern.test(account)) {
      throw new TypeError('Invalid reputation account');
    }
    return account;
  };
  /** Normalize one authenticated event and submit its immutable derived identity once.
   * @param {string} account - Host-bound account.
   * @param {ReputationEventKind} kind - Authenticated observation kind.
   * @param {string} email - Private recipient canonicalized before hashing.
   * @param {string} eventId - Trusted provider/message identity.
   * @param {number} at - Optional event time, default trusted clock.
   * @returns {Promise<boolean>} True for a new ledger insert; no exactly-once transport guarantee. */
  const record = async (
    account: string,
    kind: ReputationEventKind,
    email: string,
    eventId: string,
    at = now()
  ) => {
    verifyAccount(account);
    canonical(email);
    if (
      !trustedId.test(eventId) ||
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > now() + 300_000
    ) {
      throw new TypeError('Invalid reputation event');
    }
    /** Private derived event record; recipient hashes remain pseudonymous data. */
    const entry: ReputationEvent = {
      id: hash(`${account}:${kind}:${eventId}:${hash(canonical(email))}`),
      account,
      kind,
      at,
      recipientHash: hash(canonical(email)),
    };
    return ledger.record(entry);
  };
  return {
    /** Record one actual SMTP-accepted recipient; this never proves inbox delivery.
     * @param {string} account - Host-bound configured account.
     * @param {string} email - Private validated recipient.
     * @param {string} messageId - Private SMTP identity hashed before linkage storage.
     * @param {number} at - Optional authenticated observation epoch time.
     * @returns {Promise<boolean>} New ledger insertion or explicit duplicate. */
    recordAccepted: (
      account: string,
      email: string,
      messageId: string,
      at?: number
    ) => record(account, 'accepted', email, hash(messageId), at),
    /** Record only provider-authenticated or trusted inbound feedback; syntax is not authorization.
     * @param {{account: string, email: string, eventId: string, kind: "hard-bounce" | "soft-bounce" | "complaint", at?: number}} input - Private authenticated observation.
     * @param {string} input.account - Host-bound configured account.
     * @param {string} input.email - Private validated recipient.
     * @param {string} input.eventId - Authenticated provider identity.
     * @param {"hard-bounce" | "soft-bounce" | "complaint"} input.kind - Verified observed outcome.
     * @param {number} input.at - Optional authenticated event epoch time.
     * @returns {Promise<boolean>} New ledger insertion or explicit duplicate. */
    recordFeedback: (input: {
      /** Exact configured account identity; the ledger itself is not a tenant authorization boundary. */
      account: string;
      /** Private recipient used only for canonical hashing; hashing is not anonymization. */
      email: string;
      /** Host-authenticated provider event reference, never signature proof by itself. */
      eventId: string;
      /** Authenticated observed accepted/bounce/complaint event kind. */
      kind: 'hard-bounce' | 'soft-bounce' | 'complaint';
      /** Epoch observation/event time from authenticated host input. */
      at?: number;
    }) =>
      record(input.account, input.kind, input.email, input.eventId, input.at),
    /** Scan only the bounded account window and refuse a verdict when one extra event proves overflow.
     * @param {string} account - Exact configured account identity; host tenant binding remains external.
     * @returns {Promise<ReputationSnapshot>} Legacy heuristic with sample sufficiency and reported-only coverage; zero-denominator rates stay legacy zero.
     */
    async snapshot(account: string): Promise<ReputationSnapshot> {
      verifyAccount(account);
      /** One trusted report timestamp; future observations do not count in this snapshot. */
      const at = now();
      /** Inclusive rolling-window lower timestamp. */
      const since = at - windowMs;
      /** Fixed observed event counters; categories are not guaranteed complete delivery cohorts. */
      const totals = {
        accepted: 0,
        hardBounces: 0,
        softBounces: 0,
        complaints: 0,
      };
      let offset = 0;
      // Bound each scan page; one extra existence probe distinguishes an exact limit from truncation.
      while (offset < limit) {
        /** Next page size capped at 500 and the remaining scan budget. */
        const size = Math.min(500, limit - offset);
        /** Validated bounded private ledger page, not a cross-page immutable database snapshot. */
        const batch = await ledger.page(account, since, offset, size);
        if (!Array.isArray(batch) || batch.length > size) {
          throw new Error('Invalid reputation ledger page');
        }
        // Count only this account and completed report window; future/out-of-scope events are excluded.
        for (const item of batch) {
          if (item.account !== account || item.at < since || item.at > at) {
            continue;
          }
          if (item.kind === 'accepted') {
            totals.accepted++;
          } else if (item.kind === 'hard-bounce') {
            totals.hardBounces++;
          } else if (item.kind === 'soft-bounce') {
            totals.softBounces++;
          } else if (item.kind === 'complaint') {
            totals.complaints++;
          }
        }
        offset += batch.length;
        if (batch.length < size) {
          break;
        }
      }
      // A full final page is not evidence of truncation. Only refuse a verdict if
      // an additional event actually exists beyond the allowed scan window.
      if (
        offset === limit &&
        (await ledger.page(account, since, offset, 1)).length > 0
      ) {
        throw new Error(
          'Reputation scan limit reached; an exact verdict is unavailable'
        );
      }
      /** Legacy observed hard-bounce rate; zero denominator returns zero, paired with sampleSufficient. */
      const bouncePercent = totals.accepted
        ? (100 * totals.hardBounces) / totals.accepted
        : 0;
      /** Legacy observed soft-bounce rate; no accepted events yields zero. */
      const softBouncePercent = totals.accepted
        ? (100 * totals.softBounces) / totals.accepted
        : 0;
      /** Legacy observed complaint rate; no accepted events yields zero. */
      const complaintPercent = totals.accepted
        ? (100 * totals.complaints) / totals.accepted
        : 0;
      /** Minimum accepted-sample guard; healthy without it is not a reliable reputation grade. */
      const enough = totals.accepted >= min;
      /** Configured local heuristic outcome; no provider/DNS standing is inferred. */
      const status: ReputationSnapshot['status'] = (() => {
        if (
          enough &&
          (bouncePercent >= pauseBounce ||
            complaintPercent >= pauseComplaint ||
            (pauseSoft !== undefined && softBouncePercent >= pauseSoft))
        ) {
          return 'paused';
        }
        if (
          enough &&
          (bouncePercent >= warnBounce ||
            complaintPercent >= warnComplaint ||
            (warnSoft !== undefined && softBouncePercent >= warnSoft))
        ) {
          return 'warning';
        }
        return 'healthy';
      })();
      return {
        account,
        since,
        at,
        ...totals,
        bouncePercent,
        softBouncePercent,
        complaintPercent,
        status,
        sampleSufficient: enough,
        feedbackCoverage: 'reported-only',
      };
    },
    /** Apply the configured local heuristic pause to marketing or explicitly protected transactional sends.
     * @param {string} account - Exact configured account identity; host tenant binding remains external.
     * @param {'marketing' | 'transactional'} purpose - Explicit transactional/marketing admission context; only configured transactional protection blocks.
     * @returns {Promise<{allowed: boolean, state: ReputationSnapshot}>} Current policy decision; no subscription, tenant or provider authorization is implied.
     */
    async checkBeforeSend(
      account: string,
      purpose: 'marketing' | 'transactional'
    ) {
      /** Current bounded local heuristic snapshot used for admission policy. */
      const state = await this.snapshot(account);
      if (
        state.status === 'paused' &&
        (purpose === 'marketing' || p.protectTransactional === true)
      ) {
        return { allowed: false, state };
      }
      return { allowed: true, state };
    },
  };
}
