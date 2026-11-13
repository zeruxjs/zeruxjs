import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createOAuthAuthorization, verifyOAuthState } from './oauth.js';
import type { AuthAccount } from './shared-auth.js';
import {
  ProviderLoginError,
  loginDenied,
  loginText,
  type ProviderLoginStore,
  type ProviderIdentity,
} from './provider-store.js';
import {
  mapProviderProfile,
  type ProviderProfile,
  type ProviderProfileClaims,
} from './provider-profiles.js';
export interface LoginProvider {
  /** Explicit provider label; never a package/module name to execute. */
  id: string;
  /** Declared supported mapping family or trusted custom mapper. */
  profile: ProviderProfile;
  /** Explicit OIDC versus OAuth2 provenance; not interchangeable identity guarantees. */
  protocol: 'oidc' | 'oauth2';
  /** Inert public display text; host UI escapes it. */
  label: string;
  /** Exact verified issuer, never token-supplied discovery. */
  issuer: string;
  /** Explicit allowed HTTPS authorization endpoint. */
  authorizationEndpoint: string;
  /** Explicit allowed HTTPS token exchange endpoint. */
  tokenEndpoint: string;
  /** Explicit allowed HTTPS user-info endpoint. */
  userInfoEndpoint: string;
  /** Exact bounded HTTPS egress destinations; host transport enforces DNS/IP/TLS policy. */
  allowedUrls: readonly string[];
  /** Exact configured callback URI allowlist. */
  redirectUris: readonly string[];
  /** Explicit provider-approved scopes; OIDC requires openid. */
  scopes: readonly string[];
  /** Registered client ID; not a secret. */
  clientId: string;
  /** Explicit none/post/basic confidential client method. */
  tokenAuthentication: 'none' | 'client_secret_post' | 'client_secret_basic';
  /** Private configured secret only for declared confidential methods. */
  clientSecret?: string;
  /** Explicit allowed HTTPS key endpoint for configured OIDC. */
  jwksUrl?: string;
  /** Explicit asymmetric JWS allowlist, default RS256. */
  algorithms?: readonly string[];
  /** Expected typ and whether absence is rejected; wrong present values deny. */
  idTokenType?: { value: string; required: boolean };
  /** Require exact callback iss when true; any present iss must match. */
  requireAuthorizationIssuer?: boolean;
  /** Optional OIDC user-info enrichment whose sub must equal verified token subject. */
  loadUserInfo?: boolean;
  /** Trusted custom server mapper; cannot change verified OIDC sub. */
  mapProfile?: (
    value: Readonly<Record<string, unknown>>
  ) => ProviderProfileClaims;
}
export interface ProviderLoginContext {
  /** Host-verified tenant label. */
  tenant: string;
  /** Bounded verified server session, HMAC-bound before persistence. */
  session: string;
}
export interface ProviderLoginRequest {
  /** Optional cooperative cancellation signal. */
  signal?: AbortSignal;
  /** Optional absolute UTC millisecond wait deadline. */
  deadline?: number;
}
export interface ProviderLoginOptions {
  /** One to 16 explicitly configured provider definitions. */
  providers: readonly LoginProvider[];
  /** Borrowed linearizable attempt/code/link persistence. */
  store: ProviderLoginStore;
  /** Stable private 32-byte HMAC material; manager owns only a copy. */
  bindingKey: Uint8Array;
  /** Host enforces egress/DNS policy. This transport is mandatory; there is no implicit global fetch. */
  transport: (url: string, init: RequestInit) => Promise<Response>;
  /** Require recent independent host authentication for exact account link/unlink.
   * @param {Readonly<AuthAccount>} account - Verified target account.
   * @param {'link' | 'unlink'} action - Explicit link or unlink management operation.
   * @param {string} session - Verified initiating session.
   * @returns {Promise<boolean>} Only literal true authorizes; callback data is not provider-derived role proof.
   */
  authorizeFresh(
    account: Readonly<AuthAccount>,
    action: 'link' | 'unlink',
    session: string
  ): Promise<boolean>;
  /** Operation wait bound, default 5000ms and maximum 30000ms. */
  timeoutMs?: number;
  /** Actual-settlement cap, default 32 and maximum 128. */
  maxPending?: number;
  /** Strict JSON response ceiling, default 64KiB and maximum 256KiB. */
  maxResponseBytes?: number;
  /** Trusted server clock or Date.now. */
  now?: () => number;
  /** Owned cache duration, default one minute and maximum ten minutes. */
  jwksCacheMs?: number;
  /** Refresh cooldown, default one second and maximum one minute. */
  jwksCooldownMs?: number;
}
type JwtLibrary = typeof import('@zeruxjs/security/jwt', {
  with: { 'resolution-mode': 'import' },
});
/** Explicit supported asymmetric ID-token algorithm allowlist; token data cannot choose arbitrary crypto. */
const asymmetric = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]);
/** Validate an explicit credential-free query-free HTTPS provider endpoint.
 * @param {unknown} value - Untrusted configured endpoint string.
 * @returns {string} Canonical configured URL; no discovery/fetch occurs.
 */
