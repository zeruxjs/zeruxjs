import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createSharedAuth,
  verifyPassword,
  type TenantPrincipal,
} from '@zeruxjs/auth';
import type { SqliteConnector } from '@zeruxjs/db-sqlite';
import { createAuthPersistence, createAdmission } from './persistence.js';

export interface IdentityOptions {
  /** Exact trusted application origin; forwarded headers never choose this value. */
  origin: string;
  /** Host-verified tenant identity fixed for this application instance. */
  tenant: string;
  /** Host-verified site identity included in cryptographic namespaces. */
  site: string;
  /** Single configured operator account, not a browser-provided role claim. */
  username: string;
  /** Private persisted scrypt record; never rendered or logged. */
  passwordHash: string;
  /** Stable private 32-byte cryptographic key; rotation requires an explicit session migration. */
  key: Uint8Array;
}
export interface WorkspaceSession {
  /** Verified session record ID used to bind CSRF and revoke this exact session; never a browser role claim. */
  key: string;
  /** Opaque server proof retained only for authorization callbacks. */
  principal: unknown;
}
interface IdentityCallbacks {
  authenticate(request: Request): Promise<WorkspaceSession | null>;
  login(
    input: { username: string; password: string },
    request: Request
  ): Promise<{ cookie: string } | null>;
  logout(
    session: WorkspaceSession,
    request: Request
  ): Promise<{ cookie: string }>;
  authorize(action: string, session: WorkspaceSession): Promise<boolean>;
  /** Application-bound CSRF issue/verify contract, independent of UI visibility. */
  csrf: {
    issue(
      request: Request,
      session: WorkspaceSession | null
    ): Promise<{ token: string; cookie?: string }>;
    verify(
      request: Request,
      session: WorkspaceSession | null,
      token: string
    ): Promise<boolean>;
  };
  admit(request: Request, action: 'login'): Promise<boolean>;
}
/** Compare opaque proofs without exposing their contents.
 * @param {string} a - First private proof.
 * @param {string} b - Second private proof.
 * @returns {boolean} Exact equal-length byte equality; no secrets are logged.
 */
const equal = (a: string, b: string) => {
  /** Encoded first proof; byte equality is constant time only after the explicit length check. */
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
/** Read exactly one named cookie; ambiguous duplicate cookies fail closed.
 * @param {Request} request - Borrowed request whose cookie header remains untrusted.
 * @param {string} name - Fixed application-owned cookie name.
 * @returns {string} Single raw value, or empty text for absence/duplicates.
 */
function cookieValue(request: Request, name: string) {
  /** All exact-name cookie candidates; duplicates are rejected rather than choosing a browser-controlled ordering. */
  const values = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
}
/** Validate the private single-operator origin/key/password contract before acquiring auth resources.
 * @param {IdentityOptions} options - Trusted host configuration still requiring runtime shape/policy checks.
 * @returns {URL} Exact HTTPS origin or explicitly supported loopback HTTP development origin.
 */
export function validateIdentityOptions(options: IdentityOptions) {
  /** Validated exact application origin controls secure cookie policy and CSRF origin matching. */
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    )
  ) {
    throw new Error('WORKSPACE_ORIGIN_INVALID');
  }
  if (
    options.key.byteLength !== 32 ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.username) ||
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(options.passwordHash)
  ) {
    throw new Error('WORKSPACE_IDENTITY_INVALID');
  }
  return origin;
}
/** Create an application-scoped durable identity owner over a borrowed SQLite connector.
 * @param {SqliteConnector} connection - Borrowed persistent synchronous connector, never disconnected here.
 * @param {IdentityOptions} options - Fixed private host origin, tenant/site, account and independent key.
 * @param {boolean} migrate - Explicit operator-only schema initialization permission.
 * @returns {object} Fresh auth/CSRF/principal callbacks and an explicit auth-owner close handle.
 */
