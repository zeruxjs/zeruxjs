import { createHash } from 'node:crypto';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
import { inspectInboundSafety } from './inbound-safety.js';
import type { InboundSafety } from './inbound-safety.js';

/** Bounded configured account spelling; not tenant or principal authorization. */
const accountPattern = /^[a-z][a-z0-9_-]{0,63}$/;
/** Validated mapped native identifier spelling; no raw SQL is accepted. */
const tablePattern = /^[a-z][a-z0-9_]{0,62}$/;
/** Native unsigned 32-bit UID ceiling; sequence numbers are never treated as durable identities. */
const MAX_IMAP_UID = 0xffffffff;
export type IncomingProtocol = 'imap' | 'pop3';
export type IncomingAuth =
  | {
      /** Private configured native username; never client/public inventory. */
      user: string; /** Private native secret; POP3 controls are validated before native dispatch. */
      password: string; /** Private configured OAuth token for IMAP; POP3 OAuth mode is unsupported. */
      accessToken?: never;
    }
  | {
      /** Private configured native username; never client/public inventory. */
      user: string; /** Private configured OAuth token for IMAP; POP3 OAuth mode is unsupported. */
      accessToken: string; /** Private native secret; POP3 controls are validated before native dispatch. */
      password?: never;
    };
export interface IncomingAccount {
  /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
  name: string;
  /** Explicit IMAP/POP3 source kind. */
  protocol: IncomingProtocol;
  /** Trusted configured native endpoint; default drivers require verified TLS. */
  host: string;
  /** Native port 1–65535; defaults IMAP 993/POP3 995. */
  port?: number;
  /** TLS is required. Plaintext POP3/IMAP is deliberately unsupported. */
  secure?: true;
  /** Private configured password or IMAP access-token authentication. */
  auth: IncomingAuth;
  /** Default or exact bound remote folder; default INBOX. */
  mailbox?: string; // Default IMAP mailbox; POP3 always uses its single mailbox.
  /** Optional allowlist of additional IMAP folders that may be polled by name. */
  mailboxes?: string[];
  /** False skips configured native operations; default enabled. */
  enabled?: boolean;
  /** Native timeout budget 1000–120000ms, default 15000; not forced JavaScript cancellation. */
  timeoutMs?: number;
  /** Per-message raw-byte ceiling 1–32MiB, default 8MiB. */
  maxMessageBytes?: number;
  /** Scanned-message ceiling 1–500, default fifty. */
  maxMessagesPerPoll?: number;
  /** Refuse enormous mailboxes instead of allocating unbounded UID lists. */
  maxMailboxMessages?: number;
}
export interface InboundAddress {
  /** Untrusted parsed mailbox claim; must be escaped in any UI. */
  address: string;
  /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
  name?: string;
}
export interface InboundAttachment {
  /** Untrusted display basename normalized before host storage callbacks. */
  filename: string;
  /** Untrusted bounded MIME metadata; not proof of binary format. */
  contentType: string;
  /** Validated/observed byte count or explicit native size projection under the owning contract. */
  size: number;
  /** Bounded literal inline content reference; not a remote fetch URL. */
  contentId?: string;
  /** Explicit native MIME inline presentation metadata. */
  inline?: boolean;
  /** Opaque reference returned by a host-provided storage callback. */
  storedReference?: string;
  /** JSON mode only: base64 original binary (opt in; subject to strict total limits). */
  contentBase64?: string;
  /** True when binary content is unsafe, oversized or outside explicit output budgets. */
  contentOmitted?: boolean;
  /** Explicit trusted scanner result or unscanned; untrusted message headers cannot authenticate it. */
  scanVerdict?: 'clean' | 'suspicious' | 'blocked' | 'unscanned';
}
export interface InboundMessage {
  /** Stable local account/protocol/folder/native-generation identity hash. */
  id: string;
  /** Exact configured account scope; lower-level stores do not authorize principals. */
  account: string;
  /** Explicit IMAP/POP3 source kind. */
  protocol: IncomingProtocol;
  /** Default or exact bound remote folder; default INBOX. */
  mailbox: string;
  /** Native UID/UIDL identity retained for deduplication and exact flag mutation. */
  remoteId: string;
  /** Native IMAP generation identity; cursor/flags must not cross generations. */
  uidValidity?: string;
  /** Private untrusted Message-ID claim, distinct from the local opaque identity. */
  messageId?: string;
  /** Untrusted bounded subject; escape before display. */
  subject: string;
  /** Untrusted parsed sender claims; no SPF/DKIM/DMARC proof. */
  from: string[];
  /** Private parsed recipient claims; no account authorization is inferred. */
  to: string[];
  /** Private copied-recipient claims. */
  cc: string[];
  /** Private blind-recipient metadata when present; never public analytics. */
  bcc?: string[];
  /** Untrusted parsed reply destinations; never automatically fetched. */
  replyTo?: string[];
  /** Bounded private display-name/mailbox structures from the parser. */
  addressDetails?: {
    /** Untrusted parsed sender claims; no SPF/DKIM/DMARC proof. */
    from: InboundAddress[];
    /** Private parsed recipient claims; no account authorization is inferred. */
    to: InboundAddress[];
    /** Private copied-recipient claims. */
    cc: InboundAddress[];
    /** Private blind-recipient metadata when present; never public analytics. */
    bcc: InboundAddress[];
    /** Untrusted parsed reply destinations; never automatically fetched. */
    replyTo: InboundAddress[];
  };
  /** Untrusted bounded message linkage claim. */
  inReplyTo?: string;
  /** Bounded private message linkage claims; not authenticated ancestry. */
  references?: string[];
  /** Untrusted low/normal/high MIME hint; no queue ordering authority. */
  priority?: 'low' | 'normal' | 'high';
  /** Parsed message-authored timestamp; separate from local receivedAt. */
  date?: number;
  /** Local host clock when metadata is recorded. */
  receivedAt: number;
  /** Untrusted clipped plain text; never evaluated as server code. */
  text?: string;
  /** Sanitized/clipped body under the configured trusted sanitizer; UI still owns safe rendering. */
  html?: string;
  /** Explicit text/attachment-list coverage limitation. */
  bodyTruncated: boolean;
  /** Bounded private attachment metadata; binary output requires explicit JSON mode. */
  attachments: InboundAttachment[];
  /** Offline advisory flags plus explicit external scanner observations; not sender authentication. */
  safety?: InboundSafety;
}
export interface InboundStore {
  /** Read one private locally persisted message; this lower-level store does not authorize a principal.
   * @param {string} id - Opaque local hash reference, never principal authentication.
   * @returns {Promise<InboundMessage | null>} Stored private message or null; use the account-authorized inbox facade at HTTP boundaries.
   */
  get(id: string): Promise<InboundMessage | null>;
  /** Reserve one local identity without overwriting a previously stored message.
   * @param {InboundMessage} message - Private parsed message passed for unique local storage; lower-level storage does not authorize the caller.
   * @returns {Promise<boolean>} True for a new committed local record; duplicate returns false.
   */
  put(message: InboundMessage): Promise<boolean>; // atomic create-if-absent
  /** Delete only this local identity/account pair; no remote deletion or revision-CAS promise.
   * @param {string} id - Opaque local hash reference, never principal authentication.
   * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
   * @returns {Promise<boolean>} True only for a matching local removal; remote mail remains untouched.
   */
  erase?(id: string, account: string): Promise<boolean>;
  /** Read a bounded ordered account page from this private store.
   * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
   * @param {string | null} cursor - Exclusive opaque store continuation; null starts a page.
   * @param {number} limit - Explicit bounded page size; store default fifty, maximum five hundred.
   * @returns {Promise<{items: InboundMessage[], nextCursor: string | null, done: boolean}>} Private records and continuation; memory may require one extra empty page at an exact boundary.
   */
  page(
    account: string,
    cursor: string | null,
    limit: number
  ): Promise<{
    /** Private stored-message page, not a public summary. */
    items: InboundMessage[];
    /** Exclusive continuation or null at reported completion. */
    nextCursor: string | null;
    /** Explicit source/store completion, not assurance of delivery or malware safety. */
    done: boolean;
  }>;
}
export interface ParsedIncomingMail {
  /** Private untrusted Message-ID claim, distinct from the local opaque identity. */
  messageId?: string;
  /** Untrusted bounded subject; escape before display. */
  subject?: string;
  /** Untrusted parsed sender claims; no SPF/DKIM/DMARC proof. */
  from?: {
    /** Untrusted parsed address list or clipped-text result according to the containing contract. */
    value?: {
      /** Untrusted parsed mailbox claim; must be escaped in any UI. */
      address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
      name?: string;
    }[];
  };
  /** Private parsed recipient claims; no account authorization is inferred. */
  to?: {
    /** Untrusted parsed address list or clipped-text result according to the containing contract. */
    value?: {
      /** Untrusted parsed mailbox claim; must be escaped in any UI. */
      address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
      name?: string;
    }[];
  };
  /** Private copied-recipient claims. */
  cc?: {
    /** Untrusted parsed address list or clipped-text result according to the containing contract. */
    value?: {
      /** Untrusted parsed mailbox claim; must be escaped in any UI. */
      address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
      name?: string;
    }[];
  };
  /** Private blind-recipient metadata when present; never public analytics. */
  bcc?: {
    /** Untrusted parsed address list or clipped-text result according to the containing contract. */
    value?: {
      /** Untrusted parsed mailbox claim; must be escaped in any UI. */
      address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
      name?: string;
    }[];
  };
  /** Untrusted parsed reply destinations; never automatically fetched. */
  replyTo?: {
    /** Untrusted parsed address list or clipped-text result according to the containing contract. */
    value?: {
      /** Untrusted parsed mailbox claim; must be escaped in any UI. */
      address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
      name?: string;
    }[];
  };
  /** Untrusted bounded message linkage claim. */
  inReplyTo?: string;
  /** Bounded private message linkage claims; not authenticated ancestry. */
  references?: string[] | string;
  /** Untrusted low/normal/high MIME hint; no queue ordering authority. */
  priority?: 'low' | 'normal' | 'high';
  /** Parsed message-authored timestamp; separate from local receivedAt. */
  date?: Date;
  /** Untrusted clipped plain text; never evaluated as server code. */
  text?: string;
  /** Sanitized/clipped body under the configured trusted sanitizer; UI still owns safe rendering. */
  html?: string | false;
  /** Bounded private attachment metadata; binary output requires explicit JSON mode. */
  attachments?: {
    /** Untrusted display basename normalized before host storage callbacks. */
    filename?: string;
    /** Untrusted bounded MIME metadata; not proof of binary format. */
    contentType?: string;
    /** Untrusted native MIME presentation label. */
    contentDisposition?: string;
    /** Validated/observed byte count or explicit native size projection under the owning contract. */
    size?: number;
    /** Untrusted MIME inline content identity. */
    cid?: string;
    /** Private parser-produced binary bytes; scanner/output/storage policies apply before exposure. */
    content?: Buffer;
  }[];
}
export interface ImapConnection {
  /** Default or exact bound remote folder; default INBOX. */
  mailbox?: {
    /** Native mailbox message count used for admission bounds. */
    exists?: number;
    /** Native IMAP generation identity; cursor/flags must not cross generations. */
    uidValidity?: bigint | number | string;
    /** Native next-assignable UID; prevents skipping possible future messages on empty ranges. */
    uidNext?: bigint | number | string;
  };
  /** Establish the host-configured native IMAP connection; injected drivers own partial-connect failure cleanup.
   * @returns {Promise<void>} Native connection established; enclosing operation owns later logout.
   */
  connect(): Promise<void>;
  /** Acquire a native mailbox lease with explicit read-only/write intent.
   * @param {string} name - Exact configured account/folder or fixed validation label under the owning operation.
   * @param {{ readOnly: boolean }} options - Explicit native UID/lock intent or receiver policy; no caller role claims.
   * @returns {Promise<{release(): void}>} Owned operation lock requiring release in finally.
   */
  getMailboxLock(
    name: string,
    options: {
      /** Explicit native lock intent; reads use true, flag writes use false. */
      readOnly: boolean;
    }
  ): Promise<{
    /** Release this native operation mailbox lock.
     * @returns {void} Lock release requested; native client lifecycle remains separately owned.
     */
    release(): void;
  }>;
  /** Read native private IMAP folder metadata without modifying message state.
   * @returns {Promise<{path: string, name?: string, delimiter?: string, flags?: Set<string>}[]>} Untrusted remote labels; caller validates bounds and escapes any UI text.
   */
  list?(): Promise<
    {
      /** Untrusted native folder label, never a local filesystem path. */
      path: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
      name?: string; /** Untrusted native folder hierarchy delimiter metadata. */
      delimiter?: string; /** Native folder/message flags under explicit operation policy. */
      flags?: Set<string>;
    }[]
  >;
  /** Add only explicit native flags to one UID under the current mailbox validity/lock.
   * @param {number} uid - Validated native IMAP UID within 1–4294967295.
   * @param {string[]} flags - Explicit native flag strings selected by the receiver.
   * @param {{ uid: true }} options - Explicit native UID/lock intent or receiver policy; no caller role claims.
   * @returns {Promise<unknown>} Native outcome; no local erasure is implied.
   */
  messageFlagsAdd?(
    uid: number,
    flags: string[],
    options: {
      /** Literal true selects native UID interpretation rather than mutable sequence numbers. */
      uid: true;
    }
  ): Promise<unknown>;
  /** Remove only explicit native flags from one UID under the current mailbox validity/lock.
   * @param {number} uid - Validated native IMAP UID within 1–4294967295.
   * @param {string[]} flags - Explicit native flag strings selected by the receiver.
   * @param {{ uid: true }} options - Explicit native UID/lock intent or receiver policy; no caller role claims.
   * @returns {Promise<unknown>} Native outcome; no local erasure is implied.
   */
  messageFlagsRemove?(
    uid: number,
    flags: string[],
    options: {
      /** Literal true selects native UID interpretation rather than mutable sequence numbers. */
      uid: true;
    }
  ): Promise<unknown>;
  /** Request only explicit all/UID-range native search under caller-enforced mailbox budgets.
   * @param {{ all?: true; uid?: string }} query - Explicit native all/UID-range source request; never raw server code.
   * @param {{ uid: true }} options - Explicit native UID/lock intent or receiver policy; no caller role claims.
   * @returns {Promise<number[] | false>} Native UID list or explicit failure; caller validates identity/count bounds.
   */
  search(
    query: {
      /** Literal true requests the bounded initial native search shape. */
      all?: true; /** Literal true selects native UID interpretation rather than mutable sequence numbers. */
      uid?: string;
    },
    options: {
      /** Literal true selects native UID interpretation rather than mutable sequence numbers. */
      uid: true;
    }
  ): Promise<number[] | false>;
  /** Fetch one UID source/recorded size under the active mailbox lock.
   * @param {number} uid - Validated native IMAP UID within 1–4294967295.
   * @param {{ source: true; size: true }} query - Explicit native all/UID-range source request; never raw server code.
   * @param {{ uid: true }} options - Explicit native UID/lock intent or receiver policy; no caller role claims.
   * @returns {Promise<{source?: Buffer, size?: number} | false>} Private raw source metadata or false; bytes are validated before parsing.
   */
  fetchOne(
    uid: number,
    query: {
      /** Literal native source request or private raw source bytes in its owning contract. */
      source: true; /** Validated/observed byte count or explicit native size projection under the owning contract. */
      size: true;
    },
    options: {
      /** Literal true selects native UID interpretation rather than mutable sequence numbers. */
      uid: true;
    }
  ): Promise<
    | {
        /** Literal native source request or private raw source bytes in its owning contract. */
        source?: Buffer; /** Validated/observed byte count or explicit native size projection under the owning contract. */
        size?: number;
      }
    | false
  >;
  /** Release a successfully connected native IMAP operation client.
   * @returns {Promise<void>} Native logout settled; this is separate from receiver admission-only close.
   */
  logout(): Promise<void>;
}
export interface Pop3Connection {
  /** Read native POP3 stable identity pairs; caller rejects duplicate/oversized lists before RETR.
   * @returns {Promise<(string | number)[][]>} Private message-number/UIDL pairs; no remote DELE is issued.
   */
  UIDL(): Promise<(string | number)[][]>;
  /** Check native POP3 readiness without changing mailbox state.
   * @returns {Promise<unknown>} Native readiness outcome.
   */
  NOOP?(): Promise<unknown>;
  /** Read native POP3 readiness/status without retrieving or deleting mail.
   * @returns {Promise<unknown>} Native status outcome.
   */
  STAT?(): Promise<unknown>;
  /** Retrieve one native POP3 message without deleting it.
   * @param {string | number} number - Validated POP3 message number from the bounded UIDL listing.
   * @returns {Promise<string | Buffer | AsyncIterable<Uint8Array>>} Private raw source; configured native default preserves binary bytes.
   */
  RETR(
    number: string | number
  ): Promise<string | Buffer | AsyncIterable<Uint8Array>>;
  /** Release this native POP3 operation client.
   * @returns {Promise<unknown>} Native connection cleanup settled.
   */
  QUIT(): Promise<unknown>;
}
export interface IncomingConnections {
  /** Construct one private native IMAP facade lazily with fixed verified-TLS defaults.
   * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
   * @returns {Promise<ImapConnection>} Operation-owned client; caller connects, locks, releases and logs out after successful connect.
   */
  imap(account: IncomingAccount): Promise<ImapConnection>;
  /** Construct one private native POP3 facade lazily with verified TLS and native byte/time bounds.
   * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
   * @returns {Promise<Pop3Connection>} Operation-owned client; caller must await QUIT in finally.
   */
  pop3(account: IncomingAccount): Promise<Pop3Connection>;
}
export interface IncomingPollCursor {
  /** Native IMAP generation identity; cursor/flags must not cross generations. */
  uidValidity?: string;
  /** Exclusive incremental UID lower bound, integer 0–4294967295. */
  afterUid: number;
  /** Bind resume state to exactly one IMAP folder. */ mailbox?: string;
}
export interface IncomingPollOptions {
  /** Explicit generation/folder-bound incremental cursor; no durable persistence is automatic. */
  cursor?: IncomingPollCursor;
  /** Only a configured IMAP mailbox can be selected. */ mailbox?: string;
}
export interface EmailReceiverOptions {
  /** Explicit private native endpoint configurations; no package/disk discovery. */
  accounts: IncomingAccount[];
  /** If omitted, JSON mode returns parsed messages without installing/using any inbox tables. */
  store?: InboundStore;
  /** json mode never persists messages. Default: persist when store is provided, json otherwise. */
  mode?: 'persist' | 'json';
  /** Optional host-defined database mapping/handler. Rejected callbacks fail the poll. */
  onMessage?: (message: InboundMessage) => Promise<void> | void;
  /** Trusted external classifier; receives the original bounded source. Failure aborts the poll. */
  inspectRaw?: (context: {
    /** Exact configured account scope; lower-level stores do not authorize principals. */
    account: string;
    /** Private bounded untrusted MIME bytes supplied only to a trusted injected hook. */
    raw: Buffer;
  }) => Promise<'clean' | 'spam' | 'phishing' | 'malware' | 'review'>;
  /** Optional attachment scanner: blocked/suspicious bytes are never uploaded or emitted as base64. */
  inspectAttachment?: (context: {
    /** Exact configured account scope; lower-level stores do not authorize principals. */
    account: string;
    /** Private untrusted Message-ID claim, distinct from the local opaque identity. */
    messageId: string;
    /** Untrusted display basename normalized before host storage callbacks. */
    filename: string;
    /** Private parser-produced binary bytes; scanner/output/storage policies apply before exposure. */
    content: Buffer;
  }) => Promise<'clean' | 'suspicious' | 'blocked'>;
  /** JSON mode only; binary attachments are opt-in and base64 encoded with a total byte cap. */
  attachmentContent?: 'metadata' | 'base64';
  /** Explicit JSON base64 raw-byte budget 1–8MiB, default 2MiB. */
  maxInlineAttachmentBytes?: number;
  /** Trusted injected native factories; host qualifies TLS/lifecycle guarantees. */
  connections?: IncomingConnections;
  /** Trusted injected MIME parser; returned shape is independently checked before exposure. */
  parse?: (raw: Buffer) => Promise<ParsedIncomingMail>;
  /** Override only with a trusted HTML sanitizer. Default strips scripts, images and unsafe URLs. */
  sanitizeHtml?: (html: string) => string | Promise<string>;
  /** Attachments are NOT retained in the inbox table. Upload through this callback if desired. */
  saveAttachment?: (context: {
    /** Exact configured account scope; lower-level stores do not authorize principals. */
    account: string;
    /** Private untrusted Message-ID claim, distinct from the local opaque identity. */
    messageId: string;
    /** Private permitted attachment metadata passed to host storage policy. */
    attachment: InboundAttachment;
    /** Private parser-produced binary bytes; scanner/output/storage policies apply before exposure. */
    content: Buffer;
  }) => Promise<string>;
  /** Optional trusted local epoch clock, default Date.now. */
  now?: () => number;
}
/** Validate an explicit safe integer against its owning runtime budget.
 * @param {number | undefined} n - Optional requested integer resource budget.
 * @param {number} fallback - Explicit owning budget default.
 * @param {number} min - Explicit minimum safe integer.
 * @param {number} max - Explicit maximum safe integer/length budget.
 * @param {string} name - Exact configured account/folder or fixed validation label under the owning operation.
 * @returns {number} Validated requested value or exact default.
 */
