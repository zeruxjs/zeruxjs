import {
  createDatabaseSenderFeedbackStore,
  createSenderFeedbackService,
  createMarketingFeedbackEndpoint,
  createMarketingSuppressionService,
  createSenderReputationReportEndpoint,
  type CampaignDatabaseConnection,
  type MarketingSuppressionStore,
  type SenderFeedbackInput,
  type VerifiedEmailNotification,
} from '@zeruxjs/email';

/** Explicit host policies for one verified sender-feedback scope. */
export interface SenderVisibilityOptions {
  /** Borrowed durable database with unique inserts and committed reads. */
  db: CampaignDatabaseConnection;
  /** Shared legacy suppression store, separate from optional analytics. */
  suppressionStore: MarketingSuppressionStore;
  /** Server-verified tenant identity; never copy a browser role/tenant claim. */
  tenant: string;
  /** Server-verified site within the tenant. */
  site: string;
  /** Configured sending account reference, without SMTP credentials. */
  account: string;
  /** Explicit provider reference bound to verified notifications. */
  provider: string;
  /** Stable private 32-byte HMAC lookup key shared by authorized workers. */
  lookupKey: Uint8Array;
  /** Verify actual raw-body signature and signed timestamp under host key policy. */
  verifySignature: (raw: Uint8Array, headers: Headers) => Promise<boolean>;
  /** Return the authenticated timestamp in milliseconds; unsigned headers fail policy. */
  signedTimestamp: (headers: Headers) => number;
  /** Parse only the explicitly selected provider format after signature verification. */
  parse: (
    raw: Uint8Array,
    headers: Headers
  ) => Promise<VerifiedEmailNotification[]>;
  /** Map verified notification facts into this exact tenant/site/account/provider scope. */
  normalize: (event: VerifiedEmailNotification) => SenderFeedbackInput;
  /** Reauthorize report access for this scope; only literal true permits access. */
  authorizeReport: (request: Request) => Promise<boolean>;
}

/**
 * Bind authenticated feedback and reporting without owning a listener or database.
 *
 * @param {SenderVisibilityOptions} options - Explicit durable stores and verified host policies.
 * @returns {object} Host-registerable routes plus suppression/acceptance callbacks; keys and database lifetime remain host-owned.
 */
export function senderVisibility(options: SenderVisibilityOptions) {
  /** Scoped durable ledger; pseudonymous lookup hashes are not anonymization. */
  const sender = createSenderFeedbackService({
    ...options,
    store: createDatabaseSenderFeedbackStore(options.db),
  });
  /** Legacy shared suppression remains independent from optional analytics storage. */
  const suppression = createMarketingSuppressionService({
    store: options.suppressionStore,
  });
  /** Authenticated bounded ingestion; a five-minute window requires a signed timestamp. */
  const feedback = createMarketingFeedbackEndpoint({
    suppression,
    verifySignature: options.verifySignature,
    parse: options.parse,
    signatureTime: options.signedTimestamp,
    maxSignatureAgeMs: 300000,
    correlatedFeedback: { service: sender, normalize: options.normalize },
  });
  /** Private report endpoint resolves only this scope after fresh host authorization. */
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
