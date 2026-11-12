import type { Readable } from 'node:stream';

export type EmailAddress =
  | string
  | {
      /** Authored display name or configured account identity according to the containing contract; never an authorization claim. */
      name?: string; /** Literal mailbox validated before envelope use; private recipient data. */
      address: string;
    };
export type EmailRecipients = EmailAddress | readonly EmailAddress[];
export interface MailAttachment {
  /** Attachment display filename; resolver rejects path separators and header controls. */
  filename: string;
  /** String/byte source; legacy Readable typing does not bypass resolver requirements for files-backed streaming. */
  content?: string | Uint8Array | Readable;
  /** Explicit absolute local file path only with trusted opt-in; ancestry remains host-owned. */
  path?: string;
  /** Optional bounded inline content identifier, not a remote URL. */
  cid?: string;
  /** Declared/recorded MIME metadata validated against header controls; not content inspection. */
  contentType?: string;
  /** Explicit attachment or inline presentation hint. */
  contentDisposition?: 'attachment' | 'inline';
  /** Optional supported string-content encoding; resolver validates Buffer encoding. */
  encoding?: string;
  /** File-address attachment resolved through @zeruxjs/files; manager must be explicitly supplied. */
  file?: {
    /** Optional named files provider reference; selection does not grant tenant access. */
    storage?: string; /** Host-authorized storage bucket reference. */
    bucket: string; /** Host-authorized object key or private credential key according to the containing contract; never public config. */
    key: string;
  };
}
export interface EmailMessage {
  /** Validated sender address, required after account-default merging. */
  from?: EmailAddress;
  /** One or more validated primary recipients; at least one is required. */
  to: EmailRecipients;
  /** Optional copied recipients included in the aggregate envelope ceiling. */
  cc?: EmailRecipients;
  /** Optional private copied recipients; protected from arbitrary header overrides. */
  bcc?: EmailRecipients;
  /** Optional validated reply destinations. */
  replyTo?: EmailRecipients;
  /** Bounded header-safe subject; template rendering may supply an empty caller subject. */
  subject: string;
  /** Optional authored plain-text body. */
  text?: string;
  /** Optional authored HTML; default manager mode sanitizes/inlines, trusted mode is a host decision. */
  html?: string;
  /** Optional authored AMP payload; not automatically sanitized by the ordinary HTML converter. */
  amp?: string;
  /** Explicit registered local template identity; never executable source. */
  template?: string;
  /** Trusted placeholder values; property getters/toString are not sandboxed. */
  data?: Record<string, unknown>;
  /** Explicit private source list; bounded preparation remains separate from message validation. */
  attachments?: MailAttachment[];
  /** Host-approved extra header strings; envelope/content/signing overrides reject. */
  headers?: Record<string, string>;
  /** Explicit validated HTTPS/mailto unsubscribe targets; no preference mutation occurs during rendering. */
  listUnsubscribe?: {
    /** HTTPS unsubscribe capability target; keep it private. */
    url?: string; /** Validated unsubscribe mailbox target. */
    email?: string;
  };
  /** Optional high/normal/low SMTP message hint; not a queue ordering guarantee. */
  priority?: 'high' | 'normal' | 'low';
  /** Must be explicit for marketing; an account default cannot silently mark mail as marketing. */
  purpose?: 'transactional' | 'marketing';
  /** Explicit account; if absent use manager default. */
  account?: string;
  /** Prevent accidental duplicate sends within a manager lifetime. */
  idempotencyKey?: string;
  /** Mail tags are internal metadata: never forwarded as headers. */
  tags?: readonly string[];
  /** Opt-in per message; opens are approximate because email clients proxy and preload images. */
  tracking?: {
    /** Explicit opt-in/enabled flag in its containing account or tracking policy; defaults are owner-specific. */
    enabled?: boolean;
    /** Optional per-send approximate open-pixel observation; not human engagement proof. */
    opens?: boolean;
    /** Optional per-send click instrumentation; not completed download evidence. */
    clicks?: boolean;
    /** Optional per-send instrumented download-link observations; no attachment tracking. */
    downloads?: boolean;
    /** Exact approved HTTPS download destinations supplied to the tracking service. */
    downloadLinks?: readonly string[];
    /** Optional private tracking campaign reference; not subscription consent. */
    campaign?: string;
  };
}
export interface SmtpAuthPassword {
  /** Explicit password/oauth2 authentication discriminator. */
  type: 'password';
  /** Private SMTP account username; exclude from browser configuration. */
  user: string;
  /** Private SMTP password; host owns secret storage/rotation. */
  pass: string;
}
export interface SmtpAuthOAuth2 {
  /** Explicit password/oauth2 authentication discriminator. */
  type: 'oauth2';
  /** Private SMTP account username; exclude from browser configuration. */
  user: string;
  /** Optional host-owned OAuth client identity. */
  clientId?: string;
  /** Optional private OAuth client secret. */
  clientSecret?: string;
  /** Optional private OAuth refresh token, managed by the configured transport. */
  refreshToken?: string;
  /** Optional private OAuth access token; never browser account inventory. */
  accessToken?: string;
  /** Optional native OAuth token expiration metadata; no application login session is implied. */
  expires?: number;
  /** Optional trusted server OAuth token endpoint passed to the native transport; never model/request-provided. */
  accessUrl?: string;
  /** Optional native service-account client identifier. */
  serviceClient?: string;
  /** Private DKIM/service-account signing material; host owns storage/rotation. */
  privateKey?: string;
}
export type SmtpAuth = SmtpAuthPassword | SmtpAuthOAuth2;
export interface SmtpSettings {
  /** Trusted native SMTP endpoint; validation is not a general egress authorization policy. */
  host: string;
  /** Integer SMTP port 1–65535; 465 uses implicit TLS policy. */
  port: number;
  /** Explicit implicit-TLS choice; default follows port 465. */
  secure?: boolean;
  /** Require STARTTLS when implicit TLS is absent; disabling required encryption rejects. */
  requireTLS?: boolean;
  /** Unsafe true value rejects; no deliberate STARTTLS downgrade. */
  ignoreTLS?: boolean;
  /** Private native SMTP credentials; application authorization is separate. */
  auth?: SmtpAuth;
  /** Optional native connection pooling, default false. */
  pool?: boolean;
  /** Optional native pool ceiling 1–100. */
  maxConnections?: number;
  /** Optional native per-connection message policy; no delivery guarantee. */
  maxMessages?: number;
  /** Optional integer native connection timeout 100–3600000ms. */
  connectionTimeout?: number;
  /** Optional integer native greeting timeout 100–3600000ms. */
  greetingTimeout?: number;
  /** Optional integer native socket timeout 100–3600000ms. */
  socketTimeout?: number;
  /** Private host TLS configuration; verification cannot be disabled. */
  tls?: {
    /** Optional trusted TLS SNI/server-name override. */
    servername?: string;
    /** Explicit TLSv1.2/TLSv1.3 floor; default TLSv1.2. */
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    /** Certificate verification policy; false rejects. */
    rejectUnauthorized?: boolean;
    /** Optional trusted certificate-authority material. */
    ca?: string | string[];
  };
  /** Nodemailer DKIM signing; keep the private key in your secret manager. */
  dkim?: {
    /** Validated DKIM signing domain. */
    domainName: string;
    /** Validated DKIM selector identity. */
    keySelector: string;
    /** Private DKIM/service-account signing material; host owns storage/rotation. */
    privateKey: string;
    /** Optional trusted native DKIM cache directory; host owns permissions and lifetime. */
    cacheDir?: string;
  };
}
export interface TransportLike {
  /** Submit through a trusted injected transport; fulfillment alone may not account for every envelope recipient.
   * @param {Record<string, unknown>} mail - Private allowlisted envelope/body/attachment object for this transport.
   * @param {{ signal: AbortSignal }} context - Optional injected-transport cancellation context; native cancellation is cooperative.
   * @returns {Promise<{messageId?: string, accepted?: unknown[], rejected?: unknown[], rejectedErrors?: unknown[], response?: string}>} Private native envelope report; not evidence of inbox delivery.
   */
  sendMail(
    mail: Record<string, unknown>,
    context?: {
      /** Optional cooperative cancellation signal; does not force-stop native transport work. */
      signal: AbortSignal;
    }
  ): Promise<{
    /** Private transport-assigned message identity, not delivery evidence. */
    messageId?: string;
    /** Private validated envelope mailboxes reported accepted by SMTP. */
    accepted?: unknown[];
    /** Private envelope mailboxes reported rejected by SMTP. */
    rejected?: unknown[];
    /** Private native recipient failures used for bounded disposition classification. */
    rejectedErrors?: unknown[];
    /** Private raw SMTP response; never return as sanitized public telemetry. */
    response?: string;
  }>;
  /** Verify transport readiness without sending a message.
   * @returns {Promise<boolean>} Literal true/false readiness; optional method absence is not failover qualification.
   */
  verify?(): Promise<boolean>;
  /** Release this transport only when the manager owns it.
   * @returns {void | Promise<void>} Native close completion, where the transport exposes it.
   */
  close?(): void | Promise<void>;
}
export interface EmailAccount {
  /** Authored display name or configured account identity according to the containing contract; never an authorization claim. */
  name: string;
  /** Injected transports retain legacy owned-by-manager default; set false to borrow explicitly. */
  ownTransport?: boolean;
  /** Explicit native endpoint/credentials; choose this or an injected transport. */
  smtp?: SmtpSettings;
  /** Explicit trusted injected transport; ownTransport controls shutdown ownership. */
  transport?: TransportLike;
  /** Optional incoming side of this logical account, started through ZeruxJS email.receive. */
  receive?: Omit<import('./inbound.js').IncomingAccount, 'name'>;
  /** Partial authored message defaults; cannot silently enable marketing/tracking. */
  defaults?: Partial<EmailMessage>;
  /** Aggregate To/Cc/Bcc ceiling; manager default 100, maximum 1000. */
  maxRecipients?: number;
  /** Explicit opt-in/enabled flag in its containing account or tracking policy; defaults are owner-specific. */
  enabled?: boolean;
}
export interface EmailResult {
  /** Configured account reference or resolved result account; not tenant authorization. */
  account: string;
  /** Private transport-assigned message identity, not delivery evidence. */
  messageId?: string;
  /** Private validated envelope mailboxes reported accepted by SMTP. */
  accepted: string[];
  /** Private envelope mailboxes reported rejected by SMTP. */
  rejected: string[];
  /** Private raw SMTP response; never return as sanitized public telemetry. */
  response?: string;
  /** True for a successful process-local idempotency replay. */
  skipped?: boolean;
  /** Private policy/replay detail; review before public telemetry. */
  reason?: string;
  /** Optional opaque activity reference supplied only with explicit injected tracking. */
  trackingId?: string;
  /** SMTP envelope result only; not evidence of delivery or inbox placement. */
  submissionStatus?: 'accepted' | 'partial' | 'rejected' | 'unknown';
  /** True only when every intended recipient has an unambiguous SMTP disposition. */
  acceptanceComplete?: boolean;
  /** Private per-recipient acceptance/rejection/transient/permanent/uncertain records. */
  recipientOutcomes?: import('./smtp-outcomes.js').SmtpRecipientOutcome[];
  /** Known SMTP acceptance preserved despite interrupted optional post-send telemetry; do not resend. */
  telemetryIncomplete?: boolean;
}
export interface EmailManagerOptions {
  /** One to sixty-four explicit server account configurations. */
  accounts: EmailAccount[];
  /** Optional existing account name; defaults to the first configured account. */
  defaultAccount?: string;
  /** Aggregate To/Cc/Bcc ceiling; manager default 100, maximum 1000. */
  maxRecipients?: number;
  /** Globally suppress blocked recipients. Local memory; persist separately if needed. */
  suppressions?: string[];
  /** Explicit local recipient filter rules; not a durable suppression ledger. */
  rules?: RecipientRule[];
  /** Called before every send, fail closed. Integrate @zeruxjs/auth here. */
  authorize?: (
    message: Readonly<EmailMessage>,
    account: string
  ) => boolean | Promise<boolean>;
  /** Optional @zeruxjs/files StorageManager; attachments are streamed, not buffered. */
  files?: {
    /** Read authorized stored attachment metadata before reserving byte budget.
 * @param {{
      storage?: string;
      bucket: string;
      key: string;
    }} addr - Host-authorized tenant-bound files address; application policy remains mandatory.
 * @returns {Promise<{size: number, contentType: string} | null>} Recorded raw length/type or null; no attachment stream opened yet.
 */
    stat(addr: {
      /** Optional named files provider reference; selection does not grant tenant access. */
      storage?: string;
      /** Host-authorized storage bucket reference. */
      bucket: string;
      /** Host-authorized object key or private credential key according to the containing contract; never public config. */
      key: string;
    }): Promise<{
      /** Recorded attachment raw-byte length; validated before reserving aggregate budget. */
      size: number; /** Declared/recorded MIME metadata validated against header controls; not content inspection. */
      contentType: string;
    } | null>;
    /** Open a borrowed authorized byte source lazily when transport consumption begins.
     * @param {{ storage?: string; bucket: string; key: string }} addr - Host-authorized tenant-bound files address; application policy remains mandatory.
     * @param {{ signal?: AbortSignal }} options - Optional per-read cancellation controls.
     * @returns {Promise<AsyncIterable<Uint8Array>>} Cooperatively cancellable private source; scope owns iterator return.
     */
    read(
      addr: {
        /** Optional named files provider reference; selection does not grant tenant access. */
        storage?: string; /** Host-authorized storage bucket reference. */
        bucket: string; /** Host-authorized object key or private credential key according to the containing contract; never public config. */
        key: string;
      },
      options?: {
        /** Optional cooperative cancellation signal; does not force-stop native transport work. */
        signal?: AbortSignal;
      }
    ): Promise<AsyncIterable<Uint8Array>>;
  };
  /** Bounds actual unsettled send tasks, including preparation and cleanup. */
  maxConcurrentSends?: number;
  /** Caller observation deadline 1–600000ms, default 30000; native settlement retains capacity. */
  sendTimeoutMs?: number;
  /** Actual source-read concurrency 1–40, default four. */
  maxAttachmentStreams?: number;
  /** Aggregate raw-byte ceiling 1–1GiB, default 25MiB. */
  maxAttachmentBytes?: number;
  /** Process-local result/uncertain fence lifetime 1–86400000ms, default five minutes. */
  idempotencyTtlMs?: number;
  /** Bounded process-local key count 1–100000, default 2000; not durable deduplication. */
  maxIdempotencyKeys?: number;
  /** Optional @zeruxjs/analytics tracking service; this interface avoids a hard dependency. */
  tracking?: {
    /** Apply explicitly opted-in tracking through the injected host service.
     * @param {string} html - Rendered private HTML; no implicit consent may be inferred.
     * @param {{ id: string; account: string; message: Readonly<EmailMessage> }} context - Optional injected-transport cancellation context; native cancellation is cooperative.
     * @returns {string | Promise<string>} Instrumented HTML; failures fall back to untracked content.
     */
    instrumentHtml(
      html: string,
      context: {
        /** Opaque activity identifier; no recipient value is implied. */
        id: string; /** Configured account reference or resolved result account; not tenant authorization. */
        account: string; /** Private readonly message view; readonly typing is not deep isolation of trusted hooks. */
        message: Readonly<EmailMessage>;
      }
    ): string | Promise<string>;
    /** Observe accepted SMTP submission as separate best-effort tracking telemetry.
 * @param {{
      id: string;
      account: string;
      message: Readonly<EmailMessage>;
      result: Readonly<EmailResult>;
    }} event - Private accepted-submission observation for an explicitly enabled tracking service.
 * @returns {void | Promise<void>} Telemetry settlement; failure never authorizes resending accepted mail.
 */
    onSent?(event: {
      /** Opaque activity identifier; no recipient value is implied. */
      id: string;
      /** Configured account reference or resolved result account; not tenant authorization. */
      account: string;
      /** Private readonly message view; readonly typing is not deep isolation of trusted hooks. */
      message: Readonly<EmailMessage>;
      /** Private readonly submission result; not a sanitized public response. */
      result: Readonly<EmailResult>;
    }): void | Promise<void>;
  };
  /** Optional service with explicit opt-in and unsubscribe; required for marketing delivery. */
  /** Independent durable bounce/complaint suppression check; required by host for campaign sends. */
  marketingSuppression?: {
    /** Read current independent marketing suppression state before SMTP admission.
     * @param {EmailAddress} address - Validated private recipient; never use as a telemetry label.
     * @returns {Promise<boolean>} Literal true blocks; outage/malformed state fails closed.
     */
    isSuppressed(address: EmailAddress): Promise<boolean>;
  };
  /** Injected current subscription service required for marketing; separate from tracking analytics. */
  preferences?: {
    /** Read fresh affirmative subscription consent independently of tracking.
     * @param {EmailAddress} address - Validated private recipient; never use as a telemetry label.
     * @returns {Promise<boolean>} Literal true required for marketing; not proof of delivery.
     */
    isSubscribed(address: EmailAddress): Promise<boolean>;
    /** Produce the host-approved recipient unsubscribe URL used in one-click headers.
     * @param {EmailAddress} address - Validated private recipient; never use as a telemetry label.
     * @returns {string} Private HTTPS capability URL; never telemetry or public account inventory.
     */
    makeUnsubscribeUrl(address: EmailAddress): string;
  };
  /** Shared, provider-neutral account reputation guard. Marketing blocks on read errors. */
  reputation?: {
    /** Fresh provider-neutral account guard; marketing read failure blocks. */
    checkBeforeSend: (
      account: string,
      purpose: 'marketing' | 'transactional'
    ) => Promise<{
      /** Literal boolean account policy decision; not SMTP delivery evidence. */
      allowed: boolean;
    }>;
    /** Best-effort accepted-recipient ledger callback; failure cannot undo SMTP or trigger resend. */
    recordAccepted: (
      account: string,
      email: string,
      messageId: string
    ) => Promise<boolean | unknown>;
  };
  /** PII-free diagnostic callback. A resolved SMTP call with unknown recipients is not a confirmed acceptance. */
  onSmtpWarning?: (warning: {
    /** Configured account reference or resolved result account; not tenant authorization. */
    account: string;
    /** Fixed envelope disposition code used in address-free warning diagnostics. */
    status: 'accepted' | 'partial' | 'rejected' | 'unknown';
    /** Private policy/replay detail; review before public telemetry. */
    reason: string;
  }) => void;
  /** Trusted private operational callback; failures must not disrupt transactional mail. */
  onReputationError?: (error: unknown) => void;
  /** Trusted private telemetry-error callback; failure never retries accepted mail. */
  onTrackingError?: (error: unknown) => void;
}
export interface RecipientRule {
  /** Explicit allow/block recipient rule discriminator. */
  action: 'allow' | 'block';
  /** Exact mailbox or supported whole-domain mask; arbitrary regex rejects. */
  pattern: string;
  /** Private policy/replay detail; review before public telemetry. */
  reason?: string;
  /** Configured account reference or resolved result account; not tenant authorization. */
  account?: string;
}
export interface EmailTemplate {
  /** Opaque activity identifier; no recipient value is implied. */
  id: string;
  /** Bounded header-safe subject; template rendering may supply an empty caller subject. */
  subject: string;
  /** Optional authored HTML; default manager mode sanitizes/inlines, trusted mode is a host decision. */
  html?: string;
  /** Optional authored plain-text body. */
  text?: string;
  /** Inert authored template description; escape in any UI. */
  description?: string;
  /** Authored default/none presentation preference; transport sanitization remains separate. */
  layout?: 'default' | 'none';
}
