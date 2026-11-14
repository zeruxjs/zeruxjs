/** Host-authorized inbound retention. Only deletes LOCAL inbox metadata, never remote IMAP/POP3 mail. */
import type { InboundMessage, InboundStore } from './inbound.js';
export interface InboundRetentionOptions {
  /** Borrowed local inbox store; explicit erase capability required for real deletion. */
  store: InboundStore;
  /** Exact host-authorized private account scope. */
  account: string;
  /** Earliest allowed receivedAt timestamp (ms); older messages are candidates. */
  olderThan: number;
  /** A host must decide legal holds, active support requests, and attachment deletion policy. */
  canErase: (message: Readonly<InboundMessage>) => boolean | Promise<boolean>;
  /** Defaults to true. Production deletion requires an explicit false. */
  dryRun?: boolean;
  /** Exclusive opaque local identity continuation, default null. */
  cursor?: string | null;
  /** Integer 1–200, default 100. */
  pageSize?: number;
  /** Total rows 1–10000, default 1000. */
  maxScanned?: number;
  /** Optional cooperative cancellation checked between scans/items/deletes. */
  signal?: AbortSignal;
  /** Callbacks should be idempotent; failures are counted, not swallowed as successful cleanup. */
  afterErase?: (entry: {
    /** Opaque local deleted-message reference included only in host cleanup metadata. */
    id: string;
    /** Exact host-authorized private account scope. */
    account: string;
    /** Private opaque attachment references; callback owns authorization/idempotent cleanup. */
    references: string[];
  }) => Promise<void> | void;
}
/** Preview by default and reauthorize each bounded stale local message before explicit identity/account deletion.
 * @param {InboundRetentionOptions} options - Host-approved private account/store/cutoff/holds and optional explicit local erase controls.
 * @returns {Promise<{scanned: number, eligible: number, erased: number, skipped: number, contended: number, cleanupFailures: number, dryRun: boolean, done: boolean, nextCursor: string | null, coverage: "bounded-local-inbox-retention"}>} Count-only local progress; no remote deletion, global atomicity or automatic attachment-erasure guarantee.
 */
export async function sweepInboundRetention(options: InboundRetentionOptions) {
  /** Explicit private store/account/cutoff and independent host retention-hold decision. */
  const { store, account, olderThan, canErase } =
    options ?? ({} as InboundRetentionOptions);
  /** Validated finite page size, default one hundred. */
  const pageSize = options?.pageSize ?? 100;
  /** Total finite scan ceiling, default one thousand. */
  const maxScanned = options?.maxScanned ?? 1000;
  /** Preview by default; only literal false enables local deletion. */
  const dryRun = options?.dryRun !== false;
  if (
    !store ||
    typeof store.page !== 'function' ||
    typeof store.get !== 'function' ||
    typeof canErase !== 'function' ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(account) ||
    !Number.isSafeInteger(olderThan) ||
    olderThan < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 200 ||
    !Number.isSafeInteger(maxScanned) ||
    maxScanned < 1 ||
    maxScanned > 10000 ||
    (((candidate: unknown) => candidate !== null && candidate !== undefined)(
      options.cursor
    ) &&
      !/^[a-f0-9]{64}$/.test(options.cursor)) ||
    (!dryRun && typeof store.erase !== 'function')
  ) {
    throw new TypeError('Invalid inbound retention configuration');
  }
  let cursor = options.cursor ?? null,
    scanned = 0,
    eligible = 0,
    erased = 0,
    skipped = 0,
    contended = 0,
    cleanupFailures = 0,
    done = false;
  /** Honor cooperative cancellation at bounded local retention boundaries.

 * @returns {void} Throws host abort reason; cannot undo deletion or force-stop arbitrary store code. */
  const check = () => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('Inbound retention aborted');
    }
  };
  // Keep a resumable scan budget; exact-boundary completion is never guessed.
  while (scanned < maxScanned) {
    check();
    /** Next page budget capped by both page size and remaining total rows. */
    const limit = Math.min(pageSize, maxScanned - scanned);
    /** Validated bounded private message page, never returned as an export payload. */
    const page = await store.page(account, cursor, limit);
    if (!page || !Array.isArray(page.items) || page.items.length > limit) {
      throw new Error('Invalid inbox retention page');
    }
    let last = cursor;
    // Recheck account/order/freshness and independent host holds before local deletion.
    for (const message of page.items) {
      check();
      if (
        !message ||
        message.account !== account ||
        !Number.isSafeInteger(message.receivedAt) ||
        message.receivedAt < 0 ||
        typeof message.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(message.id) ||
        (last !== null && message.id <= last)
      ) {
        throw new Error('Invalid or out-of-order inbox retention row');
      }
      last = cursor = message.id;
      scanned++;
      if (message.receivedAt >= olderThan) {
        skipped++;
        continue;
      }
      /** Fresh local record reread before hold approval; store erase still has identity/account rather than revision-CAS semantics. */
      const latest = await store.get(message.id);
      if (
        !latest ||
        latest.account !== account ||
        latest.receivedAt !== message.receivedAt
      ) {
        contended++;
        continue;
      }
      if ((await canErase(structuredClone(latest))) !== true) {
        skipped++;
        continue;
      }
      eligible++;
      if (!dryRun) {
        check();
        if (await store.erase!(message.id, account)) {
          erased++;
          try {
            await options.afterErase?.({
              id: message.id,
              account,
              references: message.attachments
                .map((a) => a.storedReference)
                .filter((v): v is string => Boolean(v)),
            });
          } catch {
            cleanupFailures++;
          }
        } else {
          contended++;
        }
      }
    }
    if (page.done === true || page.items.length < limit) {
      done = true;
      break;
    }
    if (page.items.length === 0) {
      throw new Error('Inbox retention pagination stalled');
    }
  }
  return {
    scanned,
    eligible,
    erased,
    skipped,
    contended,
    cleanupFailures,
    dryRun,
    done,
    nextCursor: done ? null : cursor,
    coverage: 'bounded-local-inbox-retention' as const,
  };
}
