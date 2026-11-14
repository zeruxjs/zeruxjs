import type { EmailReceiver, InboundMessage, InboundStore } from './inbound.js';

/** Server-side inbox API for custom UIs. Never publish this without a host identity/authorization check. */
export type InboxOperation =
  | 'list'
  | 'read'
  | 'search'
  | 'poll'
  | 'markSeen'
  | 'markUnread'
  | 'flag'
  | 'unflag'
  | 'folders'
  | 'erase';
export interface InboxAccess {
  /** Fixed operation action presented to the host authorization callback. */
  operation: InboxOperation;
  /** Exact account scope enforced after host authorization; never a caller role claim. */
  account: string;
  /** Optional opaque local reference included in management authorization. */
  messageId?: string;
  /** Exact configured remote folder for authorization/filtering; arbitrary folder polling still rejects in receiver. */
  mailbox?: string;
}
export interface InboxApiOptions {
  /** Borrowed private inbox persistence; no native ownership transfer. */
  store: InboundStore;
  /** Required. Resolve the current user/session and enforce account permissions for EVERY call. */
  authorize: (access: InboxAccess) => Promise<boolean> | boolean;
  /** Optional borrowed receive/poll/flag/folder service; host retains its lifecycle. */
  receiver?: Pick<
    EmailReceiver,
    'poll' | 'markSeen' | 'markUnread' | 'setFlagged' | 'folders' | 'accounts'
  >;
  /** A separate, explicit legal-hold/retention approval for irreversible local erasure. */
  canErase?: (message: Readonly<InboundMessage>) => Promise<boolean> | boolean;
}
export interface InboxQuery {
  /** Exact account scope enforced after host authorization; never a caller role claim. */
  account: string;
  /** Exclusive opaque local message continuation, default null. */
  cursor?: string | null;
  /** Returned page budget 1–200, default fifty. */
  limit?: number;
}
export interface InboxSearch extends InboxQuery {
  /** Untrusted subject or bounded case-insensitive substring filter; escape in any UI. */
  subject?: string;
  /** Optional bounded case-insensitive sender substring; not sender authentication. */
  sender?: string;
  /** Exact configured remote folder for authorization/filtering; arbitrary folder polling still rejects in receiver. */
  mailbox?: string;
  /** Inclusive receivedAt lower epoch bound. */
  fromTime?: number;
  /** Inclusive receivedAt upper epoch bound; cannot precede fromTime. */
  toTime?: number;
  /** Optional fixed heuristic risk filter/summary; unknown means no recorded advisory. */
  risk?: 'low' | 'review' | 'high';
  /** Optional exact boolean presence filter; not malware inspection. */
  hasAttachments?: boolean;
  /** Maximum number of underlying messages to inspect in this call; default 1000, at most 5000. */
  maxScanned?: number;
}
export interface InboxSummary {
  /** Opaque local message reference; not an externally authenticated identity. */
  id: string;
  /** Exact account scope enforced after host authorization; never a caller role claim. */
  account: string;
  /** Exact configured remote folder for authorization/filtering; arbitrary folder polling still rejects in receiver. */
  mailbox: string;
  /** Recorded IMAP/POP3 source kind, not a transport credential. */
  protocol: InboundMessage['protocol'];
  /** Untrusted subject or bounded case-insensitive substring filter; escape in any UI. */
  subject: string;
  /** Private untrusted sender claims copied for display; escape before rendering. */
  from: string[];
  /** Optional parsed message-authored timestamp; not trusted receipt time. */
  date?: number;
  /** Recorded local received timestamp used for filtering. */
  receivedAt: number;
  /** Metadata attachment count; no bytes are exposed by summary pages. */
  attachmentCount: number;
  /** Explicit stored body-coverage limitation. */
  bodyTruncated: boolean;
  /** Optional fixed heuristic risk filter/summary; unknown means no recorded advisory. */
  risk: 'low' | 'review' | 'high' | 'unknown';
  /** Fixed advisory labels from stored metadata; authentication remains separate. */
  flags: string[];
}
/** Require one positive safe integer within the explicit operation ceiling.
 * @param {number | undefined} n - Optional requested integer; missing uses this operation default.
 * @param {number} fallback - Explicit owning operation default.
 * @param {number} max - Explicit operation ceiling.
 * @param {string} name - Fixed validation label, never private values.
 * @returns {number} Validated requested limit or its owning operation default.
 */
