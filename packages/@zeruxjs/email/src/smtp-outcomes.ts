import { addressString, validateEmailAddress } from './validation.js';
import type { EmailAddress } from './types.js';

/** SMTP server acceptance is not evidence of provider delivery or inbox placement. */
export type SmtpAcceptanceStatus =
  | 'accepted'
  | 'partial'
  | 'rejected'
  | 'unknown';
export interface SmtpAcceptance {
  /** SMTP envelope status only; never evidence of delivery/inbox placement. */
  status: SmtpAcceptanceStatus;
  /** Validated private intended mailboxes reported accepted. */
  accepted: string[];
  /** Validated private intended mailboxes reported rejected. */
  rejected: string[];
  /** True only if the provider's returned envelope accounts for every intended recipient. */
  complete: boolean;
  /** No addresses or transport responses appear in diagnostic reason codes. */
  warning?:
    | 'unreported-recipients'
    | 'unrecognized-recipient'
    | 'conflicting-recipient'
    | 'unreported-outcome';
}
/** Validate provider-reported mailbox identity; malformed values do not become accepted recipients.
 * @param {unknown} value - Provider candidate mailbox or already classified private acceptance result.
 * @returns {string | null} Lowercase validated mailbox, or null for invalid/unreadable input.
 */
function normalized(value: unknown): string | null {
  try {
    /** Literal provider-reported identity selected without treating arbitrary values as mailboxes. */
    const address = (() => {
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'object' && value !== null && 'address' in value) {
        return (value as { address: unknown }).address;
      }
      return null;
    })();
    if (typeof address !== 'string') {
      return null;
    }
    return addressString(validateEmailAddress(address)).toLowerCase();
  } catch {
    return null;
  }
}
/** Account only for intended validated envelope recipients; missing/conflicting reports remain unknown.
 * @param {readonly EmailAddress[]} intended - One to one thousand intended validated recipients, deduplicated canonically.
 * @param {{ accepted?: unknown[]; rejected?: unknown[] }} result - Provider envelope lists/error details; missing or conflicting identity stays uncertain.
 * @param {unknown[]} result.accepted - Optional provider-reported accepted identities, bounded during classification.
 * @param {unknown[]} result.rejected - Optional provider-reported rejected identities, bounded during classification.
 * @returns {SmtpAcceptance} Private recipient sets and bounded address-free warning codes.
 */
export function classifySmtpAcceptance(
  intended: readonly EmailAddress[],
  result: {
    /** Validated private intended mailboxes reported accepted. */
    accepted?: unknown[]; /** Validated private intended mailboxes reported rejected. */
    rejected?: unknown[];
  }
): SmtpAcceptance {
  if (!Array.isArray(intended) || !intended.length || intended.length > 1000) {
    throw new RangeError('Invalid SMTP recipient count');
  }
  /** Canonical intended envelope identities; unrecognized provider recipients cannot expand this scope. */
  const requested = new Set(
    intended.map((value) =>
      addressString(validateEmailAddress(value)).toLowerCase()
    )
  );
  /** Private canonical identities explicitly accepted by this one SMTP submission. */
  const accepted = new Set<string>();
  /** Private canonical identities explicitly rejected by this one SMTP submission. */
  const rejected = new Set<string>();
  let invalid = false;
  // Inspect both bounded lists without admitting identities absent from the intended envelope.
  for (const [kind, items] of [
    ['accepted', result.accepted],
    ['rejected', result.rejected],
  ] as const) {
    if (items === undefined) {
      continue;
    }
    if (!Array.isArray(items)) {
      invalid = true;
      continue;
    }
    if (items.length > 1000) {
      invalid = true;
    }
    // Cap provider processing even when a malformed native result exceeds its declared budget.
    for (const item of items.slice(0, 1000)) {
      /** Validated provider mailbox, checked against the original intended set. */
      const key = normalized(item);
      if (!key || !requested.has(key)) {
        invalid = true;
        continue;
      }
      (kind === 'accepted' ? accepted : rejected).add(key);
    }
  }
  /** True when one identity appears in both provider outcome lists. */
  const conflict = [...accepted].some((key) => rejected.has(key));
  /** Every intended identity must have one unambiguous reported disposition. */
  const complete =
    !invalid &&
    !conflict &&
    [...requested].every((key) => accepted.has(key) || rejected.has(key));
  /** Address-free diagnostic code; does not serialize provider response text. */
  const warning: SmtpAcceptance['warning'] = (() => {
    if (conflict) {
      return 'conflicting-recipient';
    }
    if (invalid) {
      return 'unrecognized-recipient';
    }
    if (!accepted.size && !rejected.size) {
      return 'unreported-outcome';
    }
    if (!complete) {
      return 'unreported-recipients';
    }
    return undefined;
  })();
  // Provider lists may not be complete; never guess at acceptance of an unlisted recipient.
  /** Explicit envelope disposition; missing/conflicting evidence never becomes delivery success. */
  const status: SmtpAcceptanceStatus = (() => {
    if (!accepted.size && !rejected.size) {
      return 'unknown';
    }
    if (!complete) {
      return 'unknown';
    }
    if (accepted.size === requested.size) {
      return 'accepted';
    }
    if (accepted.size) {
      return 'partial';
    }
    return 'rejected';
  })();
  return {
    status,
    accepted: [...accepted],
    rejected: [...rejected],
    complete,
    warning,
  };
}

