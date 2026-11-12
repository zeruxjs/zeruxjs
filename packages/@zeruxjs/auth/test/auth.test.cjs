/** Node test entry; no application server or live provider is started. */
const { test } = require('node:test');
/** Local assertions over synthetic cryptographic/persistence fixtures. */
const assert = require('node:assert/strict');
/** Native cryptography used only for disposable fixture material. */
const nodeCrypto = require('node:crypto');
/** Built package public authentication exports under test. */
const auth = require('../dist/index.js');
test('password policy and legacy session can roundtrip', () => {
  assert.equal(auth.validatePasswordStrength('short').valid, false);
  /** Synthetic expected password/byte digest or native fixture hash helper. */
  const hash = auth.hashPassword('this is a secret password');
  assert.equal(auth.verifyPassword('this is a secret password', hash), true);
  assert.equal(auth.verifyPassword('bad', hash), false);
  assert.equal(auth.verifyPassword('a', 'scrypt:garbage:hash'), false);
  /** Private synthetic bearer used only inside this isolated test. */
  const token = auth.createSession('user1', {
    userId: 'evil',
    expiresAt: 0,
    role: 'editor',
  });
  /** Verified synthetic session context; never read from user browser state. */
  const session = auth.verifySession(token);
  assert.equal(session.userId, 'user1');
  assert.equal(session.role, 'editor');
  assert.equal(session.jti.length, 22);
  assert.equal(auth.verifySession(token + 'broken'), null);
});
test('TOTP matches RFC 6238 vectors with base32 secret', () => {
  /** Disposable test-only secret or RFC vector; never a production key. */
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII 12345678901234567890
  assert.equal(
    auth.generateTotp(secret, { now: 59_000, digits: 8 }),
    '94287082'
  );
  assert.equal(
    auth.verifyTotp('94287082', secret, { now: 59_000, digits: 8, window: 0 }),
    true
  );
  assert.equal(
    auth.verifyTotp('94287083', secret, { now: 59_000, digits: 8, window: 0 }),
    false
  );
  assert.equal(auth.generateTotpSecret().length >= 32, true);
  assert.ok(
    auth
      .totpUri(secret, 'alice@example.com', 'Example')
      .startsWith('otpauth://')
  );
});
test('scoped API tokens, expiry and revocation', () => {
  let now = 1000;
  /** Bounded process-local token fixture with deterministic clock. */
  const tokens = auth.createTokenStore({ now: () => now, maxTokens: 2 });
  /** Actual committed issuance receipt checked for expiry/scope/secret behavior. */
  const issued = tokens.issue('alice', ['read'], 5000);
  assert.equal(tokens.verify(issued.token, 'read').subject, 'alice');
  assert.equal(tokens.verify(issued.token, 'write'), null);
  assert.equal(tokens.verify(issued.token + 'tamper'), null);
  assert.equal(tokens.revoke(issued.id), true);
  assert.equal(tokens.verify(issued.token), null);
  /** Independent fixture manager/credential sharing only explicitly supplied reference state. */
  const second = tokens.issue('bob', [], 1000);
  now += 1001;
  assert.equal(tokens.verify(second.token), null);
});
test('in-process session revocation works with expiry', () => {
  let now = 1000;
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = auth.createSessionRevocationStore({ now: () => now });
  /** Synthetic random session ID in the exact public grammar. */
  const jti = nodeCrypto.randomBytes(16).toString('base64url');
  store.revoke(jti, 2);
  assert.equal(store.isRevoked({ jti }), true);
  now = 2001;
  assert.equal(store.isRevoked({ jti }), false);
});

test('OAuth PKCE flow validates redirect allowlist and state', () => {
  /** Explicit synthetic provider configuration with exact callback allowlist. */
  const params = {
    authorizationEndpoint: 'https://idp.example/authorize',
    clientId: 'client',
    redirectUri: 'https://app.example/callback',
    allowedRedirectUris: ['https://app.example/callback'],
    scopes: ['openid'],
  };
  /** Local authorization URL result; no outbound request is made. */
  const request = auth.createOAuthAuthorization(params);
  /** Generated synthetic authorization URL parsed as inert data. */
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), request.state);
  assert.equal(auth.verifyOAuthState(request.state, request.state), true);
  assert.equal(auth.verifyOAuthState(request.state, 'wrong'), false);
  assert.throws(() =>
    auth.createOAuthAuthorization({
      ...params,
      redirectUri: 'https://evil.example/callback',
    })
  );
});

test('tenant and site permissions refuse cross-scope access even for claimed superuser role', () => {
  /** Verified synthetic principal or token-exchange parameters checked by the fixture. */
  const p = {
    userId: 'u1',
    tenantId: 'tenant-A',
    permissions: ['reports:read', 'email:read'],
    siteIds: ['s1'],
  };
  assert.equal(
    auth.hasTenantPermission(p, {
      tenantId: 'tenant-A',
      permission: 'reports:read',
      siteId: 's1',
    }),
    true
  );
  assert.equal(
    auth.hasTenantPermission(
      { ...p, role: 'admin' },
      { tenantId: 'tenant-B', permission: 'reports:read' }
    ),
    false
  );
  assert.equal(
    auth.hasTenantPermission(p, {
      tenantId: 'tenant-A',
      permission: 'reports:export',
    }),
    false
  );
  assert.equal(
    auth.hasTenantPermission(p, {
      tenantId: 'tenant-A',
      permission: 'reports:read',
      siteId: 's2',
    }),
    false
  );
  assert.equal(
    auth.hasTenantPermission(
      { ...p, permissions: ['*'] },
      { tenantId: 'tenant-A', permission: 'reports:read' }
    ),
    false
  );
  assert.throws(
    () =>
      auth.requireTenantPermission(p, {
        tenantId: 'tenant-B',
        permission: 'email:read',
      }),
    /denied/
  );
});
test('auth configuration protects table mappings and respects organization 0', async () => {
  /** Previous configuration/call count used to assert no unauthorized mutation. */
  const before = auth.getAuthConfig();
  assert.throws(
    () => auth.setAuthConfig({ db: { usersTable: 'users; DROP TABLE users' } }),
    /Unsafe/
  );
  assert.throws(
    () => auth.setAuthConfig({ db: { fields: { role: 'x` OR 1=1' } } }),
    /Unsafe/
  );
  assert.throws(
    () => auth.setAuthConfig({ session: { expiresIn: -2 } }),
    /Invalid session duration/
  );
  assert.deepEqual(auth.getAuthConfig(), before);
  let operation;
  /** Injected native/synthetic state adapter used only against isolated data. */
  const adapter = {
    select: async (x) => {
      operation = x;
      return { rows: [{ capabilities: 'view' }] };
    },
  };
  await auth.getCapabilities('editor', adapter, 0);
  assert.equal(operation.where.and[1].value, 0);
});
