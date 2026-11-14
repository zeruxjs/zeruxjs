/** Function-first marketing campaigns. One durable template, individually stored recipients,
 * stable queue message IDs, and delivery-time variable rendering. No HTML copies per recipient. */
import { createHash, randomBytes } from 'node:crypto';
import { validateEmailAddress, addressString } from './validation.js';
import { interpolateTemplate } from './templates.js';
import { matchesCampaignSegment } from './campaigns.js';
import type { CampaignSegment, CampaignPrimitive } from './campaigns.js';
import type { CampaignDatabaseConnection } from './campaign-storage.js';
import type { EmailMessage, EmailResult } from './types.js';

/**
 * Recognize an opaque campaign reference without accepting paths or SQL names.
 *
 * @param {unknown} s - Untrusted reference; at most 96 ASCII identifier characters.
 * @returns {boolean} Whether the value has the supported identifier syntax.
 */
const validCode = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(s);
/**
 * Restrict configured table identifiers before passing them to the database port.
 *
 * @param {string} s - Host-configured lower-case table name, at most 63 characters.
 * @returns {boolean} Whether the table identifier uses the supported syntax.
 */
const validTable = (s: string) => /^[a-z][a-z0-9_]{0,62}$/.test(s);
/**
 * Detach private campaign records from mutable caller/store references.
 *
 * @template T
 * @param {T} v - Structured-cloneable record; cloning is not sanitization.
 * @returns {T} Independent copy retaining the record's private fields.
 */
const clone = <T>(v: T): T => structuredClone(v);
/**
 * Recognize record containers before recursively checking JSON values.
 *
 * @param {unknown} v - Candidate object; arrays and custom prototypes reject.
 * @returns {boolean} Whether this is a normal or null-prototype record.
 */
const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
/**
 * Apply the existing mailbox validator and campaign identity normalization.
 *
 * @param {string} email - Private recipient mailbox, never an authorization claim.
 * @returns {string} Trimmed lower-case mailbox used for recipient deduplication.
 * @throws {TypeError} When the mailbox does not satisfy email validation.
 */
const canonical = (email: string) =>
  addressString(validateEmailAddress(email)).trim().toLowerCase();
/**
 * Derive a repeatable queue/store identity within one campaign namespace.
 *
 * @param {string} code - Validated campaign reference in the authorized store.
 * @param {string} email - Canonical private recipient mailbox.
 * @returns {string} Stable pseudonymous identifier; hashing is not anonymization.
 */
const emailId = (code: string, email: string) =>
  'cmp_' +
  createHash('sha256')
    .update(code + '\0' + email)
    .digest('hex')
    .slice(0, 40);
/**
 * Validate inert template data before JSON can silently discard invalid values.
 *
 * Host objects must be trusted: reading properties may invoke getters, and this
 * validator does not sandbox JavaScript objects supplied by application code.
 *
 * @param {unknown} value - Plain record of finite JSON primitives and containers.
 * @param {number} maxBytes - Maximum serialized UTF-8 bytes for this data scope.
 * @returns {Record<string, unknown>} Detached JSON data after depth/size checks.
 * @throws {TypeError} When a value or property name cannot be represented safely.
 * @throws {RangeError} When nesting exceeds eight or the serialized budget fails.
 */
const jsonData = (value: unknown, maxBytes: number) => {
  if (!plain(value)) {
    throw new TypeError('Campaign dynamic data must be a JSON object');
  }
  // Validate the original input, before JSON serialization can silently drop functions/undefined.
  /**
   * Check the original values recursively before serialization changes them.
   *
   * @param {unknown} v - Current private JSON node.
   * @param {number} depth - Container depth, starting at zero for the root.
   * @returns {void} Completes only when the subtree satisfies the data policy.
   */
  const inspect = (v: unknown, depth = 0): void => {
    if (depth > 8) {
      throw new RangeError('Campaign JSON nesting too deep');
    }
    if (Array.isArray(v)) {
      // Validate every element; array serialization must not hide invalid values.
      for (const x of v) {
        inspect(x, depth + 1);
      }
      return;
    }
    if (plain(v)) {
      // Reject dangerous keys at every level, including recipient overrides.
      for (const [key, item] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) {
          throw new TypeError('Forbidden dynamic data key');
        }
        inspect(item, depth + 1);
      }
      return;
    }
    if (
      v !== null &&
      typeof v !== 'string' &&
      typeof v !== 'boolean' &&
      !(typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new TypeError('Invalid JSON value');
    }
  };
  inspect(value);
  /** Serialized private data used only for the UTF-8 budget and detached copy. */
  const string = JSON.stringify(value);
  if (typeof string !== 'string' || Buffer.byteLength(string) > maxBytes) {
    throw new RangeError('Campaign JSON data too large');
  }
  /** Inert detached record; validation above excludes JSON's lossy conversions. */
  const parsed = JSON.parse(string) as Record<string, unknown>;
  return parsed;
};
export interface MarketingRecipient {
  /** Private recipient mailbox; validated and canonicalized for campaign identity, never proof of consent. */
  email: string;
  /** Human-authored private display name; escape it in any management UI. */
  name?: string;
  /** Bounded inert JSON variables; never executable template code or public telemetry. */
  data?: Record<string, unknown>;
}
export interface MarketingCampaignInput {
  /** Human-authored private display name; escape it in any management UI. */
  name: string;
  /** Authored subject template rendered separately for each recipient. */
  subject: string;
  /** Optional untrusted HTML template; final email processing owns sanitization. */
  html?: string;
  /** Optional plain-text template, independent of the HTML representation. */
  text?: string;
  /** Convenient content shorthand; choose HTML (default) or plain text. */
  content?: string;
  /** Content shorthand representation: HTML by default, or explicit plain text. */
  contentType?: 'html' | 'text';
  /** Configured EmailManager account names (SMTP password, OAuth2 or custom transport). */
  account?: string;
  /** Configured account references only, without transport credentials. */
  providers?: string[];
  /** Campaign-level JSON variables; overridden by recipient variables. */
  data?: Record<string, unknown>;
  /** Initial bounded private audience; cannot be combined with the emails alias. */
  recipients?: (string | MarketingRecipient)[];
  /** Alias for recipients, useful for one-call campaign creation. */
  emails?: (string | MarketingRecipient)[];
  /** Explicit tracking choice; fresh tracking consent must still be checked at send time. */
  isTracking?: boolean | NonNullable<EmailMessage['tracking']>;
  /** Optional audience filter applied before queueing, including streaming imports. */
  segment?: CampaignSegment;
  /** Safe epoch milliseconds; scheduling is bounded to one year ahead. */
  sendAt?: number;
  /** When false, store the campaign and recipients but leave delivery enqueueing to enqueue(). */
  autoEnqueue?: boolean;
}
export interface StoredMarketingCampaign {
  /** Opaque campaign reference in the host-authorized database namespace. */
  code: string;
  /** Human-authored private display name; escape it in any management UI. */
  name: string;
  /** Authored subject template rendered separately for each recipient. */
  subject: string;
  /** Optional untrusted HTML template; final email processing owns sanitization. */
  html?: string;
  /** Optional plain-text template, independent of the HTML representation. */
  text?: string;
  /** Configured account references only, without transport credentials. */
  providers: string[];
  /** Bounded inert JSON variables; never executable template code or public telemetry. */
  data: Record<string, unknown>;
  /** Explicit stored tracking policy; storage alone does not authorize collection. */
  tracking: NonNullable<EmailMessage['tracking']>;
  /** Safe epoch milliseconds; scheduling is bounded to one year ahead. */
  sendAt: number;
  /** Campaign lifecycle state; completed finalizes registered terminal deliveries and blocks further sends. */
  status:
    | 'building'
    | 'ready'
    | 'queue_failed'
    | 'paused'
    | 'cancelled'
    | 'completed'
    | 'archived';
  /** Optional bounded audience segment; membership never replaces consent. */
  segment?: CampaignSegment;
  /** Host epoch when terminal campaign archival committed; not deletion evidence. */
  archivedAt?: number;
  /** Host epoch when the final approved retention page redacted campaign content. */
  redactedAt?: number;
  /** Private five-minute CAS lease shared by campaign mutations; do not expose to browsers. */
  operationLease?: {
    /** Private random lease ownership token; never an authentication or preview capability. */
    token: string; /** Lease expiry in host epoch milliseconds, rechecked before protected side effects. */
    expiresAt: number;
  };
  /** Positive native CAS revision, advanced exactly once per committed campaign transition. */
  version: number;
  /** Original host creation epoch; not synthesized on every read. */
  createdAt: number;
  /** Host epoch of the last committed campaign transition. */
  updatedAt: number;
  /** Persisted audience count; audience() refreshes exact native counts after interrupted appends. */
  recipientCount: number;
}
export interface StoredMarketingRecipient {
  /** Stable opaque record reference; hashing a mailbox does not anonymize the underlying data. */
  id: string;
  /** Owning campaign identity; validate it before reading or reusing a recipient. */
  campaignCode: string;
  /** Private recipient mailbox; validated and canonicalized for campaign identity, never proof of consent. */
  email: string;
  /** Human-authored private display name; escape it in any management UI. */
  name: string;
  /** Bounded inert JSON variables; never executable template code or public telemetry. */
  data: Record<string, unknown>;
  /** Native enqueue checkpoint epoch, or null; queue acceptance is not SMTP delivery. */
  enqueuedAt: number | null;
}
export interface MarketingQueue {
  /**
   * Publish only an opaque durable delivery reference through the borrowed native queue.
   *
   * @param {string} name - Explicit fixed native task name.
   * @param {{ messageId: string; }} data - Opaque message reference only; private bodies and credentials are forbidden in queue payloads.
   * @param {string} data.messageId - Opaque durable delivery reference only; recipient/body/credentials stay out of queue data.
   * @param {{ jobId: string; delay: number; attempts: number; }} options - Explicit borrowed ports and host policy; inline fields below retain their documented limits.
   * @param {string} options.jobId - Stable native queue identity used for replay reconciliation, not exactly-once delivery.
   * @param {number} options.delay - Native queue delay in milliseconds; no timer emulation.
   * @param {number} options.attempts - Native worker attempt budget; ambiguous SMTP outcomes must not auto-replay.
   * @returns {Promise<unknown>} Native queue acceptance; never proof of completed SMTP delivery.
   */
  add(
    name: string,
    data: {
      /** Opaque durable delivery reference only; recipient/body/credentials stay out of queue data. */
      messageId: string;
    },
    options: {
      /** Stable native queue identity used for replay reconciliation, not exactly-once delivery. */
      jobId: string; /** Explicit native queue delay in milliseconds; no process timer emulation. */
      delay: number; /** Native worker attempt budget; ambiguous SMTP outcomes must not be automatically replayed. */
      attempts: number;
    }
  ): Promise<unknown>;
  /**
   * Probe the native queue for explicit redrive absence evidence.
   *
   * @param {string} id - Validated opaque record identity in the authorized namespace.
   * @returns {Promise<unknown | null | undefined>} Native job or absence; no automatic replay follows an ambiguous delivery outcome.
   */
  getJob?(id: string): Promise<unknown | null | undefined>;
}
export interface MarketingDeliveryStore {
  /**
   * Create the exact pending durable delivery identity before native queue publication.
   *
   * @param {{ id: string; version: 1; purpose: 'marketing'; recipient: string; campaignId: string; state: 'pending'; lease: null; updatedAt: number; }} record - Private durable record; exact campaign and recipient binding remain required.
   * @param {string} record.id - Stable opaque record reference; hashing a mailbox does not anonymize the underlying data.
   * @param {1} record.version - Positive native CAS revision, advanced exactly once per committed campaign transition.
   * @param {'marketing'} record.purpose - Fixed marketing discriminator; consent checks must remain active at final send.
   * @param {string} record.recipient - Private canonical mailbox bound to the durable delivery identity.
   * @param {string} record.campaignId - Owning campaign reference; conflicting persisted delivery identity rejects.
   * @param {'pending'} record.state - Durable delivery state; pending differs from sending, uncertain and SMTP-accepted.
   * @param {null} record.lease - Private delivery ownership metadata retained by the borrowed delivery store.
   * @param {number} record.updatedAt - Host epoch of the last committed campaign transition.
   * @returns {Promise<boolean>} Whether the identity was created; a racing existing record must be loaded and checked.
   */
  create(record: {
    /** Stable opaque record reference; hashing a mailbox does not anonymize the underlying data. */
    id: string;
    /** Positive native CAS revision, advanced exactly once per committed campaign transition. */
    version: 1;
    /** Fixed marketing discriminator; consent checks must remain active at final send. */
    purpose: 'marketing';
    /** Private canonical mailbox bound to the durable delivery identity. */
    recipient: string;
    /** Owning campaign reference; conflicting persisted delivery identity rejects. */
    campaignId: string;
    /** Durable delivery state; pending differs from sending, uncertain and SMTP-accepted. */
    state: 'pending';
    /** Private delivery ownership metadata retained by the borrowed delivery store. */
    lease: null;
    /** Host epoch of the last committed campaign transition. */
    updatedAt: number;
  }): Promise<boolean>;
  /**
   * Load the borrowed durable message identity for exact campaign/recipient reconciliation.
   *
   * @param {string} id - Validated opaque record identity in the authorized namespace.
   * @returns {Promise<object | null>} Private delivery state or absence; do not expose the record through public telemetry.
   */
  load(id: string): Promise<{
    /** Stable opaque record reference; hashing a mailbox does not anonymize the underlying data. */
    id: string;
    /** Durable delivery state; pending differs from sending, uncertain and SMTP-accepted. */
    state: string;
    /** Owning campaign reference; conflicting persisted delivery identity rejects. */
    campaignId?: string;
    /** Private canonical mailbox bound to the durable delivery identity. */
    recipient?: string;
  } | null>;
}
export interface MarketingRenderer {
  /**
   * Render a field using trusted application code with explicit escaping/missing-value policy.
   *
   * @param {string} template - Authored untrusted template; only registered host rendering code executes.
   * @param {Readonly<Record<string, unknown>>} context - Private inert render variables; never default log or audit fields.
   * @param {{ escape?: 'text' | 'html'; missing?: 'empty' | 'keep' | 'error'; }} options - Explicit borrowed ports and host policy; inline fields below retain their documented limits.
   * @param {'text' | 'html'} options.escape - Explicit text/HTML interpolation context; HTML encoding is not a general sanitizer.
   * @param {'empty' | 'keep' | 'error'} options.missing - Explicit missing-placeholder policy for the registered renderer.
   * @returns {Promise<string> | string} Private rendered field; no arbitrary model/template JavaScript execution is provided.
   */
  render(
    template: string,
    context: Readonly<Record<string, unknown>>,
    options?: {
      /** Explicit text/HTML interpolation context; HTML encoding is not a general sanitizer. */
      escape?:
        | 'text'
        | 'html'; /** Missing-placeholder policy selected by the trusted renderer. */
      missing?: 'empty' | 'keep' | 'error';
    }
  ): Promise<string> | string;
}
export interface MarketingCampaignServiceOptions {
  /** Borrowed structured database with unique insert and exact affected-count CAS; host owns tenant isolation. */
  db: CampaignDatabaseConnection;
  /** Borrowed explicit native add port with stable job IDs, delay and attempts. */
  queue: MarketingQueue;
  /** Borrowed durable message store; campaign metadata and queue publication are separate commits. */
  delivery: MarketingDeliveryStore;
  /** Pass zeruxjs createVariableRegistry() instance to support registered functions everywhere. */
  renderer?: MarketingRenderer;
  /** Optional pre-queue checks; a production delivery worker/EmailManager must independently enforce consent and suppression. */
  isSubscribed?: (email: string) => Promise<boolean> | boolean;
  /** Optional fresh prequeue suppression check; final delivery must independently recheck. */
  isSuppressed?: (email: string) => Promise<boolean> | boolean;
  /** Prove the job is absent before manual re-publication; must use the real queue/outbox. */
  verifyMissingJob?: (messageId: string) => Promise<boolean> | boolean;
  /** A trusted legal-hold and compliance check before irreversible campaign-data erasure. */
  approveRetention?: (
    campaign: Readonly<StoredMarketingCampaign>
  ) => Promise<boolean> | boolean;
  /** Trusted application authorization. The service is server-side and should never be exposed unauthenticated. */
  authorize?: (
    action:
      | 'create'
      | 'read'
      | 'enqueue'
      | 'cancel'
      | 'render'
      | 'append'
      | 'pause'
      | 'resume'
      | 'redrive'
      | 'schedule'
      | 'archive'
      | 'export'
      | 'exportPII'
      | 'retention'
      | 'finalize',
    code?: string
  ) => Promise<boolean> | boolean;
  /** Optional private queue-failure observer; observer failure must not replay publication. */
  onQueueError?: (code: string, error: unknown) => void | Promise<void>;
  /** Optional validation against configured EmailManager account names at creation. */
  verifyProvider?: (account: string) => boolean | Promise<boolean>;
  /** Best-effort, PII-free operational audit. Errors never replay queue/SMTP actions. */
  onAudit?: (entry: {
    /** Opaque campaign reference in the host-authorized database namespace. */
    code: string;
    /** Fixed operation label, without private recipient traits or message bodies. */
    action:
      | 'create'
      | 'append'
      | 'enqueue'
      | 'pause'
      | 'resume'
      | 'cancel'
      | 'redrive'
      | 'schedule'
      | 'archive'
      | 'export'
      | 'retention'
      | 'finalize';
    /** Checked host epoch for the audit event. */
    at: number;
    /** Optional aggregate operation count; never a recipient identifier. */
    count?: number;
  }) => void | Promise<void>;
  /** Validated campaign table name; default zerux_marketing_campaigns. */
  table?: string;
  /** Validated recipient table name; default zerux_marketing_recipients. */
  recipientTable?: string;
  /** Optional trusted epoch clock; defaults to Date.now and rejects unsafe values. */
  now?: () => number;
}
/**
 * Bind function-first campaigns to borrowed durable database, queue and delivery ports. HTTP hosts must supply independent tenant authorization and CSRF protection.
 *
 * @param {MarketingCampaignServiceOptions} options - Explicit borrowed ports and host policy; inline fields below retain their documented limits.
 * @returns {object} Trusted server management API; this service does not own or close the borrowed ports.
 */
