/** Privacy-conscious, bounded contact retention sweep. Deleting list contacts never
 * implies deletion from independent suppression/consent/audit systems; those require
 * their own compliance policies and must not be blindly removed. */
import type { MailingContact, MailingContactStore } from './contacts.js';

export interface ContactRetentionOptions {
  /** Borrowed private contact store; real deletion requires atomic version-checked delete. */
  store: MailingContactStore;
  /** Delete only records with updatedAt strictly below this UTC epoch millisecond cutoff. */
  olderThan: number;
  /** Host MUST check for legal holds, active campaigns, support and billing dependencies. */
  canErase: (contact: Readonly<MailingContact>) => Promise<boolean> | boolean;
  /** Dry-run by default. Production erasure requires explicit dryRun:false. */
  dryRun?: boolean;
  /** Optional exclusive contact hash continuation; default null. */
  cursor?: string | null;
  /** Page size 1–200, default 100. */
  pageSize?: number;
  /** Total bounded rows 1–10000, default 1000. */
  maxScanned?: number;
  /** Optional cooperative cancellation checked between page/item/delete operations. */
  signal?: AbortSignal;
  /** Best-effort PII-free auditing; invoked only after successful delete. */
  onErased?: (metadata: {
    /** Pseudonymous contact hash retained only in host-approved audit metadata; not anonymization. */
    contactId: string;
    /** Trusted post-delete audit epoch time. */
    at: number;
  }) => void | Promise<void>;
  /** Optional trusted audit clock, default Date.now. */
  now?: () => number;
}
/** Preview by default, reread and authorize each bounded stale contact before explicit revision-checked deletion.
 * @param {ContactRetentionOptions} options - Host-authorized private store, cutoff, hold policy and explicit optional deletion controls.
 * @returns {Promise<{scanned: number, eligible: number, erased: number, skipped: number, contended: number, auditFailures: number, nextCursor: string | null, done: boolean, dryRun: boolean, coverage: "bounded-versioned-contact-scan"}>} Count-only progress/checkpoint; no contact payloads and no global atomic-erasure claim.
 */
export async function sweepMailingContactRetention(
  options: ContactRetentionOptions
) {
  /** Explicit borrowed private store and host retention-hold authorization callback. */
  const { store, canErase } = options ?? ({} as ContactRetentionOptions);
  /** Content-owned UTC cutoff; recent updates are never eligible. */
  const olderThan = options.olderThan;
  /** Validated page size 1–200, default 100. */
  const pageSize = options.pageSize ?? 100;
  /** Total row budget 1–10000, default 1000. */
  const maxScanned = options.maxScanned ?? 1000;
  /** Preview is the default; only literal false permits deletion. */
  const dryRun = options.dryRun !== false;
  /** Exclusive private hash continuation or null for a fresh scan. */
  const cursor = options.cursor ?? null;
  if (
    !store ||
    typeof store.page !== 'function' ||
    typeof store.load !== 'function' ||
    typeof canErase !== 'function' ||
    !Number.isSafeInteger(olderThan) ||
    olderThan < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 200 ||
    !Number.isSafeInteger(maxScanned) ||
    maxScanned < 1 ||
    maxScanned > 10_000 ||
    (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) ||
    (!dryRun && typeof store.delete !== 'function')
  ) {
    throw new TypeError('Invalid contact retention configuration');
  }
  /** Trusted post-delete audit clock; no synthetic content timestamps are written. */
  const now = options.now ?? Date.now;
  /** Honor cooperative cancellation between bounded retention operations.

 * @returns {void} Throws the host abort reason; cannot cancel arbitrary database work already submitted. */
  const check = () => {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('Contact retention aborted');
    }
  };
  let scanned = 0,
    eligible = 0,
    erased = 0,
    skipped = 0,
    contended = 0,
    position = cursor,
    done = false,
    auditFailures = 0;
  // Retain a resumable bounded scan; an exact boundary never fabricates complete coverage.
  while (scanned < maxScanned) {
    check();
    /** Next page ceiling bounded by page size and remaining total scan budget. */
    const limit = Math.min(pageSize, maxScanned - scanned);
    /** Validated private store page; no payload is returned in the count-only sweep receipt. */
    const page = await store.page(position, limit);
    if (!page || !Array.isArray(page.items) || page.items.length > limit) {
      throw new Error('Invalid contact retention page');
    }
    let previous = position;
    // Recheck ordering, freshness and host holds independently for every private contact.
    for (const contact of page.items) {
      check();
      if (
        !contact ||
        typeof contact.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(contact.id) ||
        (previous !== null && contact.id <= previous) ||
        !Number.isSafeInteger(contact.updatedAt) ||
        contact.updatedAt < 0 ||
        !Number.isSafeInteger(contact.version) ||
        contact.version < 1
      ) {
        throw new Error('Invalid or unsorted contact row');
      }
      previous = contact.id;
      position = contact.id;
      scanned++;
      if (contact.updatedAt >= olderThan) {
        skipped++;
        continue;
      }
      // Re-read before deletion; the paginated snapshot might already be stale.
      /** Fresh private revision reread before hold authorization and version-checked delete. */
      const latest = await store.load(contact.id);
      if (
        !latest ||
        latest.version !== contact.version ||
        latest.updatedAt !== contact.updatedAt
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
        if (await store.delete!(latest.id, latest.version)) {
          erased++;
          try {
            await options.onErased?.({ contactId: latest.id, at: now() });
          } catch {
            auditFailures++;
          }
        } else {
          contended++;
        }
      }
    }
    if (page.items.length < limit || page.done === true) {
      done = true;
      break;
    }
    if (!page.items.length) {
      throw new Error('Contact pagination made no progress');
    }
  }
  // At an exact scan boundary the next page might be empty. Do not claim completeness.
  return {
    scanned,
    eligible,
    erased,
    skipped,
    contended,
    auditFailures,
    nextCursor: done ? null : position,
    done,
    dryRun,
    coverage: 'bounded-versioned-contact-scan' as const,
  };
}
