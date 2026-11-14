import type {
  EmailAddress,
  EmailRecipients,
  SmtpSettings,
  EmailMessage,
} from './types.js';

/** Header-boundary controls rejected in addresses, display names and envelope headers. */
const badLine = /[\r\n\0]/;

/** Bounded literal mailbox heuristic; not proof of deliverability or mailbox ownership. */
const emailPattern =
  // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
  /^[^\s@<>\u0000-\u001f\u007f]+@[^\s@<>\u0000-\u001f\u007f]+\.[^\s@<>\u0000-\u001f\u007f]+$/;
/** Validate a literal address/display name without rewriting the caller-owned representation.
 * @param {EmailAddress} input - Candidate address or optional single/list recipients; nothing is sent.
 * @returns {EmailAddress} Original address after bounded shape/header-injection checks.
 */
export function validateEmailAddress(input: EmailAddress): EmailAddress {
  /** Literal candidate mailbox before header-injection/length validation. */
  const address = typeof input === 'string' ? input : input?.address;
  if (
    typeof address !== 'string' ||
    address.length > 320 ||
    !emailPattern.test(address) ||
    badLine.test(address)
  ) {
    throw new TypeError('Invalid email address');
  }
  if (
    typeof input !== 'string' &&
    typeof input.name !== 'undefined' &&
    (typeof input.name !== 'string' ||
      input.name.length > 200 ||
      badLine.test(input.name))
  ) {
    throw new TypeError('Invalid display name');
  }
  return input;
}
/** Normalize optional single/list recipient inputs and validate every address.
 * @param {EmailRecipients} input - Candidate address or optional single/list recipients; nothing is sent.
 * @returns {EmailAddress[]} New outer list; structured address values remain caller-owned.
 */
export function recipientList(input?: EmailRecipients): EmailAddress[] {
  if (input === undefined) {
    return [];
  }
  /** Normalized outer recipient list; each element is validated without mutating its representation. */
  const list = Array.isArray(input) ? input : ([input] as EmailAddress[]);
  return list.map(validateEmailAddress);
}
/** Read the literal mailbox from an already validated address.
 * @param {EmailAddress} input - Candidate address or optional single/list recipients; nothing is sent.
 * @returns {string} Mailbox only; this helper performs no authorization or normalization.
 */
export function addressString(input: EmailAddress): string {
  return typeof input === 'string' ? input : input.address;
}
/** Validate the configured SMTP endpoint, encrypted-transport policy and bounded native options.
 * @param {SmtpSettings} smtp - Trusted server configuration; secrets must never enter a browser payload.
 * @returns {void} Invalid TLS/auth/pool/timeout settings reject before transport creation.
 */
