import {
  createDatabaseSenderFeedbackStore, createSenderFeedbackService,
  createMarketingFeedbackEndpoint, createMarketingSuppressionService,
  createSenderReputationReportEndpoint,
  type CampaignDatabaseConnection, type MarketingSuppressionStore,
  type SenderFeedbackInput, type VerifiedEmailNotification,
} from '@zeruxjs/email';

// Create one instance for a verified tenant/site/account/provider binding.
export function senderVisibility(options: {
  db: CampaignDatabaseConnection; suppressionStore: MarketingSuppressionStore;
  tenant: string; site: string; account: string; provider: string; lookupKey: Uint8Array;
  verifySignature: (raw: Uint8Array, headers: Headers) => Promise<boolean>;
  signedTimestamp: (headers: Headers) => number;
  parse: (raw: Uint8Array, headers: Headers) => Promise<VerifiedEmailNotification[]>;
  normalize: (event: VerifiedEmailNotification) => SenderFeedbackInput;
  authorizeReport: (request: Request) => Promise<boolean>;
}) {
  const sender = createSenderFeedbackService({...options,
    store: createDatabaseSenderFeedbackStore(options.db)});
  const suppression = createMarketingSuppressionService({store: options.suppressionStore});
  const feedback = createMarketingFeedbackEndpoint({
    suppression, verifySignature: options.verifySignature, parse: options.parse,
    signatureTime: options.signedTimestamp, maxSignatureAgeMs: 300000,
    correlatedFeedback: {service: sender, normalize: options.normalize},
  });
  const reporting = createSenderReputationReportEndpoint({
    authorize: options.authorizeReport, // must enforce this binding's tenant/site
    resolveService: () => sender,
  });
  return {
    routes: [...feedback.routes(), ...reporting.routes()],
    // Use in BOTH planner admission and EmailManager marketingSuppression.
    isSuppressed: sender.isSuppressed,
    // Wire to manager reputation.recordAccepted alongside the host admission policy.
    recordAccepted: sender.recordAccepted,
  };
}
// Authorized GET /_email/sender-report?from=<UTC epoch ms>&until=<exclusive UTC epoch ms>
// returns {report,charts}. A browser can mount each chart through
// @zeruxjs/reports/view, keeping its table alternative; destroy views on unmount.
// DB handles, signature credentials, lookup-key lifecycle and migrations stay host-owned.
