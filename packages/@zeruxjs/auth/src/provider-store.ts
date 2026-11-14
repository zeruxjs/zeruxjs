import type { AuthAccount } from './shared-auth.js';
export interface ProviderIdentity {
  /** Explicit registered provider ID. */
  provider: string;
  /** Verified exact protocol issuer. */
  issuer: string;
  /** Verified stable provider subject, never email-derived ownership. */
  subject: string;
  /** Optional inert display text; escape at the host UI sink. */
  name?: string;
  /** Optional explicitly verified provider email, never an automatic account-link key. */
  email?: string;
  /** Whether the actual mapped provider semantics established verification. */
  emailVerified: boolean;
  /** Explicit oidc versus oauth2 identity provenance. */
  protocol: 'oidc' | 'oauth2';
}
export interface ProviderAttempt {
  /** HMAC state-lookup identity, not plaintext state. */
  key: string;
  /** Host-verified tenant. */
  tenant: string;
  /** HMAC-bound initiating server session. */
  session: string;
  /** Explicit registered provider ID. */
  provider: string;
  /** Private PKCE verifier; production persistence must encrypt/protect it. */
  verifier: string;
  /** Private OIDC nonce bound to the consumed attempt. */
  nonce: string;
  /** Exact configured callback URI retained for token exchange. */
  redirectUri: string;
  /** Bounded server-time attempt expiry. */
  expiresAt: number;
  /** Optional target account requiring fresh authorization at both begin and completion. */
  linkAccount?: string;
}
/** Shared linearizable attempt/code consumption and identity uniqueness. Expiry is Unix milliseconds.
 * Store PKCE verifiers privately/encrypted; never retain plaintext authorization codes or bearer state.
 * take must match every binding before deletion. claimCode is atomic insert-if-absent, no replay/eviction.
 * link is idempotent only for the same account; tenant/provider/issuer/subject has a unique owner.
 * Host owns acquisition/query deadlines, durable storage and disposal. Ordinary cache get/set is insufficient. */
export interface ProviderLoginStore {
  /** Required shared atomic provider-login protocol identifier. */
  readonly capability: 'provider-login-atomic-v1';
  /** Reserve a new private bounded PKCE attempt with its exact expiry.
   * @param {ProviderAttempt} attempt - Private bounded session-bound PKCE attempt.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {Promise<boolean>} False on duplicate; invalid/capacity failure rejects.
   */
  put(attempt: ProviderAttempt, now: number): Promise<boolean>;
  /** Atomically consume only after tenant/session/provider bindings and expiry match.
   * @param {string} key - HMACed state/code digest, never plaintext authorization proof.
   * @param {string} tenant - Host-verified tenant label.
   * @param {string} session - HMAC-bound initiating server session.
   * @param {string} provider - Exact configured provider ID.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {Promise<ProviderAttempt|null>} Detached consumed attempt or denial; mismatched contexts cannot burn another login.
   */
  take(
    key: string,
    tenant: string,
    session: string,
    provider: string,
    now: number
  ): Promise<ProviderAttempt | null>;
  /** Atomically reserve a provider-bound code digest against replay for a bounded lifetime.
   * @param {string} key - HMACed state/code digest, never plaintext authorization proof.
   * @param {number} expiresAt - Bounded server-time claim expiry.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {Promise<boolean>} False for an existing retained claim; capacity/storage errors are not successful claims.
   */
  claimCode(key: string, expiresAt: number, now: number): Promise<boolean>;
  /** Reserve unique tenant/provider/issuer/subject ownership for one verified account.
   * @param {AuthAccount} account - Host-authenticated target tenant/account.
   * @param {ProviderIdentity} identity - Cryptographically/protocol-verified provider identity, not browser data.
   * @returns {Promise<boolean>} True for a new or same-owner link; another account is denied.
   */
  link(account: AuthAccount, identity: ProviderIdentity): Promise<boolean>;
  /** Remove a binding only when the exact authenticated account owns it.
   * @param {AuthAccount} account - Host-authenticated target tenant/account.
   * @param {string} provider - Exact configured provider ID.
   * @param {string} issuer - Verified exact issuer.
   * @param {string} subject - Verified stable provider subject.
   * @returns {Promise<boolean>} Whether this exact owner removed the link; fresh proof belongs to the caller.
   */
  unlink(
    account: AuthAccount,
    provider: string,
    issuer: string,
    subject: string
  ): Promise<boolean>;
}
/** Fixed-code failure; private provider causes must not reach client JSON. */
export class ProviderLoginError extends Error {
  /** Create a fixed public provider-login error with a private optional cause.
 * @param {| 'LOGIN_DENIED'
      | 'LOGIN_UNAVAILABLE'
      | 'LOGIN_CAPACITY'
      | 'LOGIN_CLOSED'} code - Supported public failure category.
 * @param {ErrorOptions} options - Optional internal cause for trusted diagnostics.
 */
  constructor(
    readonly code:
      | 'LOGIN_DENIED'
      | 'LOGIN_UNAVAILABLE'
      | 'LOGIN_CAPACITY'
      | 'LOGIN_CLOSED',
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'ProviderLoginError';
  }
}
/** Validate bounded UTF-8 labels without accepting control characters.
 * @param {unknown} value - Candidate provider/context label.
 * @param {number} max - Character and byte ceiling, default 512.
 * @returns {boolean} Whether the label satisfies both bounds and control policy. */
