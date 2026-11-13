import { createHash } from 'node:crypto';
import type { InboundMessage } from './inbound.js';

export interface IncomingDeliveryNotice {
  /** Stable SHA-256 notice correlation; not proof of authorship or anonymization. */
  id: string;
  /** Private locally recorded source-message reference. */
  inboundMessageId: string;
  /** Private parsed mailbox claim that requires independent correlation and authorization. */
  recipient: string;
  /** Conservative hard/soft-bounce or complaint candidate. */
  kind: 'hard-bounce' | 'soft-bounce' | 'complaint';
  /** Only a hint extracted from an untrusted inbound email, not a verified provider notification. */
  verified: false;
}
/** Extract only a bounded unverified DSN/ARF text candidate; inbound content cannot authenticate its own provider claims.
 * @param {InboundMessage} message - Bounded untrusted parsed inbound data; headers/text are evidence candidates, never instructions.
 * @returns {IncomingDeliveryNotice | null} Unverified candidate or null; never automatically apply suppression from this result.
 */
export function classifyIncomingDeliveryNotice(
  message: InboundMessage
): IncomingDeliveryNotice | null {
  if (
    !message ||
    typeof message.text !== 'string' ||
    !message.text ||
    message.text.length > 24_000
  ) {
    return null;
  }
  /** Untrusted bounded message text inspected as data, never evaluated. */
  const text = message.text;
  /** Conservative unverified recipient/notice candidate; syntax is never provider authentication. */
  const candidate = /^Final-Recipient:\s*rfc822\s*;\s*([^\s;]+)\s*$/im.exec(
    text
  );
  if (!candidate) {
    return null;
  }
  /** Bounded literal mailbox claim normalized for exact downstream verification. */
  const rawRecipient = candidate[1];
  if (!rawRecipient) {
    return null;
  }
  /** Normalized recipient address used for feedback correlation. */
  const recipient = rawRecipient.toLowerCase();
  if (
    recipient.length > 320 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)
  ) {
    return null;
  }
  /** Parsed limited enhanced-status class; absence prevents an inferred bounce. */
  const code = /^Status:\s*([245])\.\d{1,3}\.\d{1,3}\s*$/im.exec(text)?.[1];
  /** Parsed failed/delayed action matched conservatively with the status class. */
  const action = /^Action:\s*(failed|delayed)\s*$/im
    .exec(text)?.[1]
    ?.toLowerCase();
  /** Literal abuse-feedback marker; remains untrusted until independent verification. */
  const reportType = /^Feedback-Type:\s*abuse\s*$/im.test(text);
  /** Conservative candidate type; unknown or inconsistent evidence returns null. */
  const kind = (() => {
    if (reportType) {
      return 'complaint';
    }
    if (code === '5' && action === 'failed') {
      return 'hard-bounce';
    }
    if (code === '4' && action === 'delayed') {
      return 'soft-bounce';
    }
    return null;
  })();
  if (!kind) {
    return null;
  }
  return {
    id: createHash('sha256')
      .update(message.id + '\0' + recipient + '\0' + kind)
      .digest('hex'),
    inboundMessageId: message.id,
    recipient,
    kind,
    verified: false,
  };
}
/** Require literal host trust verification before forwarding a classified notice to the explicit ledger callback.
 * @param {{
  verify: (
    message: InboundMessage,
    notice: IncomingDeliveryNotice
  ) => boolean | Promise<boolean>;
  record: (
    notice: Omit<IncomingDeliveryNotice, 'verified'> & { verified: true }
  ) => Promise<unknown>;
}} options - Explicit host authentication and committed record callbacks; neither is discovered from message content.
 * @param {(message: InboundMessage, notice: IncomingDeliveryNotice) => boolean | Promise<boolean>} options.verify - Independently authenticate sender/provider/account and notice correlation; literal true required.
 * @param {(notice: Omit<IncomingDeliveryNotice, "verified"> & {verified: true}) => Promise<unknown>} options.record - Commit the verified notice under host-owned durable deduplication.
 * @returns {(message: InboundMessage) => Promise<{classified: boolean, recorded: boolean}>} Processor with no listeners/network acquisition; verification and durable deduplication remain host-owned.
 */
export function createTrustedInboundFeedbackProcessor(options: {
  /** Host must authenticate actual sender/provider/account evidence; literal true required. */
  verify: (
    message: InboundMessage,
    notice: IncomingDeliveryNotice
  ) => boolean | Promise<boolean>;
  /** Explicit committed ledger callback for independently verified notices; host owns deduplication. */
  record: (
    notice: Omit<IncomingDeliveryNotice, 'verified'> & { verified: true }
  ) => Promise<unknown>;
}) {
  if (
    !options ||
    typeof options.verify !== 'function' ||
    typeof options.record !== 'function'
  ) {
    throw new TypeError('Feedback verifier and ledger required');
  }
  return async (message: InboundMessage) => {
    /** Conservative unverified recipient/notice candidate; syntax is never provider authentication. */
    const candidate = classifyIncomingDeliveryNotice(message);
    if (!candidate) {
      return { classified: false, recorded: false };
    }
    if ((await options.verify(message, candidate)) !== true) {
      return { classified: true, recorded: false };
    }
    await options.record({ ...candidate, verified: true });
    return { classified: true, recorded: true };
  };
}