function integer(
  n: number | undefined,
  fallback: number,
  max: number,
  name: string
) {
  /** Requested explicit value or validated operation-specific fallback. */
  const value = n ?? fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`Invalid ${name}`);
  }
  return value;
}
/** Validate exact configured account syntax without authenticating the caller.
 * @param {string} value - Candidate account/message/cursor/time value under the owning validator.
 * @returns {string} Validated account spelling; host authorization is still required.
 */
function accountName(value: string) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new TypeError('Invalid inbox account');
  }
  return value;
}
/** Require the exact opaque local message-identity encoding.
 * @param {string} value - Candidate account/message/cursor/time value under the owning validator.
 * @returns {string} Validated 64-hex local reference; never remote UID or guessed slug.
 */
function msgId(value: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError('Invalid message id');
  }
  return value;
}
/** Normalize an optional exclusive message continuation without treating it as account authority.
 * @param {string | null | undefined} value - Candidate account/message/cursor/time value under the owning validator.
 * @returns {string | null} Validated opaque continuation or null.
 */
function pageCursor(value: string | null | undefined) {
  if (value !== undefined && value !== null) {
    msgId(value);
  }
  return value ?? null;
}
/** Project body-free inbox metadata while retaining private sender/subject values.
 * @param {InboundMessage} m - Private stored message whose sender/subject still require UI escaping.
 * @returns {InboxSummary} Detached summary arrays; UI must escape stored text and enforce authorization.
 */
function summary(m: InboundMessage): InboxSummary {
  return {
    id: m.id,
    account: m.account,
    mailbox: m.mailbox,
    protocol: m.protocol,
    subject: m.subject,
    from: [...m.from],
    ...(m.date !== undefined ? { date: m.date } : {}),
    receivedAt: m.receivedAt,
    attachmentCount: m.attachments.length,
    bodyTruncated: m.bodyTruncated,
    risk: m.safety?.risk ?? 'unknown',
    flags: [...(m.safety?.flags ?? [])],
  };
}
/** Validate optional nonnegative safe epoch filter values.
 * @param {number | undefined} value - Candidate account/message/cursor/time value under the owning validator.
 * @param {string} name - Fixed validation label, never private values.
 * @returns {void} Invalid time bounds reject before reading inbox storage.
 */
function condition(value: number | undefined, name: string) {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError(`Invalid ${name}`);
  }
}
/** Bind explicit per-operation account authorization to private bounded store/receiver operations.
 * @param {InboxApiOptions} options - Explicit borrowed store, current host authorization and optional receiver/retention policy.
 * @returns {InboxApi} Headless API only; host supplies HTTP/session/CSRF/response-cache policy if mounted.
 */
