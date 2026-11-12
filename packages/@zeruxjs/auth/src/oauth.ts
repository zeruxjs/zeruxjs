import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export interface OAuthAuthorizationOptions {
  /** Explicit configured HTTPS authorization URL; no discovery occurs. */
  authorizationEndpoint: string;
  /** Registered client identifier, not a secret. */
  clientId: string;
  /** Exact configured callback URL. */
  redirectUri: string;
  /** Exact callback allowlist checked before URL generation. */
  allowedRedirectUris: readonly string[];
  /** Explicit provider-approved scope names. */
  scopes?: readonly string[];
  /** Additional configured parameters; protected OAuth/PKCE keys cannot be overridden. */
  extra?: Record<string, string>;
}
/** Build authorization-code S256 PKCE URL parameters without exchanging a code or verifying provider identity. Host stores state/verifier per initiating session.
 * @param {OAuthAuthorizationOptions} options - Explicit endpoint/client/exact redirect allowlist and protected extra fields.
 * @returns {ReturnType<typeof createOAuthAuthorization>} Public URL/challenge plus private state/verifier; no network work starts.
 */
export function createOAuthAuthorization(options: OAuthAuthorizationOptions) {
  /** Explicit configured authorization URL; no provider discovery or request occurs. */
  const endpoint = new URL(options.authorizationEndpoint);
  /** Explicit callback URL required to match the supplied exact redirect allowlist. */
  const redirect = new URL(options.redirectUri);
  if (
    endpoint.protocol !== 'https:' ||
    !options.allowedRedirectUris.includes(redirect.href) ||
    !options.clientId
  ) {
    throw new Error('Invalid OAuth endpoint, client or redirect allowlist');
  }
  if (
    redirect.protocol !== 'https:' &&
    !(redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1')
  ) {
    throw new Error('OAuth redirect must use HTTPS outside localhost');
  }
  /** Fresh private PKCE verifier; retain server-side with the initiating session. */
  const verifier = randomBytes(48).toString('base64url');
  /** S256 public challenge derived from the private verifier. */
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  /** Fresh random per-login state, stored and checked by the host. */
  const state = randomBytes(32).toString('base64url');
  /** Authorization URL built solely from configured endpoint and protected standard parameters. */
  const url = new URL(endpoint.href);
  if (
    Object.keys(options.extra ?? {}).some((k) =>
      [
        'client_id',
        'redirect_uri',
        'response_type',
        'state',
        'code_challenge',
        'code_challenge_method',
        'scope',
      ].includes(k)
    )
  ) {
    throw new Error('Reserved OAuth parameter');
  }
  // Copy only configured nonreserved extras before setting protected OAuth/PKCE fields.
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', redirect.href);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (options.scopes?.length) {
    url.searchParams.set('scope', options.scopes.join(' '));
  }
  return { url: url.href, verifier, state, challenge };
}
/** Compare exact supported state spellings against the initiating server-session value.
 * @param {string} expected - Private state retained for this login session.
 * @param {string} received - Untrusted callback state.
 * @returns {boolean} Whether the callback matches; persistence, expiry and one-use consumption are host-owned.
 */
export function verifyOAuthState(expected: string, received: string): boolean {
  if (
    typeof expected !== 'string' ||
    typeof received !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(expected) ||
    !/^[A-Za-z0-9_-]{43}$/.test(received)
  ) {
    return false;
  }
  return (
    expected.length === received.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