function endpoint(value: unknown): string {
  if (!loginText(value, 2048)) {
    throw loginDenied();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw loginDenied();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw loginDenied();
  }
  return parsed.href;
}
/** Validate exact callback URL policy, allowing HTTP only for localhost development.
 * @param {unknown} value - Configured redirect URI, not an arbitrary caller destination.
 * @returns {string} Canonical configured callback without credentials/query/fragment.
 */
function redirect(value: unknown): string {
  if (!loginText(value, 2048)) {
    throw loginDenied();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw loginDenied();
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    (parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname)
      ))
  ) {
    throw loginDenied();
  }
  return parsed.href;
}
/** Create explicit code/S256/OIDC flow owners with no discovery, routes or network work on construction. The host owns transport egress and durable atomic persistence.
 * @param {ProviderLoginOptions} options - Explicit private providers, store, transport, binding key and fresh authorization.
 * @returns {ReturnType<typeof createProviderLogin>} Disposable application manager; no email auto-link or automatic session issuance.
 */
export function createProviderLogin(options: ProviderLoginOptions) {
  if (
    !options ||
    options.store?.capability !== 'provider-login-atomic-v1' ||
    !(options.bindingKey instanceof Uint8Array) ||
    options.bindingKey.length !== 32 ||
    typeof options.transport !== 'function' ||
    typeof options.authorizeFresh !== 'function' ||
    !Array.isArray(options.providers) ||
    !options.providers.length ||
    options.providers.length > 16
  ) {
    throw loginDenied();
  }
  /** Borrowed host atomic attempt/code/link primary; never replaced by ordinary cache get/set. */
  const store = options.store;
  /** Required host egress/DNS/TLS transport; there is no implicit global Fetch. */
  const transport = options.transport;
  /** Fresh host authentication callback for link/unlink, never inferred from provider profile roles. */
  const authorize = options.authorizeFresh;
  // Require all atomic attempt/code/link capabilities before any flow starts.
  for (const method of [
    'put',
    'take',
    'claimCode',
    'link',
    'unlink',
  ] as const) {
    if (typeof store[method] !== 'function') {
      throw loginDenied();
    }
  }
  /** Resolve a finite positive integer resource limit.
   * @param {number|undefined} value - Explicit configured limit.
   * @param {number} fallback - Default when omitted.
   * @param {number} max - Inclusive hard ceiling.
   * @returns {number} Validated limit, or a fixed denial. */
  const limit = (value: number | undefined, fallback: number, max: number) => {
    /** Validated configured limit, parsed bounded JSON or lazy verifier promise, owned by the enclosing operation. */
    const result = value === undefined ? fallback : value;
    if (!Number.isSafeInteger(result) || result < 1 || result > max) {
      throw loginDenied();
    }
    return result;
  };
  /** Operation wait deadline, default 5000ms and maximum 30000ms. */
  const timeout = limit(options.timeoutMs, 5000, 30000);
  /** Actual-settlement operation cap, default 32 and maximum 128. */
  const cap = limit(options.maxPending, 32, 128);
  /** Native JSON response ceiling, default 64KiB and maximum 256KiB. */
  const maxBytes = limit(options.maxResponseBytes, 65536, 262144);
  /** Owned JWKS cache duration, default 60000ms and maximum ten minutes. */
  const cacheMs = limit(options.jwksCacheMs, 60000, 600000);
  /** Bounded JWKS refresh cooldown, default 1000ms and maximum one minute. */
  const cooldownMs = limit(options.jwksCooldownMs, 1000, 60000);
  /** Trusted injected server clock or Date.now. */
  const clock = options.now === undefined ? Date.now : options.now;
  if (typeof clock !== 'function') {
    throw loginDenied();
  }
  /** Detached validated private provider definitions; never exposed through public profiles. */
  const definitions = new Map<string, LoginProvider>();
  // Detach and validate each explicitly configured provider; no dynamic discovery is allowed.
  for (const raw of options.providers) {
    if (
      !raw ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(raw.id) ||
      definitions.has(raw.id) ||
      !['google', 'microsoft', 'github', 'discord', 'custom'].includes(
        raw.profile
      ) ||
      !['oidc', 'oauth2'].includes(raw.protocol) ||
      !loginText(raw.label, 100) ||
      !loginText(raw.clientId) ||
      !Array.isArray(raw.allowedUrls) ||
      raw.allowedUrls.length < 3 ||
      raw.allowedUrls.length > 8 ||
      !Array.isArray(raw.redirectUris) ||
      !raw.redirectUris.length ||
      raw.redirectUris.length > 8 ||
      !Array.isArray(raw.scopes) ||
      !raw.scopes.length ||
      raw.scopes.length > 32 ||
      raw.scopes.some(
        (value: unknown) =>
          typeof value !== 'string' || !/^[A-Za-z0-9:._/-]{1,100}$/.test(value)
      )
    ) {
      throw loginDenied();
    }
    if (
      (['google', 'microsoft'].includes(raw.profile) &&
        raw.protocol !== 'oidc') ||
      (['github', 'discord'].includes(raw.profile) &&
        raw.protocol !== 'oauth2') ||
      (raw.profile === 'custom' && typeof raw.mapProfile !== 'function')
    ) {
      throw loginDenied();
    }
    /** Exact configured HTTPS endpoint allowlist; deployment transport must still enforce DNS/IP policy. */
    const allowedUrls = raw.allowedUrls.map(endpoint);
    /** Explicit configured HTTPS authorization endpoint, not discovered from requests. */
    const authorizationEndpoint = endpoint(raw.authorizationEndpoint);
    /** Explicit allowed token exchange endpoint; retries are deliberately not automatic. */
    const tokenEndpoint = endpoint(raw.tokenEndpoint);
    /** Explicit allowed profile endpoint; OAuth data is not an OIDC assertion. */
    const userInfoEndpoint = endpoint(raw.userInfoEndpoint);
    endpoint(raw.issuer);
    if (
      [authorizationEndpoint, tokenEndpoint, userInfoEndpoint].some(
        (url) => !allowedUrls.includes(url)
      )
    ) {
      throw loginDenied();
    }
    if (
      !['none', 'client_secret_post', 'client_secret_basic'].includes(
        raw.tokenAuthentication
      ) ||
      (raw.tokenAuthentication !== 'none' &&
        !loginText(raw.clientSecret, 2048)) ||
      (raw.tokenAuthentication === 'none' && raw.clientSecret !== undefined)
    ) {
      throw loginDenied();
    }
    // Reject malformed policy switches instead of coercing truthy configuration.
    for (const boolean of [raw.requireAuthorizationIssuer, raw.loadUserInfo]) {
      if (boolean !== undefined && typeof boolean !== 'boolean') {
        throw loginDenied();
      }
    }
    if (raw.algorithms !== undefined && !Array.isArray(raw.algorithms)) {
      throw loginDenied();
    }
    /** Detached asymmetric algorithm policy; default RS256 for configured OIDC use. */
    const algorithms = raw.algorithms ? [...raw.algorithms] : ['RS256'];
    if (
      raw.protocol === 'oidc' &&
      (!raw.scopes.includes('openid') ||
        !raw.jwksUrl ||
        !allowedUrls.includes(endpoint(raw.jwksUrl)) ||
        !algorithms.length ||
        algorithms.length > 10 ||
        new Set(algorithms).size !== algorithms.length ||
        algorithms.some((alg) => !asymmetric.has(alg)))
    ) {
      throw loginDenied();
    }
    if (
      raw.idTokenType &&
      (!loginText(raw.idTokenType.value, 64) ||
        typeof raw.idTokenType.required !== 'boolean')
    ) {
      throw loginDenied();
    }
    definitions.set(raw.id, {
      ...raw,
      authorizationEndpoint,
      tokenEndpoint,
      userInfoEndpoint,
      allowedUrls,
      redirectUris: raw.redirectUris.map(redirect),
      scopes: [...raw.scopes],
      algorithms,
      ...(raw.idTokenType ? { idTokenType: { ...raw.idTokenType } } : {}),
    });
  }
  /** Owned stable binding-key copy for session/state/code digests, wiped after drain. */
  const key = Buffer.from(options.bindingKey);
  /** Actual storage/transport/verifier work retained until settlement beyond caller deadlines. */
  const pending = new Set<Promise<unknown>>();
  /** Owned active cooperative cancellation signals; no forced JavaScript cancellation. */
  const controllers = new Set<AbortController>();
  /** Owned lazy per-provider JWT/JWKS owners closed after their native work drains. */
  const verifiers = new Map<
    string,
    Promise<ReturnType<JwtLibrary['createJwtVerifier']>>
  >();
  let closed = false,
    closing: Promise<void> | undefined;
  /** Read a safe trusted server clock used by protocol expiry policy.
   * @returns {number} Validated UTC milliseconds. */
  const now = () => {
    /** Actual trusted clock or callback result; checked before subsequent sensitive work. */
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8e15) {
      throw loginDenied();
    }
    return value;
  };
  // This keyed index binds opaque session/state/authorization-code identifiers.
  // It never hashes a human password: password verification uses the separate
  // password KDF API. Replacing this protocol index with a password KDF would
  // change stored state/code identity and invalidate outstanding ceremonies.
  /** Bind protocol state/session/code lookup keys to this host key and explicit domain.
   * @param {string} domain - Fixed internal protocol purpose.
   * @param {unknown[]} values - Exact configured tenant/provider/session/code tuple.
   * @returns {string} HMAC lookup identity, not a password hash or authorization grant. */
  const digest = (domain: string, values: unknown[]) =>
    // codeql[js/insufficient-password-hash] -- This is a keyed HMAC lookup identity, not password storage.
    createHmac('sha256', key)
      .update(JSON.stringify(['zeruxjs.auth.provider.v1', domain, ...values]))
      .digest('base64url');
  /** Validate and detach exact tenant/session labels before binding lookup keys.
   * @param {ProviderLoginContext} value - Host-verified tenant/server-session context.
   * @returns {{tenant: string, session: string, sessionHash: string}} Fixed scope plus private session digest; validation is not authentication.
   */
  function context(value: ProviderLoginContext) {
    if (
      !value ||
      !loginText(value.tenant, 128) ||
      !loginText(value.session, 128)
    ) {
      throw loginDenied();
    }
    return {
      tenant: value.tenant,
      session: value.session,
      sessionHash: digest('session', [value.tenant, value.session]),
    };
  }
  /** Resolve only explicitly registered provider IDs.
   * @param {string} id - Configured provider label, never an arbitrary package or URL.
   * @returns {LoginProvider} Private validated definition or denial. */
  const provider = (id: string) => {
    /** Exact configured definition; there is no provider discovery fallback. */
    const found = definitions.get(id);
    if (!found) {
      throw loginDenied();
    }
    return found;
  };
  /** Admit bounded protocol work while retaining native slots until actual settlement.
   * @param {ProviderLoginRequest} request - Optional cooperative signal and absolute deadline.
   * @param {(signal: AbortSignal, deadline: number) => Promise<T>} callback - Explicit protocol work receiving the owned cooperative signal/deadline.
   * @returns {Promise<T>} Result or fixed error; no token exchange, mutation or callback replay after uncertainty.
   */
  function run<T>(
    request: ProviderLoginRequest,
    callback: (signal: AbortSignal, deadline: number) => Promise<T>
  ): Promise<T> {
    if (closed) {
      return Promise.reject(new ProviderLoginError('LOGIN_CLOSED'));
    }
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.keys(request).some(
        (key) => !['signal', 'deadline'].includes(key)
      ) ||
      (request.signal !== undefined &&
        !(request.signal instanceof AbortSignal)) ||
      (request.deadline !== undefined &&
        (!Number.isSafeInteger(request.deadline) || request.deadline < 0))
    ) {
      return Promise.reject(loginDenied());
    }
    if (pending.size >= cap) {
      return Promise.reject(new ProviderLoginError('LOGIN_CAPACITY'));
    }
    /** Borrowed caller cancellation signal; its listener is removed when the wait settles. */
    const external = request.signal;
    /** Owned cooperative cancellation source for this admitted operation. */
    const controller = new AbortController();
    /** Earlier of configured wait budget and caller absolute deadline. */
    const deadline = Math.min(
      Date.now() + timeout,
      request.deadline ?? Infinity
    );
    if (external?.aborted || deadline <= Date.now()) {
      return Promise.reject(new ProviderLoginError('LOGIN_UNAVAILABLE'));
    }
    /** Signal cooperative transport/store work after cancellation or wait timeout.
     * @returns {void} Does not forcibly stop native or arbitrary host work. */
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    controllers.add(controller);
    /** Actual protocol work; owns its native pending slot until settlement. */
    const work = Promise.resolve()
      .then(async () => {
        if (controller.signal.aborted || Date.now() >= deadline) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        /** Actual trusted clock or callback result; checked before subsequent sensitive work. */
        const value = await callback(controller.signal, deadline);
        if (controller.signal.aborted || Date.now() >= deadline) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        return value;
      })
      .catch((cause) => {
        if (cause instanceof ProviderLoginError) {
          throw cause;
        }
        throw new ProviderLoginError('LOGIN_UNAVAILABLE', { cause });
      });
    pending.add(work);
    void work
      .finally(() => {
        pending.delete(work);
        controllers.delete(controller);
      })
      .catch(() => {});
    let timer: ReturnType<typeof setTimeout>;
    let cancel = () => {};
    /** Caller-visible cancellation wait, separate from actual work settlement. */
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new ProviderLoginError('LOGIN_UNAVAILABLE'));
      controller.signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
    });
    return Promise.race([work, cancelled]).finally(() => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', cancel);
      external?.removeEventListener('abort', abort);
    });
  }
  /** Use only the required host transport and bounded strict UTF-8 JSON reads with redirect rejection.
   * @param {string} url - Exact allowlisted configured endpoint.
   * @param {RequestInit} init - Explicit private request data/headers.
   * @param {AbortSignal} signal - Owned cooperative cancellation signal.
   * @param {number} deadline - Absolute wait deadline checked around reads.
   * @returns {Promise<Record<string, unknown>>} Inert bounded response data; owned readers/listeners are cancelled/released on failure.
   */
  async function json(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    deadline: number
  ): Promise<Record<string, unknown>> {
    let response: Response | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let success = false;
    /** Signal cooperative transport/store work after cancellation or wait timeout.
     * @returns {void} Does not forcibly stop native or arbitrary host work. */
    const abort = () => {
      void reader?.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted || Date.now() >= deadline) {
        throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      }
      response = await transport(url, {
        ...init,
        signal,
        redirect: 'error',
        credentials: 'omit',
      });
      if (
        signal.aborted ||
        Date.now() >= deadline ||
        response.status !== 200 ||
        response.redirected ||
        (response.url && response.url !== url) ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get('content-type') ?? ''
        ) ||
        !response.body
      ) {
        throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      }
      /** Optional declared JSON response length checked before accumulating chunks. */
      const length = response.headers.get('content-length');
      if (
        length !== null &&
        (!/^\d+$/.test(length) || Number(length) > maxBytes)
      ) {
        throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      }
      reader = response.body.getReader();
      let size = 0;
      /** Bounded response byte chunks held only until strict UTF-8 JSON parsing. */
      const chunks: Uint8Array[] = [];
      // Bound every response chunk and check cooperative cancellation before accepting JSON.
      while (true) {
        if (signal.aborted || Date.now() >= deadline) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        /** Actual bounded response read; rejected bodies are cancelled in finally. */
        const part = await reader.read();
        if (part.done) {
          break;
        }
        size += part.value.byteLength;
        if (size > maxBytes) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        chunks.push(part.value);
      }
      if (signal.aborted || Date.now() >= deadline) {
        throw new ProviderLoginError('LOGIN_UNAVAILABLE');
      }
      /** Validated configured limit, parsed bounded JSON or lazy verifier promise, owned by the enclosing operation. */
      const result = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks, size)
        )
      );
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw loginDenied();
      }
      success = true;
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      if (!success) {
        try {
          if (reader) {
            await reader.cancel();
          } else {
            await response?.body?.cancel();
          }
        } catch {
          /* preserve original private failure */
        }
      }
      reader?.releaseLock();
    }
  }
  /** Lazily own/coalesce an explicit provider JWT verifier and bounded allowlisted JWKS source.
   * @param {LoginProvider} config - Private validated OIDC provider definition.
   * @returns {Promise<ReturnType<JwtLibrary['createJwtVerifier']>>} Owned verifier; failed construction releases its lookup entry for a later explicit attempt.
   */
  async function verifier(config: LoginProvider) {
    let result = verifiers.get(config.id);
    if (!result) {
      result = (async () => {
        /** Lazy optional security JWT module; no tokens/keys are logged. */
        const jwt = await import('@zeruxjs/security/jwt');
        /** Owned allowlisted JWKS source using the mandatory host egress transport. */
        const jwks = jwt.createJwtJwks({
          url: config.jwksUrl!,
          allowedUrls: config.allowedUrls,
          transport,
          timeoutMs: Math.min(timeout, 10000),
          cacheMs,
          cooldownMs,
        });
        return jwt.createJwtVerifier({
          jwks,
          ownJwks: true,
          timeoutMs: timeout,
          policy: {
            algorithms: config.algorithms as Parameters<
              JwtLibrary['createJwtVerifier']
            >[0]['policy']['algorithms'],
            issuer: config.issuer,
            audience: config.clientId,
            type: config.idTokenType?.value ?? 'JWT',
            requireType: config.idTokenType?.required ?? false,
            requiredClaims: ['exp', 'iat', 'nonce'],
            subject: 'required',
            jti: 'optional',
            maxTokenAgeSeconds: 300,
            clockToleranceSeconds: 30,
            now,
          },
        });
      })();
      verifiers.set(config.id, result);
      void result.catch(() => {
        if (verifiers.get(config.id) === result) {
          verifiers.delete(config.id);
        }
      });
    }
    return result;
  }
  return {
    /** Expose only inert display metadata for explicitly configured providers.
     * @returns {ReturnType<ReturnType<typeof createProviderLogin>['profiles']>} ID/label/protocol/profile entries without endpoints, secrets or records.
     */
    profiles() {
      return [...definitions.values()].map(({ id, label, protocol, profile }) =>
        Object.freeze({ id, label, protocol, profile })
      );
    },
    /** Persist a five-minute state/session-bound PKCE attempt before returning the public authorization URL. Linking requires fresh proof here and again on callback.
     * @param {string} providerId - Explicit registered provider ID.
     * @param {ProviderLoginContext} input - Host-verified tenant/server-session context.
     * @param {string} redirectUri - Exact configured callback URI.
     * @param {string} linkAccount - Optional host target account requiring fresh independent proof.
     * @param {ProviderLoginRequest} request - Optional cooperative signal and absolute deadline.
     * @returns {Promise<{url: string, expiresAt: number}>} Configured authorization URL/expiry only; verifier remains private.
     */
    begin(
      providerId: string,
      input: ProviderLoginContext,
      redirectUri: string,
      linkAccount?: string,
      request: ProviderLoginRequest = {}
    ) {
      return run(request, async () => {
        /** Explicit validated private provider definition, never returned to browsers. */
        const config = provider(providerId);
        /** Detached verified tenant/session binding with HMACed session lookup identity. */
        const owner = context(input);
        /** Exact configured callback URI after policy validation. */
        const target = redirect(redirectUri);
        if (
          !config.redirectUris.includes(target) ||
          (linkAccount !== undefined &&
            (!loginText(linkAccount, 128) ||
              (await authorize(
                Object.freeze({ tenant: owner.tenant, account: linkAccount }),
                'link',
                owner.session
              )) !== true))
        ) {
          throw loginDenied();
        }
        /** Private one-use PKCE attempt consumed before token exchange. */
        const attempt = createOAuthAuthorization({
          authorizationEndpoint: config.authorizationEndpoint,
          clientId: config.clientId,
          redirectUri: target,
          allowedRedirectUris: config.redirectUris,
          scopes: [...config.scopes],
        });
        /** Independent private OIDC nonce bound to this stored attempt. */
        const nonce = randomBytes(32).toString('base64url');
        /** Configured authorization URL with protected state/PKCE/nonce parameters. */
        const url = new URL(attempt.url);
        if (config.protocol === 'oidc') {
          url.searchParams.set('nonce', nonce);
        }
        /** Server expiry for the five-minute private attempt. */
        const expiresAt = now() + 300000;
        if (
          (await store.put(
            {
              key: digest('state', [config.id, attempt.state]),
              tenant: owner.tenant,
              session: owner.sessionHash,
              provider: config.id,
              verifier: attempt.verifier,
              nonce,
              redirectUri: target,
              expiresAt,
              ...(linkAccount === undefined ? {} : { linkAccount }),
            },
            now()
          )) !== true
        ) {
          throw loginDenied();
        }
        return { url: url.href, expiresAt };
      });
    },
    /** Consume bound state/code once before exchange; verify actual OIDC or declared OAuth identity and return sanitized facts without raw tokens.
     * @param {string} providerId - Explicit registered provider ID.
     * @param {ProviderLoginContext} input - Host-verified tenant/server-session context.
     * @param {URLSearchParams} parameters - Bounded callback query parameters; duplicates and forged issuer/state deny.
     * @param {ProviderLoginRequest} request - Optional cooperative signal and absolute deadline.
     * @returns {Promise<{identity: ProviderIdentity, linked: boolean}>} Verified server identity/link receipt, not a bearer token or role grant.
     */
    complete(
      providerId: string,
      input: ProviderLoginContext,
      parameters: URLSearchParams,
      request: ProviderLoginRequest = {}
    ): Promise<{ identity: ProviderIdentity; linked: boolean }> {
      return run(request, async (signal, deadline) => {
        /** Explicit validated private provider definition, never returned to browsers. */
        const config = provider(providerId);
        /** Detached verified tenant/session binding with HMACed session lookup identity. */
        const owner = context(input);
        if (
          !(parameters instanceof URLSearchParams) ||
          parameters.getAll('state').length !== 1 ||
          parameters.getAll('code').length > 1 ||
          parameters.getAll('iss').length > 1 ||
          parameters.getAll('error').length > 1
        ) {
          throw loginDenied();
        }
        let fields = 0,
          bytes = 0;
        // Bound the callback field/byte budget before consuming one-use state.
        for (const [key, value] of parameters) {
          if (++fields > 16 || (bytes += key.length + value.length) > 8192) {
            throw loginDenied();
          }
        }
        parameters = new URLSearchParams(parameters);
        /** Bounded callback state matched to exactly one consumed stored attempt. */
        const state = parameters.get('state')!;
        if (!/^[A-Za-z0-9_-]{43}$/.test(state)) {
          throw loginDenied();
        }
        /** Private one-use PKCE attempt consumed before token exchange. */
        const attempt = await store.take(
          digest('state', [config.id, state]),
          owner.tenant,
          owner.sessionHash,
          config.id,
          now()
        );
        if (
          !attempt ||
          attempt.key !== digest('state', [config.id, state]) ||
          !Number.isSafeInteger(attempt.expiresAt) ||
          attempt.expiresAt - now() > 300000 ||
          attempt.provider !== config.id ||
          attempt.tenant !== owner.tenant ||
          attempt.session !== owner.sessionHash ||
          attempt.expiresAt <= now() ||
          !config.redirectUris.includes(attempt.redirectUri) ||
          !/^[A-Za-z0-9_-]{64}$/.test(attempt.verifier) ||
          !/^[A-Za-z0-9_-]{43}$/.test(attempt.nonce)
        ) {
          throw loginDenied();
        }
        /** Optional callback issuer, required when configured and exact whenever present. */
        const issuer = parameters.get('iss');
        /** Private callback authorization code, claimed once before exchange and never logged. */
        const code = parameters.get('code');
        if (
          parameters.has('error') ||
          (issuer !== null && issuer !== config.issuer) ||
          (config.requireAuthorizationIssuer && issuer === null) ||
          !loginText(code, 2048)
        ) {
          throw loginDenied();
        }
        if (
          attempt.linkAccount !== undefined &&
          (!loginText(attempt.linkAccount, 128) ||
            (await authorize(
              Object.freeze({
                tenant: owner.tenant,
                account: attempt.linkAccount,
              }),
              'link',
              owner.session
            )) !== true)
        ) {
          throw loginDenied();
        }
        if (signal.aborted || Date.now() >= deadline) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        if (
          (await store.claimCode(
            digest('code', [config.id, code]),
            now() + 600000,
            now()
          )) !== true
        ) {
          throw loginDenied();
        }
        /** Private form-encoded token exchange including code/verifier and declared client authentication. */
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: attempt.redirectUri,
          code_verifier: attempt.verifier,
        });
        /** Private exchange headers; client secrets/access tokens must not enter telemetry. */
        const headers: Record<string, string> = {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        };
        if (config.tokenAuthentication === 'client_secret_basic') {
          /** Form-encode one configured confidential client credential for HTTP Basic compatibility.
           * @param {string} value - Private client ID/secret spelling.
           * @returns {string} Form-encoded credential component; never log it. */
          const encode = (value: string) =>
            new URLSearchParams({ x: value }).toString().slice(2);
          headers.authorization = `Basic ${Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret!)}`).toString('base64')}`;
        } else {
          body.set('client_id', config.clientId);
          if (config.tokenAuthentication === 'client_secret_post') {
            body.set('client_secret', config.clientSecret!);
          }
        }
        /** Private bounded token response; access/refresh/ID tokens are never returned or persisted here. */
        const tokens = await json(
          config.tokenEndpoint,
          { method: 'POST', headers, body },
          signal,
          deadline
        );
        if (
          !loginText(tokens.access_token, 8192) ||
          !/^[\x21-\x7e]+$/.test(tokens.access_token) ||
          typeof tokens.token_type !== 'string' ||
          tokens.token_type.toLowerCase() !== 'bearer' ||
          tokens.error !== undefined
        ) {
          throw loginDenied();
        }
        let profile: Record<string, unknown>, subject: string | undefined;
        if (config.protocol === 'oidc') {
          if (
            typeof tokens.id_token !== 'string' ||
            tokens.id_token.length > 16384
          ) {
            throw loginDenied();
          }
          let claims, verified;
          try {
            verified = await (
              await verifier(config)
            ).verifyWithHeader(tokens.id_token, { signal, deadline });
            claims = verified.payload;
          } catch (cause) {
            if ((cause as { code?: string })?.code === 'JWT_REJECTED') {
              throw new ProviderLoginError('LOGIN_DENIED', { cause });
            }
            throw new ProviderLoginError('LOGIN_UNAVAILABLE', { cause });
          }
          if (
            !verifyOAuthState(attempt.nonce, claims.nonce as string) ||
            (claims.azp !== undefined && claims.azp !== config.clientId) ||
            (Array.isArray(claims.aud) &&
              (claims.aud.length !== 1 || claims.aud[0] !== config.clientId))
          ) {
            throw loginDenied();
          }
          // Validate each present token/code hash against the verified JWS digest profile.
          for (const [claim, value] of [
            ['at_hash', tokens.access_token],
            ['c_hash', code],
          ] as const) {
            if (claims[claim] !== undefined) {
              /** Allowlisted JWS SHA digest width used for present at_hash/c_hash validation. */
              const bits = verified.protectedHeader.alg.slice(-3);
              if (
                !['256', '384', '512'].includes(bits) ||
                typeof claims[claim] !== 'string'
              ) {
                throw loginDenied();
              }
              /** Private digest of the actual access token/code used only for protocol hash verification. */
              const hashed = createHash(`sha${bits}`).update(value).digest();
              /** Expected left-half token/code digest spelling. */
              const expected = hashed
                .subarray(0, hashed.length / 2)
                .toString('base64url');
              /** Supplied ID-token hash claim checked for grammar/length before constant-time comparison. */
              const actual = claims[claim] as string;
              if (
                !/^[A-Za-z0-9_-]+$/.test(actual) ||
                actual.length !== expected.length ||
                !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
              ) {
                throw loginDenied();
              }
            }
          }
          subject = claims.sub;
          profile = claims;
          if (config.loadUserInfo) {
            /** Bounded provider user-info data; OIDC sub must match the verified ID-token subject. */
            const user = await json(
              config.userInfoEndpoint,
              {
                headers: {
                  accept: 'application/json',
                  ...(config.profile === 'github'
                    ? { 'user-agent': 'ZeruxJS-auth' }
                    : {}),
                  authorization: `Bearer ${tokens.access_token}`,
                },
              },
              signal,
              deadline
            );
            if (user.sub !== subject) {
              throw loginDenied();
            }
            profile = { ...claims, ...user };
          }
        } else {
          profile = await json(
            config.userInfoEndpoint,
            {
              headers: {
                accept: 'application/json',
                ...(config.profile === 'github'
                  ? { 'user-agent': 'ZeruxJS-auth' }
                  : {}),
                authorization: `Bearer ${tokens.access_token}`,
              },
            },
            signal,
            deadline
          );
        }
        /** Sanitized explicitly configured profile facts; custom mapping is trusted host code. */
        const mapped = mapProviderProfile(
          config.profile,
          profile,
          config.mapProfile
        );
        if (subject !== undefined && mapped.subject !== subject) {
          throw loginDenied();
        }
        /** Verified stable tenant/provider/issuer/subject facts, not a session or permission grant. */
        const identity: ProviderIdentity = {
          provider: config.id,
          issuer: config.issuer,
          protocol: config.protocol,
          subject: mapped.subject,
          emailVerified: mapped.emailVerified === true,
          ...(mapped.name ? { name: mapped.name } : {}),
          ...(mapped.email ? { email: mapped.email } : {}),
        };
        if (signal.aborted || Date.now() >= deadline) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        /** Whether the already-authorized flow requests an exact unique account binding. */
        const linked = attempt.linkAccount !== undefined;
        if (
          linked &&
          (await store.link(
            { tenant: owner.tenant, account: attempt.linkAccount! },
            identity
          )) !== true
        ) {
          throw loginDenied();
        }
        return { identity, linked };
      });
    },
    /** Freshly authorize removal of this exact account/provider/issuer/subject binding.
     * @param {AuthAccount} account - Host-authenticated target tenant/account.
     * @param {string} session - Verified initiating server session.
     * @param {string} providerId - Explicit registered provider ID.
     * @param {string} subject - Verified stable provider subject, never an email lookup.
     * @param {ProviderLoginRequest} request - Optional cooperative signal and absolute deadline.
     * @returns {Promise<boolean>} Whether the bound owner removed the identity; host preserves an independent recovery route.
     */
    unlink(
      account: AuthAccount,
      session: string,
      providerId: string,
      subject: string,
      request: ProviderLoginRequest = {}
    ) {
      return run(request, async (signal, deadline) => {
        /** Explicit validated private provider definition, never returned to browsers. */
        const config = provider(providerId);
        /** Detached verified tenant/session binding with HMACed session lookup identity. */
        const owner = context({ tenant: account?.tenant, session });
        if (
          !loginText(account.account, 128) ||
          !loginText(subject) ||
          (await authorize(
            Object.freeze({ tenant: owner.tenant, account: account.account }),
            'unlink',
            session
          )) !== true
        ) {
          throw loginDenied();
        }
        if (signal.aborted || Date.now() >= deadline) {
          throw new ProviderLoginError('LOGIN_UNAVAILABLE');
        }
        return (
          (await store.unlink(
            { tenant: owner.tenant, account: account.account },
            config.id,
            config.issuer,
            subject
          )) === true
        );
      });
    },
    /** Stop admission, signal cooperative work and drain pending native operations plus owned JWT/JWKS owners, then wipe copied key/config references.
     * @returns {Promise<void>} Idempotent drain; borrowed store/transport remain host-owned and uncooperative work may delay shutdown.
     */
    close() {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        // Signal every active cooperative owner before draining actual protocol settlement.
        for (const controller of controllers) {
          controller.abort();
        }
        await Promise.allSettled([...pending]);
        await Promise.allSettled(
          [...verifiers.values()].map(async (result) => (await result).close())
        );
        verifiers.clear();
        key.fill(0);
        definitions.clear();
      }));
    },
  };
}
