import { createHash, randomUUID } from 'node:crypto';
import {
  classifySmtpRecipients,
  EmailSubmissionError,
  smtpSubmissionFailure,
  classifySmtpAcceptance,
} from './smtp-outcomes.js';
import type {
  EmailAccount,
  EmailAddress,
  EmailManagerOptions,
  EmailMessage,
  EmailResult,
  SmtpAuth,
  TransportLike,
} from './types.js';
import {
  validateEmailAddress,
  validateMessage,
  validateSmtp,
  recipientList,
} from './validation.js';
import { createRecipientFilter } from './filters.js';
import { createTemplateRegistry } from './templates.js';
import { convertHtmlToEmail, plainTextFromHtml } from './html.js';
import { resolveAttachmentScope, type AttachmentScope } from './attachments.js';

/** Build private native SMTP options from validated trusted account configuration.
 * @param {EmailAccount} account - Validated private native account; credentials never enter public output.
 * @returns {Record<string, unknown>} Native secret-bearing transport options; never public configuration.
 */
function toTransportConfig(account: EmailAccount): Record<string, unknown> {
  /** Validated private native SMTP settings; never returned as account inventory. */
  const smtp = account.smtp!;
  /** Private password/OAuth2 material retained only for native transport creation. */
  const auth: SmtpAuth | undefined = smtp.auth;
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? smtp.port === 465,
    requireTLS: smtp.requireTLS ?? (smtp.secure !== true && smtp.port !== 465),
    ignoreTLS: smtp.ignoreTLS ?? false,
    pool: smtp.pool ?? false,
    maxConnections: smtp.maxConnections ?? 5,
    maxMessages: smtp.maxMessages ?? 100,
    connectionTimeout: smtp.connectionTimeout ?? 10000,
    greetingTimeout: smtp.greetingTimeout ?? 10000,
    socketTimeout: smtp.socketTimeout ?? 30000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...smtp.tls },
    ...(auth
      ? {
          auth:
            auth.type === 'password'
              ? { user: auth.user, pass: auth.pass }
              : { ...auth, type: 'OAuth2' },
        }
      : {}),
    ...(smtp.dkim ? { dkim: { ...smtp.dkim } } : {}),
  };
}
/** Normalize legacy private native result fields; despite the historical name, addresses/response are not public-safe.
 * @param {{
    messageId?: string;
    accepted?: unknown[];
    rejected?: unknown[];
    response?: string;
  }} value - Private native SMTP result or unsubscribe-target options according to the helper.
 * @param {string} value.messageId - Optional private native identity.
 * @param {unknown[]} value.accepted - Optional private native accepted list.
 * @param {unknown[]} value.rejected - Optional private native rejected list.
 * @param {string} value.response - Optional private raw SMTP response.
 * @param {string} account - Validated private native account; credentials never enter public output.
 * @returns {EmailResult} Private message identity/envelope/response fields; use counter projections for telemetry.
 */
function redactResult(
  value: {
    /** Private transport-assigned identity; not inbox delivery evidence. */
    messageId?: string;
    /** Private native accepted envelope report requiring classification. */
    accepted?: unknown[];
    /** Private native rejected envelope report requiring classification. */
    rejected?: unknown[];
    /** Private raw native SMTP response; this helper does not sanitize it for clients. */
    response?: string;
  },
  account: string
): EmailResult {
  /** Normalize legacy native envelope values into bounded private strings.
   * @param {unknown[]} values - Optional native outcome array.
   * @returns {string[]} Private bounded address strings, not public telemetry. */
  const asAddresses = (values?: unknown[]) =>
    Array.isArray(values) ? values.map((v) => String(v).slice(0, 320)) : [];
  return {
    account,
    messageId: value.messageId,
    accepted: asAddresses(value.accepted),
    rejected: asAddresses(value.rejected),
    response: value.response,
  };
}
/** Validate explicit unsubscribe targets before producing one-click HTTPS/mailto headers.
 * @param {EmailMessage['listUnsubscribe']} value - Private native SMTP result or unsubscribe-target options according to the helper.
 * @returns {Record<string, string>} Header map; URL capabilities remain private.
 */
function unsubscribeHeaders(
  value: EmailMessage['listUnsubscribe']
): Record<string, string> {
  if (!value) {
    return {};
  }
  /** Validated private unsubscribe URL/mailbox targets assembled into headers. */
  const targets: string[] = [];
  if (value.url) {
    /** Parsed HTTPS unsubscribe capability; credentials and oversized URLs reject. */
    const url = new URL(value.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.href.length > 2048
    ) {
      throw new TypeError('HTTPS unsubscribe URL required');
    }
    targets.push(`<${url.href}>`);
  }
  if (value.email) {
    validateEmailAddress(value.email);
    targets.push(`<mailto:${value.email}>`);
  }
  if (!targets.length) {
    throw new TypeError('Unsubscribe target required');
  }
  return {
    'List-Unsubscribe': targets.join(', '),
    ...(value.url
      ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : {}),
  };
}
/** Hash serializable message/tracking policy while excluding observation-only execution controls.
 * @param {EmailMessage} message - Private host message; no principal/tenant identity is inferred from envelope addresses.
 * @param {EmailSendOptions} opts - Explicit send observation/tracking controls used for fingerprint exclusions.
 * @returns {string} Process-local SHA-256 conflict identity; native streams/repeated objects reject.
 */
function fingerprintSend(
  message: EmailMessage,
  opts: EmailSendOptions
): string {
  /** Observation-only controls removed from the fingerprint; remaining tracking/render policy stays identity-bound. */
  const {
    signal: _signal,
    timeoutMs: _timeout,
    deadline: _deadline,
    ...fingerprintOptions
  } = opts;
  /** Per-fingerprint object identity set; repeated/cyclic/stream data cannot be replay-fingerprinted. */
  const seen = new WeakSet<object>();
  let encoded: string;
  try {
    encoded = JSON.stringify(
      { message, opts: fingerprintOptions },
      (_key, value) => {
        if (
          typeof value === 'function' ||
          typeof value === 'symbol' ||
          typeof value === 'bigint'
        ) {
          throw new TypeError('Non-serializable idempotent email');
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            throw new TypeError('Repeated/cyclic object in idempotent email');
          }
          seen.add(value);
          if (
            typeof value.pipe === 'function' ||
            typeof value.getReader === 'function'
          ) {
            throw new TypeError(
              'Stream attachments require durable external idempotency'
            );
          }
          if (
            !Array.isArray(value) &&
            !(value instanceof Uint8Array) &&
            !Buffer.isBuffer(value)
          ) {
            return Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            );
          }
        }
        return value;
      }
    )!;
  } catch (error) {
    throw Object.assign(
      new TypeError('Idempotent email must use serializable payloads'),
      { cause: error }
    );
  }
  if (encoded.length > 1_000_000) {
    throw new RangeError('Idempotency fingerprint payload exceeds limit');
  }
  return createHash('sha256').update(encoded).digest('hex');
}
/** Detach supported mutable envelope/byte/address fields before asynchronous authorization begins.
 * @param {EmailMessage} message - Private host message; no principal/tenant identity is inferred from envelope addresses.
 * @param {number} maxBytes - Aggregate raw-byte ceiling while snapshotting mutable byte attachments.
 * @returns {EmailMessage} Private partial snapshot; trusted getters and template data are not sandboxed.
 */