export function createInboxApi(options: InboxApiOptions) {
  if (!options?.store || typeof options.authorize !== 'function') {
    throw new TypeError(
      'Inbox API requires a store and authorization callback'
    );
  }
  /** Borrowed private inbox persistence; host retains native storage lifecycle. */
  const { store } = options;
  /** Validate operation identity then require literal fresh host authorization before storage or remote access.
   * @param {InboxOperation} operation - Fixed operation label checked independently on each call.
   * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
   * @param {string} messageId - Optional local opaque identity for scoped operation authorization.
   * @param {string} mailbox - Optional configured remote folder; authorization receives it before any poll.
   * @returns {Promise<void>} Denied access throws without interpreting caller role/email claims.
   */
  async function allow(
    operation: InboxOperation,
    account: string,
    messageId?: string,
    mailbox?: string
  ) {
    accountName(account);
    if (messageId) {
      msgId(messageId);
    }
    if (
      mailbox !== undefined &&
      (typeof mailbox !== 'string' ||
        !mailbox ||
        mailbox.length > 255 ||
        /[\r\n\0]/.test(mailbox))
    ) {
      throw new TypeError('Invalid inbox mailbox');
    }
    if (
      (await options.authorize({
        operation,
        account,
        ...(messageId ? { messageId } : {}),
        ...(mailbox ? { mailbox } : {}),
      })) !== true
    ) {
      throw new Error('Inbox access denied');
    }
  }
  /** Return identical missing behavior for nonexistent and other-account messages.
   * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
   * @param {string} id - Local opaque stored message identity; account mismatch behaves as missing.
   * @returns {Promise<InboundMessage | null>} Private in-scope stored message only; caller already authorized this operation.
   */
  async function scoped(account: string, id: string) {
    /** Private in-scope stored message; cross-account and missing identities share the same null behavior. */
    const record = await store.get(msgId(id));
    // Return identical not-found behavior for non-existent and cross-account messages.
    if (!record || record.account !== account) {
      return null;
    }
    return record;
  }
  return {
    /** Return a bounded authorized body-free summary page and reject out-of-account store results.
     * @param {InboxQuery} query - Explicit bounded account/cursor/filter inputs; server authorization remains mandatory.
     * @returns {Promise<{items: InboxSummary[], nextCursor: string | null, done: boolean}>} Private summary page; empty/filtered continuation never proves no further records.
     */
    async list(query: InboxQuery) {
      /** Validated account spelling passed through fresh host operation authorization. */
      const account = accountName(query?.account);
      /** Validated returned-page ceiling, default fifty and maximum two hundred. */
      const limit = integer(query.limit, 50, 200, 'inbox page limit');
      /** Validated exclusive opaque message continuation; it grants no account authority. */
      const cursor = pageCursor(query.cursor);
      await allow('list', account);
      /** Authorized bounded store/receiver result checked before returning a private projection. */
      const result = await store.page(account, cursor, limit);
      if (
        result.items.length > limit ||
        result.items.some((m) => m.account !== account)
      ) {
        throw new Error('Inbox store returned out-of-scope records');
      }
      return {
        items: result.items.map(summary),
        nextCursor: result.nextCursor,
        done: result.done,
      };
    },
    /** Authorize and return a detached stored message without assuming this layer sanitizes its contents.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @param {string} id - Local opaque stored message identity; account mismatch behaves as missing.
     * @returns {Promise<InboundMessage | null>} Private stored data or null; trusted renderer/sanitizer responsibilities remain external.
     */
    async get(account: string, id: string) {
      accountName(account);
      msgId(id);
      await allow('read', account, id);
      /** Private in-scope stored message; cross-account and missing identities share the same null behavior. */
      const record = await scoped(account, id);
      return record ? structuredClone(record) : null;
    },
    /** Filter only a bounded authorized account scan with explicit progress/coverage metadata.
     * @param {InboxSearch} query - Explicit bounded account/cursor/filter inputs; server authorization remains mandatory.
     * @returns {Promise<{items: InboxSummary[], nextCursor: string | null, done: boolean, scanned: number, scanLimited: boolean}>} Private body-free matches; more scan records do not guarantee more matching results.
     */
    async search(query: InboxSearch) {
      /** Validated account spelling passed through fresh host operation authorization. */
      const account = accountName(query?.account);
      /** Validated returned-page ceiling, default fifty and maximum two hundred. */
      const limit = integer(query.limit, 50, 200, 'search page limit');
      /** Explicit underlying scan ceiling, default one thousand and maximum five thousand. */
      const maxScanned = integer(
        query.maxScanned,
        1000,
        5000,
        'search scan bound'
      );
      condition(query.fromTime, 'start time');
      condition(query.toTime, 'end time');
      if (
        query.fromTime !== undefined &&
        query.toTime !== undefined &&
        query.fromTime > query.toTime
      ) {
        throw new RangeError('Invalid time window');
      }
      if (
        query.risk !== undefined &&
        !['low', 'review', 'high'].includes(query.risk)
      ) {
        throw new TypeError('Invalid risk filter');
      }
      if (
        query.hasAttachments !== undefined &&
        typeof query.hasAttachments !== 'boolean'
      ) {
        throw new TypeError('Invalid attachment filter');
      }
      for (const term of [query.subject, query.sender, query.mailbox]) {
        if (
          term !== undefined &&
          (typeof term !== 'string' || term.length > 256)
        ) {
          throw new TypeError('Invalid inbox search term');
        }
      }
      /** Validated initial exclusive scan position before fresh authorization. */
      const start = pageCursor(query.cursor);
      await allow('search', account);
      /** Body-free private matches; stored sender/subject data still require display escaping. */
      const items: InboxSummary[] = [];
      let scanned = 0,
        cursor = start,
        done = false;
      /** Optional bounded lowercase subject substring; no regex/executable query is accepted. */
      const subject = query.subject?.toLowerCase();
      /** Optional bounded lowercase sender substring; never authenticated sender identity. */
      const sender = query.sender?.toLowerCase();
      // Stop at both returned-result and underlying-scan ceilings; keep an exclusive continuation.
      while (scanned < maxScanned && items.length < limit) {
        /** Bounded authorized account page; out-of-account records reject instead of leaking. */
        const page = await store.page(
          account,
          cursor,
          Math.min(200, maxScanned - scanned)
        );
        if (
          page.items.length > 200 ||
          page.items.some((m) => m.account !== account)
        ) {
          throw new Error('Inbox store returned out-of-scope records');
        }
        if (page.items.length === 0) {
          if (!page.done) {
            throw new Error('Inbox store returned an empty nonterminal page');
          }
          done = true;
          break;
        }
        // Advance through each examined record even when filters produce no visible match.
        for (const m of page.items) {
          scanned++;
          cursor = m.id;
          if (
            (!subject || m.subject.toLowerCase().includes(subject)) &&
            (!sender || m.from.some((x) => x.toLowerCase().includes(sender))) &&
            (query.mailbox === undefined || m.mailbox === query.mailbox) &&
            (query.fromTime === undefined || m.receivedAt >= query.fromTime) &&
            (query.toTime === undefined || m.receivedAt <= query.toTime) &&
            (query.risk === undefined || m.safety?.risk === query.risk) &&
            (query.hasAttachments === undefined ||
              m.attachments.length > 0 === query.hasAttachments)
          ) {
            items.push(summary(m));
          }
          if (items.length === limit) {
            break;
          }
        }
        if (items.length === limit) {
          done = page.done && cursor === page.items.at(-1)!.id;
          break;
        }
        if (page.done) {
          done = true;
          break;
        }
      }
      return {
        items,
        nextCursor: done ? null : cursor,
        done,
        scanned,
        scanLimited: !done && scanned >= maxScanned,
      };
    },
    /** Authorize remote flag mutation then delegate UIDVALIDITY/identity fencing to the receiver.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @param {string} id - Local opaque stored message identity; account mismatch behaves as missing.
     * @returns {Promise<boolean>} Native receiver outcome; does not erase local or remote message content.
     */
    async markSeen(account: string, id: string) {
      accountName(account);
      msgId(id);
      await allow('markSeen', account, id);
      if (!options.receiver) {
        throw new Error('IMAP receiver is not configured');
      }
      /** Exact private in-scope stored reference passed to receiver or retention approval. */
      const message = await scoped(account, id);
      if (!message) {
        return false;
      }
      return options.receiver.markSeen(account, message);
    },
    /** Authorize remote unread mutation and delegate native identity fencing to the receiver.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @param {string} id - Local opaque stored message identity; account mismatch behaves as missing.
     * @returns {Promise<boolean>} Native receiver outcome; this method is not local inbox erasure.
     */
    async markUnread(account: string, id: string) {
      accountName(account);
      msgId(id);
      await allow('markUnread', account, id);
      if (!options.receiver) {
        throw new Error('IMAP receiver is not configured');
      }
      /** Exact private in-scope stored reference passed to receiver or retention approval. */
      const message = await scoped(account, id);
      return message ? options.receiver.markUnread(account, message) : false;
    },
    /** Require an actual boolean flag state under explicit flag/unflag operation authorization.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @param {string} id - Local opaque stored message identity; account mismatch behaves as missing.
     * @param {boolean} flagged - Literal boolean native flagged state; truthy coercion is rejected.
     * @returns {Promise<boolean>} Receiver outcome for this exact stored remote identity.
     */
    async setFlagged(account: string, id: string, flagged: boolean) {
      accountName(account);
      msgId(id);
      if (typeof flagged !== 'boolean') {
        throw new TypeError('Invalid flagged state');
      }
      await allow(flagged ? 'flag' : 'unflag', account, id);
      if (!options.receiver) {
        throw new Error('IMAP receiver is not configured');
      }
      /** Exact private in-scope stored reference passed to receiver or retention approval. */
      const message = await scoped(account, id);
      return message
        ? options.receiver.setFlagged(account, message, flagged)
        : false;
    },
    /** Authorize account folder discovery before acquiring the optional receiver transport.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @returns {ReturnType<EmailReceiver["folders"]>} Private native folder metadata; not a public folder namespace.
     */
    async folders(account: string) {
      await allow('folders', account);
      if (!options.receiver) {
        throw new Error('IMAP receiver is not configured');
      }
      return options.receiver.folders(account);
    },
    /** Require independent operation authorization and retention approval before explicit local deletion.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @param {string} id - Local opaque stored message identity; account mismatch behaves as missing.
     * @returns {Promise<boolean>} Local store deletion outcome; remote mail and suppression evidence remain untouched.
     */
    async eraseLocal(account: string, id: string) {
      accountName(account);
      msgId(id);
      await allow('erase', account, id);
      if (!store.erase || !options.canErase) {
        throw new Error(
          'Local inbox erasure requires explicit retention approval'
        );
      }
      /** Exact private in-scope stored reference passed to receiver or retention approval. */
      const message = await scoped(account, id);
      if (!message) {
        return false;
      }
      if ((await options.canErase(structuredClone(message))) !== true) {
        throw new Error('Inbox erasure denied by retention policy');
      }
      return store.erase(id, account);
    },
    /** Authorize the exact account/mailbox before polling and return counters without received bodies.
     * @param {string} account - Exact configured account; syntax is not a verified tenant or principal.
     * @param {string} mailbox - Optional configured remote folder; authorization receives it before any poll.
     * @returns {Promise<object>} Private account/protocol/scanned/stored/duplicate/oversized projection; host owns remote lifecycle.
     */
    async poll(account: string, mailbox?: string) {
      await allow('poll', account, undefined, mailbox);
      if (!options.receiver) {
        throw new Error('Inbox receiver is not configured');
      }
      /** Authorized bounded store/receiver result checked before returning a private projection. */
      const result = await options.receiver.poll(
        account,
        mailbox === undefined ? {} : { mailbox }
      );
      // The host controls polling; do not expose parsed message bodies via this operation.
      return {
        account,
        protocol: result.protocol,
        scanned: result.scanned,
        stored: result.stored,
        duplicates: result.duplicates,
        oversized: result.oversized,
      };
    },
  };
}
export type InboxApi = ReturnType<typeof createInboxApi>;