/** Project SMTP acceptance into address-free operational counters.
 * @param {SmtpAcceptance} value - Provider candidate mailbox or already classified private acceptance result.
 * @returns {{status: SmtpAcceptanceStatus, acceptedCount: number, rejectedCount: number, complete: boolean, warning: SmtpAcceptance["warning"]}} Safe counters/codes, never message bodies or transport responses.
 */
export function describeSmtpOutcome(value: SmtpAcceptance) {
  return {
    status: value.status,
    acceptedCount: value.accepted.length,
    rejectedCount: value.rejected.length,
    complete: value.complete,
    warning: value.warning,
  };
}

export interface SmtpRecipientOutcome {
  /** Private canonical mailbox; exclude from public telemetry. */
  recipient: string;
  /** SMTP envelope status only; never evidence of delivery/inbox placement. */
  status: 'accepted' | 'rejected' | 'transient' | 'permanent' | 'uncertain';
  /** True only with qualified safe-retry evidence; uncertain work never auto-replays. */
  retryable: boolean;
  /** Optional integer SMTP failure code in the validated 400–599 range. */
  responseCode?: number;
}
/** Accept only integer negative SMTP reply codes from the bounded 400–599 range.
 * @param {unknown} value - Private native candidate response code.
 * @returns {number | undefined} Validated failure code, or undefined. */
const responseCode = (value: unknown) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 400 &&
  value <= 599
    ? value
    : undefined;
/** Classify each intended recipient without automatically replaying accepted or uncertain work.
 * @param {readonly EmailAddress[]} intended - One to one thousand intended validated recipients, deduplicated canonically.
 * @param {{
    accepted?: unknown[];
    rejected?: unknown[];
    rejectedErrors?: unknown[];
  }} result - Provider envelope lists/error details; missing or conflicting identity stays uncertain.
 * @param {unknown[]} result.accepted - Optional provider-reported accepted identities.
 * @param {unknown[]} result.rejected - Optional provider-reported rejected identities.
 * @param {unknown[]} result.rejectedErrors - Optional bounded per-recipient native failure details, kept private.
 * @returns {SmtpRecipientOutcome[]} Private mailbox outcomes; SMTP acceptance is not inbox delivery.
 */