function snapshotMessage(
  message: EmailMessage,
  maxBytes: number
): EmailMessage {
  if (!message || typeof message !== 'object') {
    throw new TypeError('Invalid email message');
  }
  /** Detach a structured mailbox before asynchronous host callbacks.
   * @param {EmailAddress} value - Private validated address representation.
   * @returns {EmailAddress} Original immutable string or new shallow address object. */
  const address = (value: EmailAddress) =>
    typeof value === 'string' ? value : { ...value };
  /** Validate and snapshot the optional single/list envelope before awaiting authorization.
   * @param {EmailMessage['to'] | undefined} value - Private recipient input, omitted lists stay undefined.
   * @returns {EmailAddress[] | undefined} New validated address list, detached from mutable address objects. */
  const recipients = (value: EmailMessage['to'] | undefined) =>
    value === undefined ? undefined : recipientList(value).map(address);
  let bytes = 0;
  /** Prepared/reserved attachment views; byte sources are detached before asynchronous hooks. */
  const attachments = message.attachments?.map((a) => {
    let content = a.content;
    if (content instanceof Uint8Array) {
      bytes += content.byteLength;
      if (bytes > maxBytes) {
        throw new RangeError('Attachments exceed aggregate limit');
      }
      content = Buffer.from(content);
    }
    return {
      ...a,
      ...(a.file ? { file: { ...a.file } } : {}),
      ...(content !== undefined ? { content } : {}),
    };
  });
  return {
    ...message,
    ...(message.from ? { from: address(message.from) } : {}),
    to: recipients(message.to) ?? [],
    cc: recipients(message.cc),
    bcc: recipients(message.bcc),
    replyTo: recipients(message.replyTo),
    ...(message.headers ? { headers: { ...message.headers } } : {}),
    ...(message.listUnsubscribe
      ? { listUnsubscribe: { ...message.listUnsubscribe } }
      : {}),
    ...(message.tracking
      ? {
          tracking: {
            ...message.tracking,
            ...(message.tracking.downloadLinks
              ? { downloadLinks: [...message.tracking.downloadLinks] }
              : {}),
          },
        }
      : {}),
    ...(attachments ? { attachments } : {}),
  };
}
export interface EmailSendOptions {
  /** Cooperative observation/cancellation signal; native work retains capacity until settlement. */
  signal?: AbortSignal;
  /** Bounded caller observation interval 1–600000ms; defaults to manager policy. */
  timeoutMs?: number;
  /** Absolute epoch-millisecond observation deadline within the bounded maximum age. */
  deadline?: number;
  /** Default email conversion sanitizes/inlines; trusted bypass is explicit host responsibility. */
  htmlMode?: 'email' | 'trusted';
  /** Explicit trusted local-path opt-in; default false. */
  allowLocalAttachmentPaths?: boolean;
  /** Overrides per-message tracking for this send. false always disables all tracking. */
  tracking?: boolean | NonNullable<EmailMessage['tracking']>;
}
/** Create one bounded transport/send owner without acquiring native SMTP handles until needed.
 * @param {EmailManagerOptions} options - Trusted host accounts, policies and borrowed integration callbacks.
 * @returns {EmailManager} Generation-owned manager; close drains actual send/verification work and closes owned transports only.
 */
