import {
  createEmailManager, describeSmtpRecipients,
  type EmailMessage, type TransportLike,
} from '@zeruxjs/email';

// The host owns identity/tenant checks and the transport lifetime.
export function createMailer(
  transport: TransportLike,
  authorize: (message: Readonly<EmailMessage>) => Promise<boolean>,
) {
  const manager = createEmailManager({
    accounts: [{name: 'receipts', transport, ownTransport: false,
      defaults: {from: 'Receipts <receipts@example.com>'}}],
    authorize, maxConcurrentSends: 4, sendTimeoutMs: 15000,
  });
  return {
    async receipt(to: string, signal: AbortSignal) {
      const result = await manager.send({to, subject: 'Receipt',
        text: 'Your receipt is ready.', purpose: 'transactional'}, {signal});
      // Counters omit recipients, raw SMTP responses and message contents.
      return {submissionStatus: result.submissionStatus,
        counts: describeSmtpRecipients(result.recipientOutcomes ?? [])};
    },
    close: () => manager.close(),
  };
}