export function classifySmtpRecipients(
  intended: readonly EmailAddress[],
  result: {
    /** Validated private intended mailboxes reported accepted. */
    accepted?: unknown[];
    /** Validated private intended mailboxes reported rejected. */
    rejected?: unknown[];
    rejectedErrors?: unknown[];
  }
): SmtpRecipientOutcome[] {
  /** Validated envelope classification reused for per-recipient outcomes. */
  const aggregate = classifySmtpAcceptance(intended, result);
  /** Private canonical identities explicitly accepted by this one SMTP submission. */
  const accepted = new Set(aggregate.accepted);
  /** Private canonical identities explicitly rejected by this one SMTP submission. */
  const rejected = new Set(aggregate.rejected);
  /** Bounded mailbox-to-response mapping from provider rejection details. */
  const errors = new Map<string, number>();
  if (Array.isArray(result.rejectedErrors)) {
    // Keep only bounded valid mailbox/code pairs; raw transport errors stay private.
    for (const raw of result.rejectedErrors.slice(0, 1000)) {
      /** Private native error shape inspected without serializing its fields. */
      const e = raw as {
        /** Private canonical mailbox; exclude from public telemetry. */
        recipient?: unknown; /** Optional integer SMTP failure code in the validated 400–599 range. */
        responseCode?: unknown;
      };
      /** Validated private rejection mailbox; never an operational label. */
      const recipient = normalized(e?.recipient);
      /** Validated negative SMTP code; absence must not imply safe retry. */
      const code = responseCode(e?.responseCode);
      if (recipient && code) {
        errors.set(recipient, code);
      }
    }
  }
  return [
    ...new Set(
      intended.map((value) =>
        addressString(validateEmailAddress(value)).toLowerCase()
      )
    ),
  ].map((recipient) => {
    if (accepted.has(recipient) && !rejected.has(recipient)) {
      return { recipient, status: 'accepted', retryable: false };
    }
    if (rejected.has(recipient) && !accepted.has(recipient)) {
      /** Validated negative SMTP code; absence must not imply safe retry. */
      const code = errors.get(recipient);
      return {
        recipient,
        status: (() => {
          if (code) {
            if (code < 500) {
              return 'transient';
            }
            return 'permanent';
          }
          return 'rejected';
        })(),
        retryable: code !== undefined && code < 500,
        ...(code ? { responseCode: code } : {}),
      };
    }
    return { recipient, status: 'uncertain', retryable: false };
  });
}
/** Permit only explicit transient replies or recognized pre-DATA connection failures.
 * @param {unknown} error - Private native/wrapped error inspected only for qualified retry evidence.
 * @returns {boolean} Whether caller policy may retry; ambiguous submission remains false.
 */