export function createEmailManager(options: EmailManagerOptions) {
  if (!options?.accounts?.length || options.accounts.length > 64) {
    throw new TypeError('At least one email connection required');
  }
  /** Exact configured account map; no optional filesystem/provider discovery occurs. */
  const accounts = new Map<string, EmailAccount>();
  // Validate every configured account before retaining any lazy transport state.
  for (const account of options.accounts) {
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(account?.name) ||
      accounts.has(account.name)
    ) {
      throw new TypeError('Invalid or duplicate email account name');
    }
    if (Boolean(account.smtp) === Boolean(account.transport)) {
      throw new TypeError('Choose SMTP settings or injected transport');
    }
    if (
      account.ownTransport !== undefined &&
      typeof account.ownTransport !== 'boolean'
    ) {
      throw new TypeError('Invalid transport ownership');
    }
    if (account.smtp) {
      validateSmtp(account.smtp);
    }
    if (account.defaults?.from) {
      validateEmailAddress(account.defaults.from);
    }
    accounts.set(account.name, account);
  }
  /** Existing default account name, or first configured account when omitted. */
  const fallback = options.defaultAccount ?? options.accounts[0].name;
  if (!accounts.has(fallback)) {
    throw new Error('Unknown default email account');
  }
  /** Validated manager envelope ceiling, default 100, maximum 1000. */
  const limit = options.maxRecipients ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError('Invalid recipient limit');
  }
  /** Instance-local recipient policy; durable suppression remains independently injected. */
  const filter = createRecipientFilter(options.rules, options.suppressions);
  /** Instance-local authored catalog; no module/template code is compiled. */
  const templates = createTemplateRegistry();
  /** Per-account lazy construction promises; resolved transports retain explicit ownership. */
  const created = new Map<string, Promise<TransportLike>>();
  /** Bounded process-local known/uncertain replay fences, never durable delivery state. */
  const completed = new Map<
    string,
    {
      /** Epoch expiry for this bounded process-local replay fence. */
      until: number;
      /** Known private SMTP result retained without resubmission. */
      result?: EmailResult;
      /** Private uncertain submission error retained to prevent ambiguous replay. */
      error?: EmailSubmissionError;
      /** Account-scoped message/policy conflict identity; observation controls are excluded. */
      fingerprint: string;
    }
  >();
  /** In-flight keyed observation records; original native sends are tracked separately. */
  const pending = new Map<
    string,
    {
      /** Observed send promise; actual native work is tracked independently. */
      task: Promise<EmailResult>;
      /** Account-scoped message/policy conflict identity; observation controls are excluded. */
      fingerprint: string;
      /** Private original execution state; coalesced callers never own cancellation of it. */
      context: SendContext;
    }
  >();
  /** Bounded replay-fence count, default 2000. */
  const maxKeys = options.maxIdempotencyKeys ?? 2000;
  /** Replay-fence duration, default five minutes; not receiver deduplication. */
  const ttl = options.idempotencyTtlMs ?? 5 * 60_000;
  if (
    !Number.isSafeInteger(maxKeys) ||
    maxKeys < 1 ||
    maxKeys > 100000 ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1 ||
    ttl > 86_400_000
  ) {
    throw new RangeError('Invalid idempotency policy');
  }
  /** Actual unsettled send/verification capacity, default eight. */
  const maxSends = options.maxConcurrentSends ?? 8;
  /** Default bounded caller observation deadline, 30000ms. */
  const defaultTimeout = options.sendTimeoutMs ?? 30000;
  if (
    !Number.isSafeInteger(maxSends) ||
    maxSends < 1 ||
    maxSends > 128 ||
    !Number.isSafeInteger(defaultTimeout) ||
    defaultTimeout < 1 ||
    defaultTimeout > 600000
  ) {
    throw new RangeError('Invalid send execution limits');
  }
  interface SendContext {
    /** Exact configured account associated with this owned task. */
    name: string;
    /** Cooperative observation/cancellation signal; native work retains capacity until settlement. */
    signal: AbortSignal;
    /** Owned cooperative cancellation controller; not forced native cancellation. */
    controller: AbortController;
    /** True once the sendMail boundary has been crossed; later unknown failures are uncertain. */
    submitted: boolean;
    /** Private validated recipient list used for exact outcome classification. */
    intended: EmailAddress[];
    /** Known SMTP acceptance preserved when optional post-send telemetry stalls. */
    known?: EmailResult;
    /** Owned lazy reader scope; actual disposal is part of send settlement. */
    attachments?: AttachmentScope;
    /** Check cooperative send cancellation/deadline at an explicit stage boundary.
     * @returns {void} Throws before further work; cannot force-stop arbitrary host/native callbacks.
     */
    check(): void;
  }
  /** Actual native send promises retained through attachment disposal. */
  const jobs = new Set<Promise<EmailResult>>();
  /** Actual native readiness operations with their owned cooperative controllers. */
  const verifications = new Map<
    Promise<boolean>,
    {
      /** Exact configured account associated with this owned task. */
      name: string;
      /** Owned cooperative cancellation controller; not forced native cancellation. */
      controller: AbortController;
    }
  >();
  /** Actual in-flight send state retained even after callers stop observing. */
  const contexts = new Set<SendContext>();
  /** Weak transport-identity fence preventing duplicate owned close. */
  const released = new WeakSet<object>();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Close an owned transport once while preserving explicit borrowed transport ownership.
   * @param {string} name - Exact configured account name; not caller-provided authorization.
   * @param {TransportLike} transport - Native handle whose actual ownership follows ownTransport.
   * @returns {Promise<void>} Native close settled, or borrowed/already released transport left untouched.
   */
  async function release(name: string, transport: TransportLike) {
    if (accounts.get(name)?.ownTransport === false || released.has(transport)) {
      return;
    }
    released.add(transport);
    await transport.close?.();
  }
  /** Expire old process-local idempotency entries and retain a bounded known/uncertain result.
   * @param {string} key - Account-scoped process-local idempotency identity.
   * @param {string} fingerprint - Hash of the validated message/tracking policy, excluding observation controls.
   * @param {EmailResult} result - Private known SMTP result retained for replay fencing.
   * @param {EmailSubmissionError} error - Private callback/submission cause; never default telemetry.
   * @returns {void} TTL fence updated; no durable or cross-instance exactly-once guarantee.
   */
  function remember(
    key: string,
    fingerprint: string,
    result?: EmailResult,
    error?: EmailSubmissionError
  ) {
    // Remove expired process-local replay fences before applying the entry ceiling.
    for (const [old, item] of completed) {
      if (item.until <= Date.now()) {
        completed.delete(old);
      }
    }
    if (!completed.has(key) && completed.size >= maxKeys) {
      completed.delete(completed.keys().next().value!);
    }
    completed.set(key, { until: Date.now() + ttl, result, error, fingerprint });
  }
  let waiters = 0;
  /** Bound a coalesced caller independently without cancelling or resubmitting the original send.
   * @param {{ task: Promise<EmailResult>; context: SendContext }} running - Original owned send and context observed without duplicating submission.
   * @param {Promise<EmailResult>} running.task - Original caller-facing owned send observation.
   * @param {SendContext} running.context - Original private lifecycle state, never cancelled by this waiter.
   * @param {EmailSendOptions} settings - Explicit observation/batch settings with bounded cooperative deadline/signal.
   * @returns {Promise<EmailResult>} Known acceptance or explicit uncertain observation; original work retains its slot.
   */
  async function observeShared(
    running: {
      /** Observed send promise; actual native work is tracked independently. */
      task: Promise<EmailResult>;
      /** Private original execution state; coalesced callers never own cancellation of it. */
      context: SendContext;
    },
    settings: EmailSendOptions
  ) {
    if (waiters >= Math.min(maxSends * 4, 512)) {
      throw Object.assign(new Error('Email waiter capacity exceeded'), {
        code: 'EMAIL_SEND_OVERLOAD',
      });
    }
    /** Validated caller-specific observation interval; no native replay/timeout guarantee. */
    const ms = settings.timeoutMs ?? defaultTimeout;
    if (
      !Number.isSafeInteger(ms) ||
      ms < 1 ||
      ms > 600000 ||
      (settings.signal !== undefined &&
        !(settings.signal instanceof AbortSignal)) ||
      (settings.deadline !== undefined &&
        (!Number.isSafeInteger(settings.deadline) ||
          settings.deadline < 0 ||
          settings.deadline > Date.now() + 600000))
    ) {
      throw new TypeError('Invalid send deadline/signal');
    }
    waiters++;
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort = () => {};
    try {
      /** Caller cancellation/deadline observation raced against actual work, which keeps its slot. */
      const stopped = new Promise<EmailResult>((resolve, reject) => {
        abort = () => {
          if (running.context.known) {
            resolve({ ...running.context.known, telemetryIncomplete: true });
          } else {
            reject(
              new EmailSubmissionError(
                'EMAIL_SMTP_UNCERTAIN',
                running.context.intended,
                new Error('Shared email observation cancelled or expired')
              )
            );
          }
        };
        settings.signal?.addEventListener('abort', abort, { once: true });
        if (settings.signal?.aborted) {
          abort();
        }
        timer = setTimeout(
          abort,
          Math.max(
            1,
            Math.min(Date.now() + ms, settings.deadline ?? Infinity) -
              Date.now()
          )
        );
      });
      return await Promise.race([running.task, stopped]);
    } finally {
      waiters--;
      if (timer) {
        clearTimeout(timer);
      }
      settings.signal?.removeEventListener('abort', abort);
    }
  }
  /** Resolve one configured transport lazily and reject reuse of a released injected owner.
   * @param {string} name - Exact configured account name; not caller-provided authorization.
   * @returns {Promise<TransportLike>} Owned or explicitly borrowed native transport; construction failures clear only that pending entry.
   */
  async function transporter(name: string): Promise<TransportLike> {
    if (closed) {
      throw new Error('Email manager closed');
    }
    /** Configured private account resolved before native acquisition. */
    const account = accounts.get(name);
    if (!account) {
      throw new Error('Unknown email account');
    }
    if (account.transport && released.has(account.transport)) {
      throw Object.assign(
        new Error('Owned email transport was released; provide a new handle'),
        { code: 'EMAIL_TRANSPORT_RELEASED' }
      );
    }
    if (account.enabled === false) {
      throw new Error(`Email account disabled: ${name}`);
    }
    let current = created.get(name);
    if (!current) {
      current = account.transport
        ? Promise.resolve(account.transport)
        : import('nodemailer').then(
            ({ default: nm }) =>
              nm.createTransport(toTransportConfig(account)) as TransportLike
          );
      created.set(name, current);
      current.catch(() => {
        if (created.get(name) === current) {
          created.delete(name);
        }
      });
    }
    return current;
  }
  /** Validate, authorize and recheck marketing policy before one SMTP submission; optional telemetry cannot authorize replay.
   * @param {EmailMessage} message - Private host message; no principal/tenant identity is inferred from envelope addresses.
   * @param {string} name - Exact configured account name; not caller-provided authorization.
   * @param {EmailSendOptions} sendOpts - Explicit per-send controls; no automatic consent is granted.
   * @param {SendContext} context - Private owned send state retaining actual submission/attachment lifecycle.
   * @returns {Promise<EmailResult>} Private per-recipient acceptance outcomes with independently optional tracking.
   */
  async function doSend(
    message: EmailMessage,
    name: string,
    sendOpts: EmailSendOptions,
    context: SendContext
  ): Promise<EmailResult> {
    context.check();
    /** Configured private account resolved before native acquisition. */
    const account = accounts.get(name)!;
    /** Private per-send message merged with trusted defaults before explicit purpose/tracking policy. */
    const merged: EmailMessage = {
      ...account.defaults,
      ...message,
      account: name,
    };
    // Tracking may only be enabled explicitly on THIS send, never silently through account defaults.
    /** Explicit send/message tracking choice; account defaults cannot silently opt in. */
    const policy = (() => {
      if (sendOpts.tracking === false) {
        return { enabled: false };
      }
      if (sendOpts.tracking === true) {
        return { enabled: true };
      }
      if (sendOpts.tracking) {
        return { ...sendOpts.tracking };
      }
      if (message.tracking) {
        return { ...message.tracking };
      }
      return { enabled: false };
    })();
    merged.tracking = {
      enabled: policy.enabled === true,
      opens: policy.opens,
      clicks: policy.clicks,
      downloads: policy.downloads,
      downloadLinks: policy.downloadLinks,
      campaign: policy.campaign,
    };
    /** Literal true required for optional injected tracking instrumentation. */
    const trackingEnabled = merged.tracking.enabled === true;
    /** Explicit per-message marketing purpose; account defaults cannot supply consent. */
    const marketing = message.purpose === 'marketing';
    if (
      message.purpose !== undefined &&
      !['marketing', 'transactional'].includes(message.purpose)
    ) {
      throw new TypeError('Invalid email purpose');
    }
    // Account defaults may not silently turn transactional sends into marketing campaigns.
    merged.purpose = marketing ? 'marketing' : 'transactional';
    /** Isolate optional tracking diagnostics from mail acceptance and delivery control.
     * @param {unknown} error - Private callback/submission cause; never default telemetry.
     * @returns {void} Diagnostic invoked at most for this failure; callback errors are ignored.
     */
    function warnTracking(error: unknown) {
      try {
        options.onTrackingError?.(error);
      } catch {
        /* logging must not break delivery */
      }
    }

    if (merged.template) {
      /** Registered authored template output merged before envelope/body validation. */
      const render = templates.render(merged.template, merged.data);
      merged.subject = merged.subject || render.subject;
      merged.html = merged.html ?? render.html;
      merged.text = merged.text ?? render.text;
    }
    /** Validated intended envelope; used for recipient admission and exact SMTP classification. */
    const { to, cc, bcc } = validateMessage(
      merged,
      Math.min(limit, account.maxRecipients ?? limit)
    );
    context.intended = [...to, ...cc, ...bcc];
    if (!merged.from) {
      throw new TypeError(`Email account ${name} requires a From address`);
    }
    if (options.authorize && (await options.authorize(merged, name)) !== true) {
      throw Object.assign(new Error('Email delivery not authorized'), {
        code: 'EMAIL_FORBIDDEN',
      });
    }
    context.check();
    // Apply local policy to every intended envelope recipient before acquiring SMTP.
    for (const recipient of [...to, ...cc, ...bcc]) {
      /** Private local suppression/rule outcome for one validated recipient. */
      const evaluation = filter.evaluate(recipient, name);
      if (evaluation.rejected.length) {
        throw Object.assign(
          new Error(`Recipient rejected: ${evaluation.rejected[0].reason}`),
          { code: 'EMAIL_FILTERED' }
        );
      }
    }
    if (marketing) {
      if (cc.length || bcc.length || to.length !== 1) {
        throw Object.assign(
          new Error(
            'Marketing delivery requires exactly one To recipient and no Cc/Bcc'
          ),
          { code: 'EMAIL_MARKETING_RECIPIENTS' }
        );
      }
      if (!options.preferences) {
        throw Object.assign(
          new Error('Marketing consent service unavailable'),
          { code: 'EMAIL_CONSENT_UNAVAILABLE' }
        );
      }
      // Fail closed when the consent database cannot be read; do not deliver without consent.
      let subscribed = false;
      try {
        subscribed = await options.preferences.isSubscribed(to[0]);
      } catch {
        throw Object.assign(new Error('Marketing consent lookup unavailable'), {
          code: 'EMAIL_CONSENT_UNAVAILABLE',
        });
      }
      context.check();
      if (typeof subscribed !== 'boolean') {
        throw Object.assign(new Error('Invalid marketing consent state'), {
          code: 'EMAIL_CONSENT_UNAVAILABLE',
        });
      }
      if (subscribed !== true) {
        throw Object.assign(
          new Error('Recipient has not opted into marketing'),
          { code: 'EMAIL_CONSENT_REQUIRED' }
        );
      }
      if (options.marketingSuppression) {
        let blocked;
        try {
          blocked = await options.marketingSuppression.isSuppressed(to[0]);
        } catch {
          throw Object.assign(new Error('Marketing suppression unavailable'), {
            code: 'EMAIL_SUPPRESSION_UNAVAILABLE',
          });
        }
        if (typeof blocked !== 'boolean') {
          throw Object.assign(
            new Error('Invalid marketing suppression state'),
            { code: 'EMAIL_SUPPRESSION_UNAVAILABLE' }
          );
        }
        if (blocked) {
          throw Object.assign(
            new Error('Recipient suppressed from marketing'),
            { code: 'EMAIL_SUPPRESSED' }
          );
        }
      }
      merged.listUnsubscribe = {
        ...merged.listUnsubscribe,
        url: options.preferences.makeUnsubscribeUrl(to[0]),
      };
    }
    context.check();
    /** Validated extra headers plus explicit unsubscribe headers; private capabilities may be present. */
    const headers = {
      ...merged.headers,
      ...unsubscribeHeaders(merged.listUnsubscribe),
    };
    let renderedHtml: string | undefined;
    if (merged.html) {
      if (sendOpts.htmlMode === 'trusted') {
        renderedHtml = merged.html;
      } else {
        renderedHtml = await convertHtmlToEmail(merged.html);
      }
    }
    context.check();
    /** Pre-instrumentation HTML retained so optional analytics failure cannot prevent delivery. */
    const untrackedHtml = renderedHtml;
    // The tracking service is explicitly injected; no hidden analytics requests or tracking by default.
    /** Opaque per-attempt activity reference, exposed only for explicit injected tracking. */
    const trackingId = randomUUID();
    if (renderedHtml && trackingEnabled && options.tracking) {
      try {
        renderedHtml = await options.tracking.instrumentHtml(renderedHtml, {
          id: trackingId,
          account: name,
          message: merged,
        });
        if (typeof renderedHtml !== 'string') {
          throw new TypeError('Invalid tracking HTML');
        }
      } catch (error) {
        warnTracking(error);
        renderedHtml = untrackedHtml;
      }
    }
    context.check();
    /** Authored text or conversion of untracked HTML, independent of analytics. */
    const text =
      merged.text ??
      (untrackedHtml ? await plainTextFromHtml(untrackedHtml) : undefined);
    context.check();
    context.attachments = await resolveAttachmentScope(
      merged.attachments,
      {
        files: options.files,
        maxAttachmentBytes: options.maxAttachmentBytes,
        maxAttachmentStreams: options.maxAttachmentStreams,
      },
      sendOpts.allowLocalAttachmentPaths ?? false,
      context.signal
    );
    /** Prepared/reserved attachment views; byte sources are detached before asynchronous hooks. */
    const attachments = context.attachments.attachments;
    context.check();
    /** Private allowlisted native submission payload; no arbitrary raw transport options forwarded. */
    const data: Record<string, unknown> = {
      from: merged.from,
      to,
      cc,
      bcc,
      replyTo: merged.replyTo ? recipientList(merged.replyTo) : undefined,
      subject: merged.subject,
      html: renderedHtml,
      text,
      amp: merged.amp,
      headers,
      priority: merged.priority,
      attachments,
    };
    /** Resolved native handle, owned or explicitly borrowed by account policy. */
    const transport = await transporter(name);
    context.check();
    if (marketing) {
      // Fresh pre-SMTP check protects against preference changes during HTML rendering.
      let allowed;
      try {
        allowed = await options.preferences!.isSubscribed(to[0]);
      } catch {
        throw Object.assign(new Error('Marketing consent unavailable'), {
          code: 'EMAIL_CONSENT_UNAVAILABLE',
        });
      }
      if (typeof allowed !== 'boolean') {
        throw Object.assign(new Error('Invalid marketing consent state'), {
          code: 'EMAIL_CONSENT_UNAVAILABLE',
        });
      }
      if (allowed !== true) {
        throw Object.assign(new Error('Marketing consent revoked'), {
          code: 'EMAIL_CONSENT_REQUIRED',
        });
      }
      if (options.marketingSuppression) {
        let blocked;
        try {
          blocked = await options.marketingSuppression.isSuppressed(to[0]);
        } catch {
          throw Object.assign(new Error('Marketing suppression unavailable'), {
            code: 'EMAIL_SUPPRESSION_UNAVAILABLE',
          });
        }
        if (typeof blocked !== 'boolean') {
          throw Object.assign(
            new Error('Invalid marketing suppression state'),
            { code: 'EMAIL_SUPPRESSION_UNAVAILABLE' }
          );
        }
        if (blocked) {
          throw Object.assign(
            new Error('Recipient suppressed from marketing'),
            { code: 'EMAIL_SUPPRESSED' }
          );
        }
      }
    }
    // Provider-independent account health gate, executed immediately before SMTP acceptance.
    if (options.reputation) {
      let decision;
      try {
        decision = await options.reputation.checkBeforeSend(
          name,
          merged.purpose!
        );
        if (!decision || typeof decision.allowed !== 'boolean') {
          throw new TypeError('Invalid reputation decision');
        }
      } catch (error) {
        if (marketing) {
          throw Object.assign(new Error('Reputation store unavailable'), {
            code: 'EMAIL_REPUTATION_UNAVAILABLE',
          });
        }
        try {
          options.onReputationError?.(error);
        } catch {
          /* Logging must not interrupt transactional mail */
        }
      }
      if (decision?.allowed === false) {
        throw Object.assign(new Error('Sender reputation paused'), {
          code: 'EMAIL_REPUTATION_PAUSED',
        });
      }
    }
    context.check();
    context.submitted = true;
    /** Private native SMTP envelope report; fulfillment alone is not full acceptance. */
    const reported = await transport.sendMail(
      data,
      account.transport ? { signal: context.signal } : undefined
    );
    /** Validated intended-envelope classification, never inbox-delivery evidence. */
    const outcome = classifySmtpAcceptance([...to, ...cc, ...bcc], reported);
    /** Private normalized submission result with per-recipient dispositions. */
    const result = {
      ...redactResult(reported, name),
      accepted: outcome.accepted,
      rejected: outcome.rejected,
      submissionStatus: outcome.status,
      acceptanceComplete: outcome.complete,
      recipientOutcomes: classifySmtpRecipients(
        [...to, ...cc, ...bcc],
        reported
      ),
    };
    context.known =
      trackingEnabled && options.tracking ? { ...result, trackingId } : result;
    if (context.signal.aborted) {
      return { ...context.known, telemetryIncomplete: true };
    }
    if (outcome.warning) {
      try {
        options.onSmtpWarning?.({
          account: name,
          status: outcome.status,
          reason: outcome.warning,
        });
      } catch {
        /* Diagnostics must not change SMTP acceptance */
      }
    }
    if (options.reputation) {
      // Accepted SMTP recipients only. Do not retry an accepted email because telemetry failed.
      for (const address of result.accepted) {
        if (context.signal.aborted) {
          break;
        }
        try {
          await options.reputation.recordAccepted(
            name,
            address,
            result.messageId ?? trackingId
          );
        } catch (error) {
          try {
            options.onReputationError?.(error);
          } catch {
            /* report only */
          }
        }
      }
    }
    if (
      !context.signal.aborted &&
      trackingEnabled &&
      result.accepted.length > 0 &&
      options.tracking?.onSent
    ) {
      // Mail has been accepted. Telemetry failures must not trigger a duplicate send/retry.
      try {
        await options.tracking.onSent({
          id: trackingId,
          account: name,
          message: merged,
          result,
        });
      } catch (error) {
        warnTracking(error);
      }
    }
    return trackingEnabled && options.tracking
      ? { ...result, trackingId }
      : result;
  }
  /** Generation-owned API; no native SMTP connection is created merely by constructing it. */
  const manager = {
    templates,
    filter,
    /** Expose configured account transport metadata without credential fields.
     * @returns {{name: string, enabled: boolean, protocol: string, host: string | undefined, port: number | undefined, secure: boolean | undefined}[]} Host-private account inventory; endpoint metadata still needs access control.
     */
    accounts() {
      return [...accounts.values()].map(({ name, enabled, smtp }) => ({
        name,
        enabled: enabled !== false,
        protocol: smtp ? 'smtp' : 'custom',
        host: smtp?.host,
        port: smtp?.port,
        secure: smtp?.secure,
      }));
    },
    /** Bound caller observation of readiness while retaining actual native capacity and owned cleanup.
     * @param {string} name - Exact configured account name; not caller-provided authorization.
     * @param {Pick<EmailSendOptions, 'signal' | 'timeoutMs' | 'deadline'>} settings - Explicit observation/batch settings with bounded cooperative deadline/signal.
     * @returns {Promise<boolean>} Literal readiness or fixed private-cause submission error; no mail sent.
     */
    async verify(
      name = fallback,
      settings: Pick<EmailSendOptions, 'signal' | 'timeoutMs' | 'deadline'> = {}
    ) {
      if (closed) {
        throw new Error('Email manager closed');
      }
      if (jobs.size + verifications.size >= maxSends) {
        throw Object.assign(new Error('Email send capacity exceeded'), {
          code: 'EMAIL_SEND_OVERLOAD',
        });
      }
      /** Validated caller-specific observation interval; no native replay/timeout guarantee. */
      const ms = settings.timeoutMs ?? defaultTimeout;
      if (
        !Number.isSafeInteger(ms) ||
        ms < 1 ||
        ms > 600000 ||
        (settings.signal !== undefined &&
          !(settings.signal instanceof AbortSignal)) ||
        (settings.deadline !== undefined &&
          (!Number.isSafeInteger(settings.deadline) ||
            settings.deadline < 0 ||
            settings.deadline > Date.now() + 600000))
      ) {
        throw new TypeError('Invalid verify deadline/signal');
      }
      /** Owned cooperative cancellation controller; native settlement remains separate. */
      const controller = new AbortController();
      /** Forward caller cancellation to this operation observation without replaying work.

 * @returns {void} Owned signal aborted; native/provider cooperation determines settlement. */
      const abort = () => controller.abort();
      /** Minimum caller/manager absolute observation expiration; actual work may outlive it. */
      const deadline = Math.min(Date.now() + ms, settings.deadline ?? Infinity);
      let expired = false;
      /** Validate the current cooperative signal and wall-clock observation deadline.

 * @returns {void} Throws fixed cancellation/deadline detail before further stages. */
      const check = () => {
        if (controller.signal.aborted || Date.now() >= deadline) {
          throw Object.assign(
            new Error('Email verification cancelled or deadline exceeded'),
            {
              code:
                expired || Date.now() >= deadline
                  ? 'EMAIL_VERIFY_DEADLINE'
                  : 'EMAIL_VERIFY_CANCELLED',
            }
          );
        }
      };
      settings.signal?.addEventListener('abort', abort, { once: true });
      if (settings.signal?.aborted) {
        abort();
      }
      let stop = () => {};
      /** Caller cancellation/deadline observation raced against actual work, which keeps its slot. */
      const stopped = new Promise<never>((_, reject) => {
        stop = () => {
          try {
            check();
          } catch (e) {
            reject(e);
          }
        };
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) {
          stop();
        }
      });
      /** Owned observation timer; always cleared and detached from the caller signal. */
      const timer = setTimeout(
        () => {
          expired = true;
          controller.abort();
        },
        Math.max(1, deadline - Date.now())
      );
      /** Actual owned task promise; capacity is released only after its real settlement. */
      const native = Promise.resolve().then(async () => {
        check();
        /** Resolved native handle, owned or explicitly borrowed by account policy. */
        const transport = await transporter(name);
        try {
          check();
          /** Native readiness response required to be an actual boolean. */
          const valid = transport.verify ? await transport.verify() : true;
          check();
          if (typeof valid !== 'boolean') {
            throw new TypeError('Invalid transport verification result');
          }
          if (
            valid === false &&
            !contexts.size &&
            verifications.size === 1 &&
            accounts.get(name)?.ownTransport !== false
          ) {
            created.delete(name);
            await release(name, transport);
          }
          return valid;
        } catch (cause) {
          if (
            ![...contexts].some((c) => c.name === name) &&
            ![...verifications.values()].some(
              (v) => v.name === name && v.controller !== controller
            ) &&
            accounts.get(name)?.ownTransport !== false
          ) {
            created.delete(name);
            try {
              await release(name, transport);
            } catch {
              /* Preserve verification cause. */
            }
          }
          throw cause instanceof EmailSubmissionError
            ? cause
            : new EmailSubmissionError('EMAIL_VERIFY_FAILED', [], cause);
        }
      });
      verifications.set(native, { name, controller });
      void native.finally(() => verifications.delete(native)).catch(() => {});
      try {
        return await Promise.race([native, stopped]);
      } finally {
        clearTimeout(timer);
        settings.signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', stop);
      }
    },

    /** Admit a bounded private message, fence process-local idempotency and preserve ambiguous submission as uncertain.
     * @param {EmailMessage} message - Private host message; no principal/tenant identity is inferred from envelope addresses.
     * @param {EmailSendOptions} sendOpts - Explicit per-send controls; no automatic consent is granted.
     * @returns {Promise<EmailResult>} Known acceptance or explicit failure; caller timeout does not release native ownership early.
     */
    async send(
      message: EmailMessage,
      sendOpts: EmailSendOptions = {}
    ): Promise<EmailResult> {
      if (closed) {
        throw new Error('Email manager closed');
      }
      message = snapshotMessage(
        message,
        options.maxAttachmentBytes ?? 25 * 1024 * 1024
      );
      /** Exact selected account identity, never a browser role or tenant claim. */
      const name = message.account ?? fallback;
      if (!accounts.has(name)) {
        throw new Error('Unknown email account');
      }
      /** Optional account-scoped process-local idempotency key. */
      const key = message.idempotencyKey
        ? `${name}:${message.idempotencyKey}`
        : undefined;
      // A key cannot silently acknowledge a DIFFERENT message. Streams are not safe to fingerprint.
      /** Message/tracking identity hash; execution observation controls do not change it. */
      const fingerprint = key ? fingerprintSend(message, sendOpts) : undefined;
      if (key) {
        /** Existing unexpired known/uncertain replay fence checked before accepting new work. */
        const prior = completed.get(key);
        if (prior && prior.until > Date.now()) {
          if (prior.fingerprint !== fingerprint) {
            throw Object.assign(
              new Error('Idempotency key reused for different email'),
              { code: 'EMAIL_IDEMPOTENCY_CONFLICT' }
            );
          }
          if (prior.error) {
            throw prior.error;
          }
          return {
            ...prior.result!,
            skipped: true,
            reason: 'idempotency replay',
          };
        }
        /** Original pending keyed send observed without a second SMTP submission. */
        const running = pending.get(key);
        if (running) {
          if (running.fingerprint !== fingerprint) {
            throw Object.assign(
              new Error('Idempotency key reused for different email'),
              { code: 'EMAIL_IDEMPOTENCY_CONFLICT' }
            );
          }
          return observeShared(running, sendOpts);
        }
      }
      if (jobs.size + verifications.size >= maxSends) {
        throw Object.assign(new Error('Email send capacity exceeded'), {
          code: 'EMAIL_SEND_OVERLOAD',
        });
      }
      /** Validated per-send observation interval, defaulting to manager policy. */
      const timeout = sendOpts.timeoutMs ?? defaultTimeout;
      if (
        !Number.isSafeInteger(timeout) ||
        timeout < 1 ||
        timeout > 600000 ||
        (sendOpts.signal !== undefined &&
          !(sendOpts.signal instanceof AbortSignal)) ||
        (sendOpts.deadline !== undefined &&
          (!Number.isSafeInteger(sendOpts.deadline) ||
            sendOpts.deadline < 0 ||
            sendOpts.deadline > Date.now() + 600000))
      ) {
        throw new TypeError('Invalid send deadline/signal');
      }
      /** Owned cooperative cancellation controller; native settlement remains separate. */
      const controller = new AbortController();
      /** Minimum caller/manager absolute observation expiration; actual work may outlive it. */
      const deadline = Math.min(
        Date.now() + timeout,
        sendOpts.deadline ?? Infinity
      );
      let expired = false;
      /** Owned send state with intended recipients, known acceptance and attachment cleanup. */
      const context: SendContext = {
        name,
        controller,
        signal: controller.signal,
        submitted: false,
        intended: [],
        /** Check cooperative send cancellation/deadline at an explicit stage boundary.
         * @returns {void} Throws before further work; cannot force-stop arbitrary host/native callbacks.
         */
        check() {
          if (controller.signal.aborted || Date.now() >= deadline) {
            throw Object.assign(
              new Error(
                expired || Date.now() >= deadline
                  ? 'Email send deadline exceeded'
                  : 'Email send cancelled'
              ),
              {
                code:
                  expired || Date.now() >= deadline
                    ? 'EMAIL_SEND_DEADLINE'
                    : 'EMAIL_SEND_CANCELLED',
              }
            );
          }
        },
      };
      /** Forward caller cancellation to this operation observation without replaying work.

 * @returns {void} Owned signal aborted; native/provider cooperation determines settlement. */
      const abort = () => controller.abort();
      sendOpts.signal?.addEventListener('abort', abort, { once: true });
      if (sendOpts.signal?.aborted) {
        abort();
      }
      contexts.add(context);
      let stop = () => {};
      /** Caller cancellation/deadline observation raced against actual work, which keeps its slot. */
      const stopped = new Promise<never>((_, reject) => {
        stop = () =>
          reject(
            Object.assign(
              new Error(
                expired
                  ? 'Email send deadline exceeded'
                  : 'Email send cancelled'
              ),
              { code: expired ? 'EMAIL_SEND_DEADLINE' : 'EMAIL_SEND_CANCELLED' }
            )
          );
        controller.signal.addEventListener('abort', stop, { once: true });
        if (controller.signal.aborted) {
          stop();
        }
      });
      /** Owned observation timer; always cleared and detached from the caller signal. */
      const timer = setTimeout(
        () => {
          expired = true;
          controller.abort();
        },
        Math.max(1, deadline - Date.now())
      );
      /** Actual owned task promise; capacity is released only after its real settlement. */
      const native = Promise.resolve()
        .then(() => doSend(message, name, sendOpts, context))
        .catch((cause) => {
          throw context.submitted
            ? smtpSubmissionFailure(context.intended, cause)
            : cause;
        })
        .finally(async () => {
          await context.attachments?.dispose();
        });
      jobs.add(native);
      void native
        .finally(() => {
          jobs.delete(native);
          contexts.delete(context);
          if (key && pending.get(key)?.task === task) {
            pending.delete(key);
          }
        })
        .catch(() => {});
      /** Caller-facing raced observation; actual native ownership remains in the jobs set. */
      const task = Promise.race([native, stopped])
        .catch((cause) => {
          if (context.known) {
            return { ...context.known, telemetryIncomplete: true };
          }
          if (context.submitted && !(cause instanceof EmailSubmissionError)) {
            throw new EmailSubmissionError(
              'EMAIL_SMTP_UNCERTAIN',
              context.intended,
              cause
            );
          }
          throw cause;
        })
        .finally(() => {
          clearTimeout(timer);
          sendOpts.signal?.removeEventListener('abort', abort);
          controller.signal.removeEventListener('abort', stop);
        });
      if (key) {
        pending.set(key, { task, fingerprint: fingerprint!, context });
        task.catch((error) => {
          if (
            error instanceof EmailSubmissionError &&
            error.code === 'EMAIL_SMTP_UNCERTAIN'
          ) {
            remember(key, fingerprint!, undefined, error);
          }
        });
        native
          .then(
            (result) => remember(key, fingerprint!, result),
            (error) => {
              if (
                error instanceof EmailSubmissionError &&
                error.code === 'EMAIL_SMTP_UNCERTAIN'
              ) {
                remember(key, fingerprint!, undefined, error);
              }
            }
          )
          .catch(() => {});
      }

      return task;
    },
    /** Choose another explicitly configured verified account only before any SMTP send begins.
     * @param {EmailMessage} message - Private host message; no principal/tenant identity is inferred from envelope addresses.
     * @param {readonly string[]} names - One to ten unique configured failover candidates in trusted priority order.
     * @param {EmailSendOptions} sendOpts - Explicit per-send controls; no automatic consent is granted.
     * @returns {Promise<EmailResult>} Exactly one selected submission attempt; never fail over after send failure.
     */
    async sendWithVerifiedFailover(
      message: EmailMessage,
      names: readonly string[],
      sendOpts: EmailSendOptions = {}
    ): Promise<EmailResult> {
      if (closed) {
        throw new Error('Email manager closed');
      }
      if (
        !Array.isArray(names) ||
        names.length < 1 ||
        names.length > 10 ||
        new Set(names).size !== names.length ||
        names.some((name) => typeof name !== 'string' || !accounts.has(name))
      ) {
        throw new TypeError('Invalid SMTP failover accounts');
      }
      if (message.account !== undefined && message.account !== names[0]) {
        throw new TypeError('Failover primary must match selected account');
      }
      /** Minimum caller/manager absolute observation expiration; actual work may outlive it. */
      const deadline = Math.min(
        sendOpts.deadline ?? Infinity,
        Date.now() + (sendOpts.timeoutMs ?? defaultTimeout)
      );
      let selected: string | undefined;
      // Consider only explicit configured candidates before the first actual SMTP send.
      for (const name of names) {
        /** Configured private account resolved before native acquisition. */
        const account = accounts.get(name)!;
        if (account.enabled === false) {
          continue;
        }
        let transport: TransportLike;
        try {
          transport = await transporter(name);
        } catch {
          continue;
        }
        if (typeof transport.verify !== 'function') {
          continue;
        }
        try {
          if (
            (await manager.verify(name, {
              signal: sendOpts.signal,
              timeoutMs: sendOpts.timeoutMs,
              deadline,
            })) === true
          ) {
            selected = name;
            break;
          }
        } catch (error) {
          if (
            Date.now() >= deadline ||
            sendOpts.signal?.aborted ||
            (
              error as {
                /** Fixed package failure code inspected for overload/qualified control only. */
                code?: string;
              }
            ).code === 'EMAIL_SEND_OVERLOAD'
          ) {
            throw error;
          } /* No SMTP send occurred; another verified account is eligible. */
        }
      }
      if (!selected) {
        throw Object.assign(
          new Error('No verified SMTP account available; no message submitted'),
          { code: 'EMAIL_NO_VERIFIED_TRANSPORT' }
        );
      }
      // Once send begins, no automatic retry or failover is safe: SMTP acceptance might be uncertain.
      return manager.send(
        { ...message, account: selected },
        { ...sendOpts, deadline }
      );
    },
    /** Share a total deadline across bounded local workers while preserving every per-message outcome.
 * @param {readonly EmailMessage[]} messages - At most ten thousand private messages; returned results preserve their order.
 * @param {{
        concurrency?: number;
        continueOnError?: boolean;
        signal?: AbortSignal;
        timeoutMs?: number;
        deadline?: number;
      }} settings - Explicit observation/batch settings with bounded cooperative deadline/signal.
 * @param {number} settings.concurrency - Local workers 1–20, default three.
 * @param {boolean} settings.continueOnError - False aggregates failures after all workers settle.
 * @param {AbortSignal} settings.signal - Optional cooperative cancellation forwarded to sends.
 * @param {number} settings.timeoutMs - Total observation interval; defaults to manager policy.
 * @param {number} settings.deadline - Optional absolute epoch-millisecond total deadline.
 * @returns {Promise<({ok: true, result: EmailResult} | {ok: false, error: Error})[]>} Ordered private outcomes; continueOnError false throws only after workers finish.
 */
    async sendBatch(
      messages: readonly EmailMessage[],
      settings: {
        /** Batch workers 1–20, default three; manager admission still applies. */
        concurrency?: number;
        /** False aggregates failures after all workers settle; default returns each outcome. */
        continueOnError?: boolean;
        /** Cooperative observation/cancellation signal; native work retains capacity until settlement. */
        signal?: AbortSignal;
        /** Bounded caller observation interval 1–600000ms; defaults to manager policy. */
        timeoutMs?: number;
        /** Absolute epoch-millisecond observation deadline within the bounded maximum age. */
        deadline?: number;
      } = {}
    ): Promise<
      (
        | {
            /** Explicit per-message batch result discriminator. */
            ok: true;
            /** Known private SMTP result retained without resubmission. */
            result: EmailResult;
          }
        | {
            /** Explicit per-message batch result discriminator. */
            ok: false;
            /** Private uncertain submission error retained to prevent ambiguous replay. */
            error: Error;
          }
      )[]
    > {
      /** Validated batch worker count, default three and maximum twenty. */
      const workers = settings.concurrency ?? 3;
      /** Shared batch observation interval, bounded independently of per-message queue state. */
      const budget = settings.timeoutMs ?? defaultTimeout;
      if (!Number.isSafeInteger(budget) || budget < 1 || budget > 600000) {
        throw new RangeError('Invalid batch deadline');
      }
      /** Minimum caller/manager absolute observation expiration; actual work may outlive it. */
      const deadline = Math.min(
        settings.deadline ?? Infinity,
        Date.now() + budget
      );
      if (
        !Number.isSafeInteger(workers) ||
        workers < 1 ||
        workers > 20 ||
        messages.length > 10000
      ) {
        throw new RangeError('Invalid batch size');
      }
      /** Ordered private batch outcomes; aggregate failure never erases successful sends. */
      const results: Array<
        | {
            /** Explicit per-message batch result discriminator. */
            ok: true;
            /** Known private SMTP result retained without resubmission. */
            result: EmailResult;
          }
        | {
            /** Explicit per-message batch result discriminator. */
            ok: false;
            /** Private uncertain submission error retained to prevent ambiguous replay. */
            error: Error;
          }
      > = new Array(messages.length);
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(workers, messages.length) }, async () => {
          // Claim each ordered result slot synchronously before yielding to one bounded send.
          while (index < messages.length) {
            /** Exclusively claimed synchronous batch index before yielding to the sender. */
            const i = index++;
            try {
              results[i] = {
                ok: true,
                result: await manager.send(messages[i], {
                  signal: settings.signal,
                  deadline,
                }),
              };
            } catch (e) {
              results[i] = {
                ok: false,
                error: e instanceof Error ? e : new Error(String(e)),
              };
            }
          }
        })
      );
      if (settings.continueOnError === false && results.some((r) => !r.ok)) {
        throw new AggregateError(
          results
            .filter((r) => !r.ok)
            .map(
              (r) =>
                (
                  r as {
                    /** Explicit per-message batch result discriminator. */
                    ok: false;
                    /** Private uncertain submission error retained to prevent ambiguous replay. */
                    error: Error;
                  }
                ).error
            ),
          'Email batch delivery failed'
        );
      }
      return results;
    },
    /** Project bounded current lifecycle counters without message/account labels.
     * @returns {{closed: boolean, pending: number, waiters: number, transports: number}} Local operational counts, not durable queue/delivery evidence.
     */
    status() {
      return {
        closed,
        pending: jobs.size + verifications.size,
        waiters,
        transports: created.size,
      };
    },
    /** Stop admission, abort cooperative contexts, drain actual native work and close owned transports.
     * @returns {Promise<void>} Idempotent actual-settlement cleanup; noncooperative host/native work can delay it.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      // Request cancellation without discarding actual send/attachment settlement ownership.
      for (const context of contexts) {
        context.controller.abort();
      }
      // Readiness work also keeps its native slot until actual settlement.
      for (const value of verifications.values()) {
        value.controller.abort();
      }
      closing = (async () => {
        await Promise.allSettled([...jobs, ...verifications.keys()]);
        /** Snapshot of lazy native construction entries for teardown after actual work drain. */
        const entries = [...created.entries()];
        /** Settled native construction outcomes; failed acquisitions own no handle to close. */
        const transports = await Promise.allSettled(entries.map(([, p]) => p));
        /** All settled owned transport-close outcomes; borrowed transports are preserved. */
        const cleanup = await Promise.allSettled(
          transports.map((r, i) =>
            r.status === 'fulfilled'
              ? release(entries[i]![0], r.value)
              : Promise.resolve()
          )
        );
        created.clear();
        pending.clear();
        completed.clear();
        /** Native cleanup failures reported through a fixed public close message with private cause. */
        const failed = cleanup.filter((r) => r.status === 'rejected');
        if (failed.length) {
          throw new Error('Email transport cleanup failed', {
            cause: new AggregateError(
              failed.map((r) => (r as PromiseRejectedResult).reason)
            ),
          });
        }
      })();
      return closing;
    },
  };
  return manager;
}
export type EmailManager = ReturnType<typeof createEmailManager>;
