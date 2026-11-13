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
  origin: string;
  tenant: string;
  site: string;
  username: string;
  passwordHash: string;
  /** Stable private 32-byte key. Rotation needs an explicit session migration. */
  key: Uint8Array;
}
export interface WorkspaceSession {
  key: string;
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
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function cookieValue(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
}
export function validateIdentityOptions(options: IdentityOptions) {
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    )
  )
    throw new Error('WORKSPACE_ORIGIN_INVALID');
  if (
    options.key.byteLength !== 32 ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.username) ||
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(options.passwordHash)
  )
    throw new Error('WORKSPACE_IDENTITY_INVALID');
  return origin;
}
export function createWorkspaceIdentity(
  connection: SqliteConnector,
  options: IdentityOptions,
  migrate: boolean
) {
  const origin = validateIdentityOptions(options);
  const key = Buffer.from(options.key);
  const mac = (purpose: string, value: string) =>
    createHmac('sha256', key)
      .update(JSON.stringify([purpose, options.tenant, options.site, value]))
      .digest('base64url');
  const account = { tenant: options.tenant, account: options.username };
  const proofs = new AsyncLocalStorage<string>();
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
  const secure = origin.protocol === 'https:';
  const sessionName = secure ? '__Host-workspace' : 'workspace';
  const csrfName = secure ? '__Host-workspace-csrf' : 'workspace-csrf';
  const cookie = (name: string, value: string, age: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const publicPrincipal = Object.freeze({ public: true });
  const principal = (
    userId: string,
    permissions: readonly string[]
  ): TenantPrincipal => ({
    userId,
    tenantId: options.tenant,
    siteIds: [options.site],
    permissions,
  });
  const resolvePrincipal = async (proof: unknown) => {
    if (proof === publicPrincipal)
      return principal('public-reader', ['workspace:read']);
    if (
      !proof ||
      typeof proof !== 'object' ||
      !('token' in proof) ||
      typeof proof.token !== 'string'
    )
      return null;
    return (await auth.verifySession(account, proof.token, 'workspace'))
      ? principal(options.username, ['workspace:read', 'workspace:write'])
      : null;
  };
  const authenticate: IdentityCallbacks['authenticate'] = async (request) => {
    const token = cookieValue(request, sessionName);
    const session = await auth.verifySession(account, token, 'workspace');
    return session
      ? { key: session.id, principal: Object.freeze({ token }) }
      : null;
  };
  const admission = createAdmission(
    connection,
    migrate,
    mac('admission', options.username)
  );
  const csrf: IdentityCallbacks['csrf'] = {
    async issue(request, session) {
      let nonce = cookieValue(request, csrfName);
      if (!/^[A-Za-z0-9_-]{32}$/.test(nonce))
        nonce = randomBytes(24).toString('base64url');
      const payload = `${Date.now() + 900_000}.${nonce}`;
      return {
        token: `${payload}.${mac('csrf', payload + ':' + (session?.key ?? 'anonymous'))}`,
        cookie: cookie(csrfName, nonce, 900),
      };
    },
    async verify(request, session, token) {
      if (request.headers.get('origin') !== origin.origin || token.length > 160)
        return false;
      const parts = token.split('.');
      if (
        parts.length !== 3 ||
        !/^\d{13}$/.test(parts[0]!) ||
        !/^[A-Za-z0-9_-]{32}$/.test(parts[1]!)
      )
        return false;
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
  const callbacks: IdentityCallbacks = {
    authenticate,
    csrf,
    async login(input) {
      // HTTP owner performs persistent admission before password verification.
      if (
        !equal(input.username, options.username) ||
        !verifyPassword(input.password, options.passwordHash)
      )
        return null;
      const issued = await auth.issueSession(account, {
        device: 'workspace-browser',
        scopes: ['workspace'],
        ttlMs: 3_600_000,
      });
      return { cookie: cookie(sessionName, issued.token, 3600) };
    },
    async logout(session) {
      const proof = session.principal as { token: string };
      await proofs.run(proof.token, () => auth.revoke(account, session.key));
      return { cookie: cookie(sessionName, '', 0) };
    },
    async authorize(_action, session) {
      return !!(await resolvePrincipal(session.principal));
    },
    async admit(_request, action) {
      return admission(action);
    },
  };
  return {
    publicPrincipal,
    resolvePrincipal,
    callbacks,
    authenticate,
    async close() {
      await auth.close();
      key.fill(0);
    },
  };
}