export function validateSmtp(smtp: SmtpSettings) {
  if (
    typeof smtp.host !== 'string' ||
    smtp.host.length > 253 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(smtp.host)
  ) {
    throw new TypeError('Invalid SMTP hostname');
  }
  if (!Number.isSafeInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) {
    throw new RangeError('Invalid SMTP port');
  }
  if (smtp.ignoreTLS === true) {
    throw new TypeError('Ignoring TLS is unsafe for outbound SMTP');
  }
  if (smtp.port === 465 && smtp.secure === false) {
    throw new TypeError('SMTP port 465 requires implicit TLS');
  }
  if (smtp.secure !== true && smtp.port !== 465 && smtp.requireTLS === false) {
    throw new TypeError('Disabling required STARTTLS is unsafe');
  }
  if (
    smtp.tls?.minVersion !== undefined &&
    !['TLSv1.2', 'TLSv1.3'].includes(smtp.tls.minVersion)
  ) {
    throw new TypeError('Invalid SMTP minimum TLS version');
  }
  if (smtp.auth) {
    /** Private SMTP authentication settings, never public account inventory. */
    const a = smtp.auth;
    if (!a.user || badLine.test(a.user)) {
      throw new TypeError('Invalid SMTP user');
    }
    if (a.type === 'password') {
      if (!a.pass) {
        throw new TypeError('Missing SMTP password');
      }
    } else if (a.type === 'oauth2') {
      if (!a.accessToken && !a.refreshToken && !a.privateKey) {
        throw new TypeError('Missing OAuth2 token source');
      }
    } else {
      throw new TypeError('Unsupported SMTP auth');
    }
  }
  // Validate every native timeout before any SMTP connection is created.
  for (const timeout of [
    smtp.connectionTimeout,
    smtp.greetingTimeout,
    smtp.socketTimeout,
  ]) {
    if (
      timeout !== undefined &&
      (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 3_600_000)
    ) {
      throw new RangeError('Invalid SMTP timeout');
    }
  }
  if (smtp.dkim) {
    if (
      !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(smtp.dkim.domainName) ||
      !/^[a-z0-9_-]{1,63}$/i.test(smtp.dkim.keySelector) ||
      typeof smtp.dkim.privateKey !== 'string' ||
      smtp.dkim.privateKey.length < 40
    ) {
      throw new TypeError('Invalid DKIM signing configuration');
    }
  }
  if (
    smtp.maxConnections !== undefined &&
    (!Number.isSafeInteger(smtp.maxConnections) ||
      smtp.maxConnections < 1 ||
      smtp.maxConnections > 100)
  ) {
    throw new RangeError('Invalid SMTP pool size');
  }
  if (smtp.tls?.rejectUnauthorized === false) {
    throw new TypeError('Disabling SMTP certificate verification is unsafe');
  }
}
/** Validate recipient counts, subject/header boundaries and required body/template presence.
 * @param {EmailMessage} message - Host-supplied message before send; validation is not tenant authorization.
 * @param {number} maxRecipients - Explicit aggregate To/Cc/Bcc ceiling, default 100.
 * @returns {{to: EmailAddress[], cc: EmailAddress[], bcc: EmailAddress[]}} Validated envelope lists; attachment preparation and consent remain separate.
 */
export function validateMessage(message: EmailMessage, maxRecipients = 100) {
  /** Validated primary recipients used for the aggregate envelope ceiling. */
  const to = recipientList(message.to);
  /** Validated copied recipients; counted with To and Bcc. */
  const cc = recipientList(message.cc);
  /** Validated private copied recipients; never allowed through a caller header override. */
  const bcc = recipientList(message.bcc);
  if (!to.length) {
    throw new TypeError('At least one To recipient required');
  }
  if (to.length + cc.length + bcc.length > maxRecipients) {
    throw new RangeError('Too many recipients');
  }
  if (message.from) {
    validateEmailAddress(message.from);
  }
  if (message.replyTo) {
    recipientList(message.replyTo);
  }
  if (
    typeof message.subject !== 'string' ||
    message.subject.length > 998 ||
    badLine.test(message.subject)
  ) {
    throw new TypeError('Invalid message subject');
  }
  if (!message.html && !message.text && !message.template) {
    throw new TypeError('Email body or template required');
  }
  if (message.headers) {
    // Reject injected/protected envelope headers before preparing transport data.
    for (const [key, value] of Object.entries(message.headers)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9-]{0,99}$/.test(key) ||
        typeof value !== 'string' ||
        badLine.test(value)
      ) {
        throw new TypeError('Invalid message headers');
      }
      if (
        /^(bcc|cc|to|from|content-type|content-transfer-encoding|dkim-signature)$/i.test(
          key
        )
      ) {
        throw new TypeError('Protected email header');
      }
    }
  }
  if (
    message.idempotencyKey !== undefined &&
    (typeof message.idempotencyKey !== 'string' ||
      !/^[a-zA-Z0-9_:.@-]{1,150}$/.test(message.idempotencyKey))
  ) {
    throw new TypeError('Invalid idempotency key');
  }
  if (message.attachments && message.attachments.length > 40) {
    throw new RangeError('Too many attachments');
  }
  return { to, cc, bcc };
}