export function isRetryableSmtpError(error: unknown): boolean {
  if (error instanceof EmailSubmissionError) {
    return error.code !== 'EMAIL_SMTP_UNCERTAIN' && error.safeRetry;
  }
  /** Private native error shape inspected without serializing its fields. */
  const e = error as {
    code?: unknown;
    command?: unknown;
    /** Optional integer SMTP failure code in the validated 400–599 range. */
    responseCode?: unknown;
  };
  /** Validated negative SMTP code; absence must not imply safe retry. */
  const code = responseCode(e?.responseCode);
  if (code !== undefined) {
    return code < 500;
  }
  return (
    [
      'CONN',
      'CONNECT',
      'EHLO',
      'HELO',
      'STARTTLS',
      'AUTH',
      'MAIL FROM',
      'RCPT TO',
    ].includes(String(e?.command ?? '').toUpperCase()) &&
    [
      'ECONNECTION',
      'ETIMEDOUT',
      'ESOCKET',
      'ECONNRESET',
      'EAI_AGAIN',
      'ECONNREFUSED',
    ].includes(String(e?.code ?? ''))
  );
}
/** Explicit submission failure with a fixed public message and non-enumerable private cause/outcomes. */
export class EmailSubmissionError extends Error {
  /** Frozen private mailbox outcomes; deliberately non-enumerable on this error. */
  readonly outcomes!: readonly SmtpRecipientOutcome[];
  /** Retain transport cause and frozen recipient outcomes as non-enumerable trusted internal detail.
   * @param {string} code - Fixed package failure code; not provider response text.
   * @param {readonly EmailAddress[]} intended - One to one thousand intended validated recipients, deduplicated canonically.
   * @param {unknown} cause - Private underlying failure retained non-enumerably.
   * @param {boolean} safeRetry - Explicit safe-retry evidence; default false.
   * @param {number} responseCode - Optional validated negative SMTP response code.
   */
  constructor(
    readonly code: string,
    intended: readonly EmailAddress[],
    cause: unknown,
    readonly safeRetry = false,
    readonly responseCode?: number
  ) {
    super(`Email submission failed (${code})`);
    this.name = 'EmailSubmissionError';
    Object.defineProperty(this, 'cause', { value: cause });
    /** Explicit envelope disposition; missing/conflicting evidence never becomes delivery success. */
    const status = (() => {
      if (code === 'EMAIL_SMTP_UNCERTAIN') {
        return 'uncertain';
      }
      if (responseCode) {
        if (responseCode < 500) {
          return 'transient';
        }
        return 'permanent';
      }
      if (safeRetry) {
        return 'transient';
      }
      return 'rejected';
    })();
    Object.defineProperty(this, 'outcomes', {
      enumerable: false,
      writable: false,
      configurable: false,
      value: Object.freeze(
        [
          ...new Set(
            intended.map((v) =>
              addressString(validateEmailAddress(v)).toLowerCase()
            )
          ),
        ].map((recipient) =>
          Object.freeze({
            recipient,
            status,
            retryable: safeRetry,
            ...(responseCode ? { responseCode } : {}),
          })
        )
      ),
    });
  }
}
/** Count only known disposition labels without serializing recipient identity.
 * @param {readonly SmtpRecipientOutcome[]} outcomes - Private per-recipient outcomes; only status counters leave this helper.
 * @returns {Record<"accepted" | "rejected" | "transient" | "permanent" | "uncertain", number>} Address-free status counters.
 */
export function describeSmtpRecipients(
  outcomes: readonly SmtpRecipientOutcome[]
) {
  /** Fixed address-free outcome counters; unknown properties are ignored. */
  const counts = {
    accepted: 0,
    rejected: 0,
    transient: 0,
    permanent: 0,
    uncertain: 0,
  };
  // Count known labels only; never project private recipient values.
  for (const item of outcomes) {
    if (Object.hasOwn(counts, item.status)) {
      counts[item.status]++;
    }
  }
  return counts;
}
/** Wrap native SMTP failure without exposing its private transport message/cause.
 * @param {readonly EmailAddress[]} intended - One to one thousand intended validated recipients, deduplicated canonically.
 * @param {unknown} cause - Private underlying failure retained non-enumerably.
 * @returns {EmailSubmissionError} Explicit rejected/not-sent/uncertain submission outcome; no automatic retry.
 */
export function smtpSubmissionFailure(
  intended: readonly EmailAddress[],
  cause: unknown
): EmailSubmissionError {
  /** Private native error shape inspected without serializing its fields. */
  const e = cause as {
    /** Optional integer SMTP failure code in the validated 400–599 range. */
    responseCode?: unknown;
  };
  /** Validated negative SMTP code; absence must not imply safe retry. */
  const code = responseCode(e?.responseCode);
  /** Qualified transient/pre-DATA retry evidence; uncertain submission stays false. */
  const safeRetry = isRetryableSmtpError(cause);
  return new EmailSubmissionError(
    (() => {
      if (code) {
        return 'EMAIL_SMTP_REJECTED';
      }
      if (safeRetry) {
        return 'EMAIL_SMTP_NOT_SENT';
      }
      return 'EMAIL_SMTP_UNCERTAIN';
    })(),
    intended,
    cause,
    safeRetry,
    code
  );
}
