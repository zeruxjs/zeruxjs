import type { AuthAccount } from './shared-auth.js';

/** Trusted server-side verification result, never a client bearer token or authorization grant. */
export interface ExternalStepUpIdentity extends AuthAccount {
  /** Verified protocol issuer; never caller-asserted. */
  issuer: string;
  /** Verified stable external subject, not an email auto-link key. */
  subject: string;
  /** Server verification time in UTC milliseconds. */
  verifiedAt: number;
  /** Actual verified step-up protocol kind. */
  method: 'client-certificate' | 'enterprise-sso';
}
/** Adapter receives host-owned TLS context. Implementations must verify the peer certificate against
 * configured trust roots (and a peer certificate must actually exist), then map a stable certificate
 * identity to the tenant/account. A header, request JSON or a client-supplied authorized flag is not TLS proof.
 * Proxy adapters require an explicitly mutually authenticated gateway plus authenticated, replay-bound
 * certificate assertions tied to this request; never accept an arbitrary forwarded certificate header.
 * The host must reject unverified/reused TLS sessions without certificate identity. */
export interface ClientCertificateIdentityAdapter<TrustedTlsContext> {
  /** Declared adapter kind; this label alone does not implement verification. */
  readonly kind: 'client-certificate';
  /** Verify actual protocol evidence using host-owned trust, replay and cancellation policy. Client JSON or forwarded labels are never verified proof.
   * @param {TrustedTlsContext} context - Trusted TLS evidence owned by the server, not an arbitrary header.
   * @param {{ signal: AbortSignal; deadline: number }} options - Explicit cooperative signal and absolute deadline.
   * @returns {Promise<ExternalStepUpIdentity|null>} Verified server result or denial; not a bearer token or automatic permission grant.
   */
  verify(
    context: TrustedTlsContext,
    options: { signal: AbortSignal; deadline: number }
  ): Promise<ExternalStepUpIdentity | null>;
  /** Optionally release adapter-owned verification resources after pending work settles.
   * @returns {void|Promise<void>} Host controls adapter ownership; no implementation is installed by this contract.
   */
  close?(): void | Promise<void>;
}
/** Separate SSO verifier contract: host configures issuer/audience, signed assertion verification,
 * state/nonce, expiry and atomic replay policy. OAuth user-info is not an identity assertion.
 * No built-in SAML/OIDC provider, discovery fetch, JWT substitute or automatic account linking. */
export interface EnterpriseSsoIdentityAdapter<AssertionInput> {
  /** Declared adapter kind; this label alone does not implement verification. */
  readonly kind: 'enterprise-sso';
  /** Verify actual protocol evidence using host-owned trust, replay and cancellation policy. Client JSON or forwarded labels are never verified proof.
   * @param {AssertionInput} assertion - Protocol assertion requiring real signed issuer/audience/state/replay checks.
   * @param {{ signal: AbortSignal; deadline: number }} options - Explicit cooperative signal and absolute deadline.
   * @returns {Promise<ExternalStepUpIdentity|null>} Verified server result or denial; not a bearer token or automatic permission grant.
   */
  verify(
    assertion: AssertionInput,
    options: { signal: AbortSignal; deadline: number }
  ): Promise<ExternalStepUpIdentity | null>;
  /** Optionally release adapter-owned verification resources after pending work settles.
   * @returns {void|Promise<void>} Host controls adapter ownership; no implementation is installed by this contract.
   */
  close?(): void | Promise<void>;
}
