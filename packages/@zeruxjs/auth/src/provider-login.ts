import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createOAuthAuthorization, verifyOAuthState } from './oauth.js';
import type { AuthAccount } from './shared-auth.js';
import { ProviderLoginError, loginDenied, loginText, type ProviderLoginStore, type ProviderIdentity } from './provider-store.js';
import { mapProviderProfile, type ProviderProfile, type ProviderProfileClaims } from './provider-profiles.js';
export interface LoginProvider {
  id: string; profile: ProviderProfile; protocol: 'oidc' | 'oauth2'; label: string;
  issuer: string; authorizationEndpoint: string; tokenEndpoint: string; userInfoEndpoint: string;
  allowedUrls: readonly string[]; redirectUris: readonly string[]; scopes: readonly string[];
  clientId: string; tokenAuthentication: 'none' | 'client_secret_post' | 'client_secret_basic'; clientSecret?: string;
  jwksUrl?: string; algorithms?: readonly string[]; idTokenType?: { value: string; required: boolean };
  requireAuthorizationIssuer?: boolean; loadUserInfo?: boolean;
  mapProfile?: (value: Readonly<Record<string, unknown>>) => ProviderProfileClaims;
}
export interface ProviderLoginContext { tenant: string; session: string }
export interface ProviderLoginRequest { signal?: AbortSignal; deadline?: number }
export interface ProviderLoginOptions {
  providers: readonly LoginProvider[]; store: ProviderLoginStore; bindingKey: Uint8Array;
  /** Host enforces egress/DNS policy. This transport is mandatory; there is no implicit global fetch. */
  transport: (url: string, init: RequestInit) => Promise<Response>;
  authorizeFresh(account: Readonly<AuthAccount>, action: 'link' | 'unlink', session: string): Promise<boolean>;
  timeoutMs?: number; maxPending?: number; maxResponseBytes?: number; now?: () => number;
  jwksCacheMs?: number; jwksCooldownMs?: number;
}
type JwtLibrary = typeof import('@zeruxjs/security/jwt', { with: { 'resolution-mode': 'import' } });
const asymmetric = new Set(['RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512','EdDSA']);
function endpoint(value: unknown): string {
  if (!loginText(value, 2048)) throw loginDenied(); let parsed: URL; try { parsed = new URL(value); } catch { throw loginDenied(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.search) throw loginDenied(); return parsed.href;
}
function redirect(value: unknown): string {
  if (!loginText(value, 2048)) throw loginDenied(); let parsed: URL; try { parsed = new URL(value); } catch { throw loginDenied(); }
  if (parsed.username || parsed.password || parsed.hash || parsed.search || parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) throw loginDenied(); return parsed.href;
}
/** Explicit authorization-code + S256 flow. No discovery scan, implicit network or account/email auto-link. */
export function createProviderLogin(options: ProviderLoginOptions) {
  if (!options || options.store?.capability !== 'provider-login-atomic-v1' || !(options.bindingKey instanceof Uint8Array) || options.bindingKey.length !== 32 || typeof options.transport !== 'function' || typeof options.authorizeFresh !== 'function' || !Array.isArray(options.providers) || !options.providers.length || options.providers.length > 16) throw loginDenied();
  const store = options.store, transport = options.transport, authorize = options.authorizeFresh;
  for (const method of ['put','take','claimCode','link','unlink'] as const) if (typeof store[method] !== 'function') throw loginDenied();
  const limit = (value: number | undefined, fallback: number, max: number) => { const result = value === undefined ? fallback : value; if (!Number.isSafeInteger(result) || result < 1 || result > max) throw loginDenied(); return result; };
  const timeout = limit(options.timeoutMs, 5000, 30000), cap = limit(options.maxPending, 32, 128), maxBytes = limit(options.maxResponseBytes, 65536, 262144);
  const cacheMs = limit(options.jwksCacheMs, 60000, 600000), cooldownMs = limit(options.jwksCooldownMs, 1000, 60000), clock = options.now === undefined ? Date.now : options.now;
  if (typeof clock !== 'function') throw loginDenied();
  const definitions = new Map<string, LoginProvider>();
  for (const raw of options.providers) {
    if (!raw || !/^[a-z][a-z0-9-]{0,63}$/.test(raw.id) || definitions.has(raw.id) || !['google','microsoft','github','discord','custom'].includes(raw.profile) || !['oidc','oauth2'].includes(raw.protocol) || !loginText(raw.label, 100) || !loginText(raw.clientId) || !Array.isArray(raw.allowedUrls) || raw.allowedUrls.length < 3 || raw.allowedUrls.length > 8 || !Array.isArray(raw.redirectUris) || !raw.redirectUris.length || raw.redirectUris.length > 8 || !Array.isArray(raw.scopes) || !raw.scopes.length || raw.scopes.length > 32 || raw.scopes.some((value: unknown) => typeof value !== 'string' || !/^[A-Za-z0-9:._/-]{1,100}$/.test(value))) throw loginDenied();
    if (['google','microsoft'].includes(raw.profile) && raw.protocol !== 'oidc' || ['github','discord'].includes(raw.profile) && raw.protocol !== 'oauth2' || raw.profile === 'custom' && typeof raw.mapProfile !== 'function') throw loginDenied();
    const allowedUrls = raw.allowedUrls.map(endpoint), authorizationEndpoint = endpoint(raw.authorizationEndpoint), tokenEndpoint = endpoint(raw.tokenEndpoint), userInfoEndpoint = endpoint(raw.userInfoEndpoint); endpoint(raw.issuer);
    if ([authorizationEndpoint,tokenEndpoint,userInfoEndpoint].some(url => !allowedUrls.includes(url))) throw loginDenied();
    if (!['none','client_secret_post','client_secret_basic'].includes(raw.tokenAuthentication) || raw.tokenAuthentication !== 'none' && !loginText(raw.clientSecret, 2048) || raw.tokenAuthentication === 'none' && raw.clientSecret !== undefined) throw loginDenied();
    for (const boolean of [raw.requireAuthorizationIssuer, raw.loadUserInfo]) if (boolean !== undefined && typeof boolean !== 'boolean') throw loginDenied();
    if (raw.algorithms !== undefined && !Array.isArray(raw.algorithms)) throw loginDenied();
    const algorithms = raw.algorithms ? [...raw.algorithms] : ['RS256'];
    if (raw.protocol === 'oidc' && (!raw.scopes.includes('openid') || !raw.jwksUrl || !allowedUrls.includes(endpoint(raw.jwksUrl)) || !algorithms.length || algorithms.length > 10 || new Set(algorithms).size !== algorithms.length || algorithms.some(alg => !asymmetric.has(alg)))) throw loginDenied();
    if (raw.idTokenType && (!loginText(raw.idTokenType.value, 64) || typeof raw.idTokenType.required !== 'boolean')) throw loginDenied();
    definitions.set(raw.id, { ...raw, authorizationEndpoint, tokenEndpoint, userInfoEndpoint, allowedUrls, redirectUris: raw.redirectUris.map(redirect), scopes: [...raw.scopes], algorithms, ...(raw.idTokenType ? { idTokenType: { ...raw.idTokenType } } : {}) });
  }
  const key = Buffer.from(options.bindingKey), pending = new Set<Promise<unknown>>(), controllers = new Set<AbortController>();
  const verifiers = new Map<string, Promise<ReturnType<JwtLibrary['createJwtVerifier']>>>(); let closed = false, closing: Promise<void> | undefined;
  const now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value > 8e15) throw loginDenied(); return value; };
  // HMAC binds high-entropy session/state/PKCE tokens, not human passwords.
  // S256 PKCE and these opaque-token indexes must remain interoperable.
  const digest = (domain: string, values: unknown[]) => createHmac('sha256', key).update(JSON.stringify(['zeruxjs.auth.provider.v1', domain, ...values])).digest('base64url');
  function context(value: ProviderLoginContext) {
    if (!value || !loginText(value.tenant, 128) || !loginText(value.session, 128)) throw loginDenied();
    return { tenant: value.tenant, session: value.session, sessionHash: digest('session', [value.tenant, value.session]) };
  }
  const provider = (id: string) => { const found = definitions.get(id); if (!found) throw loginDenied(); return found; };
  function run<T>(request: ProviderLoginRequest, callback: (signal: AbortSignal, deadline: number) => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new ProviderLoginError('LOGIN_CLOSED'));
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key=>!['signal','deadline'].includes(key)) || request.signal !== undefined && !(request.signal instanceof AbortSignal) || request.deadline !== undefined && (!Number.isSafeInteger(request.deadline) || request.deadline < 0)) return Promise.reject(loginDenied());
    if (pending.size >= cap) return Promise.reject(new ProviderLoginError('LOGIN_CAPACITY'));
    const external = request.signal, controller = new AbortController(), deadline = Math.min(Date.now() + timeout, request.deadline ?? Infinity);
    if (external?.aborted || deadline <= Date.now()) return Promise.reject(new ProviderLoginError('LOGIN_UNAVAILABLE'));
    const abort = () => controller.abort(); external?.addEventListener('abort', abort, { once: true }); controllers.add(controller);
    const work = Promise.resolve().then(async () => { if (controller.signal.aborted || Date.now() >= deadline) throw new ProviderLoginError('LOGIN_UNAVAILABLE'); const value = await callback(controller.signal, deadline); if (controller.signal.aborted || Date.now() >= deadline) throw new ProviderLoginError('LOGIN_UNAVAILABLE'); return value; }).catch(cause => { if (cause instanceof ProviderLoginError) throw cause; throw new ProviderLoginError('LOGIN_UNAVAILABLE', { cause }); });
    pending.add(work); void work.finally(() => { pending.delete(work); controllers.delete(controller); }).catch(() => {});
    let timer: ReturnType<typeof setTimeout>; let cancel = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new ProviderLoginError('LOGIN_UNAVAILABLE')); controller.signal.addEventListener('abort', cancel, { once: true }); timer = setTimeout(abort, Math.max(1, deadline - Date.now())); });
    return Promise.race([work,cancelled]).finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); external?.removeEventListener('abort', abort); });
  }
  async function json(url: string, init: RequestInit, signal: AbortSignal, deadline: number): Promise<Record<string, unknown>> {
    let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined; let success = false;
    const abort = () => { void reader?.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted || Date.now() >= deadline) throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      response = await transport(url, { ...init, signal, redirect: 'error', credentials: 'omit' });
      if (signal.aborted || Date.now() >= deadline || response.status !== 200 || response.redirected || response.url && response.url !== url || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      const length = response.headers.get('content-length'); if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      while (true) { if (signal.aborted || Date.now() >= deadline) throw new ProviderLoginError('LOGIN_UNAVAILABLE'); const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) throw new ProviderLoginError('LOGIN_UNAVAILABLE'); chunks.push(part.value); }
      if (signal.aborted || Date.now() >= deadline) throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); if (!result || typeof result !== 'object' || Array.isArray(result)) throw loginDenied(); success = true; return result;
    } finally { signal.removeEventListener('abort', abort); if (!success) try { if (reader) await reader.cancel(); else await response?.body?.cancel(); } catch { /* preserve original private failure */ } reader?.releaseLock(); }
  }
  async function verifier(config: LoginProvider) {
    let result = verifiers.get(config.id);
    if (!result) {
      result = (async () => {
        const jwt = await import('@zeruxjs/security/jwt');
        const jwks = jwt.createJwtJwks({ url: config.jwksUrl!, allowedUrls: config.allowedUrls, transport, timeoutMs: Math.min(timeout, 10000), cacheMs, cooldownMs });
        return jwt.createJwtVerifier({ jwks, ownJwks: true, timeoutMs: timeout, policy: { algorithms: config.algorithms as Parameters<JwtLibrary['createJwtVerifier']>[0]['policy']['algorithms'], issuer: config.issuer, audience: config.clientId, type: config.idTokenType?.value ?? 'JWT', requireType: config.idTokenType?.required ?? false, requiredClaims: ['exp','iat','nonce'], subject: 'required', jti: 'optional', maxTokenAgeSeconds: 300, clockToleranceSeconds: 30, now } });
      })(); verifiers.set(config.id, result); void result.catch(() => { if (verifiers.get(config.id) === result) verifiers.delete(config.id); });
    }
    return result;
  }
  return {
    /** Safe display metadata only; never exposes endpoints, secrets or identity records. */
    profiles() { return [...definitions.values()].map(({ id, label, protocol, profile }) => Object.freeze({ id, label, protocol, profile })); },
    /** Bind a five-minute PKCE attempt to host-verified tenant/session; link enrollment requires fresh proof. */
    begin(providerId: string, input: ProviderLoginContext, redirectUri: string, linkAccount?: string, request: ProviderLoginRequest = {}) {
      return run(request, async () => {
        const config = provider(providerId), owner = context(input), target = redirect(redirectUri);
        if (!config.redirectUris.includes(target) || linkAccount !== undefined && (!loginText(linkAccount, 128) || await authorize(Object.freeze({ tenant: owner.tenant, account: linkAccount }), 'link', owner.session) !== true)) throw loginDenied();
        const attempt = createOAuthAuthorization({ authorizationEndpoint: config.authorizationEndpoint, clientId: config.clientId, redirectUri: target, allowedRedirectUris: config.redirectUris, scopes: [...config.scopes] }), nonce = randomBytes(32).toString('base64url');
        const url = new URL(attempt.url); if (config.protocol === 'oidc') url.searchParams.set('nonce', nonce);
        const expiresAt = now() + 300000;
        if (await store.put({ key: digest('state', [config.id, attempt.state]), tenant: owner.tenant, session: owner.sessionHash, provider: config.id, verifier: attempt.verifier, nonce, redirectUri: target, expiresAt, ...(linkAccount === undefined ? {} : { linkAccount }) }, now()) !== true) throw loginDenied();
        return { url: url.href, expiresAt };
      });
    },
    /** Consume callback state/code once before exchange and return a verified/mapped identity, never raw tokens. */
    complete(providerId: string, input: ProviderLoginContext, parameters: URLSearchParams, request: ProviderLoginRequest = {}): Promise<{ identity: ProviderIdentity; linked: boolean }> {
      return run(request, async (signal, deadline) => {
        const config = provider(providerId), owner = context(input);
        if (!(parameters instanceof URLSearchParams) || parameters.getAll('state').length !== 1 || parameters.getAll('code').length > 1 || parameters.getAll('iss').length > 1 || parameters.getAll('error').length > 1) throw loginDenied();
        let fields=0,bytes=0; for(const [key,value] of parameters){if(++fields>16||(bytes+=key.length+value.length)>8192)throw loginDenied();}
        parameters=new URLSearchParams(parameters);
        const state = parameters.get('state')!; if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw loginDenied();
        const attempt = await store.take(digest('state', [config.id, state]), owner.tenant, owner.sessionHash, config.id, now());
        if (!attempt || attempt.key !== digest('state', [config.id, state]) || !Number.isSafeInteger(attempt.expiresAt) || attempt.expiresAt - now() > 300000 || attempt.provider !== config.id || attempt.tenant !== owner.tenant || attempt.session !== owner.sessionHash || attempt.expiresAt <= now() || !config.redirectUris.includes(attempt.redirectUri) || !/^[A-Za-z0-9_-]{64}$/.test(attempt.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(attempt.nonce)) throw loginDenied();
        const issuer = parameters.get('iss'), code = parameters.get('code');
        if (parameters.has('error') || issuer !== null && issuer !== config.issuer || config.requireAuthorizationIssuer && issuer === null || !loginText(code, 2048)) throw loginDenied();
        if (attempt.linkAccount !== undefined && (!loginText(attempt.linkAccount, 128) || await authorize(Object.freeze({ tenant: owner.tenant, account: attempt.linkAccount }), 'link', owner.session) !== true)) throw loginDenied();
        if(signal.aborted||Date.now()>=deadline)throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        if (await store.claimCode(digest('code', [config.id, code]), now() + 600000, now()) !== true) throw loginDenied();
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: attempt.redirectUri, code_verifier: attempt.verifier });
        const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
        if (config.tokenAuthentication === 'client_secret_basic') {
          const encode = (value: string) => new URLSearchParams({ x: value }).toString().slice(2);
          headers.authorization = `Basic ${Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret!)}`).toString('base64')}`;
        } else { body.set('client_id', config.clientId); if (config.tokenAuthentication === 'client_secret_post') body.set('client_secret', config.clientSecret!); }
        const tokens = await json(config.tokenEndpoint, { method: 'POST', headers, body }, signal, deadline);
        if (!loginText(tokens.access_token, 8192) || !/^[\x21-\x7e]+$/.test(tokens.access_token) || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer' || tokens.error !== undefined) throw loginDenied();
        let profile: Record<string, unknown>, subject: string | undefined;
        if (config.protocol === 'oidc') {
          if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16384) throw loginDenied();
          let claims, verified;
          try { verified = await (await verifier(config)).verifyWithHeader(tokens.id_token, { signal, deadline }); claims = verified.payload; }
          catch (cause) { if ((cause as { code?: string })?.code === 'JWT_REJECTED') throw new ProviderLoginError('LOGIN_DENIED', { cause }); throw new ProviderLoginError('LOGIN_UNAVAILABLE', { cause }); }
          if (!verifyOAuthState(attempt.nonce, claims.nonce as string) || claims.azp !== undefined && claims.azp !== config.clientId || Array.isArray(claims.aud) && (claims.aud.length !== 1 || claims.aud[0] !== config.clientId)) throw loginDenied();
          for (const [claim, value] of [['at_hash', tokens.access_token], ['c_hash', code]] as const) if (claims[claim] !== undefined) {
            const bits = verified.protectedHeader.alg.slice(-3);
            if (!['256','384','512'].includes(bits) || typeof claims[claim] !== 'string') throw loginDenied();
            const hashed = createHash(`sha${bits}`).update(value).digest(), expected = hashed.subarray(0, hashed.length / 2).toString('base64url');
            const actual = claims[claim] as string;
            if (!/^[A-Za-z0-9_-]+$/.test(actual) || actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw loginDenied();
          }
          subject = claims.sub; profile = claims;
          if (config.loadUserInfo) { const user = await json(config.userInfoEndpoint, { headers: { accept: 'application/json', ...(config.profile === 'github' ? { 'user-agent': 'ZeruxJS-auth' } : {}), authorization: `Bearer ${tokens.access_token}` } }, signal, deadline); if (user.sub !== subject) throw loginDenied(); profile = { ...claims, ...user }; }
        } else profile = await json(config.userInfoEndpoint, { headers: { accept: 'application/json', ...(config.profile === 'github' ? { 'user-agent': 'ZeruxJS-auth' } : {}), authorization: `Bearer ${tokens.access_token}` } }, signal, deadline);
        const mapped = mapProviderProfile(config.profile, profile, config.mapProfile);
        if (subject !== undefined && mapped.subject !== subject) throw loginDenied();
        const identity: ProviderIdentity = { provider: config.id, issuer: config.issuer, protocol: config.protocol, subject: mapped.subject, emailVerified: mapped.emailVerified === true, ...(mapped.name ? { name: mapped.name } : {}), ...(mapped.email ? { email: mapped.email } : {}) };
        if(signal.aborted||Date.now()>=deadline)throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        const linked = attempt.linkAccount !== undefined;
        if (linked && await store.link({ tenant: owner.tenant, account: attempt.linkAccount! }, identity) !== true) throw loginDenied();
        return { identity, linked };
      });
    },
    /** Freshly authorized removal of this account's exact issuer/subject binding; no email lookup. */
    unlink(account: AuthAccount, session: string, providerId: string, subject: string, request: ProviderLoginRequest = {}) {
      return run(request, async (signal, deadline) => {
        const config = provider(providerId), owner = context({ tenant: account?.tenant, session });
        if (!loginText(account.account, 128) || !loginText(subject) || await authorize(Object.freeze({ tenant: owner.tenant, account: account.account }), 'unlink', session) !== true) throw loginDenied();
        if(signal.aborted||Date.now()>=deadline)throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        return await store.unlink({ tenant: owner.tenant, account: account.account }, config.id, config.issuer, subject) === true;
      });
    },
    /** Stop admission, abort cooperatively, drain native work and owned JWT sources; borrowed store stays open. */
    close() { closed = true; return closing ??= Promise.resolve().then(async () => { for (const controller of controllers) controller.abort(); await Promise.allSettled([...pending]); await Promise.allSettled([...verifiers.values()].map(async result => (await result).close())); verifiers.clear(); key.fill(0); definitions.clear(); }); }
  };
}