export function createWorkspaceIdentity(
  connection: SqliteConnector,
  options: IdentityOptions,
  migrate: boolean
) {
  /** Validated exact application origin controls secure cookie policy and CSRF origin matching. */
  const origin = validateIdentityOptions(options);
  /** Independent private key copy owned by this identity instance; the caller retains its original buffer. */
  const key = Buffer.from(options.key);
  /** Bind one proof to its cryptographic purpose and fixed host tenant/site.
   * @param {string} purpose - Fixed authored purpose discriminator.
   * @param {string} value - Proof input; never logged or treated as executable content.
   * @returns {string} Base64url SHA-256 MAC under this owner’s private key copy.
   */
  const mac = (purpose: string, value: string) =>
    createHmac('sha256', key)
      .update(JSON.stringify([purpose, options.tenant, options.site, value]))
      .digest('base64url');
  /** Fixed account namespace; HTTP form fields cannot choose a different tenant/account. */
  const account = { tenant: options.tenant, account: options.username };
  /** Short-lived server-only revocation proof context, scoped to the awaited logout operation. */
  const proofs = new AsyncLocalStorage<string>();
  /** Shared durable auth owner using the application’s CAS adapter and derived independent key purposes. */
  const auth = createSharedAuth({
    store: createAuthPersistence(connection, migrate),
    indexKey: Buffer.from(mac('index', 'v1'), 'base64url'),
    keys: [{ id: 'v1', key: Buffer.from(mac('sessions', 'v1'), 'base64url') }],
    activeKeyId: 'v1',
    authorizeFresh: async (identity, action) =>
      identity.tenant === account.tenant &&
      identity.account === account.account &&
      action === 'revoke-one' &&
      !!proofs.getStore() &&
      !!(await auth.verifySession(account, proofs.getStore()!, 'workspace')),
  });
  /** Only an explicitly validated HTTPS origin permits __Host-/Secure cookies. */
  const secure = origin.protocol === 'https:';
  /** Cookie name distinguishes secure host-only deployment from explicit loopback development. */
  const sessionName = secure ? '__Host-workspace' : 'workspace';
  /** CSRF nonce cookie follows the same secure/loopback origin policy. */
  const csrfName = secure ? '__Host-workspace-csrf' : 'workspace-csrf';
  /** Serialize only server-generated proof cookies under the validated origin policy.
   * @param {string} name - Fixed secure/development cookie name.
   * @param {string} value - Server-generated opaque proof or empty revocation value.
   * @param {number} age - Fixed maximum age in seconds.
   * @returns {string} HttpOnly, SameSite=Strict cookie; Secure is required on HTTPS.
   */
  const cookie = (name: string, value: string, age: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  /** Exact private sentinel identity for the explicitly public read-only workflow; object lookalikes are not accepted. */
  const publicPrincipal = Object.freeze({ public: true });
  /** Project verified identity into fixed host scope.
   * @param {string} userId - Server-established public user identifier.
   * @param {readonly string[]} permissions - Authored permissions for this verified identity.
   * @returns {TenantPrincipal} Tenant/site-bound projection, never a browser role claim.
   */
  const principal = (
    userId: string,
    permissions: readonly string[]
  ): TenantPrincipal => ({
    userId,
    tenantId: options.tenant,
    siteIds: [options.site],
    permissions,
  });
  /** Resolve an exact public sentinel or freshly verified private session proof.
   * @param {unknown} proof - Candidate server proof; structural public lookalikes do not authorize.
   * @returns {Promise<TenantPrincipal | null>} Fixed verified principal or denial.
   */
  const resolvePrincipal = async (proof: unknown) => {
    if (proof === publicPrincipal) {
      return principal('public-reader', ['workspace:read']);
    }
    if (
      !proof ||
      typeof proof !== 'object' ||
      !('token' in proof) ||
      typeof proof.token !== 'string'
    ) {
      return null;
    }
    return (await auth.verifySession(account, proof.token, 'workspace'))
      ? principal(options.username, ['workspace:read', 'workspace:write'])
      : null;
  };
  /** Authenticate each request from a single opaque cookie and durable session state.
   * @param {Request} request - Borrowed request; no forwarded identity header is trusted.
   * @returns {Promise<WorkspaceSession | null>} Verified session proof or null, never raw account storage.
   */
  const authenticate: IdentityCallbacks['authenticate'] = async (request) => {
    /** Untrusted cookie candidate must pass the durable session verifier before becoming a principal. */
    const token = cookieValue(request, sessionName);
    /** Actual verified live session; its opaque ID binds subsequent CSRF proofs. */
    const session = await auth.verifySession(account, token, 'workspace');
    return session
      ? { key: session.id, principal: Object.freeze({ token }) }
      : null;
  };
  /** Durable fixed-account attempt budget is consumed before password verification by the HTTP owner. */
  const admission = createAdmission(
    connection,
    migrate,
    mac('admission', options.username)
  );
  /** Per-request challenge issuance/verification binds origin, nonce, deadline and current session key. */
  const csrf: IdentityCallbacks['csrf'] = {
    /** Issue a finite CSRF proof bound to the exact request cookie and current session.
     * @param {Request} request - Borrowed request supplying a candidate nonce cookie.
     * @param {WorkspaceSession | null} session - Fresh authenticated session, or explicit anonymous login scope.
     * @returns {Promise<{ token: string; cookie?: string }>} Signed challenge plus fixed-policy nonce cookie.
     */
    async issue(request, session) {
      let nonce = cookieValue(request, csrfName);
      if (!/^[A-Za-z0-9_-]{32}$/.test(nonce)) {
        nonce = randomBytes(24).toString('base64url');
      }
      /** Finite challenge deadline and random nonce; the signature additionally binds the authenticated session. */
      const payload = `${Date.now() + 900_000}.${nonce}`;
      return {
        token: `${payload}.${mac('csrf', payload + ':' + (session?.key ?? 'anonymous'))}`,
        cookie: cookie(csrfName, nonce, 900),
      };
    },
    /** Require exact origin, bounded freshness, matching nonce and session-bound MAC.
     * @param {Request} request - Borrowed request with an untrusted Origin/cookie header.
     * @param {WorkspaceSession | null} session - Current fresh session, not a client-declared account.
     * @param {string} token - Bounded candidate CSRF proof supplied by the form/protocol request.
     * @returns {Promise<boolean>} Whether all checks pass; valid syntax alone never authorizes a request.
     */
    async verify(request, session, token) {
      if (
        request.headers.get('origin') !== origin.origin ||
        token.length > 160
      ) {
        return false;
      }
      /** Untrusted proof components require exact count and grammar before cryptographic comparison. */
      const parts = token.split('.');
      if (
        parts.length !== 3 ||
        !/^\d{13}$/.test(parts[0]!) ||
        !/^[A-Za-z0-9_-]{32}$/.test(parts[1]!)
      ) {
        return false;
      }
      /** Finite future deadline; stale challenges and excessive future windows reject. */
      const expires = Number(parts[0]);
      return (
        expires > Date.now() &&
        expires <= Date.now() + 900_000 &&
        equal(parts[1]!, cookieValue(request, csrfName)) &&
        equal(
          parts[2]!,
          mac('csrf', `${parts[0]}.${parts[1]}:${session?.key ?? 'anonymous'}`)
        )
      );
    },
  };
  /** Host-bound auth callbacks; this local profile has one operator rather than client-supplied role groups. */
  const callbacks: IdentityCallbacks = {
    authenticate,
    csrf,
    /** Verify the configured single operator after HTTP admission and CSRF checks.
     * @param {{ username: string; password: string }} input - Private credential form values, never logged.
     * @returns {Promise<{ cookie: string } | null>} Persisted opaque-session cookie or denied credentials.
     */
    async login(input) {
      // HTTP owner performs persistent admission before password verification.
      if (
        !equal(input.username, options.username) ||
        !verifyPassword(input.password, options.passwordHash)
      ) {
        return null;
      }
      /** Actual persisted session receipt; only its opaque token enters the cookie. */
      const issued = await auth.issueSession(account, {
        device: 'workspace-browser',
        scopes: ['workspace'],
        ttlMs: 3_600_000,
      });
      return { cookie: cookie(sessionName, issued.token, 3600) };
    },
    /** Revoke the verified session using fresh server proof context before clearing its cookie.
     * @param {WorkspaceSession} session - Fresh verified session with a server-retained proof.
     * @returns {Promise<{ cookie: string }>} Expiring cookie after durable revocation succeeds.
     */
    async logout(session) {
      /** Server-retained session proof used for freshly authorized single-session revocation. */
      const proof = session.principal as { token: string };
      await proofs.run(proof.token, () => auth.revoke(account, session.key));
      return { cookie: cookie(sessionName, '', 0) };
    },
    /** Reverify this local single-operator session; fine-grained host roles are not implemented here.
     * @param {string} _action - Compatibility action label; this profile grants its verified operator the workspace scope.
     * @param {WorkspaceSession} session - Server-established proof to reverify against durable state.
     * @returns {Promise<boolean>} Whether the current proof remains valid.
     */
    async authorize(_action, session) {
      return !!(await resolvePrincipal(session.principal));
    },
    /** Consume the fixed account’s durable admission window without trusting client IP/tenant claims.
     * @param {Request} _request - Compatibility request argument, deliberately unused for identity selection.
     * @param {'login'} action - Explicit supported admission action.
     * @returns {Promise<boolean>} Atomic persisted admission decision.
     */
    async admit(_request, action) {
      return admission(action);
    },
  };
  return {
    publicPrincipal,
    resolvePrincipal,
    callbacks,
    authenticate,
    /** Close the owned auth manager before zeroing this identity’s private key copy.
     * @returns {Promise<void>} Auth close settlement; the borrowed database stays host-owned.
     */
    async close() {
      await auth.close();
      key.fill(0);
    },
  };
}