export const loginText = (value: unknown, max = 512): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  Buffer.byteLength(value) <= max &&
  // eslint-disable-next-line no-control-regex -- Reject controls in bounded identity labels.
  !/[\x00-\x1f\x7f]/.test(value);
/** Create a fixed login denial without exposing provider/state details.
 * @returns {ProviderLoginError} Redacted public denial. */
export const loginDenied = () => new ProviderLoginError('LOGIN_DENIED');
/** Recognize a supported keyed-digest spelling.
 * @param {unknown} value - Candidate state/code/session digest.
 * @returns {boolean} Whether the fixed-length base64url grammar passes. */
const hash = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
/** Create bounded process-local atomic attempt/code/link reference state. No durable cross-replica guarantee is implied.
 * @param {{ maxEntries?: number; maxLinks?: number }} options - Optional transient/link limits; expired transients prune but links never evict.
 * @param {number|undefined} options.maxEntries - Transient attempt/code capacity, default 1000 and maximum 10000.
 * @param {number|undefined} options.maxLinks - Retained identity-link capacity, default 10000 and maximum 100000.
 * @returns {ProviderLoginStore & {clear(): void}} Reference facade; no background expiry worker or connection ownership.
 */
export function createMemoryProviderLoginStore(
  options: { maxEntries?: number; maxLinks?: number } = {}
): ProviderLoginStore & {
  /** Destroy local transient replay and identity-link state during explicit owned teardown.
   * @returns {void} Do not treat this as a production retention/eviction strategy.
   */
  clear(): void;
} {
  /** Reference capacity per live attempt/code set, default 1000 and maximum 10000. */
  const max = options.maxEntries ?? 1000;
  /** Retained unique identity-link capacity, default 10000 and maximum 100000. */
  const maxLinks = options.maxLinks ?? 10000;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 10000 ||
    !Number.isSafeInteger(maxLinks) ||
    maxLinks < 1 ||
    maxLinks > 100000
  ) {
    throw loginDenied();
  }
  /** Private process-local PKCE attempts; production stores must encrypt verifier material. */
  const attempts = new Map<string, ProviderAttempt>();
  /** Process-local consumed-code digest/expiry claims; no plaintext authorization code is stored. */
  const codes = new Map<string, number>();
  /** Persistent-for-this-process identity owner map; links are never silently evicted. */
  const links = new Map<string, string>();
  /** Remove only expired transient records before reference-store work.
   * @param {number} now - Trusted current server milliseconds.
   * @returns {void} Invalid time rejects; identity links are never pruned here. */
  const prune = (now: number) => {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw loginDenied();
    }
    // Prune only expired transient attempts; never evict identity links.
    for (const [key, value] of attempts) {
      if (value.expiresAt <= now) {
        attempts.delete(key);
      }
    }
    // Prune only expired code-replay claims before checking capacity.
    for (const [key, expiry] of codes) {
      if (expiry <= now) {
        codes.delete(key);
      }
    }
  };
  /** Bind identity ownership to exact tenant/provider/issuer/subject labels.
   * @param {string} tenant - Host-verified tenant.
   * @param {string} provider - Configured provider ID.
   * @param {string} issuer - Verified exact issuer.
   * @param {string} subject - Verified stable subject, not an email auto-link key.
   * @returns {string} Unambiguous identity tuple serialization. */
  const identityKey = (
    tenant: string,
    provider: string,
    issuer: string,
    subject: string
  ) => {
    if (
      ![tenant, provider, issuer, subject].every((value) => loginText(value))
    ) {
      throw loginDenied();
    }
    return JSON.stringify([tenant, provider, issuer, subject]);
  };
  return {
    capability: 'provider-login-atomic-v1',
    /** Reserve a new private bounded PKCE attempt with its exact expiry.
     * @param {ProviderAttempt} attempt - Private bounded session-bound PKCE attempt.
     * @param {number} now - Trusted current server milliseconds.
     * @returns {Promise<boolean>} False on duplicate; invalid/capacity failure rejects.
     */
    async put(attempt, now) {
      if (
        !attempt ||
        !hash(attempt.key) ||
        !hash(attempt.session) ||
        !hash(attempt.nonce) ||
        !/^[A-Za-z0-9_-]{64}$/.test(attempt.verifier) ||
        !loginText(attempt.provider, 64) ||
        !loginText(attempt.tenant, 128) ||
        !loginText(attempt.redirectUri, 2048) ||
        !Number.isSafeInteger(attempt.expiresAt) ||
        attempt.expiresAt <= now ||
        attempt.expiresAt - now > 300000 ||
        (attempt.linkAccount !== undefined &&
          !loginText(attempt.linkAccount, 128))
      ) {
        throw loginDenied();
      }
      prune(now);
      if (attempts.has(attempt.key)) {
        return false;
      }
      if (attempts.size >= max) {
        throw new ProviderLoginError('LOGIN_CAPACITY');
      }
      attempts.set(attempt.key, { ...attempt });
      return true;
    },
    /** Atomically consume only after tenant/session/provider bindings and expiry match.
     * @param {string} key - HMACed state/code digest, never plaintext authorization proof.
     * @param {string} tenant - Host-verified tenant label.
     * @param {string} session - HMAC-bound initiating server session.
     * @param {string} provider - Exact configured provider ID.
     * @param {number} now - Trusted current server milliseconds.
     * @returns {Promise<ProviderAttempt|null>} Detached consumed attempt or denial; mismatched contexts cannot burn another login.
     */
    async take(key, tenant, session, provider, now) {
      prune(now);
      /** Current attempt checked against every session/tenant/provider binding before consumption. */
      const found = attempts.get(key);
      if (
        !found ||
        found.tenant !== tenant ||
        found.session !== session ||
        found.provider !== provider
      ) {
        return null;
      }
      attempts.delete(key);
      return { ...found };
    },
    /** Atomically reserve a provider-bound code digest against replay for a bounded lifetime.
     * @param {string} key - HMACed state/code digest, never plaintext authorization proof.
     * @param {number} expiresAt - Bounded server-time claim expiry.
     * @param {number} now - Trusted current server milliseconds.
     * @returns {Promise<boolean>} False for an existing retained claim; capacity/storage errors are not successful claims.
     */
    async claimCode(key, expiresAt, now) {
      if (
        !hash(key) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= now ||
        expiresAt - now > 600000
      ) {
        throw loginDenied();
      }
      prune(now);
      if (codes.has(key)) {
        return false;
      }
      if (codes.size >= max) {
        throw new ProviderLoginError('LOGIN_CAPACITY');
      }
      codes.set(key, expiresAt);
      return true;
    },
    /** Reserve unique tenant/provider/issuer/subject ownership for one verified account.
     * @param {AuthAccount} account - Host-authenticated target tenant/account.
     * @param {ProviderIdentity} identity - Cryptographically/protocol-verified provider identity, not browser data.
     * @returns {Promise<boolean>} True for a new or same-owner link; another account is denied.
     */
    async link(account, identity) {
      if (!loginText(account?.account, 128)) {
        throw loginDenied();
      }
      /** Exact configured identity-ownership tuple key. */
      const key = identityKey(
        account.tenant,
        identity.provider,
        identity.issuer,
        identity.subject
      );
      /** Previously linked account; only the same account can idempotently retain ownership. */
      const owner = links.get(key);
      if (owner !== undefined) {
        return owner === account.account;
      }
      if (links.size >= maxLinks) {
        throw new ProviderLoginError('LOGIN_CAPACITY');
      }
      links.set(key, account.account);
      return true;
    },
    /** Remove a binding only when the exact authenticated account owns it.
     * @param {AuthAccount} account - Host-authenticated target tenant/account.
     * @param {string} provider - Exact configured provider ID.
     * @param {string} issuer - Verified exact issuer.
     * @param {string} subject - Verified stable provider subject.
     * @returns {Promise<boolean>} Whether this exact owner removed the link; fresh proof belongs to the caller.
     */
    async unlink(account, provider, issuer, subject) {
      /** Exact configured identity-ownership tuple key. */
      const key = identityKey(account.tenant, provider, issuer, subject);
      if (
        !loginText(account.account, 128) ||
        links.get(key) !== account.account
      ) {
        return false;
      }
      return links.delete(key);
    },
    /** Destroy local transient replay and identity-link state during explicit owned teardown.
     * @returns {void} Do not treat this as a production retention/eviction strategy.
     */
    clear() {
      attempts.clear();
      codes.clear();
      links.clear();
    },
  };
}
