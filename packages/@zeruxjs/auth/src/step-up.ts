import type { AuthAccount } from './shared-auth.js';

/** Trusted server-side verification result, never a client bearer token or authorization grant. */
export interface ExternalStepUpIdentity extends AuthAccount {
    issuer: string; subject: string; verifiedAt: number; method: 'client-certificate' | 'enterprise-sso';
}
/** Adapter receives host-owned TLS context. Implementations must verify the peer certificate against
 * configured trust roots (and a peer certificate must actually exist), then map a stable certificate
 * identity to the tenant/account. A header, request JSON or a client-supplied authorized flag is not TLS proof.
 * Proxy adapters require an explicitly mutually authenticated gateway plus authenticated, replay-bound
 * certificate assertions tied to this request; never accept an arbitrary forwarded certificate header.
 * The host must reject unverified/reused TLS sessions without certificate identity. */
export interface ClientCertificateIdentityAdapter<TrustedTlsContext> {
    readonly kind: 'client-certificate';
    verify(context: TrustedTlsContext, options: { signal: AbortSignal; deadline: number }): Promise<ExternalStepUpIdentity | null>;
    close?(): void | Promise<void>;
}
/** Separate SSO verifier contract: host configures issuer/audience, signed assertion verification,
 * state/nonce, expiry and atomic replay policy. OAuth user-info is not an identity assertion.
 * No built-in SAML/OIDC provider, discovery fetch, JWT substitute or automatic account linking. */
export interface EnterpriseSsoIdentityAdapter<AssertionInput> {
    readonly kind: 'enterprise-sso';
    verify(assertion: AssertionInput, options: { signal: AbortSignal; deadline: number }): Promise<ExternalStepUpIdentity | null>;
    close?(): void | Promise<void>;
}