function bounds(
  n: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string
): number {
  /** Explicit helper value or default checked against its owning runtime budget. */
  const value = n ?? fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${name}`);
  }
  return value;
}
/** Validate explicit native account, TLS/auth mode, mailbox allowlist and resource budgets before acquisition.
 * @param {IncomingAccount} account - Trusted configured account or exact account identity under the owning API.
 * @returns {void} Malformed settings reject; trusted injected drivers still own transport qualification.
 */
function checkAccount(account: IncomingAccount) {
  if (
    !accountPattern.test(account?.name) ||
    !['imap', 'pop3'].includes(account.protocol)
  ) {
    throw new TypeError('Invalid receive account');
  }
  if (
    typeof account.host !== 'string' ||
    !/^([a-z0-9][a-z0-9.-]{0,252}|\[[0-9a-f:]+\])$/i.test(account.host) ||
    account.host.includes('..')
  ) {
    throw new TypeError('Invalid inbound hostname');
  }
  if (account.secure !== undefined && account.secure !== true) {
    throw new TypeError('Inbound connections require verified TLS');
  }
  bounds(
    account.port,
    account.protocol === 'imap' ? 993 : 995,
    1,
    65535,
    'mail port'
  );
  bounds(account.timeoutMs, 15000, 1000, 120000, 'mail timeout');
  bounds(
    account.maxMessageBytes,
    8 * 1024 * 1024,
    1024,
    32 * 1024 * 1024,
    'mail size'
  );
  bounds(account.maxMessagesPerPoll, 50, 1, 500, 'poll limit');
  bounds(account.maxMailboxMessages, 5000, 1, 50000, 'mailbox scan limit');
  if (
    !account.auth ||
    typeof account.auth.user !== 'string' ||
    !account.auth.user.trim() ||
    account.auth.user.length > 320
  ) {
    throw new TypeError('Invalid inbound username');
  }
  if (
    typeof account.auth.password !== 'string' &&
    typeof account.auth.accessToken !== 'string'
  ) {
    throw new TypeError('Inbound authentication required');
  }
  if (account.protocol === 'pop3' && 'accessToken' in account.auth) {
    throw new TypeError(
      'POP3 OAuth2 is not supported by the selected POP3 driver'
    );
  }
  if (
    account.protocol === 'pop3' &&
    (/[\r\n\0]/.test(account.auth.user) ||
      (typeof account.auth.password === 'string' &&
        /[\r\n\0]/.test(account.auth.password)))
  ) {
    throw new TypeError('Unsafe POP3 authentication data');
  }
  if (account.protocol === 'pop3' && account.mailbox) {
    throw new TypeError('POP3 does not support named mailboxes');
  }
  if (account.mailbox && !safeMailbox(account.mailbox)) {
    throw new TypeError('Invalid IMAP mailbox');
  }
  if (account.mailboxes !== undefined) {
    if (
      account.protocol !== 'imap' ||
      !Array.isArray(account.mailboxes) ||
      account.mailboxes.length > 100 ||
      account.mailboxes.some((folder) => !safeMailbox(folder)) ||
      new Set(account.mailboxes).size !== account.mailboxes.length
    ) {
      throw new TypeError('Invalid IMAP mailbox allowlist');
    }
  }
}
/** Validate bounded literal folder spelling without treating it as a filesystem path.
 * @param {unknown} value - Private parsed record or explicit native helper input according to the owning signature.
 * @returns {boolean} True only for a nonempty string without header controls.
 */
function safeMailbox(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    !/[\r\n\0]/.test(value)
  );
}
/** Choose only the configured/default/explicitly allowlisted IMAP folder; POP3 has no selectable folder.
 * @param {IncomingAccount} account - Trusted configured account or exact account identity under the owning API.
 * @param {string | undefined} requested - Optional configured requested folder; arbitrary unlisted folder rejects.
 * @returns {string} Literal folder reference; no principal authorization is supplied.
 */
function resolveMailbox(
  account: IncomingAccount,
  requested: string | undefined
): string {
  if (account.protocol === 'pop3') {
    if (requested !== undefined) {
      throw new TypeError('POP3 has no named mailboxes');
    }
    return 'INBOX';
  }
  /** Validated configured/default native folder identity, not a local filesystem path. */
  const mailbox = requested ?? account.mailbox ?? 'INBOX';
  if (!safeMailbox(mailbox)) {
    throw new TypeError('Invalid IMAP mailbox');
  }
  if (
    requested !== undefined &&
    requested !== account.mailbox &&
    requested !== 'INBOX' &&
    !account.mailboxes?.includes(requested)
  ) {
    throw new Error('IMAP mailbox not configured for this account');
  }
  return mailbox;
}
/** Bind local message identity to account/protocol/folder/UIDVALIDITY/remote identity.
 * @param {string} account - Trusted configured account or exact account identity under the owning API.
 * @param {IncomingProtocol} protocol - Explicit IMAP/POP3 identity domain.
 * @param {string} mailbox - Literal configured folder identity; not a local filesystem path.
 * @param {string} uidValidity - Native immutable mailbox generation; changed validity fences reused UIDs.
 * @param {string} remoteId - Stable native remote identity, never sender-provided executable text.
 * @returns {string} Stable SHA-256 reference; not anonymization or principal permission.
 */
function keyFor(
  account: string,
  protocol: IncomingProtocol,
  mailbox: string,
  uidValidity: string,
  remoteId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([account, protocol, mailbox, uidValidity, remoteId]))
    .digest('hex');
}
/** Project only bounded parsed mailbox claims; these are not authenticated sender identities.
 * @param {{
  value?: { address?: string; name?: string }[];
}} value - Private parsed record or explicit native helper input according to the owning signature.
 * @param {{address?: string, name?: string}[]} value.value - Optional untrusted parsed address list; bounded before private display projection.
 * @returns {string[]} At most one hundred private claimed addresses.
 */
function emails(value?: {
  /** Untrusted parsed address list or clipped-text result according to the containing contract. */
  value?: {
    /** Untrusted parsed mailbox claim; must be escaped in any UI. */
    address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
    name?: string;
  }[];
}): string[] {
  return (value?.value ?? [])
    .map((item) => item.address ?? '')
    .filter(Boolean)
    .slice(0, 100);
}
/** Strip path components and bounded control characters before exposing an untrusted filename to host callbacks.
 * @param {unknown} value - Private parsed record or explicit native helper input according to the owning signature.
 * @returns {string} Literal safe display basename, not a trusted executable path.
 */
function safeFilename(value: unknown): string {
  /** Untrusted basename after removing both slash conventions; never an executable path. */
  const leaf =
    String(value ?? 'attachment')
      .split(/[\\/]/)
      .at(-1) ?? 'attachment';

  /** Bounded display basename with literal control characters removed. */
  const cleaned = leaf
    // eslint-disable-next-line no-control-regex -- Intentionally removes control characters from an untrusted display filename.
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .trim()
    .slice(0, 255);
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : 'attachment';
}
/** Bound parsed display/mailbox metadata without trusting received names as labels or roles.
 * @param {{
  value?: { address?: string; name?: string }[];
}} value - Private parsed record or explicit native helper input according to the owning signature.
 * @param {{address?: string, name?: string}[]} value.value - Optional untrusted parsed address list; bounded before private display projection.
 * @returns {InboundAddress[]} Private untrusted address details; UI escaping remains required.
 */
function addressDetails(value?: {
  /** Untrusted parsed address list or clipped-text result according to the containing contract. */
  value?: {
    /** Untrusted parsed mailbox claim; must be escaped in any UI. */
    address?: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
    name?: string;
  }[];
}): InboundAddress[] {
  return (value?.value ?? [])
    .filter((x) => typeof x.address === 'string' && x.address.length > 0)
    .slice(0, 100)
    .map((x) => ({
      address: x.address!.slice(0, 320),
      ...(x.name ? { name: String(x.name).slice(0, 256) } : {}),
    }));
}
/** Clip text by UTF-16 length and explicitly record lost coverage.
 * @param {string | undefined} value - Private parsed record or explicit native helper input according to the owning signature.
 * @param {number} max - Explicit maximum safe integer/length budget.
 * @returns {{value: string | undefined, truncated: boolean}} Optional clipped value with its exact truncation flag.
 */
function clip(
  value: string | undefined,
  max: number
): {
  /** Untrusted parsed address list or clipped-text result according to the containing contract. */
  value: string | undefined; /** True when clipping removed source coverage. */
  truncated: boolean;
} {
  if (!value) {
    return { value: undefined, truncated: false };
  }
  return {
    value: value.length > max ? value.slice(0, max) : value,
    truncated: value.length > max,
  };
}
/** Mapping for a pre-existing application inbox table. The three identity/JSON fields are required;
 * every other field is an optional denormalized column for application-owned indexes and queries.
 * Existing tables are never modified when createTable=false.
 */
export interface MappedInboxColumns {
  /** Stable local account/protocol/folder/native-generation identity hash. */
  id: string;
  /** Exact configured account scope; lower-level stores do not authorize principals. */
  account: string;
  /** Explicit mapped private JSON column identity; schema changes require createTable true. */
  payload: string;
  /** Untrusted bounded subject; escape before display. */
  subject?: string;
  /** Default or exact bound remote folder; default INBOX. */
  mailbox?: string;
  /** Local host clock when metadata is recorded. */
  receivedAt?: string;
  /** Untrusted parsed sender claims; no SPF/DKIM/DMARC proof. */
  from?: string;
}
export interface MappedDatabaseInboxOptions {
  /** Validated trusted host table identifier. */
  table: string;
  /** Defaults to false: the host owns migrations, indexes and column definitions. */
  createTable?: boolean;
  /** Explicit unique validated native column mapping; not caller SQL. */
  columns?: Partial<MappedInboxColumns>;
}
/** Adapt explicit host-owned columns with bounded private JSON and identity/account checks.
 * @param {CampaignDatabaseConnection} db - Borrowed real structured database; host scopes tenants/accounts and closes it.
 * @param {MappedDatabaseInboxOptions} config - Explicit trusted table/column mapping; createTable defaults false.
 * @returns {InboundStore} Borrowed database facade; schema changes only when explicitly createTable is enabled.
 */
export function createMappedDatabaseInboxStore(
  db: CampaignDatabaseConnection,
  config: MappedDatabaseInboxOptions
): InboundStore {
  /** Explicit validated host table; no request-selected schema discovery. */
  const table = config?.table;
  if (typeof table !== 'string' || !tablePattern.test(table)) {
    throw new TypeError('Invalid inbox table');
  }
  /** Unique validated identity/account/private-payload mapping with optional denormalized columns. */
  const columns: MappedInboxColumns = {
    id: 'id',
    account: 'account',
    payload: 'payload_json',
    ...config.columns,
  };
  /** Mapped native column names checked for unsafe spelling and collisions. */
  const keys = Object.values(columns);
  if (
    keys.some((v) => typeof v !== 'string' || !tablePattern.test(v)) ||
    new Set(keys).size !== keys.length
  ) {
    throw new TypeError('Invalid or duplicate mapped inbox columns');
  }
  let ready: Promise<void> | undefined;
  /** Coalesce optional schema initialization; existing host tables remain untouched unless createTable is enabled.

 * @returns {Promise<void>} Borrowed schema initialization settled; failed initialization can be attempted later. */
  const ensure = () =>
    (ready ??= (async () => {
      if (!config.createTable) {
        return;
      } // Existing application-owned table is not touched.
      /** Explicit optional denormalized schema columns; no application-owned table mutation by default. */
      const extra = [
        ...(columns.subject
          ? [{ name: columns.subject, type: 'varchar', length: 1024 }]
          : []),
        ...(columns.mailbox
          ? [{ name: columns.mailbox, type: 'varchar', length: 255 }]
          : []),
        ...(columns.receivedAt
          ? [{ name: columns.receivedAt, type: 'bigint' }]
          : []),
        ...(columns.from
          ? [{ name: columns.from, type: 'varchar', length: 320 }]
          : []),
      ];
      /** Private structured native result checked before interpreting rows or commit status. */
      const result = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
          {
            name: columns.id,
            type: 'varchar',
            length: 64,
            primary: true,
            notNull: true,
          },
          { name: columns.account, type: 'varchar', length: 64, notNull: true },
          { name: columns.payload, type: 'text', notNull: true },
          ...extra,
        ],
      });
      if (!result?.ok) {
        throw new Error('Inbox table initialization failed');
      }
      if (db.createIndex) {
        try {
          await db.createIndex({
            table,
            name: `${table}_account_idx`,
            columns: [columns.account, columns.id],
            unique: false,
            ifNotExists: true,
          });
        } catch {
          /* optional index */
        }
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }));
  /** Parse private stored JSON and cross-check local identity/account against native row columns.
   * @param {Record<string, unknown>} row - Private native mapped row.
   * @returns {InboundMessage} Private stored message; this is not full untrusted-snapshot schema validation or HTML sanitization. */
  const decode = (row: Record<string, unknown>): InboundMessage => {
    /** Private stored JSON text required before parsing as data. */
    const serialized = row[columns.payload];
    if (typeof serialized !== 'string') {
      throw new Error('Corrupt inbox payload');
    }
    /** Parsed private record checked against its identity/account columns. */
    const data = JSON.parse(serialized) as InboundMessage;
    if (data.id !== row[columns.id] || data.account !== row[columns.account]) {
      throw new Error('Corrupt inbox identity');
    }
    return data;
  };
  /** Only mapped identity/account/private-payload columns are read for document decoding. */
  const projection = [columns.id, columns.account, columns.payload];
  /** Borrowed structured store facade; authorization and database close remain host-owned. */
  const adapter: InboundStore = {
    /** Read one private locally persisted message; this lower-level store does not authorize a principal.
     * @param {string} id - Opaque local hash reference, never principal authentication.
     * @returns {Promise<InboundMessage | null>} Stored private message or null; use the account-authorized inbox facade at HTTP boundaries.
     */
    async get(id) {
      if (!/^[a-f0-9]{64}$/.test(id)) {
        throw new TypeError('Invalid inbox id');
      }
      await ensure();
      /** Private structured native result checked before interpreting rows or commit status. */
      const result = await db.select({
        table,
        columns: projection,
        where: { field: columns.id, operator: 'eq', value: id },
        limit: 1,
      });
      if (!result?.ok || !Array.isArray(result.rows)) {
        throw new Error('Inbox read failed');
      }
      return result.rows.length
        ? decode(result.rows[0] as Record<string, unknown>)
        : null;
    },
    /** Reserve one local identity without overwriting a previously stored message.
     * @param {InboundMessage} value - Private parsed record or explicit native helper input according to the owning signature.
     * @returns {Promise<boolean>} True for a new committed local record; duplicate returns false.
     */
    async put(value) {
      if (
        !/^[a-f0-9]{64}$/.test(value?.id) ||
        !accountPattern.test(value.account)
      ) {
        throw new TypeError('Invalid inbox identity');
      }
      await ensure();
      /** Private complete message JSON checked against the conservative 60000-byte TEXT ceiling. */
      const json = JSON.stringify(value);
      if (Buffer.byteLength(json) > 60_000) {
        throw new RangeError('Inbox metadata exceeds portable TEXT limit');
      }
      /** Allowlisted mapped native values; neither credentials nor arbitrary raw column expressions are copied. */
      const values: Record<string, unknown> = {
        [columns.id]: value.id,
        [columns.account]: value.account,
        [columns.payload]: json,
      };
      if (columns.subject) {
        values[columns.subject] = value.subject.slice(0, 1024);
      }
      if (columns.mailbox) {
        values[columns.mailbox] = value.mailbox.slice(0, 255);
      }
      if (columns.receivedAt) {
        values[columns.receivedAt] = value.receivedAt;
      }
      if (columns.from) {
        values[columns.from] = (value.from[0] ?? '').slice(0, 320);
      }
      try {
        /** Private structured native result checked before interpreting rows or commit status. */
        const result = await db.insert({ table, values });
        if (result?.ok) {
          return true;
        }
      } catch (error) {
        /** Existing exact local identity used to distinguish duplicate insertion from native failure. */
        const existing = await adapter.get(value.id);
        if (existing) {
          return false;
        }
        throw error;
      }
      if (await adapter.get(value.id)) {
        return false;
      }
      throw new Error('Inbox insert failed');
    },
    /** Delete only this local identity/account pair; no remote deletion or revision-CAS promise.
     * @param {string} id - Opaque local hash reference, never principal authentication.
     * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
     * @returns {Promise<boolean>} True only for a matching local removal; remote mail remains untouched.
     */
    async erase(id, account) {
      if (!/^[a-f0-9]{64}$/.test(id) || !accountPattern.test(account)) {
        throw new TypeError('Invalid inbox erase identity');
      }
      if (!db.delete) {
        throw new Error(
          'Inbox retention requires a connector with delete support'
        );
      }
      await ensure();
      /** Private native deletion result; exact zero/one counts are required. */
      const r = await db.delete({
        table,
        where: {
          and: [
            { field: columns.id, operator: 'eq', value: id },
            { field: columns.account, operator: 'eq', value: account },
          ],
        },
      });
      if (!r?.ok) {
        throw new Error('Inbox erasure failed');
      }
      /** Exact native affected count; unknown/multiple deletions reject the store contract. */
      const count = r.affectedCount ?? r.rowCount;
      if (!Number.isSafeInteger(count) || (count !== 0 && count !== 1)) {
        throw new Error('Inbox erasure requires affectedCount');
      }
      return count === 1;
    },
    /** Read a bounded ordered account page from this private store.
     * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
     * @param {string | null} cursor - Exclusive opaque store continuation; null starts a page.
     * @param {number} limit - Explicit bounded page size; store default fifty, maximum five hundred.
     * @returns {Promise<{items: InboundMessage[], nextCursor: string | null, done: boolean}>} Private records and continuation; memory may require one extra empty page at an exact boundary.
     */
    async page(account, cursor = null, limit = 50) {
      if (!accountPattern.test(account)) {
        throw new TypeError('Invalid account');
      }
      /** Explicit page ceiling or observed attachment/source length under the owning bounded operation. */
      const size = bounds(limit, 50, 1, 500, 'page limit');
      if (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) {
        throw new TypeError('Invalid cursor');
      }
      await ensure();
      /** Fixed account predicate plus optional exclusive local identity continuation. */
      const conditions: [any, ...any[]] = [
        { field: columns.account, operator: 'eq', value: account },
      ];
      if (cursor) {
        conditions.push({ field: columns.id, operator: 'gt', value: cursor });
      }
      /** Private structured native result checked before interpreting rows or commit status. */
      const result = await db.select({
        table,
        columns: projection,
        where: { and: conditions },
        orderBy: [{ by: columns.id, direction: 'asc' }],
        limit: size + 1,
      });
      if (!result?.ok || !Array.isArray(result.rows)) {
        throw new Error('Inbox listing failed');
      }
      if (result.rows.length > size + 1) {
        throw new Error('Inbox connector ignored page bound');
      }
      /** One extra native row proves another stored page exists. */
      const hasNext = result.rows.length > size;
      /** Bounded private message map/page; never a public-safe inbox response. */
      const items = result.rows
        .slice(0, size)
        .map((row) => decode(row as Record<string, unknown>));
      return {
        items,
        nextCursor: hasNext ? items.at(-1)!.id : null,
        done: !hasNext,
      };
    },
  };
  return adapter;
}
/** Choose the default package inbox mapping and explicitly enable lazy schema creation.
 * @param {CampaignDatabaseConnection} db - Borrowed real structured database; host scopes tenants/accounts and closes it.
 * @param {string} table - Validated default inbox table identity, default zerux_email_inbox.
 * @returns {InboundStore} Borrowed private database adapter; host owns actual commits, tenant scope and close.
 */
export function createDatabaseInboxStore(
  db: CampaignDatabaseConnection,
  table = 'zerux_email_inbox'
): InboundStore {
  return createMappedDatabaseInboxStore(db, { table, createTable: true });
}
/** Create a cloned-message process-local fixture without durability or native resource acquisition.
 * @returns {InboundStore} Development/reference store; host owns retained-history bounds.
 */
export function createMemoryInboxStore(): InboundStore {
  /** Bounded private message map/page; never a public-safe inbox response. */
  const items = new Map<string, InboundMessage>();
  return {
    /** Read one private locally persisted message; this lower-level store does not authorize a principal.
     * @param {string} id - Opaque local hash reference, never principal authentication.
     * @returns {Promise<InboundMessage | null>} Stored private message or null; use the account-authorized inbox facade at HTTP boundaries.
     */
    async get(id) {
      return items.has(id) ? structuredClone(items.get(id)!) : null;
    },
    /** Reserve one local identity without overwriting a previously stored message.
     * @param {InboundMessage} value - Private parsed record or explicit native helper input according to the owning signature.
     * @returns {Promise<boolean>} True for a new committed local record; duplicate returns false.
     */
    async put(value) {
      if (items.has(value.id)) {
        return false;
      }
      items.set(value.id, structuredClone(value));
      return true;
    },
    /** Delete only this local identity/account pair; no remote deletion or revision-CAS promise.
     * @param {string} id - Opaque local hash reference, never principal authentication.
     * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
     * @returns {Promise<boolean>} True only for a matching local removal; remote mail remains untouched.
     */
    async erase(id, account) {
      if (items.get(id)?.account !== account) {
        return false;
      }
      return items.delete(id);
    },
    /** Read a bounded ordered account page from this private store.
     * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
     * @param {string | null} cursor - Exclusive opaque store continuation; null starts a page.
     * @param {number} limit - Explicit bounded page size; store default fifty, maximum five hundred.
     * @returns {Promise<{items: InboundMessage[], nextCursor: string | null, done: boolean}>} Private records and continuation; memory may require one extra empty page at an exact boundary.
     */
    async page(account, cursor = null, limit = 50) {
      /** Explicit page ceiling or observed attachment/source length under the owning bounded operation. */
      const size = bounds(limit, 50, 1, 500, 'page limit');
      /** Bounded ordered local fixture records before detached projection. */
      const page = [...items.values()]
        .filter(
          (v) => v.account === account && (cursor === null || v.id > cursor)
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, size);
      return {
        items: page.map((v) => structuredClone(v)),
        nextCursor: page.length === size ? page.at(-1)!.id : null,
        done: page.length < size,
      };
    },
  };
}
/** Lazy explicitly selected native factories with fixed TLS policy; no import-time connection starts. */
const defaultConnections: IncomingConnections = {
  /** Construct one private native IMAP facade lazily with fixed verified-TLS defaults.
   * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
   * @returns {Promise<ImapConnection>} Operation-owned client; caller connects, locks, releases and logs out after successful connect.
   */
  async imap(account) {
    /** Maintained native IMAP implementation loaded only for an explicit operation. */
    const { ImapFlow } = await import('imapflow');
    return new ImapFlow({
      host: account.host,
      port: account.port ?? 993,
      secure: true,
      auth: {
        user: account.auth.user,
        ...('password' in account.auth
          ? { pass: account.auth.password }
          : { accessToken: account.auth.accessToken }),
      },
      connectionTimeout: account.timeoutMs ?? 15000,
      greetingTimeout: account.timeoutMs ?? 15000,
      socketTimeout: account.timeoutMs ?? 15000,
      disableAutoIdle: true,
      logger: false,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    }) as unknown as ImapConnection;
  },
  /** Construct one private native POP3 facade lazily with verified TLS and native byte/time bounds.
   * @param {IncomingAccount | string} account - Trusted configured account or exact account identity under the owning API.
   * @returns {Promise<Pop3Connection>} Operation-owned client; caller must await QUIT in finally.
   */
  async pop3(account) {
    /** Maintained native POP3 implementation loaded only for an explicit operation. */
    const { default: Pop3Command } = await import('node-pop3');
    return new Pop3Command({
      host: account.host,
      port: account.port ?? 995,
      tls: true,
      user: account.auth.user,
      password: 'password' in account.auth ? account.auth.password : undefined,
      timeout: account.timeoutMs ?? 15000,
      maxMailSize: account.maxMessageBytes ?? 8 * 1024 * 1024,
      parseStreamToString: false,
      streamReadTimeout: account.timeoutMs ?? 15000,
      tlsOptions: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    }) as Pop3Connection;
  },
};
/** Preserve native POP3 byte chunks while enforcing an aggregate ceiling; legacy decoded strings use UTF-8 conversion.
 * @param {string | Buffer | AsyncIterable<Uint8Array>} value - Private parsed record or explicit native helper input according to the owning signature.
 * @param {number} maximum - Aggregate raw-byte ceiling before MIME parsing.
 * @returns {Promise<Buffer>} Private bounded bytes; already-decoded legacy strings cannot reconstruct original binary encoding.
 */
async function readRaw(
  value: string | Buffer | AsyncIterable<Uint8Array>,
  maximum: number
): Promise<Buffer> {
  if (typeof value === 'string') {
    /** Legacy string converted to UTF-8 bytes; original binary fidelity cannot be reconstructed after decoding. */
    const buffer = Buffer.from(value, 'utf8');
    if (buffer.length > maximum) {
      throw new RangeError('POP3 message exceeds byte limit');
    }
    return buffer;
  }
  if (Buffer.isBuffer(value)) {
    if (value.length > maximum) {
      throw new RangeError('POP3 message exceeds byte limit');
    }
    return value;
  }
  if (!value || typeof value[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('POP3 RETR returned invalid raw message');
  }
  /** Bounded owned POP3 raw-byte copies accumulated without lossy text conversion. */
  const chunks: Buffer[] = [];
  let size = 0;
  // Preserve raw bytes while rejecting overflow on every native POP3 chunk.
  for await (const part of value) {
    if (!(part instanceof Uint8Array)) {
      throw new Error('Invalid POP3 stream chunk');
    }
    size += part.byteLength;
    if (size > maximum) {
      throw new RangeError('POP3 message exceeds byte limit');
    }
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks, size);
}
/** Create explicit private receiver operations with bounded MIME policy and per-operation native cleanup.
 * @param {EmailReceiverOptions} options - Explicit native UID/lock intent or receiver policy; no caller role claims.
 * @returns {EmailReceiver} Host-owned admission controller; no HTTP authorization or native drain-on-close is inferred.
 */
export function createEmailReceiver(options: EmailReceiverOptions) {
  if (
    !options ||
    !Array.isArray(options.accounts) ||
    !options.accounts.length
  ) {
    throw new TypeError('Receive accounts are required');
  }
  /** Explicit persist/json selection; JSON mode has no automatic local deduplication. */
  const mode = options.mode ?? (options.store ? 'persist' : 'json');
  if (mode !== 'persist' && mode !== 'json') {
    throw new TypeError('Invalid inbound mode');
  }
  if (mode === 'persist' && !options.store) {
    throw new TypeError('Persistent receiving requires an inbox store');
  }
  if (options.attachmentContent === 'base64' && mode !== 'json') {
    throw new TypeError('Binary attachment output requires JSON mode');
  }
  /** Explicit JSON-mode raw-binary output ceiling, default two MiB. */
  const maxInline = bounds(
    options.maxInlineAttachmentBytes,
    2 * 1024 * 1024,
    1024,
    8 * 1024 * 1024,
    'inline attachment limit'
  );
  /** Configured private account registry; duplicate names reject before native acquisition. */
  const accounts = new Map<string, IncomingAccount>();
  // Validate each explicit account before any native factory can be selected.
  for (const input of options.accounts) {
    checkAccount(input);
    if (accounts.has(input.name)) {
      throw new TypeError('Duplicate receive account');
    }
    accounts.set(input.name, input);
  }
  /** Explicit trusted injected factories or the fixed maintained native defaults. */
  const connections = options.connections ?? defaultConnections;
  /** Select the explicit trusted MIME parser or lazily load the maintained default.
   * @param {Buffer} raw - Bounded private untrusted raw source.
   * @returns {Promise<ParsedIncomingMail>} Parser-produced data checked independently before exposure; no source code is evaluated. */
  const parse =
    options.parse ??
    (async (raw: Buffer) => {
      /** Maintained MIME parser loaded only during explicit receive work. */
      const { simpleParser } = await import('mailparser');
      return (await simpleParser(raw)) as unknown as ParsedIncomingMail;
    });
  /** Use explicit trusted sanitization or the fixed default allowlist before exposing received HTML.
   * @param {string} raw - Untrusted raw HTML; never evaluated.
   * @returns {string | Promise<string>} Sanitized markup under host/default policy, later clipped with coverage metadata. */
  const sanitizeHtml =
    options.sanitizeHtml ??
    (async (raw: string) => {
      /** Maintained sanitizer loaded lazily; no remote URL is fetched. */
      const { default: sanitize } = await import('sanitize-html');
      return sanitize(raw, {
        allowedTags: [
          'p',
          'br',
          'b',
          'strong',
          'em',
          'i',
          'u',
          'a',
          'ul',
          'ol',
          'li',
          'blockquote',
          'div',
          'span',
          'table',
          'tbody',
          'tr',
          'td',
          'th',
          'h1',
          'h2',
          'h3',
        ],
        allowedAttributes: { a: ['href'] },
        allowedSchemes: ['https', 'mailto'],
        allowProtocolRelative: false,
        nonTextTags: ['script', 'style', 'textarea', 'noscript'],
      });
    });
  let closed = false;
  /** Validate/inspect bounded raw mail, stage permitted attachments and commit local metadata before onMessage.
   * @param {IncomingAccount} account - Trusted configured account or exact account identity under the owning API.
   * @param {string} mailbox - Literal configured folder identity; not a local filesystem path.
   * @param {string} remoteId - Stable native remote identity, never sender-provided executable text.
   * @param {string} uidValidity - Native immutable mailbox generation; changed validity fences reused UIDs.
   * @param {Buffer} raw - Private bounded untrusted source bytes, treated only as data.
   * @returns {Promise<InboundMessage | null>} New private parsed message or duplicate null; host attachment side effects require idempotence/orphan handling.
   */
  async function save(
    account: IncomingAccount,
    mailbox: string,
    remoteId: string,
    uidValidity: string,
    raw: Buffer
  ): Promise<InboundMessage | null> {
    /** Current configured raw-message byte ceiling; independent of the per-poll message count. */
    const max = account.maxMessageBytes ?? 8 * 1024 * 1024;
    if (raw.byteLength > max) {
      throw new RangeError('Inbound message exceeds configured byte limit');
    }
    /** Stable private account/protocol/folder/generation/remote identity hash. */
    const id = keyFor(
      account.name,
      account.protocol,
      mailbox,
      uidValidity,
      remoteId
    );
    if (mode === 'persist' && (await options.store!.get(id))) {
      return null;
    }
    /** Explicit trusted external scanner observation; unsupported values reject. */
    const externalVerdict = options.inspectRaw
      ? await options.inspectRaw({ account: account.name, raw })
      : undefined;
    if (
      externalVerdict &&
      !['clean', 'spam', 'phishing', 'malware', 'review'].includes(
        externalVerdict
      )
    ) {
      throw new Error('Invalid external mail verdict');
    }
    /** Untrusted MIME parser output independently checked before text or attachment use. */
    const parsed = await parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed.attachments !== undefined &&
        !Array.isArray(parsed.attachments)) ||
      (parsed.text !== undefined && typeof parsed.text !== 'string') ||
      (parsed.html !== undefined &&
        parsed.html !== false &&
        typeof parsed.html !== 'string')
    ) {
      throw new Error('Invalid MIME parser result');
    }
    /** Clipped private plain text with explicit lost-coverage metadata. */
    const text = clip(parsed.text, 24000);
    /** Configured-sanitizer output clipped independently of raw-message/attachment budgets. */
    const html = clip(
      typeof parsed.html === 'string'
        ? await sanitizeHtml(parsed.html)
        : undefined,
      24000
    );
    /** Private safe metadata list; binary output/storage is separately gated. */
    const attachments: InboundAttachment[] = [];
    let inlineBytes = 0,
      omitted = false;
    // Limit attachment metadata inspection and gate bytes independently before host storage/output.
    for (const original of (parsed.attachments ?? []).slice(0, 100)) {
      if (
        !original ||
        typeof original !== 'object' ||
        (original.content !== undefined &&
          !Buffer.isBuffer(original.content)) ||
        (original.size !== undefined &&
          (!Number.isSafeInteger(original.size) || original.size < 0))
      ) {
        throw new Error('Invalid MIME attachment');
      }
      /** Observed parser-buffer byte count, independent of a MIME declaration. */
      const actualSize = original.content?.length ?? 0;
      /** Validated MIME-declared size or observed count fallback; cannot hide larger bytes. */
      const declaredSize = original.size ?? actualSize;
      /** Explicit page ceiling or observed attachment/source length under the owning bounded operation. */
      const size = Math.max(actualSize, declaredSize);
      /** Normalized private metadata passed to explicit host attachment policy only. */
      const attachment: InboundAttachment = {
        filename: safeFilename(original.filename),
        contentType: String(original.contentType ?? 'application/octet-stream')
          .replace(/[\r\n\0]/g, '')
          .slice(0, 128),
        size,
        ...(original.cid
          ? { contentId: String(original.cid).slice(0, 320) }
          : {}),
        ...(original.contentDisposition === 'inline' || Boolean(original.cid)
          ? { inline: true }
          : {}),
      };
      if (size > max) {
        attachment.contentOmitted = true;
        omitted = true;
      }
      if (original.content && size <= max) {
        attachment.scanVerdict = options.inspectAttachment
          ? await options.inspectAttachment({
              account: account.name,
              messageId: id,
              filename: attachment.filename,
              content: original.content,
            })
          : 'unscanned';
        if (
          !['clean', 'suspicious', 'blocked', 'unscanned'].includes(
            attachment.scanVerdict
          )
        ) {
          throw new Error('Invalid attachment scanner verdict');
        }
      }
      /** Binary admission requires bounded bytes and nonblocked scanner/malware results. */
      const safeBytes =
        original.content &&
        size <= max &&
        attachment.scanVerdict !== 'blocked' &&
        attachment.scanVerdict !== 'suspicious' &&
        externalVerdict !== 'malware';
      if (
        options.attachmentContent === 'base64' &&
        mode === 'json' &&
        original.content &&
        !safeBytes
      ) {
        attachment.contentOmitted = true;
        omitted = true;
      }
      if (
        options.attachmentContent === 'base64' &&
        mode === 'json' &&
        safeBytes
      ) {
        if (inlineBytes + original.content!.length <= maxInline) {
          attachment.contentBase64 = original.content!.toString('base64');
          inlineBytes += original.content!.length;
        } else {
          attachment.contentOmitted = true;
          omitted = true;
        }
      }
      if (options.saveAttachment && safeBytes) {
        /** Opaque host attachment-storage reference; host owns idempotence and orphan cleanup before metadata commit. */
        const ref = await options.saveAttachment({
          account: account.name,
          messageId: id,
          attachment,
          content: original.content!,
        });
        if (typeof ref !== 'string' || !ref || ref.length > 1024) {
          throw new Error('Attachment store returned invalid reference');
        }
        attachment.storedReference = ref;
      }
      attachments.push(attachment);
    }
    /** Private normalized parsed message; contains no native account password/token. */
    const message: InboundMessage = {
      id,
      account: account.name,
      protocol: account.protocol,
      mailbox,
      remoteId,
      ...(account.protocol === 'imap' ? { uidValidity } : {}),
      messageId: parsed.messageId?.slice(0, 320),
      subject: (parsed.subject ?? '').slice(0, 1024),
      from: emails(parsed.from),
      to: emails(parsed.to),
      cc: emails(parsed.cc),
      bcc: emails(parsed.bcc),
      replyTo: emails(parsed.replyTo),
      addressDetails: {
        from: addressDetails(parsed.from),
        to: addressDetails(parsed.to),
        cc: addressDetails(parsed.cc),
        bcc: addressDetails(parsed.bcc),
        replyTo: addressDetails(parsed.replyTo),
      },
      inReplyTo: parsed.inReplyTo?.slice(0, 320),
      references: (Array.isArray(parsed.references)
        ? parsed.references
        : [parsed.references ?? '']
      )
        .filter(Boolean)
        .slice(0, 100)
        .map((v) => String(v).slice(0, 320)),
      ...(parsed.priority && ['low', 'normal', 'high'].includes(parsed.priority)
        ? { priority: parsed.priority }
        : {}),
      ...(parsed.date instanceof Date && Number.isFinite(parsed.date.getTime())
        ? { date: parsed.date.getTime() }
        : {}),
      receivedAt: options.now?.() ?? Date.now(),
      text: text.value,
      html: html.value,
      bodyTruncated:
        text.truncated ||
        html.truncated ||
        Boolean(parsed.attachments && parsed.attachments.length > 100),
      attachments,
    };
    message.safety = inspectInboundSafety({
      subject: message.subject,
      from: message.from,
      html: typeof parsed.html === 'string' ? parsed.html : undefined,
      text: message.text,
      attachments,
      bodyTruncated: message.bodyTruncated,
      attachmentContentOmitted: omitted,
      externalVerdict,
      attachmentVerdicts: attachments.map((a) => a.scanVerdict ?? 'unscanned'),
    });
    if (mode === 'persist' && !(await options.store!.put(message))) {
      return null;
    }
    if (options.onMessage) {
      await options.onMessage(structuredClone(message));
    }
    return message;
  }
  /** Reopen only an authorized configured mailbox and fence UIDVALIDITY before one native flag update.
   * @param {string} name - Exact configured account/folder or fixed validation label under the owning operation.
   * @param {string | InboundMessage} messageId - Opaque local message reference or private parsed message; native identity is recomputed.
   * @param {'\\Seen' | '\\Flagged'} flag - One fixed supported Seen/Flagged native flag.
   * @param {boolean} set - Explicit boolean native add/remove selection.
   * @returns {Promise<boolean>} Native flag outcome; caller must authorize the initiating principal independently.
   */
  async function mutateImapFlag(
    name: string,
    messageId: string | InboundMessage,
    flag: '\\Seen' | '\\Flagged',
    set: boolean
  ): Promise<boolean> {
    if (closed) {
      throw new Error('Email receiver closed');
    }
    /** Exact enabled configured account resolved before native work. */
    const account = accounts.get(name);
    if (!account || account.enabled === false || account.protocol !== 'imap') {
      throw new Error('Only IMAP accounts support message flags');
    }
    /** Private normalized parsed message; contains no native account password/token. */
    const message =
      typeof messageId === 'string'
        ? await options.store?.get(messageId)
        : messageId;
    if (
      message &&
      message.id !==
        keyFor(
          message.account,
          message.protocol,
          message.mailbox,
          message.uidValidity ?? '',
          message.remoteId
        )
    ) {
      throw new Error('Invalid IMAP message identity');
    }
    if (
      !message ||
      message.account !== name ||
      message.protocol !== 'imap' ||
      !/^[1-9]\d*$/.test(message.remoteId) ||
      !Number.isSafeInteger(Number(message.remoteId)) ||
      Number(message.remoteId) > MAX_IMAP_UID ||
      !message.uidValidity ||
      !safeMailbox(message.mailbox) ||
      ![
        account.mailbox ?? 'INBOX',
        'INBOX',
        ...(account.mailboxes ?? []),
      ].includes(message.mailbox)
    ) {
      throw new Error('IMAP message not found');
    }
    /** Per-operation private native facade; enclosing operation owns lock/logout or POP3 QUIT. */
    const client = await connections.imap(account);
    let connected = false;
    try {
      await client.connect();
      connected = true;
      /** Owned native mailbox lease always released by the enclosing operation finally. */
      const lock = await client.getMailboxLock(message.mailbox, {
        readOnly: false,
      });
      try {
        if (String(client.mailbox?.uidValidity) !== message.uidValidity) {
          throw new Error(
            'IMAP UIDVALIDITY changed; refusing to modify a different message'
          );
        }
        /** Explicit native add/remove flag method selected from this same client; no arbitrary remote operation. */
        const change = set ? client.messageFlagsAdd : client.messageFlagsRemove;
        if (!change) {
          throw new Error('IMAP flag changes unsupported by driver');
        }
        await change.call(client, Number(message.remoteId), [flag], {
          uid: true,
        });
        return true;
      } finally {
        lock.release();
      }
    } finally {
      if (connected) {
        await client.logout();
      }
    }
  }
  return {
    /** Project private configured endpoint/folder metadata without authentication secrets.
     * @returns {object[]} Host-private inventory; endpoint labels still require access control.
     */
    accounts() {
      return [...accounts.values()].map(
        ({ name, protocol, host, port, enabled, mailbox, mailboxes }) => ({
          name,
          protocol,
          host,
          port: port ?? (protocol === 'imap' ? 993 : 995),
          enabled: enabled !== false,
          mailbox: mailbox ?? 'INBOX',
          ...(protocol === 'imap'
            ? {
                mailboxes: [
                  ...new Set([mailbox ?? 'INBOX', ...(mailboxes ?? [])]),
                ],
              }
            : {}),
        })
      );
    },
    /** Read the explicitly borrowed local store without opening a native receive connection.
     * @param {string} id - Opaque local reference; this lower-level read requires host authorization.
     * @returns {Promise<InboundMessage | null>} Private stored message; configured store required. */
    get: (id: string) => {
      if (!options.store) {
        throw new Error(
          'No inbox store configured; handle messages returned by poll()'
        );
      }
      return options.store.get(id);
    },
    /** Check native account readiness and release each operation handle without changing inbox content.
     * @param {string} name - Exact configured account/folder or fixed validation label under the owning operation.
     * @returns {Promise<boolean>} Native readiness result; no later delivery/receive guarantee.
     */
    async verify(name: string): Promise<boolean> {
      if (closed) {
        throw new Error('Email receiver closed');
      }
      /** Exact enabled configured account resolved before native work. */
      const account = accounts.get(name);
      if (!account || account.enabled === false) {
        throw new Error('Receive account unavailable');
      }
      if (account.protocol === 'imap') {
        /** Per-operation private native facade; enclosing operation owns lock/logout or POP3 QUIT. */
        const client = await connections.imap(account);
        let connected = false;
        try {
          await client.connect();
          connected = true;
          /** Owned native mailbox lease always released by the enclosing operation finally. */
          const lock = await client.getMailboxLock(account.mailbox ?? 'INBOX', {
            readOnly: true,
          });
          lock.release();
          return true;
        } finally {
          if (connected) {
            await client.logout();
          }
        }
      }
      /** Per-operation private native facade; enclosing operation owns lock/logout or POP3 QUIT. */
      const client = await connections.pop3(account);
      try {
        if (client.NOOP) {
          await client.NOOP();
        } else if (client.STAT) {
          await client.STAT();
        } else {
          await client.UIDL();
        }
        return true;
      } finally {
        await client.QUIT();
      }
    },
    /** Page the explicitly borrowed local store without opening a native receive connection.
     * @param {string} account - Host-authorized exact configured account.
     * @param {string | null} cursor - Exclusive local store continuation, default null.
     * @param {number} limit - Explicit bounded store page size, default fifty.
     * @returns {Promise<{items: InboundMessage[], nextCursor: string | null, done: boolean}>} Private stored page; configured store required. */
    page: (account: string, cursor: string | null = null, limit = 50) => {
      if (!options.store) {
        throw new Error(
          'No inbox store configured; implement your own pagination'
        );
      }
      return options.store.page(account, cursor, limit);
    },
    /** Receive one configured mailbox with bounded identity/source/MIME work; messages remain on the remote server.
     * @param {string} name - Exact configured account/folder or fixed validation label under the owning operation.
     * @param {IncomingPollOptions} pollOptions - Optional explicit configured mailbox and bound incremental UID cursor.
     * @returns {Promise<object>} Private counts/new IDs plus explicit JSON-mode messages/cursor; not durable cursor ownership.
     */
    async poll(name: string, pollOptions: IncomingPollOptions = {}) {
      if (closed) {
        throw new Error('Email receiver closed');
      }
      /** Exact enabled configured account resolved before native work. */
      const account = accounts.get(name);
      if (!account || account.enabled === false) {
        throw new Error('Receive account unavailable');
      }
      /** Validated configured/default native folder identity, not a local filesystem path. */
      const mailbox = resolveMailbox(account, pollOptions.mailbox);
      /** Configured per-poll scan count, default fifty. */
      const limit = account.maxMessagesPerPoll ?? 50;
      /** Configured native mailbox/UIDL/search ceiling, default five thousand. */
      const maxScan = account.maxMailboxMessages ?? 5000;
      let scanned = 0,
        stored = 0,
        duplicates = 0,
        oversized = 0;
      /** Private local identities inserted during this poll, never recipient bodies in queue data. */
      const newIds: string[] = [];
      /** Explicit JSON-mode parsed messages; persist mode does not return this payload list. */
      const messages: InboundMessage[] = [];
      /** Caller-supplied explicit generation/folder-bound UID continuation; host persists it separately. */
      const cursor = pollOptions.cursor;
      if (
        cursor &&
        (account.protocol !== 'imap' ||
          !Number.isSafeInteger(cursor.afterUid) ||
          cursor.afterUid < 0 ||
          cursor.afterUid > MAX_IMAP_UID ||
          (cursor.uidValidity !== undefined &&
            !/^\d+$/.test(cursor.uidValidity)) ||
          (cursor.mailbox !== undefined &&
            (!safeMailbox(cursor.mailbox) || cursor.mailbox !== mailbox)) ||
          (cursor.mailbox === undefined &&
            cursor.afterUid > 0 &&
            mailbox !== (account.mailbox ?? 'INBOX')))
      ) {
        throw new TypeError('Invalid or cross-mailbox IMAP cursor');
      }
      let nextCursor: IncomingPollCursor | undefined;
      if (account.protocol === 'imap') {
        /** Per-operation private native facade; enclosing operation owns lock/logout or POP3 QUIT. */
        const client = await connections.imap(account);
        let connected = false;
        try {
          await client.connect();
          connected = true;
          /** Owned native mailbox lease always released by the enclosing operation finally. */
          const lock = await client.getMailboxLock(mailbox, { readOnly: true });
          try {
            if (!cursor && (client.mailbox?.exists ?? 0) > maxScan) {
              throw new RangeError(
                'IMAP mailbox exceeds scan bound; use incremental cursor polling'
              );
            }
            /** Current native UIDVALIDITY used to prevent reuse across mailbox generations. */
            const validity = String(client.mailbox?.uidValidity ?? '');
            if (!/^\d+$/.test(validity)) {
              throw new Error('IMAP server did not expose UIDVALIDITY');
            }
            if (cursor?.uidValidity && cursor.uidValidity !== validity) {
              throw new Error(
                'IMAP UIDVALIDITY changed; reset incremental cursor explicitly'
              );
            }
            /** Finite inclusive UID search ceiling bounded by unsigned UID range and scan budget. */
            const upper = cursor
              ? Math.min(MAX_IMAP_UID, cursor.afterUid + maxScan)
              : undefined;
            /** Native UID search result validated before bounded per-message processing. */
            const uids =
              cursor?.afterUid === MAX_IMAP_UID
                ? []
                : await client.search(
                    cursor
                      ? { uid: `${cursor.afterUid + 1}:${upper}` }
                      : { all: true },
                    { uid: true }
                  );
            if (uids === false) {
              throw new Error('IMAP UID search failed');
            }
            if (uids.length > maxScan) {
              throw new RangeError('IMAP UID search exceeded bound');
            }
            /** Filtered native UIDs ordered ascending for resume or descending for initial polling. */
            const candidateUids = uids
              .filter(
                (uid) => !cursor || (uid > cursor.afterUid && uid <= upper!)
              )
              .sort((a, b) => (cursor ? a - b : b - a));
            let lastProcessed = cursor?.afterUid ?? 0,
              visited = 0;
            // Process bounded native UIDs without advancing past missing/invalid sources.
            for (const uid of candidateUids) {
              if (scanned >= limit) {
                break;
              }
              visited++;
              if (!Number.isSafeInteger(uid) || uid < 1 || uid > MAX_IMAP_UID) {
                throw new Error('Invalid IMAP UID');
              }
              /** Stable private account/protocol/folder/generation/remote identity hash. */
              const id = keyFor(name, 'imap', mailbox, validity, String(uid));
              if (mode === 'persist' && (await options.store!.get(id))) {
                duplicates++;
                lastProcessed = uid;
                continue;
              }
              /** Private native raw-source/size fetch result; invalid/missing source preserves retry behavior. */
              const msg = await client.fetchOne(
                uid,
                { source: true, size: true },
                { uid: true }
              );
              if (!msg || !msg.source || !(msg.source instanceof Uint8Array)) {
                throw new Error(
                  'IMAP source unavailable or invalid; retry the cursor instead of skipping the UID'
                );
              }
              if (
                msg.size !== undefined &&
                msg.size > (account.maxMessageBytes ?? 8 * 1024 * 1024)
              ) {
                oversized++;
                lastProcessed = uid;
                continue;
              }
              scanned++;
              try {
                /** Private normalized parsed message; contains no native account password/token. */
                const message = await save(
                  account,
                  mailbox,
                  String(uid),
                  validity,
                  Buffer.from(msg.source)
                );
                if (message) {
                  stored++;
                  newIds.push(id);
                  if (mode === 'json') {
                    messages.push(message);
                  }
                } else {
                  duplicates++;
                }
                lastProcessed = uid;
              } catch (error) {
                if (error instanceof RangeError) {
                  oversized++;
                  lastProcessed = uid;
                  continue;
                }
                throw error;
              }
            }
            if (cursor) {
              // Never skip a UID that may be assigned to a future message. Without UIDNEXT,
              // advancing across an empty UID range could lose late messages.
              /** Native next-assignable UID used only when safely representable. */
              const next = Number(client.mailbox?.uidNext);
              /** Known assigned UID boundary; absence of valid UIDNEXT cannot justify skipping future messages. */
              const knownUpper =
                Number.isSafeInteger(next) && next > 0
                  ? Math.max(cursor.afterUid, next - 1)
                  : lastProcessed;
              nextCursor = {
                uidValidity: validity,
                mailbox,
                afterUid:
                  visited < candidateUids.length
                    ? lastProcessed
                    : Math.min(upper!, Math.max(lastProcessed, knownUpper)),
              };
            }
          } finally {
            lock.release();
          }
        } finally {
          if (connected) {
            await client.logout();
          }
        }
      } else {
        /** Per-operation private native facade; enclosing operation owns lock/logout or POP3 QUIT. */
        const client = await connections.pop3(account);
        try {
          /** Bounded native POP3 UIDL pairs validated for number/identity uniqueness before RETR. */
          const pairs = await client.UIDL();
          if (!Array.isArray(pairs) || pairs.length > maxScan) {
            throw new RangeError('POP3 UIDL mailbox exceeds scan bound');
          }
          /** Per-poll POP3 sequence uniqueness set; sequence alone is not durable identity. */
          const numbers = new Set<string>();
          /** Per-poll native UIDL uniqueness set; duplicate stable identities reject. */
          const ids = new Set<string>();
          // Validate the complete bounded UIDL identity set before retrieving any POP3 message.
          for (const pair of pairs) {
            /** Validated POP3 message number; never interpolated into shell or filesystem code. */
            const number = String(pair?.[0] ?? '');
            /** Bounded native POP3 stable identity checked for header controls and duplicates. */
            const uidl = String(pair?.[1] ?? '');
            if (
              !/^[1-9]\d*$/.test(number) ||
              !uidl ||
              uidl.length > 512 ||
              /[\r\n\0]/.test(uidl) ||
              numbers.has(number) ||
              ids.has(uidl)
            ) {
              throw new Error('Invalid or duplicate POP3 UIDL entry');
            }
            numbers.add(number);
            ids.add(uidl);
          }
          // Retrieve only bounded nonduplicate identities; never issue POP3 DELE.
          for (const pair of pairs.slice().reverse()) {
            if (scanned >= limit) {
              break;
            }
            /** Validated POP3 message number; never interpolated into shell or filesystem code. */
            const number = String(pair?.[0] ?? '');
            /** Native POP3 stable UIDL reference used for account-bound deduplication. */
            const remoteId = String(pair?.[1] ?? '');
            if (
              !/^[1-9]\d*$/.test(number) ||
              !remoteId ||
              remoteId.length > 512
            ) {
              throw new Error('Invalid POP3 UIDL entry');
            }
            /** Stable private account/protocol/folder/generation/remote identity hash. */
            const id = keyFor(name, 'pop3', 'INBOX', '', remoteId);
            if (mode === 'persist' && (await options.store!.get(id))) {
              duplicates++;
              continue;
            }
            /** Private POP3 RETR result converted only through bounded raw-byte handling. */
            const source = await client.RETR(number);
            scanned++;
            try {
              /** Private normalized parsed message; contains no native account password/token. */
              const message = await save(
                account,
                'INBOX',
                remoteId,
                '',
                await readRaw(
                  source,
                  account.maxMessageBytes ?? 8 * 1024 * 1024
                )
              );
              if (message) {
                stored++;
                newIds.push(id);
                if (mode === 'json') {
                  messages.push(message);
                }
              } else {
                duplicates++;
              }
            } catch (error) {
              if (error instanceof RangeError) {
                oversized++;
                continue;
              }
              throw error;
            }
          }
        } finally {
          await client.QUIT();
        }
      }
      return {
        account: name,
        protocol: account.protocol,
        scanned,
        stored,
        duplicates,
        oversized,
        newIds,
        ...(mode === 'json' ? { messages } : {}),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    /** Poll enabled configured accounts sequentially without creating a background scheduler.
     * @returns {Promise<object[]>} Per-account outcomes; no durable checkpoint is implied.
     */
    async pollAll() {
      /** Sequential per-account/folder outcomes; no background scheduler or durable checkpoint is created. */
      const results = [];
      // Poll only enabled explicit accounts sequentially; this does not persist scheduler/checkpoint state.
      for (const name of accounts.keys()) {
        if (accounts.get(name)?.enabled !== false) {
          results.push(await this.poll(name));
        }
      }
      return results;
    },
    /** Poll explicit configured folders sequentially with independent fresh cursors.
     * @returns {Promise<object[]>} Per-folder outcomes; host must persist one durable checkpoint per account/folder for resumability.
     */
    async pollConfiguredMailboxes() {
      /** Sequential per-account/folder outcomes; no background scheduler or durable checkpoint is created. */
      const results = [];
      // Keep configured account/folder ownership separate; a helper poll has no durable resume state.
      for (const account of accounts.values()) {
        if (account.enabled === false) {
          continue;
        }
        if (account.protocol === 'pop3') {
          results.push(await this.poll(account.name));
          continue;
        }
        // Use an independent fresh bound cursor for each configured IMAP folder.
        for (const mailbox of new Set([
          account.mailbox ?? 'INBOX',
          ...(account.mailboxes ?? []),
        ])) {
          results.push(
            await this.poll(account.name, {
              mailbox,
              cursor: { afterUid: 0, mailbox },
            })
          );
        }
      }
      return results;
    },
    /** Read bounded native IMAP folder labels using a per-operation client.
     * @param {string} name - Exact configured account/folder or fixed validation label under the owning operation.
     * @returns {Promise<{path: string, name?: string}[]>} Private untrusted labels, stripped of credentials and bounded for display.
     */
    async folders(name: string): Promise<
      {
        /** Untrusted native folder label, never a local filesystem path. */
        path: string; /** Untrusted display label or explicit configured identity in its containing contract; never a role claim. */
        name?: string;
      }[]
    > {
      if (closed) {
        throw new Error('Email receiver closed');
      }
      /** Exact enabled configured account resolved before native work. */
      const account = accounts.get(name);
      if (
        !account ||
        account.enabled === false ||
        account.protocol !== 'imap'
      ) {
        throw new Error('IMAP account unavailable');
      }
      /** Per-operation private native facade; enclosing operation owns lock/logout or POP3 QUIT. */
      const client = await connections.imap(account);
      let connected = false;
      try {
        await client.connect();
        connected = true;
        if (!client.list) {
          throw new Error('IMAP folder listing unsupported by driver');
        }
        /** Bounded native IMAP folder listing; untrusted labels are clipped for private display. */
        const folders = await client.list();
        if (!Array.isArray(folders) || folders.length > 2000) {
          throw new Error('Invalid IMAP folder listing');
        }
        return folders.map((f) => ({
          path: String(f.path).slice(0, 255),
          ...(f.name ? { name: String(f.name).slice(0, 255) } : {}),
        }));
      } finally {
        if (connected) {
          await client.logout();
        }
      }
    },
    /** Set remote Seen under the explicit native mailbox lock; POP3 is unsupported.
     * @param {string} name - Exact configured IMAP account; host authorizes access before this low-level call.
     * @param {string | InboundMessage} messageId - Local reference or private JSON-mode record; native identity/UIDVALIDITY are rechecked.
     * @returns {Promise<boolean>} Native mutation outcome, never local message deletion. */
    markSeen: (name: string, messageId: string | InboundMessage) =>
      mutateImapFlag(name, messageId, '\\Seen', true),
    /** Clear remote Seen under the explicit native mailbox lock; POP3 is unsupported.
     * @param {string} name - Exact configured IMAP account; host authorizes access before this low-level call.
     * @param {string | InboundMessage} messageId - Local reference or private JSON-mode record; native identity/UIDVALIDITY are rechecked.
     * @returns {Promise<boolean>} Native mutation outcome, never local message deletion. */
    markUnread: (name: string, messageId: string | InboundMessage) =>
      mutateImapFlag(name, messageId, '\\Seen', false),
    /** Set/clear remote Flagged for one fenced UID; host passes the explicit boolean policy.
     * @param {string} name - Exact configured IMAP account; host authorizes access before this low-level call.
     * @param {string | InboundMessage} messageId - Local reference or private JSON-mode record; native identity/UIDVALIDITY are rechecked.
     * @param {boolean} flagged - Requested native add/remove choice.
     * @returns {Promise<boolean>} Native mutation outcome; no principal authorization is inferred. */
    setFlagged: (
      name: string,
      messageId: string | InboundMessage,
      flagged: boolean
    ) => mutateImapFlag(name, messageId, '\\Flagged', flagged),
    /** Stop new native receiver operations; existing per-operation work keeps its own cleanup.
     * @returns {Promise<void>} Admission closed only; does not cancel/drain active polls or close a borrowed store.
     */
    async close() {
      closed = true;
    },
  };
}
export type EmailReceiver = ReturnType<typeof createEmailReceiver>;
/** Accept only an opaque configured account reference for an explicitly registered queue task.
 * @param {Pick<EmailReceiver, 'poll'>} receiver - Borrowed explicitly registered receiver; queue data cannot choose another module or endpoint.
 * @returns {(job: {data: {account: string}}) => Promise<object>} Borrowed receiver callback; no credentials/message bodies are allowed in job data.
 */
export function createIncomingPollProcessor(
  receiver: Pick<EmailReceiver, 'poll'>
) {
  return async (job: {
    /** Opaque job reference containing only the configured account name. */
    data: {
      /** Exact configured account scope; lower-level stores do not authorize principals. */
      account: string;
    };
  }) => {
    if (
      !job?.data ||
      Object.keys(job.data).length !== 1 ||
      !accountPattern.test(job.data.account)
    ) {
      throw new TypeError('Poll jobs may contain only a receive account name');
    }
    return receiver.poll(job.data.account);
  };
}
