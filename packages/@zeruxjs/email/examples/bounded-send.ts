import {
  createEmailManager,
  describeSmtpRecipients,
  type EmailMessage,
  type TransportLike,
} from '@zeruxjs/email';

// The host owns identity/tenant checks and the transport lifetime.
/** Create a bounded transactional mailer around a borrowed host transport and fresh authorization callback.
 * @param {TransportLike} transport - Trusted host-owned transport; this adapter never closes it.
 * @param {(message: Readonly<EmailMessage>) => Promise<boolean>} authorize - Host reauthorization for the initiating tenant/recipient; literal true is required.
 * @returns {object} Mailer exposing receipt and close; close drains its manager while preserving the borrowed transport.
 */
export function createMailer(
  transport: TransportLike,
  authorize: (message: Readonly<EmailMessage>) => Promise<boolean>
) {
  /** Generation-owned bounded sender; the injected native transport remains borrowed. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'receipts',
        transport,
        ownTransport: false,
        defaults: {
          from: { name: 'Receipts', address: 'receipts@example.com' },
        },
      },
    ],
    authorize,
    maxConcurrentSends: 4,
    sendTimeoutMs: 15000,
  });
  return {
    /** Submit one authorized transactional receipt and return address-free SMTP counters.
     * @param {string} to - Private validated recipient; not proof of tenant identity.
     * @param {AbortSignal} signal - Cooperative caller cancellation; ambiguous acceptance never auto-retries.
     * @returns {Promise<object>} Envelope status/counters; not proof of inbox delivery.
     */
    async receipt(to: string, signal: AbortSignal) {
      /** Private SMTP outcome projected into address-free counters before returning to the host. */
      const result = await manager.send(
        {
          to,
          subject: 'Receipt',
          text: 'Your receipt is ready.',
          purpose: 'transactional',
        },
        { signal }
      );
      // Counters omit recipients, raw SMTP responses and message contents.
      return {
        submissionStatus: result.submissionStatus,
        counts: describeSmtpRecipients(result.recipientOutcomes ?? []),
      };
    },
    close: () => manager.close(),
  };
}