export function createMarketingCampaignService(
  options: MarketingCampaignServiceOptions
) {
  /** Borrowed persistence, native queue and durable delivery ports; this service does not close them. */
  const { db, queue, delivery } =
    options ?? ({} as MarketingCampaignServiceOptions);
  if (
    !db ||
    !['createTable', 'insert', 'select', 'update'].every(
      (key) => typeof (db as any)[key] === 'function'
    ) ||
    typeof queue?.add !== 'function' ||
    typeof delivery?.create !== 'function' ||
    typeof delivery?.load !== 'function'
  ) {
    throw new TypeError(
      'Marketing campaigns require DB, queue and durable delivery store'
    );
  }
  /** Validated host-owned campaign table; tenant isolation belongs to the authorized database scope. */
  const table = options.table ?? 'zerux_marketing_campaigns';
  /** Validated private recipient table; it is separate from durable SMTP delivery state. */
  const recipientTable = options.recipientTable ?? 'zerux_marketing_recipients';
  if (
    !validTable(table) ||
    !validTable(recipientTable) ||
    table === recipientTable
  ) {
    throw new TypeError('Invalid campaign tables');
  }
  /** Trusted host epoch clock, defaulting to Date.now; values are checked before persistence. */
  const clock = options.now ?? Date.now;
  /**
   * Read the trusted clock and reject unsafe or negative epoch values before lease decisions.
   *
   * @returns {number} Checked nonnegative safe epoch milliseconds; unsafe clocks reject.
   */
  const now = () => {
    /** Clock value checked as a nonnegative safe integer before use. */
    const v = clock();
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new Error('Invalid campaign clock');
    }
    return v;
  };
  /**
   * Emit aggregate-only audit metadata after persistence; audit failure never replays a side effect.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @param {'create' | 'append' | 'enqueue' | 'pause' | 'resume' | 'cancel' | 'redrive' | 'schedule' | 'archive' | 'export' | 'retention' | 'finalize'} action - Fixed authorized operation label; never private message content.
   * @param {number} count - Optional aggregate count; no recipient identity.
   * @returns {Promise<void>} Audit observer settled or failed in isolation; committed work is never replayed.
   */
  const audit = async (
    code: string,
    action:
      | 'create'
      | 'append'
      | 'enqueue'
      | 'pause'
      | 'resume'
      | 'cancel'
      | 'redrive'
      | 'schedule'
      | 'archive'
      | 'export'
      | 'retention'
      | 'finalize',
    count?: number
  ) => {
    try {
      await options.onAudit?.({
        code,
        action,
        at: now(),
        ...(count === undefined ? {} : { count }),
      });
    } catch {
      /* no side-effect replay */
    }
  };
  /**
   * Require literal true when the host installs an authorization callback; absent callbacks mean trusted server use.
   *
   * @param {'create' | 'read' | 'enqueue' | 'cancel' | 'render' | 'append' | 'pause' | 'resume' | 'redrive' | 'schedule' | 'archive' | 'export' | 'exportPII' | 'retention' | 'finalize'} action - Fixed authorized operation label; never private message content.
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @returns {Promise<void>} Literal host approval, or trusted-server operation when no callback is installed.
   */
  const authorize = async (
    action:
      | 'create'
      | 'read'
      | 'enqueue'
      | 'cancel'
      | 'render'
      | 'append'
      | 'pause'
      | 'resume'
      | 'redrive'
      | 'schedule'
      | 'archive'
      | 'export'
      | 'exportPII'
      | 'retention'
      | 'finalize',
    code?: string
  ) => {
    if (options.authorize && (await options.authorize(action, code)) !== true) {
      throw Object.assign(new Error('Campaign access denied'), {
        code: 'CAMPAIGN_FORBIDDEN',
      });
    }
  };
  let initialization: Promise<void> | undefined;
  /**
   * Share schema initialization and clear failed initialization so a later explicit call may retry.
   *
   * @returns {Promise<void>} Tables initialized; optional index failure does not claim indexed query performance.
   */
  const ensure = () =>
    (initialization ??= (async () => {
      // Initialize only the two declared private tables; schema failure rejects shared startup.
      for (const [name, columns] of [
        [
          table,
          [
            {
              name: 'id',
              type: 'varchar',
              length: 96,
              primary: true,
              notNull: true,
            },
            { name: 'version', type: 'bigint', notNull: true },
            { name: 'created_at', type: 'bigint', notNull: true },
            { name: 'payload_json', type: 'text', notNull: true },
          ],
        ],
        [
          recipientTable,
          [
            {
              name: 'id',
              type: 'varchar',
              length: 64,
              primary: true,
              notNull: true,
            },
            { name: 'campaign_id', type: 'varchar', length: 96, notNull: true },
            { name: 'enqueued_at', type: 'bigint' },
            { name: 'payload_json', type: 'text', notNull: true },
          ],
        ],
      ] as const) {
        /** Native database result; success and affected-count checks remain authoritative. */
        const result = await db.createTable({
          table: name,
          ifNotExists: true,
          columns,
        });
        if (!result?.ok) {
          throw new Error('Campaign database initialization failed');
        }
      }
      // Cover both paginated recipient reads and durable enqueue-checkpoint recovery.
      // Index failures are non-fatal; they affect performance, not correctness.
      if (db.createIndex) {
        // Attempt only declared native indexes; index failure does not alter correctness claims.
        for (const [suffix, columns] of [
          ['campaign_cursor_idx', ['campaign_id', 'id']],
          ['campaign_queue_idx', ['campaign_id', 'enqueued_at']],
        ] as const) {
          try {
            await db.createIndex({
              table: recipientTable,
              name: `${recipientTable.slice(0, 36)}_${suffix}`,
              columns: [...columns],
              ifNotExists: true,
            });
          } catch {
            /* optional */
          }
        }
      }
    })().catch((error) => {
      initialization = undefined;
      throw error;
    }));
  /**
   * Serialize private records under the portable TEXT byte budget; never a public projection.
   *
   * @param {unknown} value - Private cloneable record to serialize under the portable TEXT budget.
   * @param {number} max - Maximum serialized UTF-8 bytes, default 60000.
   * @returns {string} Serialized private record within the UTF-8 budget.
   */
  const encode = (value: unknown, max = 60_000) => {
    /** Serialized private payload checked against its byte budget before storage. */
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || Buffer.byteLength(text) > max) {
      throw new RangeError('Campaign record exceeds portable TEXT size');
    }
    return text;
  };
  /**
   * Read one scoped campaign and check persisted identity/revision; this is not a full schema validator.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @returns {Promise<StoredMarketingCampaign | null>} Identity/revision-checked private record or absence; not a full schema validation.
   */
  const readCampaign = async (
    code: string
  ): Promise<StoredMarketingCampaign | null> => {
    if (!validCode(code)) {
      throw new TypeError('Invalid campaign code');
    }
    await ensure();
    /** Native database result; success and affected-count checks remain authoritative. */
    const result = await db.select({
      table,
      columns: ['id', 'version', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: code },
      limit: 1,
    });
    if (!result?.ok || !Array.isArray(result.rows)) {
      throw new Error('Campaign database read failed');
    }
    if (!result.rows.length) {
      return null;
    }
    /** Native private database row, not safe for direct HTTP serialization. */
    const row = result.rows[0] as Record<string, unknown>;
    /** Private campaign record in the configured host-authorized namespace. */
    const campaign = JSON.parse(
      String(row.payload_json)
    ) as StoredMarketingCampaign;
    if (campaign.code !== code || campaign.version !== Number(row.version)) {
      throw new Error('Corrupt campaign record');
    }
    return campaign;
  };
  /**
   * Resolve the persisted campaign or reject; absence is never synthesized as a new record.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @returns {Promise<StoredMarketingCampaign>} Private persisted record; missing campaigns reject.
   */
  const requireCampaign = async (code: string) => {
    /** Resolved private campaign record; callers must retain the authorization boundary. */
    const item = await readCampaign(code);
    if (!item) {
      throw new Error('Campaign not found');
    }
    return item;
  };
  /**
   * Apply a cloned transition using at most twenty native revision-CAS attempts.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @param {(v: StoredMarketingCampaign) => StoredMarketingCampaign} edit - Trusted synchronous transition over a detached record; must preserve identity and increment revision exactly once.
   * @returns {Promise<StoredMarketingCampaign>} Committed revision after at most twenty CAS attempts; contention rejects.
   */
  const updateCampaign = async (
    code: string,
    edit: (v: StoredMarketingCampaign) => StoredMarketingCampaign
  ) => {
    // Retry only a revision conflict, with a fixed twenty-attempt ceiling and no queue side effects.
    for (let attempt = 0; attempt < 20; attempt++) {
      /** Current persisted revision used to fence this transition. */
      const current = await requireCampaign(code);
      /** Detached candidate revision; identity and exact revision increment must remain valid. */
      const next = edit(clone(current));
      if (next.code !== code || next.version !== current.version + 1) {
        throw new Error('Invalid campaign transition');
      }
      next.updatedAt = now();
      /** Native database result; success and affected-count checks remain authoritative. */
      const result = await db.update({
        table,
        values: { version: next.version, payload_json: encode(next) },
        where: {
          and: [
            { field: 'id', operator: 'eq', value: code },
            { field: 'version', operator: 'eq', value: current.version },
          ],
        },
      });
      if (!result?.ok) {
        throw new Error('Campaign checkpoint failed');
      }
      /** Native affected count; unknown or multiple-row results cannot prove successful CAS. */
      const changed = result.affectedCount ?? result.rowCount;
      if (
        typeof changed !== 'number' ||
        !Number.isSafeInteger(changed) ||
        changed < 0 ||
        changed > 1
      ) {
        throw new Error('Campaign CAS unavailable');
      }
      if (changed === 1) {
        return next;
      }
    }
    throw new Error('Concurrent campaign checkpoint contention');
  };
  // Shared version-CAS lease for scheduling, publishing and archive checks. A
  // crashed process releases it by expiry. Do not use a process-local mutex.
  /**
   * Claim a shared five-minute random lease through revision CAS, never a process-local mutex.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @returns {Promise<string>} Private lease token; live ownership conflicts reject.
   */
  const takeLease = async (code: string) => {
    /** Private random lease claim; never expose it as a browser capability. */
    const token = randomBytes(20).toString('hex');
    await updateCampaign(code, (c) => {
      if (c.operationLease && c.operationLease.expiresAt > now()) {
        throw new Error('Campaign operation is busy');
      }
      return {
        ...c,
        operationLease: { token, expiresAt: now() + 300_000 },
        version: c.version + 1,
      };
    });
    return token;
  };
  /**
   * Recheck exact unexpired lease ownership and renew near expiry before another side effect.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @param {string} token - Private exact lease token; never accept a browser role claim instead.
   * @returns {Promise<StoredMarketingCampaign>} Current campaign under this exact unexpired lease; near expiry renews through CAS.
   */
  const assertLease = async (code: string, token: string) => {
    /** Persisted campaign used for the current lease or delivery-state decision. */
    const c = await requireCampaign(code);
    if (
      c.operationLease?.token !== token ||
      c.operationLease.expiresAt <= now()
    ) {
      throw new Error('Campaign operation lease lost');
    }
    if (c.operationLease.expiresAt - now() < 60_000) {
      await updateCampaign(code, (old) => {
        if (
          old.operationLease?.token !== token ||
          old.operationLease.expiresAt <= now()
        ) {
          throw new Error('Campaign operation lease lost');
        }
        return {
          ...old,
          operationLease: { token, expiresAt: now() + 300_000 },
          version: old.version + 1,
        };
      });
    }
    return c;
  };
  /**
   * Release only this token; failed cleanup relies on expiry and must not clear another owner.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @param {string} token - Private exact lease token; never accept a browser role claim instead.
   * @returns {Promise<void>} Release attempt settled; failed cleanup relies on expiry without hiding the original error.
   */
  const releaseLease = async (code: string, token: string) => {
    try {
      /** Persisted campaign used for the current lease or delivery-state decision. */
      const c = await requireCampaign(code);
      if (c.operationLease?.token === token) {
        await updateCampaign(code, (current) => {
          if (current.operationLease?.token !== token) {
            throw new Error('Campaign operation lease lost');
          }
          /** Detached candidate revision; identity and exact revision increment must remain valid. */
          const next = { ...current, version: current.version + 1 };
          delete next.operationLease;
          return next;
        });
      }
    } catch {
      /* Expiry permits recovery; caller's original errors must remain visible. */
    }
  };
  /**
   * Use native COUNT for exact audience totals rather than materializing all recipient rows.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @param {boolean} onlyUnqueued - Default false; true counts only records without an enqueue checkpoint.
   * @returns {Promise<number>} Exact safe-integer native count; unknown precision rejects.
   */
  const countRecipients = async (
    code: string,
    onlyUnqueued = false
  ): Promise<number> => {
    await ensure();
    /** Structured fixed-scope database predicates; user query text cannot replace the campaign identity. */
    const clauses: any[] = [
      { field: 'campaign_id', operator: 'eq', value: code },
    ];
    if (onlyUnqueued) {
      clauses.push({ field: 'enqueued_at', operator: 'isNull' });
    }
    /** Native database result; success and affected-count checks remain authoritative. */
    const result = await db.select({
      table: recipientTable,
      columns: [
        {
          expr: {
            kind: 'function',
            name: 'COUNT',
            args: [{ kind: 'column', name: 'id' }],
          },
          as: 'total',
        },
      ],
      where: { and: clauses },
      limit: 1,
    });
    if (
      !result?.ok ||
      !Array.isArray(result.rows) ||
      result.rows.length !== 1
    ) {
      throw new Error('Campaign recipient count unavailable');
    }
    /** Native count value before safe-integer conversion. */
    const raw = (result.rows[0] as Record<string, unknown>).total;
    /** Validated numeric count; unsafe precision rejects instead of truncating. */
    const value =
      typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error('Invalid campaign recipient count');
    }
    return value;
  };
  /**
   * Read a private recipient and verify persisted identity/campaign/checkpoint fields.
   *
   * @param {string} id - Opaque recipient identity; exact campaign binding remains separately checked.
   * @returns {Promise<StoredMarketingRecipient | null>} Private identity/checkpoint-checked record or absence.
   */
  const readRecipient = async (
    id: string
  ): Promise<StoredMarketingRecipient | null> => {
    if (!/^cmp_[a-f0-9]{40}$/.test(id)) {
      throw new TypeError('Invalid marketing message ID');
    }
    await ensure();
    /** Native database result; success and affected-count checks remain authoritative. */
    const result = await db.select({
      table: recipientTable,
      columns: ['id', 'campaign_id', 'enqueued_at', 'payload_json'],
      where: { field: 'id', operator: 'eq', value: id },
      limit: 1,
    });
    if (!result?.ok || !Array.isArray(result.rows)) {
      throw new Error('Recipient lookup failed');
    }
    if (!result.rows.length) {
      return null;
    }
    /** Native private database row, not safe for direct HTTP serialization. */
    const row = result.rows[0] as Record<string, unknown>;
    /** Validated numeric count; unsafe precision rejects instead of truncating. */
    const value = JSON.parse(
      String(row.payload_json)
    ) as StoredMarketingRecipient;
    if (
      value.id !== id ||
      value.campaignCode !== row.campaign_id ||
      value.enqueuedAt !==
        (row.enqueued_at === null || row.enqueued_at === undefined
          ? null
          : Number(row.enqueued_at))
    ) {
      throw new Error('Corrupt recipient record');
    }
    return value;
  };
  /**
   * Read a bounded exclusive-ID page with one extra row to determine continuation.
   *
   * @param {string} code - Validated opaque campaign reference in the host-authorized namespace.
   * @param {string | null} cursor - Exclusive opaque record cursor; null starts the page sequence.
   * @param {number} limit - Finite requested page size, validated before native selection.
   * @returns {Promise<{items: StoredMarketingRecipient[], nextCursor: string | null, done: boolean}>} Bounded private keyset page with an extra-row continuation probe.
   */
  const pageRecipients = async (
    code: string,
    cursor: string | null,
    limit: number
  ): Promise<{
    /** Bounded private page records; caller-facing endpoints must apply their own projection. */
    items: StoredMarketingRecipient[];
    /** Exclusive opaque ID continuation, or null when this page has no further rows. */
    nextCursor: string | null;
    /** Explicit bounded-page completion; not a claim that SMTP delivery has completed. */
    done: boolean;
  }> => {
    if (
      !validCode(code) ||
      (cursor !== null && !/^cmp_[a-f0-9]{40}$/.test(cursor)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200
    ) {
      throw new TypeError('Invalid campaign pagination');
    }
    await ensure();
    /** Structured fixed-scope database predicates; user query text cannot replace the campaign identity. */
    const clauses: any[] = [
      { field: 'campaign_id', operator: 'eq', value: code },
    ];
    if (cursor) {
      clauses.push({ field: 'id', operator: 'gt', value: cursor });
    }
    /** Native database result; success and affected-count checks remain authoritative. */
    const result = await db.select({
      table: recipientTable,
      columns: ['id', 'campaign_id', 'enqueued_at', 'payload_json'],
      where: { and: clauses },
      orderBy: [{ by: 'id', direction: 'asc' }],
      limit: limit + 1,
    });
    if (
      !result?.ok ||
      !Array.isArray(result.rows) ||
      result.rows.length > limit + 1
    ) {
      throw new Error('Campaign recipient page unavailable');
    }
    /** Extra-row evidence of another page; never an unbounded total-count claim. */
    const hasMore = result.rows.length > limit;
    /** Detached bounded page records; privacy depends on the caller-facing projection. */
    const items = result.rows.slice(0, limit).map((raw) => {
      /** Native private database row, not safe for direct HTTP serialization. */
      const row = raw as Record<string, unknown>;
      /** Validated numeric count; unsafe precision rejects instead of truncating. */
      const value = JSON.parse(
        String(row.payload_json)
      ) as StoredMarketingRecipient;
      if (
        value.id !== row.id ||
        value.campaignCode !== code ||
        (cursor && value.id <= cursor)
      ) {
        throw new Error('Out of scope campaign recipient');
      }
      return value;
    });
    return {
      items,
      nextCursor: hasMore ? items.at(-1)!.id : null,
      done: !hasMore,
    };
  };
  /**
   * Persist one campaign and its individually validated recipients, then optionally queue references. These separate writes are not a database/queue transaction.
   *
   * @param {MarketingCampaignInput} input - Validated campaign definition and bounded private audience.
   * @returns {Promise<string>} Opaque durable campaign code; queue failure can leave queue_failed state without undoing recipients.
   */
  async function create(input: MarketingCampaignInput): Promise<string> {
    await authorize('create');
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) =>
          ![
            'name',
            'subject',
            'html',
            'text',
            'content',
            'contentType',
            'account',
            'providers',
            'data',
            'recipients',
            'emails',
            'isTracking',
            'sendAt',
            'autoEnqueue',
            'segment',
          ].includes(k)
      )
    ) {
      throw new TypeError('Invalid campaign definition');
    }
    /** Validated campaign HTML body; email sanitization/rendering remains a separate boundary. */
    const html =
      input.content !== undefined && input.contentType !== 'text'
        ? input.content
        : input.html;
    /** Serialized private payload checked against its byte budget before storage. */
    const text =
      input.content !== undefined && input.contentType === 'text'
        ? input.content
        : input.text;
    if (
      (input.contentType !== undefined &&
        !['html', 'text'].includes(input.contentType)) ||
      (input.content !== undefined &&
        (typeof input.content !== 'string' ||
          input.html !== undefined ||
          input.text !== undefined))
    ) {
      throw new TypeError('Ambiguous marketing content');
    }
    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 120 ||
      typeof input.subject !== 'string' ||
      !input.subject ||
      input.subject.length > 998 ||
      (typeof html !== 'string' && typeof text !== 'string') ||
      (html !== undefined && html.length > 55_000) ||
      (text !== undefined && text.length > 55_000)
    ) {
      throw new TypeError(
        'Campaign name, subject and HTML or text are required'
      );
    }
    /** Explicit configured account names; credentials never enter campaign queue bodies. */
    const providers = input.providers ?? (input.account ? [input.account] : []);
    if (
      !Array.isArray(providers) ||
      providers.length < 1 ||
      providers.length > 10 ||
      providers.some(
        (v) => typeof v !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(v)
      )
    ) {
      throw new TypeError('Configured SMTP provider names are required');
    }
    if (options.verifyProvider) {
      // Check each distinct configured account through the explicit host verifier before persistence.
      for (const account of new Set(providers)) {
        if ((await options.verifyProvider(account)) !== true) {
          throw new Error('Marketing email provider unavailable');
        }
      }
    }
    if (input.emails !== undefined && input.recipients !== undefined) {
      throw new TypeError('Choose emails or recipients, not both');
    }
    /** Explicit initial audience; the emails alias cannot be combined with recipients. */
    const recipients = input.recipients ?? input.emails;
    if (
      !Array.isArray(recipients) ||
      !recipients.length ||
      recipients.length > 1000
    ) {
      throw new RangeError(
        'Campaign must have 1..1000 recipients per creation'
      );
    }
    if (
      input.autoEnqueue !== undefined &&
      typeof input.autoEnqueue !== 'boolean'
    ) {
      throw new TypeError('Invalid auto-enqueue flag');
    }
    if (
      input.sendAt !== undefined &&
      (!Number.isSafeInteger(input.sendAt) ||
        input.sendAt < 0 ||
        input.sendAt > now() + 365 * 86_400_000)
    ) {
      throw new TypeError('Invalid campaign schedule');
    }
    /** Validated bounded campaign variables; recipient variables may override these values. */
    const globalData = jsonData(input.data ?? {}, 10_000);
    /** Per-input canonical mailbox set used to reject duplicate initial recipients. */
    const unique = new Set<string>();
    /** Validated private initial recipients before their individual durable writes. */
    const people: {
      /** Private recipient mailbox; validated and canonicalized for campaign identity, never proof of consent. */
      email: string;
      /** Human-authored private display name; escape it in any management UI. */
      name: string;
      /** Bounded inert JSON variables; never executable template code or public telemetry. */
      data: Record<string, unknown>;
    }[] = [];
    // Validate the entire initial audience and reject duplicate canonical identities before writing it.
    for (const entry of recipients) {
      /** Private recipient input; mailbox syntax is not consent or tenant authorization. */
      const person = typeof entry === 'string' ? { email: entry } : entry;
      if (
        !person ||
        typeof person.email !== 'string' ||
        (person.name !== undefined &&
          (typeof person.name !== 'string' || person.name.length > 200))
      ) {
        throw new TypeError('Invalid campaign recipient');
      }
      /** Canonical private mailbox used for stable identity and delivery checks. */
      const email = canonical(person.email);
      if (unique.has(email)) {
        throw new TypeError('Duplicate campaign recipient');
      }
      unique.add(email);
      people.push({
        email,
        name: person.name ?? '',
        data: jsonData(person.data ?? {}, 4000),
      });
    }
    /** Opaque campaign reference; host authorization and store scoping remain mandatory. */
    const code = 'camp_' + randomBytes(16).toString('hex');
    /** Checked host epoch used for this persisted transition. */
    const time = now();
    if (
      input.isTracking !== undefined &&
      typeof input.isTracking !== 'boolean'
    ) {
      /** Explicit tracking policy input; storing a campaign never implies tracking consent. */
      const policy = input.isTracking;
      if (
        !plain(policy) ||
        Object.keys(policy).some(
          (k) =>
            ![
              'enabled',
              'opens',
              'clicks',
              'downloads',
              'downloadLinks',
              'campaign',
            ].includes(k)
        ) ||
        ['enabled', 'opens', 'clicks', 'downloads'].some(
          (k) =>
            (policy as Record<string, unknown>)[k] !== undefined &&
            typeof (policy as Record<string, unknown>)[k] !== 'boolean'
        ) ||
        (policy.downloadLinks !== undefined &&
          (!Array.isArray(policy.downloadLinks) ||
            policy.downloadLinks.length > 20 ||
            policy.downloadLinks.some(
              (v) => typeof v !== 'string' || v.length > 2048
            )))
      ) {
        throw new TypeError('Invalid tracking policy');
      }
    }
    /** Stored explicit tracking choices; send-time independent consent remains authoritative. */
    const tracking = (() => {
      if (input.isTracking === true) {
        return {
          enabled: true,
          opens: true,
          clicks: true,
          downloads: true,
          campaign: code,
        };
      }
      if (input.isTracking === false || input.isTracking === undefined) {
        return { enabled: false };
      }
      return {
        ...input.isTracking,
        enabled: input.isTracking.enabled === true,
        campaign: code,
      };
    })();
    if (input.segment !== undefined) {
      matchesCampaignSegment(
        { id: 'validation', email: 'validation@example.test' },
        input.segment
      );
    }
    /** Private campaign record in the configured host-authorized namespace. */
    const campaign: StoredMarketingCampaign = {
      code,
      name: input.name,
      subject: input.subject,
      html,
      text,
      providers: [...new Set(providers)],
      segment: input.segment === undefined ? undefined : clone(input.segment),
      data: globalData,
      tracking,
      sendAt: input.sendAt ?? time,
      status: 'building',
      version: 1,
      createdAt: time,
      updatedAt: time,
      recipientCount: people.length,
    };
    await ensure();
    /** Durable campaign candidate; recipient insertion and queue publication are separate commits. */
    const created = await db.insert({
      table,
      values: {
        id: code,
        version: 1,
        created_at: time,
        payload_json: encode(campaign),
      },
    });
    if (!created?.ok) {
      throw new Error('Campaign creation unavailable');
    }
    // Persist recipients individually; a later failure can leave a building campaign for host recovery.
    for (const person of people) {
      /** Stable campaign/recipient reference; pseudonymous spelling is not authorization. */
      const id = emailId(code, person.email);
      /** Private durable record; validate exact campaign and recipient identity before reuse. */
      const record: StoredMarketingRecipient = {
        id,
        campaignCode: code,
        ...person,
        enqueuedAt: null,
      };
      /** Native database result; success and affected-count checks remain authoritative. */
      const result = await db.insert({
        table: recipientTable,
        values: {
          id,
          campaign_id: code,
          enqueued_at: null,
          payload_json: encode(record, 8000),
        },
      });
      if (!result?.ok) {
        throw new Error(
          `Campaign ${code} recipient insert failed; campaign remains in building state`
        );
      }
    }
    await updateCampaign(code, (c) => ({
      ...c,
      status: 'ready',
      version: c.version + 1,
    }));
    await audit(code, 'create', people.length);
    // Queue outages do not hide the durable campaign code; caller can retry enqueue(code).
    if (input.autoEnqueue === false) {
      return code;
    }
    try {
      let cursor: string | null = null;
      // Queue bounded pages in stable order; each prior publication/checkpoint can already be committed.
      do {
        /** Bounded recipient page and continuation; partial progress may already be committed. */
        const page = await enqueue(code, { cursor, limit: 200 }, true);
        cursor = page.nextCursor;
      } while (cursor !== null);
    } catch (error) {
      await updateCampaign(code, (c) => ({
        ...c,
        status: 'queue_failed',
        version: c.version + 1,
      }));
      try {
        await options.onQueueError?.(code, error);
      } catch {
        /* never conceal durable campaign */
      }
    }
    return code;
  }
  /**
   * Evaluate segment plus optional host consent/suppression checks before queueing; final sending must recheck.
   *
   * @param {StoredMarketingCampaign} campaign - Private campaign used for segment and configured prequeue consent checks.
   * @param {StoredMarketingRecipient} row - Private exact recipient identity and inert traits.
   * @returns {Promise<boolean>} Segment and configured prequeue policy decision; final send-time consent remains independent.
   */
  const eligible = async (
    campaign: StoredMarketingCampaign,
    row: StoredMarketingRecipient
  ): Promise<boolean> => {
    if (campaign.segment) {
      /** Primitive recipient traits available to the explicit segment evaluator. */
      const traits: Record<string, CampaignPrimitive> = { name: row.name };
      // Project only primitive traits into segment evaluation; membership never grants marketing consent.
      for (const [key, value] of Object.entries(row.data)) {
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        ) {
          traits[key] = value;
        }
      }
      if (
        !matchesCampaignSegment(
          { id: row.id, email: row.email, traits },
          campaign.segment
        )
      ) {
        return false;
      }
    }
    if (
      options.isSubscribed &&
      (await options.isSubscribed(row.email)) !== true
    ) {
      return false;
    }
    if (
      options.isSuppressed &&
      (await options.isSuppressed(row.email)) !== false
    ) {
      return false;
    }
    return true;
  };
  /**
   * Claim a shared lease, stage exact durable delivery identities and checkpoint only native queue acceptance. Partial progress survives later failure.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ cursor?: string | null; limit?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
   * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
   * @param {boolean} internal - Trusted internal enqueue path, default false; never accept this flag from HTTP input.
   * @returns {Promise<object>} Bounded queued/excluded counts and continuation; neither exactly-once nor inbox-delivery evidence.
   */
  async function enqueue(
    code: string,
    {
      cursor = null,
      limit = 200,
    }: {
      /** Exclusive opaque record cursor; null starts at the first matching row. */
      cursor?:
        | string
        | null; /** Finite per-page record budget, validated by the selected operation. */
      limit?: number;
    } = {},
    internal = false
  ) {
    if (!internal) {
      await authorize('enqueue', code);
    }
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    try {
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      if (!['ready', 'queue_failed'].includes(campaign.status)) {
        throw new Error('Campaign cannot be enqueued in current state');
      }
      /** Bounded recipient page and continuation; partial progress may already be committed. */
      const page = await pageRecipients(code, cursor, limit);
      let queued = 0,
        excluded = 0;
      // Process this finite page under the lease, checking eligibility before staging and publishing references.
      for (const row of page.items) {
        if (row.enqueuedAt !== null) {
          continue;
        }
        // Fail closed if any configured consent/suppression lookup errors. Do not persist an enqueue checkpoint.
        if (!(await eligible(campaign, row))) {
          excluded++;
          continue;
        }
        // Stop publishing new jobs if another administrator paused/cancelled/archived this campaign.
        /** Fresh persisted state used to reject stale lease or scheduling decisions. */
        const latest = await assertLease(code, token);
        if (
          !['ready', 'queue_failed'].includes(latest.status) ||
          latest.sendAt !== campaign.sendAt
        ) {
          throw new Error(
            'Campaign changed during enqueue; retry using current schedule'
          );
        }
        /** Previously persisted recipient or delivery record used to reconcile matching replay. */
        const existing = await delivery.load(row.id);
        if (
          existing &&
          (existing.campaignId !== code || existing.recipient !== row.email)
        ) {
          throw new Error('Conflicting durable mail record');
        }
        if (!existing) {
          /** Native create-only result; a racing insert requires an exact persisted identity check. */
          const inserted = await delivery.create({
            id: row.id,
            version: 1,
            purpose: 'marketing',
            recipient: row.email,
            campaignId: code,
            state: 'pending',
            lease: null,
            updatedAt: now(),
          });
          if (!inserted) {
            /** Fresh persisted state after the preceding operation, not a cached ownership guarantee. */
            const fresh = await delivery.load(row.id);
            if (
              !fresh ||
              fresh.campaignId !== code ||
              fresh.recipient !== row.email
            ) {
              throw new Error('Conflicting durable mail insertion');
            }
          }
        }
        // Stable BullMQ job IDs prevent duplicate waiting entries; durable delivery claims prevent re-sends.
        try {
          await queue.add(
            'email.deliver',
            { messageId: row.id },
            {
              jobId: row.id,
              delay: Math.max(0, campaign.sendAt - now()),
              attempts: 5,
            }
          );
        } catch (error) {
          try {
            await updateCampaign(code, (c) => {
              if (!['ready', 'queue_failed'].includes(c.status)) {
                throw new Error('Campaign state changed');
              }
              return { ...c, status: 'queue_failed', version: c.version + 1 };
            });
          } catch {
            /* Preserve original Redis failure. */
          }
          try {
            await options.onQueueError?.(code, error);
          } catch {
            /* Preserve original failure. */
          }
          throw error;
        }
        /** Detached candidate revision; identity and exact revision increment must remain valid. */
        const next = { ...row, enqueuedAt: now() };
        /** Native database result; success and affected-count checks remain authoritative. */
        const result = await db.update({
          table: recipientTable,
          values: {
            enqueued_at: next.enqueuedAt,
            payload_json: encode(next, 8000),
          },
          where: {
            and: [
              { field: 'id', operator: 'eq', value: row.id },
              { field: 'campaign_id', operator: 'eq', value: code },
              { field: 'enqueued_at', operator: 'isNull' },
            ],
          },
        });
        if (!result?.ok) {
          throw new Error('Recipient enqueue checkpoint failed');
        }
        /** Native affected-count evidence for one checkpoint; it is not an SMTP acknowledgement. */
        const affected = result.affectedCount ?? result.rowCount;
        if (
          typeof affected !== 'number' ||
          !Number.isSafeInteger(affected) ||
          affected < 0 ||
          affected > 1
        ) {
          throw new Error('Recipient enqueue checkpoint requires CAS');
        }
        queued += affected;
      }
      if (campaign.status === 'queue_failed' && page.done) {
        await updateCampaign(code, (c) => ({
          ...c,
          status: 'ready',
          version: c.version + 1,
        }));
      }
      if (queued) {
        await audit(code, 'enqueue', queued);
      }
      return {
        campaignCode: code,
        queued,
        excluded,
        nextCursor: page.nextCursor,
        done: page.done,
      };
    } finally {
      await releaseLease(code, token);
    }
  }

  /**
   * Append one bounded batch under the campaign lease. Matching replay is idempotent; conflicting rows reject, and earlier inserts are not rolled back.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {readonly (string | MarketingRecipient)[]} entries - One to one thousand private recipients; identical replay data is required.
   * @param {boolean} enqueueNow - Explicit post-persistence enqueue request; no atomic queue/database guarantee.
   * @returns {Promise<object>} New/existing counts and refreshed exact audience total; optional queueing occurs after the append lease releases.
   */
  async function appendRecipients(
    code: string,
    entries: readonly (string | MarketingRecipient)[],
    enqueueNow = false
  ) {
    await authorize('append', code);
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    let count = 0,
      added = 0,
      existing = 0;
    try {
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      if (!['ready', 'queue_failed'].includes(campaign.status)) {
        throw new Error('Cannot append recipients to this campaign');
      }
      if (
        !Array.isArray(entries) ||
        entries.length < 1 ||
        entries.length > 1000 ||
        typeof enqueueNow !== 'boolean'
      ) {
        throw new RangeError('Append 1..1000 recipients');
      }
      /** Canonical mailbox set for this bounded append batch only. */
      const seen = new Set<string>();
      // Append one finite batch, reconciling only exactly matching persisted replays after races.
      for (const entry of entries) {
        /** Private recipient input; mailbox syntax is not consent or tenant authorization. */
        const person = typeof entry === 'string' ? { email: entry } : entry;
        if (
          !person ||
          typeof person.email !== 'string' ||
          (person.name !== undefined &&
            (typeof person.name !== 'string' || person.name.length > 200))
        ) {
          throw new TypeError('Invalid campaign recipient');
        }
        /** Canonical private mailbox used for stable identity and delivery checks. */
        const email = canonical(person.email);
        if (seen.has(email)) {
          throw new TypeError('Duplicate recipient within batch');
        }
        seen.add(email);
        /** Private durable record; validate exact campaign and recipient identity before reuse. */
        const record: StoredMarketingRecipient = {
          id: emailId(code, email),
          campaignCode: code,
          email,
          name: person.name ?? '',
          data: jsonData(person.data ?? {}, 4000),
          enqueuedAt: null,
        };
        /** Previously stored recipient used to reject conflicting replay data. */
        const old = await readRecipient(record.id);
        if (old) {
          if (
            old.email !== record.email ||
            old.name !== record.name ||
            JSON.stringify(old.data) !== JSON.stringify(record.data)
          ) {
            throw new Error('Conflicting recipient replay');
          }
          existing++;
          continue;
        }
        try {
          /** Native database result; success and affected-count checks remain authoritative. */
          const result = await db.insert({
            table: recipientTable,
            values: {
              id: record.id,
              campaign_id: code,
              enqueued_at: null,
              payload_json: encode(record, 8000),
            },
          });
          if (!result?.ok) {
            throw new Error('Recipient insertion failed');
          }
          added++;
        } catch (error) {
          /** Record reread after insert failure to reconcile only an exactly matching racing insert. */
          const concurrent = await readRecipient(record.id);
          if (
            concurrent &&
            concurrent.email === record.email &&
            concurrent.name === record.name &&
            JSON.stringify(concurrent.data) === JSON.stringify(record.data)
          ) {
            existing++;
            continue;
          }
          throw error;
        }
      }
      count = await countRecipients(code);
      await updateCampaign(code, (c) => ({
        ...c,
        recipientCount: count,
        version: c.version + 1,
      }));
    } finally {
      await releaseLease(code, token);
    }
    let queued = 0;
    if (enqueueNow) {
      let cursor: string | null = null;
      // After releasing the append lease, explicitly enqueue bounded pages until native continuation ends.
      do {
        /** Bounded recipient page and continuation; partial progress may already be committed. */
        const page = await enqueue(code, { cursor, limit: 200 }, true);
        queued += page.queued;
        cursor = page.nextCursor;
      } while (cursor !== null);
    }
    await audit(code, 'append', added);
    return {
      campaignCode: code,
      added,
      existing,
      recipientCount: count,
      queued,
    };
  }
  /**
   * Authorize and query native audience counts without loading the full recipient table.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @returns {Promise<object>} Exact total and unqueued counts; no consent or delivery inference.
   */
  async function audience(code: string) {
    await authorize('read', code);
    /** Private campaign record in the configured host-authorized namespace. */
    const campaign = await requireCampaign(code);
    /** Exact native audience count, not a delivery or consent count. */
    const total = await countRecipients(code);
    /** Exact native count without an enqueue checkpoint; native queue state remains separate. */
    const unqueued = await countRecipients(code, true);
    if (unqueued > total) {
      throw new Error('Corrupt campaign audience counts');
    }
    return {
      campaignCode: code,
      status: campaign.status,
      storedRecipientCount: total,
      unqueued,
      enqueued: total - unqueued,
      storedCountMatches: campaign.recipientCount === total,
    };
  }

  /**
   * Recheck configured prequeue policy for a pending redrive candidate. Stable job IDs and durable worker CAS still gate actual SMTP delivery.
   *
   * @param {StoredMarketingCampaign} campaign - Private campaign used for segment and configured prequeue consent checks.
   * @param {StoredMarketingRecipient} row - Private exact recipient identity and inert traits.
   * @returns {Promise<boolean>} Fresh prequeue policy decision; the caller separately verifies pending identity and queue absence.
   */
  const eligibleRecipientForRedrive = (
    campaign: StoredMarketingCampaign,
    row: StoredMarketingRecipient
  ) => eligible(campaign, row);
  /**
   * Explicitly redrive only exact pending delivery identities with fresh policy and native queue absence evidence. Sending or uncertain outcomes are never eligible.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ cursor?: string | null; limit?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
   * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
   * @returns {Promise<object>} Bounded inspected/eligible/submitted/excluded counts and continuation; submission means native acceptance.
   */
  async function redrivePending(
    code: string,
    {
      cursor = null,
      limit = 100,
    }: {
      /** Exclusive opaque record cursor; null starts at the first matching row. */
      cursor?:
        | string
        | null; /** Finite per-page record budget, validated by the selected operation. */
      limit?: number;
    } = {}
  ) {
    await authorize('redrive', code);
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    try {
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      if (!['ready', 'queue_failed'].includes(campaign.status)) {
        throw new Error('Campaign cannot be redriven');
      }
      /** Bounded recipient page and continuation; partial progress may already be committed. */
      const page = await pageRecipients(code, cursor, limit);
      if (
        typeof options.verifyMissingJob !== 'function' &&
        typeof queue.getJob !== 'function'
      ) {
        throw new Error('Safe redrive requires a queue job absence check');
      }
      let eligible = 0,
        submitted = 0,
        excluded = 0;
      // Inspect only previously checkpointed recipients; require pending state and native queue absence before redrive.
      for (const row of page.items) {
        if (row.enqueuedAt === null) {
          continue;
        }
        /** Persisted delivery state; sending/uncertain outcomes must not be treated as missing work. */
        const state = await delivery.load(row.id);
        if (
          !state ||
          state.campaignId !== code ||
          state.recipient !== row.email
        ) {
          throw new Error('Missing or conflicting durable delivery identity');
        }
        if (state.state !== 'pending') {
          continue;
        }
        if (!(await eligibleRecipientForRedrive(campaign, row))) {
          excluded++;
          continue;
        }
        /** Explicit native queue absence evidence; absence alone never proves SMTP did not accept. */
        const absent = options.verifyMissingJob
          ? await options.verifyMissingJob(row.id)
          : !(await queue.getJob!(row.id));
        if (absent !== true) {
          excluded++;
          continue;
        }
        await assertLease(code, token);
        eligible++;
        await queue.add(
          'email.deliver',
          { messageId: row.id },
          {
            jobId: row.id,
            delay: Math.max(0, campaign.sendAt - now()),
            attempts: 5,
          }
        );
        submitted++;
      }
      if (submitted) {
        await audit(code, 'redrive', submitted);
      }
      return {
        campaignCode: code,
        inspected: page.items.length,
        eligible,
        submitted,
        excluded,
        nextCursor: page.nextCursor,
        done: page.done,
      };
    } finally {
      await releaseLease(code, token);
    }
  }

  /**
   * Authorize one recipient, combine inert variables and invoke only explicitly registered rendering capabilities. Rendered private content is not safe dashboard HTML.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {string} id - Validated opaque record identity in the authorized namespace.
   * @returns {Promise<EmailMessage>} Private marketing message with deterministic configured-account selection and explicit tracking policy.
   */
  async function renderRecipient(
    code: string,
    id: string
  ): Promise<EmailMessage> {
    await authorize('render', code);
    /** Private campaign record in the configured host-authorized namespace. */
    const campaign = await requireCampaign(code);
    /** Private recipient input; mailbox syntax is not consent or tenant authorization. */
    const person = await readRecipient(id);
    if (!person || person.campaignCode !== code) {
      throw new Error('Recipient not found in campaign');
    }
    /** Private render context combining campaign defaults with recipient overrides. */
    const context = {
      ...clone(campaign.data),
      ...clone(person.data),
      name: person.name,
      email: person.email,
      campaign: { code, name: campaign.name },
    };
    /** Subject and body templates passed only to the explicitly registered renderer. */
    const fields = {
      subject: campaign.subject,
      ...(campaign.html === undefined ? {} : { html: campaign.html }),
      ...(campaign.text === undefined ? {} : { text: campaign.text }),
    };
    // If the app registry supports renderFields, resolve shared dynamic variables once
    // across subject, HTML, and plain text for a consistent per-recipient snapshot.
    /** Borrowed trusted rendering capability; it may execute registered host code, never arbitrary template JavaScript. */
    const registry = options.renderer as MarketingRenderer & {
      /** Optional trusted batch-render capability; rendered bodies remain private untrusted content. */
      renderFields?: (
        fields: Record<string, string>,
        context: Readonly<Record<string, unknown>>,
        options?: {
          /** Explicit text/HTML interpolation context; HTML encoding is not a general sanitizer. */
          escape?: Record<string, 'text' | 'html'>;
          /** Missing-placeholder policy selected by the trusted renderer. */
          missing?: 'empty' | 'keep' | 'error';
        }
      ) => Promise<Record<string, string>>;
    };
    /** Private rendered fields; they remain untrusted email content rather than safe dashboard HTML. */
    const rendered =
      typeof registry?.renderFields === 'function'
        ? await registry.renderFields(fields, context, {
            escape: { subject: 'text', html: 'html', text: 'text' },
            missing: 'empty',
          })
        : null;
    /**
     * Render one field through the registered renderer or escaped interpolation fallback.
     *
     * @param {'subject' | 'html' | 'text'} key - Registered subject/html/text field selector.
     * @param {string} template - Untrusted authored template; never arbitrary executable source.
     * @param {'html' | 'text'} escape - Explicit HTML or text interpolation context.
     * @returns {Promise<string>} Private rendered field; renderer code is explicitly registered and not sandboxed.
     */
    const render = async (
      key: 'subject' | 'html' | 'text',
      template: string,
      escape: 'html' | 'text'
    ) => {
      if (rendered) {
        return rendered[key];
      }
      if (options.renderer) {
        return await options.renderer.render(template, context, {
          escape,
          missing: 'empty',
        });
      }
      return interpolateTemplate(template, context, escape === 'html');
    };
    /** Deterministic hash-derived account selection within the configured provider list. */
    const providerNumber =
      parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) %
      campaign.providers.length;
    /** Rendered subject retained separately from provider/template configuration. */
    const subject = await render('subject', campaign.subject, 'text');
    if (subject === undefined) {
      throw new Error('Marketing subject renderer returned no subject');
    }
    return {
      to: person.name
        ? { name: person.name, address: person.email }
        : person.email,
      account: campaign.providers[providerNumber],
      purpose: 'marketing',
      subject,
      html:
        campaign.html === undefined
          ? undefined
          : await render('html', campaign.html, 'html'),
      text:
        campaign.text === undefined
          ? undefined
          : await render('text', campaign.text, 'text'),
      tracking: { ...campaign.tracking },
    };
  }
  /**
   * Change a future schedule only before any recipient enqueue checkpoint exists. Already queued jobs are never silently rescheduled.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {number} sendAt - Safe future epoch milliseconds, at most one year ahead.
   * @param {{ enqueueNow?: boolean; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {boolean} settings.enqueueNow - Explicit request to queue after the persistence step; it is not an atomic database/queue transaction.
   * @returns {Promise<object>} Committed schedule/status and optional enqueue counts; later queue failure does not undo persistence.
   */
  async function schedule(
    code: string,
    sendAt: number,
    {
      enqueueNow = true,
    }: {
      /** Explicit request to queue after the persistence step; it is not an atomic database/queue transaction. */
      enqueueNow?: boolean;
    } = {}
  ) {
    await authorize('schedule', code);
    if (
      !Number.isSafeInteger(sendAt) ||
      sendAt < now() ||
      sendAt > now() + 365 * 86_400_000 ||
      typeof enqueueNow !== 'boolean'
    ) {
      throw new TypeError('Invalid campaign schedule');
    }
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    let updated: StoredMarketingCampaign;
    try {
      /** Persisted campaign state observed before the bounded operation begins. */
      const initial = await requireCampaign(code);
      if (!['ready', 'queue_failed', 'paused'].includes(initial.status)) {
        throw new Error('Campaign cannot be scheduled');
      }
      if (
        (await countRecipients(code, true)) !== (await countRecipients(code))
      ) {
        throw new Error('Already enqueued campaigns cannot be rescheduled');
      }
      updated = await updateCampaign(code, (current) => {
        if (!['ready', 'queue_failed', 'paused'].includes(current.status)) {
          throw new Error('Campaign cannot be scheduled');
        }
        return { ...current, sendAt, version: current.version + 1 };
      });
    } finally {
      await releaseLease(code, token);
    }
    await audit(code, 'schedule');
    let queued = 0,
      excluded = 0;
    if (enqueueNow && updated.status !== 'paused') {
      let cursor: string | null = null;
      // Queue pages only after schedule persistence and lease release; queue failure cannot undo the schedule.
      do {
        /** Bounded recipient page and continuation; partial progress may already be committed. */
        const page = await enqueue(code, { cursor, limit: 200 }, true);
        queued += page.queued;
        excluded += page.excluded;
        cursor = page.nextCursor;
      } while (cursor !== null);
    }
    return {
      campaignCode: code,
      sendAt,
      queued,
      excluded,
      status: (await requireCampaign(code)).status,
    };
  }

  /**
   * Export a bounded authorized projection; private recipient fields additionally require exportPII approval.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ cursor?: string | null; limit?: number; includePII?: boolean; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
   * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
   * @param {boolean} settings.includePII - Default false; true requires separate exportPII authorization.
   * @returns {Promise<object>} Page metadata and default redacted rows, or explicitly authorized private fields; not anonymized data.
   */
  async function exportPage(
    code: string,
    {
      cursor = null,
      limit = 100,
      includePII = false,
    }: {
      /** Exclusive opaque record cursor; null starts at the first matching row. */
      cursor?:
        | string
        | null; /** Finite per-page record budget, validated by the selected operation. */
      limit?: number; /** Default false; true requires the distinct exportPII authorization before exposing recipient data. */
      includePII?: boolean;
    } = {}
  ) {
    await authorize('export', code);
    if (typeof includePII !== 'boolean') {
      throw new TypeError('Invalid export privacy option');
    }
    if (includePII) {
      await authorize('exportPII', code);
    }
    /** Private campaign record in the configured host-authorized namespace. */
    const campaign = await requireCampaign(code);
    /** Bounded recipient page and continuation; partial progress may already be committed. */
    const page = await pageRecipients(code, cursor, limit);
    /** Detached bounded page records; privacy depends on the caller-facing projection. */
    const items = [];
    // Build one bounded export page; private fields require the separate exportPII authorization.
    for (const row of page.items) {
      /** Persisted delivery state; sending/uncertain outcomes must not be treated as missing work. */
      const state = await delivery.load(row.id);
      items.push({
        messageId: row.id,
        state: state?.state ?? 'not_registered',
        ...(includePII
          ? { email: row.email, name: row.name, data: clone(row.data) }
          : {}),
      });
    }
    await audit(code, 'export', items.length);
    return {
      campaign: {
        code: campaign.code,
        name: campaign.name,
        status: campaign.status,
        createdAt: campaign.createdAt,
        sendAt: campaign.sendAt,
        recipientCount: campaign.recipientCount,
        archivedAt: campaign.archivedAt ?? null,
      },
      items,
      nextCursor: page.nextCursor,
      done: page.done,
    };
  }

  /**
   * Count durable delivery states within one authorized page and label page versus complete coverage explicitly.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ cursor?: string | null; limit?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
   * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
   * @returns {Promise<object>} Bounded state counts; sent is labeled SMTP acceptance, never confirmed inbox delivery.
   */
  async function report(
    code: string,
    {
      cursor = null,
      limit = 200,
    }: {
      /** Exclusive opaque record cursor; null starts at the first matching row. */
      cursor?:
        | string
        | null; /** Finite per-page record budget, validated by the selected operation. */
      limit?: number;
    } = {}
  ) {
    await authorize('read', code);
    /** Private campaign record in the configured host-authorized namespace. */
    const campaign = await requireCampaign(code);
    /** Bounded recipient page and continuation; partial progress may already be committed. */
    const page = await pageRecipients(code, cursor, limit);
    /** Bounded delivery-state counters; SMTP acceptance does not establish inbox delivery. */
    const states: Record<string, number> = {
      notQueued: 0,
      pending: 0,
      claimed: 0,
      sending: 0,
      smtpAccepted: 0,
      suppressed: 0,
      uncertain: 0,
      rejected: 0,
      missing: 0,
    };
    // Count only this page and retain missing-state coverage instead of inventing successful delivery.
    for (const row of page.items) {
      if (row.enqueuedAt === null) {
        states.notQueued = (states.notQueued ?? 0) + 1;
        continue;
      }
      /** Borrowed durable delivery record checked against the exact campaign/recipient identity. */
      const deliveryRow = await delivery.load(row.id);
      if (
        !deliveryRow ||
        deliveryRow.campaignId !== code ||
        deliveryRow.recipient !== row.email
      ) {
        states.missing = (states.missing ?? 0) + 1;
        continue;
      }
      /** Persisted delivery state; sending/uncertain outcomes must not be treated as missing work. */
      const state =
        deliveryRow.state === 'sent' ? 'smtpAccepted' : deliveryRow.state;
      if (Object.hasOwn(states, state)) {
        states[state] = (states[state] ?? 0) + 1;
      } else {
        states.missing = (states.missing ?? 0) + 1;
      }
    }
    return {
      campaignCode: code,
      status: campaign.status,
      scanned: page.items.length,
      states,
      nextCursor: page.nextCursor,
      done: page.done,
      scope: page.done && cursor === null ? 'complete' : 'page',
      disclaimer: 'smtpAccepted is not confirmed mailbox delivery',
    };
  }

  /**
   * Finalize only after bounded inspection proves registered deliveries terminal. Unqueued recipients are excluded; at least one registered delivery is required.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ maxInspect?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {number} settings.maxInspect - Maximum terminal-state scan count, default 100000 with a one-million ceiling.
   * @returns {Promise<object>} Committed completed state, which blocks further sending in this function-first service.
   */
  async function finalize(
    code: string,
    {
      maxInspect = 100_000,
    }: {
      /** Maximum terminal-state scan count, default 100000 with a one-million ceiling. */
      maxInspect?: number;
    } = {}
  ) {
    await authorize('finalize', code);
    if (
      !Number.isSafeInteger(maxInspect) ||
      maxInspect < 1 ||
      maxInspect > 1_000_000
    ) {
      throw new RangeError('Invalid completion scan bound');
    }
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    try {
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      if (campaign.status === 'completed') {
        return {
          campaignCode: code,
          status: 'completed' as const,
          inspected: 0,
          nonterminal: 0,
          done: true,
        };
      }
      if (campaign.status !== 'ready') {
        throw new Error('Only ready campaigns can be finalized');
      }
      let cursor: string | null = null,
        inspected = 0,
        nonterminal = 0,
        registered = 0;
      // Scan terminal states by bounded native pages; renew exact ownership and enforce the total inspection ceiling.
      do {
        await assertLease(code, token);
        /** Bounded recipient page and continuation; partial progress may already be committed. */
        const page = await pageRecipients(
          code,
          cursor,
          Math.min(200, maxInspect - inspected)
        );
        // Check only registered deliveries; unqueued recipients do not establish a completed send.
        for (const row of page.items) {
          if (row.enqueuedAt !== null) {
            registered++;
            /** Persisted delivery state; sending/uncertain outcomes must not be treated as missing work. */
            const state = await delivery.load(row.id);
            if (
              !state ||
              state.campaignId !== code ||
              state.recipient !== row.email ||
              !['sent', 'suppressed', 'rejected'].includes(state.state)
            ) {
              nonterminal++;
            }
          }
        }
        inspected += page.items.length;
        cursor = page.nextCursor;
        if (cursor !== null && inspected >= maxInspect) {
          throw new Error('Finalize requires a larger bounded recipient scan');
        }
      } while (cursor !== null);
      if (!registered || nonterminal) {
        return {
          campaignCode: code,
          status: 'ready' as const,
          inspected,
          nonterminal,
          done: false,
        };
      }
      await updateCampaign(code, (c) => {
        if (c.status !== 'ready') {
          throw new Error('Campaign changed during finalization');
        }
        return { ...c, status: 'completed', version: c.version + 1 };
      });
      await audit(code, 'finalize', registered);
      return {
        campaignCode: code,
        status: 'completed' as const,
        inspected,
        nonterminal: 0,
        done: true,
      };
    } finally {
      await releaseLease(code, token);
    }
  }

  /**
   * Archive a cancelled/completed campaign only after bounded registered-delivery terminal checks. Archival itself deletes no recipient data.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ maxInspect?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {number} settings.maxInspect - Maximum terminal-state scan count, default 100000 with a one-million ceiling.
   * @returns {Promise<object>} Committed archived campaign revision; delivery, consent and audit stores remain separate.
   */
  async function archive(
    code: string,
    {
      maxInspect = 100_000,
    }: {
      /** Maximum terminal-state scan count, default 100000 with a one-million ceiling. */
      maxInspect?: number;
    } = {}
  ) {
    await authorize('archive', code);
    if (
      !Number.isSafeInteger(maxInspect) ||
      maxInspect < 1 ||
      maxInspect > 1_000_000
    ) {
      throw new RangeError('Invalid archive scan bound');
    }
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    try {
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      if (campaign.status === 'archived') {
        return campaign;
      }
      if (!['cancelled', 'completed'].includes(campaign.status)) {
        throw new Error('Cancel or finalize campaign before archiving');
      }
      let cursor: string | null = null,
        inspected = 0;
      // Check archived eligibility through bounded pages while retaining shared lease ownership.
      do {
        await assertLease(code, token);
        /** Bounded recipient page and continuation; partial progress may already be committed. */
        const page = await pageRecipients(
          code,
          cursor,
          Math.min(200, maxInspect - inspected)
        );
        // Reject archive if any registered durable identity is missing, conflicting or nonterminal.
        for (const row of page.items) {
          if (row.enqueuedAt !== null) {
            /** Persisted delivery state; sending/uncertain outcomes must not be treated as missing work. */
            const state = await delivery.load(row.id);
            if (
              !state ||
              !['sent', 'suppressed', 'rejected'].includes(state.state)
            ) {
              throw new Error(
                'Cannot archive campaign with pending or uncertain deliveries'
              );
            }
          }
        }
        inspected += page.items.length;
        cursor = page.nextCursor;
        if (cursor !== null && inspected >= maxInspect) {
          throw new Error('Archive requires a larger bounded recipient scan');
        }
      } while (cursor !== null);
      /** Committed campaign revision returned by native CAS, independent of later queue/audit outcomes. */
      const updated = await updateCampaign(code, (c) => {
        if (!['cancelled', 'completed'].includes(c.status)) {
          throw new Error(
            'Campaign must remain cancelled or completed to archive'
          );
        }
        return {
          ...c,
          status: 'archived',
          archivedAt: now(),
          version: c.version + 1,
        };
      });
      await audit(code, 'archive', inspected);
      return updated;
    } finally {
      await releaseLease(code, token);
    }
  }
  /**
   * Preview or perform explicitly approved paged retention on an aged archived campaign. Lease/control revisions may change even during a no-erasure preview.
   *
   * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
   * @param {{ olderThan: number; cursor?: string | null; limit?: number; dryRun?: boolean; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
   * @param {number} settings.olderThan - Required host-approved archive cutoff in epoch milliseconds.
   * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
   * @param {number} settings.limit - Finite per-page record budget, validated by the selected operation.
   * @param {boolean} settings.dryRun - Defaults true; preview does not erase payloads, although lease/control revisions may change.
   * @returns {Promise<object>} Page deletion/progress receipt; only the final page redacts campaign content, with no cross-store atomic erasure.
   */
  async function redactArchived(
    code: string,
    {
      olderThan,
      cursor = null,
      limit = 200,
      dryRun = true,
    }: {
      /** Required host-approved archive cutoff in epoch milliseconds. */
      olderThan: number;
      /** Exclusive opaque record cursor; null starts at the first matching row. */
      cursor?: string | null;
      /** Finite per-page record budget, validated by the selected operation. */
      limit?: number;
      /** Defaults true; preview does not erase payloads, although lease/control revisions may change. */
      dryRun?: boolean;
    }
  ) {
    await authorize('retention', code);
    if (
      !Number.isSafeInteger(olderThan) ||
      olderThan < 0 ||
      olderThan > now() ||
      typeof dryRun !== 'boolean'
    ) {
      throw new TypeError('Invalid retention cutoff');
    }
    if (typeof options.approveRetention !== 'function') {
      throw new Error(
        'Campaign retention needs an explicit legal-hold approval callback'
      );
    }
    /** Private random lease claim; never expose it as a browser capability. */
    const token = await takeLease(code);
    try {
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      if (
        campaign.status !== 'archived' ||
        campaign.archivedAt === undefined ||
        campaign.archivedAt >= olderThan
      ) {
        throw new Error('Only aged archived campaigns can be redacted');
      }
      if (campaign.redactedAt !== undefined) {
        return {
          campaignCode: code,
          inspected: 0,
          deleted: 0,
          nextCursor: null,
          done: true,
          redacted: true,
        };
      }
      if ((await options.approveRetention(clone(campaign))) !== true) {
        throw new Error('Campaign retention not approved');
      }
      /** Bounded recipient page and continuation; partial progress may already be committed. */
      const page = await pageRecipients(code, cursor, limit);
      let deleted = 0;
      if (!dryRun) {
        if (typeof db.delete !== 'function') {
          throw new Error('Retention requires atomic database delete');
        }
        // Delete only this approved page with exact identity and live lease checks; earlier deletes cannot be rolled back.
        for (const row of page.items) {
          await assertLease(code, token);
          /** Private bounded recipient record; project it before returning management data. */
          const r = await db.delete({
            table: recipientTable,
            where: {
              and: [
                { field: 'id', operator: 'eq', value: row.id },
                { field: 'campaign_id', operator: 'eq', value: code },
              ],
            },
          });
          /** Native affected-count evidence for one checkpoint; it is not an SMTP acknowledgement. */
          const affected = r?.affectedCount ?? r?.rowCount;
          if (!r?.ok || affected !== 1) {
            throw new Error('Campaign retention row deletion failed');
          }
          deleted++;
        }
        if (page.done) {
          await updateCampaign(code, (c) => {
            if (c.status !== 'archived') {
              throw new Error('Campaign is no longer archived');
            }
            return {
              ...c,
              subject: '[redacted]',
              html: undefined,
              text: undefined,
              providers: [],
              data: {},
              segment: undefined,
              tracking: { enabled: false },
              redactedAt: now(),
              version: c.version + 1,
            };
          });
        }
      }
      if (deleted) {
        await audit(code, 'retention', deleted);
      }
      return {
        campaignCode: code,
        inspected: page.items.length,
        deleted,
        nextCursor: page.nextCursor,
        done: page.done,
        redacted: !dryRun && page.done,
        dryRun,
      };
    } finally {
      await releaseLease(code, token);
    }
  }
  /** Trusted server management API over borrowed resources; HTTP authorization/CSRF belong to its host. */
  const api = {
    create,
    enqueue,
    appendRecipients,
    audience,
    redrivePending,
    schedule,
    exportPage,
    report,
    finalize,
    archive,
    redactArchived,
    /**
     * Authorize and project campaign state plus exact audience counts for management.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @returns {Promise<object>} Private management overview; names and identifiers still require access control.
     */
    async overview(code: string) {
      await authorize('read', code);
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      /** Exact native audience count, not a delivery or consent count. */
      const total = await countRecipients(code);
      /** Exact native count without an enqueue checkpoint; native queue state remains separate. */
      const unqueued = await countRecipients(code, true);
      if (unqueued > total) {
        throw new Error('Corrupt campaign recipient counters');
      }
      return {
        code: campaign.code,
        name: campaign.name,
        status: campaign.status,
        sendAt: campaign.sendAt,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        recipientCount: total,
        enqueued: total - unqueued,
        unqueued,
        storedCountMatches: campaign.recipientCount === total,
        trackingEnabled: campaign.tracking.enabled === true,
        providerCount: campaign.providers.length,
      };
    },
    /**
     * Authorize bounded recipient previews through the same trusted renderer used for delivery.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @param {{ cursor?: string | null; limit?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
     * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
     * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
     * @returns {Promise<object>} Private rendered previews and continuation; never a public preview capability.
     */
    async previewPage(
      code: string,
      {
        cursor = null,
        limit = 10,
      }: {
        /** Exclusive opaque record cursor; null starts at the first matching row. */
        cursor?:
          | string
          | null; /** Finite per-page record budget, validated by the selected operation. */
        limit?: number;
      } = {}
    ) {
      await authorize('render', code);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
        throw new RangeError('Preview page limit is 1..20');
      }
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(code);
      /** Bounded recipient page and continuation; partial progress may already be committed. */
      const page = await pageRecipients(code, cursor, limit);
      /** Detached bounded page records; privacy depends on the caller-facing projection. */
      const items = [];
      // Render each bounded private preview through the same registered path as actual delivery.
      for (const person of page.items) {
        // Render through the same service path used for actual SMTP delivery.
        /** Private rendered marketing message; final manager consent and transport limits still apply. */
        const message = await renderRecipient(campaign.code, person.id);
        items.push({
          messageId: person.id,
          subject: message.subject,
          html: message.html,
          text: message.text,
          recipient: person.email,
          provider: message.account,
          trackingEnabled: message.tracking?.enabled === true,
        });
      }
      return { items, nextCursor: page.nextCursor, done: page.done };
    },
    /**
     * Authorize and clone one full private campaign record.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @returns {Promise<StoredMarketingCampaign | null>} Private campaign including possible lease metadata, or null; HTTP hosts must project it.
     */
    async get(code: string) {
      await authorize('read', code);
      /** Resolved private campaign record; callers must retain the authorization boundary. */
      const item = await readCampaign(code);
      return item ? clone(item) : null;
    },
    /**
     * Authorize a bounded native keyset page in the configured campaign namespace.
     *
     * @param {{ cursor?: string | null; limit?: number; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
     * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
     * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
     * @returns {Promise<object>} Private campaign records and continuation; this is not a public listing.
     */
    async list({
      cursor = null,
      limit = 25,
    }: {
      /** Exclusive opaque record cursor; null starts at the first matching row. */
      cursor?:
        | string
        | null; /** Finite per-page record budget, validated by the selected operation. */
      limit?: number;
    } = {}) {
      await authorize('read');
      if (
        (cursor !== null && !validCode(cursor)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new TypeError('Invalid campaign list cursor or limit');
      }
      await ensure();
      /** Native database result; success and affected-count checks remain authoritative. */
      const result = await db.select({
        table,
        columns: ['id', 'version', 'payload_json'],
        ...(cursor
          ? { where: { field: 'id', operator: 'gt', value: cursor } }
          : {}),
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit: limit + 1,
      });
      if (
        !result?.ok ||
        !Array.isArray(result.rows) ||
        result.rows.length > limit + 1
      ) {
        throw new Error('Campaign list unavailable');
      }
      /** Extra-row evidence of another page; never an unbounded total-count claim. */
      const hasMore = result.rows.length > limit;
      /** Bounded private campaign page; full records may contain operation lease metadata. */
      const campaigns = result.rows.slice(0, limit).map((row) => {
        /** Private bounded recipient record; project it before returning management data. */
        const r = row as Record<string, unknown>;
        /** Persisted campaign used for the current lease or delivery-state decision. */
        const c = JSON.parse(String(r.payload_json)) as StoredMarketingCampaign;
        if (c.code !== r.id || c.version !== Number(r.version)) {
          throw new Error('Corrupt campaign list');
        }
        return c;
      });
      return {
        campaigns,
        nextCursor: hasMore ? campaigns.at(-1)!.code : null,
        done: !hasMore,
      };
    },
    /**
     * Authorize a bounded private audience page with optional durable-state lookups.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @param {{ cursor?: string | null; limit?: number; withDelivery?: boolean; }} settings - Explicit bounded per-operation settings; defaults and privacy flags are documented below.
     * @param {string | null} settings.cursor - Exclusive opaque record cursor; null starts at the first matching row.
     * @param {number} settings.limit - Finite page size; the selected operation enforces its own maximum and default.
     * @param {boolean} settings.withDelivery - Default true; include bounded private durable-state lookups.
     * @returns {Promise<object>} Private recipient records and optional delivery state; caller owns safe UI projection.
     */
    async recipients(
      code: string,
      {
        cursor = null,
        limit = 50,
        withDelivery = true,
      }: {
        /** Exclusive opaque record cursor; null starts at the first matching row. */
        cursor?:
          | string
          | null; /** Finite per-page record budget, validated by the selected operation. */
        limit?: number; /** Default true; include private per-recipient durable state lookups within the bounded page. */
        withDelivery?: boolean;
      } = {}
    ) {
      await authorize('read', code);
      await requireCampaign(code);
      /** Bounded recipient page and continuation; partial progress may already be committed. */
      const page = await pageRecipients(code, cursor, limit);
      /** Bounded native rows in stable keyset order; never an unrestricted table scan. */
      const rows = await Promise.all(
        page.items.map(async (person) => ({
          ...person,
          deliveryState: withDelivery
            ? ((await delivery.load(person.id))?.state ?? 'not_registered')
            : undefined,
        }))
      );
      return { recipients: rows, nextCursor: page.nextCursor, done: page.done };
    },
    preview: renderRecipient,
    /**
     * Apply campaign lifecycle and schedule rules before a durable worker sends a referenced message.
     *
     * @param {{ campaignId?: string; }} record - Private durable record; exact campaign and recipient binding remain required.
     * @param {string} record.campaignId - Owning campaign reference; conflicting persisted delivery identity rejects.
     * @returns {Promise<"allow" | "defer" | "suppress">} Allow absent campaign references; defer paused/building/future work; suppress cancelled/completed/archived campaigns.
     */
    async deliveryGate(record: {
      /** Owning campaign reference; conflicting persisted delivery identity rejects. */
      campaignId?: string;
    }): Promise<'allow' | 'defer' | 'suppress'> {
      if (!record.campaignId) {
        return 'allow';
      }
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(record.campaignId);
      if (['cancelled', 'completed', 'archived'].includes(campaign.status)) {
        return 'suppress';
      }
      if (
        campaign.status === 'building' ||
        campaign.status === 'paused' ||
        campaign.sendAt > now()
      ) {
        return 'defer';
      }
      return 'allow';
    },
    /**
     * Resolve a private referenced recipient, recheck eligibility and pass rendered marketing content to the borrowed manager. Durable worker claims/retries remain external.
     *
     * @param {string} id - Validated opaque record identity in the authorized namespace.
     * @param {{ send(message: EmailMessage): Promise<EmailResult> }} manager - Borrowed EmailManager-compatible sender; this service does not close it.
     * @param {(message: EmailMessage) => Promise<EmailResult>} manager.send - Borrowed sender enforcing fresh consent and transport policy; its private outcome is not delivery proof.
     * @returns {Promise<EmailResult>} Manager outcome with private transport details; ambiguous acceptance must not be automatically replayed.
     */
    async sendById(
      id: string,
      manager: {
        /**
         * Send through the explicitly borrowed email manager with its fresh marketing consent and transport policy.
         *
         * @param {EmailMessage} message - Private marketing message requiring fresh final consent and transport checks.
         * @returns {Promise<EmailResult>} Private normalized SMTP outcome, not inbox-delivery proof.
         */
        send(message: EmailMessage): Promise<EmailResult>;
      }
    ): Promise<EmailResult> {
      /** Native private database row, not safe for direct HTTP serialization. */
      const row = await readRecipient(id);
      if (!row) {
        throw new Error('Marketing recipient missing');
      }
      /** Private campaign record in the configured host-authorized namespace. */
      const campaign = await requireCampaign(row.campaignCode);
      if (['cancelled', 'completed', 'archived'].includes(campaign.status)) {
        throw new Error('Campaign cancelled, completed or archived');
      }
      if (!(await eligible(campaign, row))) {
        throw Object.assign(
          new Error('Recipient has no active marketing permission'),
          { code: 'EMAIL_CONSENT_REQUIRED' }
        );
      }
      if (
        campaign.status === 'paused' ||
        campaign.status === 'building' ||
        campaign.sendAt > now()
      ) {
        throw Object.assign(new Error('Campaign delivery deferred'), {
          code: 'CAMPAIGN_DELIVERY_DEFERRED',
        });
      }
      /** Private rendered marketing message; final manager consent and transport limits still apply. */
      const message = await renderRecipient(row.campaignCode, id);
      // Fresh policy check at the handoff; EmailManager is still responsible for the final pre-SMTP check.
      if (!(await eligible(await requireCampaign(row.campaignCode), row))) {
        throw Object.assign(new Error('Marketing permission revoked'), {
          code: 'EMAIL_CONSENT_REQUIRED',
        });
      }
      return manager.send(message);
    },
    /**
     * Authorize and revision-check a ready or queue-failed campaign before pausing future delivery.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @returns {Promise<object>} Committed campaign state; already executing native sends are not forcibly cancelled.
     */
    async pause(code: string) {
      await authorize('pause', code);
      /** Resolved private campaign record; callers must retain the authorization boundary. */
      const item = await updateCampaign(code, (c) => {
        if (!['ready', 'queue_failed'].includes(c.status)) {
          throw new Error('Campaign cannot be paused');
        }
        return { ...c, status: 'paused', version: c.version + 1 };
      });
      await audit(code, 'pause');
      return item;
    },
    /**
     * Authorize and revision-check a paused campaign before restoring ready state.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @returns {Promise<object>} Committed ready state; this operation alone does not enqueue additional recipients.
     */
    async resume(code: string) {
      await authorize('resume', code);
      /** Resolved private campaign record; callers must retain the authorization boundary. */
      const item = await updateCampaign(code, (c) => {
        if (c.status !== 'paused') {
          throw new Error('Campaign is not paused');
        }
        return { ...c, status: 'ready', version: c.version + 1 };
      });
      await audit(code, 'resume');
      return item;
    },
    /**
     * Authorize cancellation and suppress later campaign delivery through committed state.
     *
     * @param {string} code - Validated opaque campaign reference; spelling is not tenant authorization.
     * @returns {Promise<object>} Committed cancelled state; existing native work is not recalled.
     */
    async cancel(code: string) {
      await authorize('cancel', code);
      /** Resolved private campaign record; callers must retain the authorization boundary. */
      const item = await updateCampaign(code, (c) => {
        if (c.status === 'cancelled') {
          throw new Error('Campaign already cancelled');
        }
        return { ...c, status: 'cancelled', version: c.version + 1 };
      });
      await audit(code, 'cancel');
      return item;
    },
  };
  return api;
}
export type MarketingCampaignService = ReturnType<
  typeof createMarketingCampaignService
>;
