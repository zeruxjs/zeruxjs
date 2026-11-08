import type { AuthAccount } from './shared-auth.js';
export interface ProviderIdentity { provider: string; issuer: string; subject: string; name?: string; email?: string; emailVerified: boolean; protocol: 'oidc' | 'oauth2' }
export interface ProviderAttempt { key: string; tenant: string; session: string; provider: string; verifier: string; nonce: string; redirectUri: string; expiresAt: number; linkAccount?: string }
/** Shared linearizable attempt/code consumption and identity uniqueness. Expiry is Unix milliseconds.
 * Store PKCE verifiers privately/encrypted; never retain plaintext authorization codes or bearer state.
 * take must match every binding before deletion. claimCode is atomic insert-if-absent, no replay/eviction.
 * link is idempotent only for the same account; tenant/provider/issuer/subject has a unique owner.
 * Host owns acquisition/query deadlines, durable storage and disposal. Ordinary cache get/set is insufficient. */
export interface ProviderLoginStore {
  readonly capability: 'provider-login-atomic-v1';
  put(attempt: ProviderAttempt, now: number): Promise<boolean>;
  take(key: string, tenant: string, session: string, provider: string, now: number): Promise<ProviderAttempt | null>;
  claimCode(key: string, expiresAt: number, now: number): Promise<boolean>;
  link(account: AuthAccount, identity: ProviderIdentity): Promise<boolean>;
  unlink(account: AuthAccount, provider: string, issuer: string, subject: string): Promise<boolean>;
}
export class ProviderLoginError extends Error {
  constructor(readonly code: 'LOGIN_DENIED' | 'LOGIN_UNAVAILABLE' | 'LOGIN_CAPACITY' | 'LOGIN_CLOSED', options?: ErrorOptions) { super(code, options); this.name = 'ProviderLoginError'; }
}
// eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
export const loginText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && Buffer.byteLength(value) <= max && !/[\x00-\x1f\x7f]/.test(value);
export const loginDenied = () => new ProviderLoginError('LOGIN_DENIED');
const hash = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
/** Process-local bounded reference store. Never silently evicts identity links or replay records. */
export function createMemoryProviderLoginStore(options: { maxEntries?: number; maxLinks?: number } = {}): ProviderLoginStore & { clear(): void } {
  const max = options.maxEntries ?? 1000, maxLinks = options.maxLinks ?? 10000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10000 || !Number.isSafeInteger(maxLinks) || maxLinks < 1 || maxLinks > 100000) throw loginDenied();
  const attempts = new Map<string, ProviderAttempt>(), codes = new Map<string, number>(), links = new Map<string, string>();
  const prune = (now: number) => { if (!Number.isSafeInteger(now) || now < 0) throw loginDenied(); for (const [key, value] of attempts) if (value.expiresAt <= now) attempts.delete(key); for (const [key, expiry] of codes) if (expiry <= now) codes.delete(key); };
  const identityKey = (tenant: string, provider: string, issuer: string, subject: string) => { if (![tenant, provider, issuer, subject].every(value => loginText(value))) throw loginDenied(); return JSON.stringify([tenant, provider, issuer, subject]); };
  return {
    capability: 'provider-login-atomic-v1',
    async put(attempt, now) {
      if (!attempt || !hash(attempt.key) || !hash(attempt.session) || !hash(attempt.nonce) || !/^[A-Za-z0-9_-]{64}$/.test(attempt.verifier) || !loginText(attempt.provider, 64) || !loginText(attempt.tenant, 128) || !loginText(attempt.redirectUri, 2048) || !Number.isSafeInteger(attempt.expiresAt) || attempt.expiresAt <= now || attempt.expiresAt - now > 300000 || attempt.linkAccount !== undefined && !loginText(attempt.linkAccount, 128)) throw loginDenied();
      prune(now); if (attempts.has(attempt.key)) return false; if (attempts.size >= max) throw new ProviderLoginError('LOGIN_CAPACITY'); attempts.set(attempt.key, { ...attempt }); return true;
    },
    async take(key, tenant, session, provider, now) { prune(now); const found = attempts.get(key); if (!found || found.tenant !== tenant || found.session !== session || found.provider !== provider) return null; attempts.delete(key); return { ...found }; },
    async claimCode(key, expiresAt, now) { if (!hash(key) || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > 600000) throw loginDenied(); prune(now); if (codes.has(key)) return false; if (codes.size >= max) throw new ProviderLoginError('LOGIN_CAPACITY'); codes.set(key, expiresAt); return true; },
    async link(account, identity) { if (!loginText(account?.account, 128)) throw loginDenied(); const key = identityKey(account.tenant, identity.provider, identity.issuer, identity.subject), owner = links.get(key); if (owner !== undefined) return owner === account.account; if (links.size >= maxLinks) throw new ProviderLoginError('LOGIN_CAPACITY'); links.set(key, account.account); return true; },
    async unlink(account, provider, issuer, subject) { const key = identityKey(account.tenant, provider, issuer, subject); if (!loginText(account.account, 128) || links.get(key) !== account.account) return false; return links.delete(key); },
    clear() { attempts.clear(); codes.clear(); links.clear(); }
  };
}
