/** Node test entry; no application server or live provider is started. */
const { test } = require('node:test');
/** Local assertions over synthetic cryptographic/persistence fixtures. */
const assert = require('node:assert/strict');
/** Native ephemeral provider keys and expected PKCE digest helpers. */
const { randomBytes, createHash } = require('node:crypto');
/** Installed maintained JWT fixture tooling; no live JWKS/provider is contacted. */
const jose = require('jose');
/** Built package public authentication exports under test. */
const auth = require('../dist/index.js');
/** Synthetic initiating tenant/server-session context. */
const owner = { tenant: 'tenant-a', session: 'host-session' };
/** Exact approved synthetic callback URL. */
const redirectUri = 'https://app.example/callback';
/** Create isolated credential owners with deterministic clocks, explicit proof policy and scripted native failures.
 * @param {object} override - Explicit provider/transport fixture overrides, default empty.
 * @returns {object|Promise<object>} Fixture handles with explicit close/clear teardown.
 */
async function fixture(override = {}) {
  let time = Date.now(),
    authorized = false,
    nonce,
    challenge,
    claims = {},
    failure = false,
    rotation = 1;
  /** Owned disposable provider signing key pair. */
  const pair = await jose.generateKeyPair('ES256', { extractable: true });
  /** Public fixture JWK used by the scripted local JWKS response. */
  const pub = await jose.exportJWK(pair.publicKey);
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = auth.createMemoryProviderLoginStore();
  /** Observed scripted transport destinations; assertions verify no unintended dispatch. */
  const calls = [];
  /** Captured private fixture attempts used to verify HMAC/session/PKCE binding. */
  const records = [];
  /** Reference store wrapper capturing only synthetic attempts for assertions. */
  const wrapped = {
    ...store,
    async put(record, now) {
      records.push(record);
      return store.put(record, now);
    },
  };
  /** Explicit private fixture RP/provider/clock/authorization settings. */
  const config = {
    id: 'example',
    profile: 'custom',
    protocol: 'oidc',
    label: 'Example',
    issuer: 'https://idp.example',
    authorizationEndpoint: 'https://idp.example/auth',
    tokenEndpoint: 'https://idp.example/token',
    userInfoEndpoint: 'https://idp.example/user',
    jwksUrl: 'https://idp.example/keys',
    allowedUrls: [
      'https://idp.example/auth',
      'https://idp.example/token',
      'https://idp.example/user',
      'https://idp.example/keys',
    ],
    redirectUris: [redirectUri],
    scopes: ['openid', 'profile', 'email'],
    clientId: 'client',
    tokenAuthentication: 'none',
    algorithms: ['ES256'],
    mapProfile: (v) => ({
      subject: v.sub,
      name: v.name,
      email: v.email,
      emailVerified: v.email_verified === true,
    }),
    ...override.provider,
  };
  /** Scripted injected provider transport; it never delegates to a network.
   * @param {string} url - Exact synthetic provider endpoint.
   * @param {RequestInit} init - Explicit private scripted request options.
   * @returns {Promise<Response>} Scripted injected provider transport; it never delegates to a network. */
  const transport = async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    if (url === config.tokenEndpoint) {
      if (failure) {
        throw Error('PRIVATE_TOKEN_FAILURE');
      }
      /** Verified synthetic principal or token-exchange parameters checked by the fixture. */
      const p = new URLSearchParams(init.body);
      assert.equal(p.get('grant_type'), 'authorization_code');
      assert.equal(p.get('redirect_uri'), redirectUri);
      assert.equal(
        createHash('sha256').update(p.get('code_verifier')).digest('base64url'),
        challenge
      );
      /** Fixture issuance time in Unix seconds for valid/hostile JWT claims. */
      const sec = Math.floor(time / 1000);
      /** Locally signed disposable ID token returned only by the scripted transport. */
      const id_token = await new jose.SignJWT({
        iss: config.issuer,
        aud: config.clientId,
        sub: 'subject-1',
        iat: sec,
        exp: sec + 60,
        nonce,
        email: 'verified@example.test',
        email_verified: true,
        ...claims,
      })
        .setProtectedHeader({ alg: 'ES256', kid: `key-${rotation}` })
        .sign(pair.privateKey);
      return Response.json({
        access_token: 'PRIVATE_ACCESS_TOKEN',
        token_type: 'Bearer',
        id_token,
      });
    }
    if (url === config.jwksUrl) {
      return Response.json({
        keys: [{ ...pub, alg: 'ES256', kid: `key-${rotation}` }],
      });
    }
    if (url === config.userInfoEndpoint) {
      return Response.json({
        id: 42,
        sub: 'subject-1',
        name: 'Profile',
        email: 'unverified@example.test',
        ...override.userInfo,
      });
    }
    throw Error('Unexpected outbound destination');
  };
  /** Explicit isolated manager/store/transport configuration. */
  const options = {
    providers: [config],
    store: wrapped,
    bindingKey: randomBytes(32),
    transport,
    authorizeFresh: async () => authorized,
    now: () => time,
    jwksCooldownMs: 1,
    jwksCacheMs: 20,
    ...override.options,
  };
  /** First independent fixture manager sharing only the declared reference store. */
  const first = auth.createProviderLogin(options);
  /** Independent fixture manager/credential sharing only explicitly supplied reference state. */
  const second = auth.createProviderLogin(options);
  /** Start one synthetic login and retain expected nonce/PKCE challenge for scripted responses.
   * @param {object} manager - Explicit fixture manager, default first owner.
   * @param {string|undefined} account - Optional synthetic link target requiring fresh proof.
   * @returns {Promise<URLSearchParams>} Bound synthetic callback fields; no live authorization request.
   */
  async function begin(manager = first, account) {
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = await manager.begin(config.id, owner, redirectUri, account);
    /** Generated synthetic authorization URL parsed as inert data. */
    const url = new URL(result.url);
    nonce = url.searchParams.get('nonce');
    challenge = url.searchParams.get('code_challenge');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    return new URLSearchParams({
      state: url.searchParams.get('state'),
      code: randomBytes(16).toString('hex'),
    });
  }
  return {
    first,
    second,
    options,
    config,
    calls,
    records,
    begin,
    authorize: (v) => (authorized = v),
    setClaims: (v) => (claims = v),
    outage: () => (failure = true),
    rotate: () => rotation++,
    advance: (ms) => (time += ms),
    async close() {
      await first.close();
      await second.close();
      store.clear();
    },
  };
}
test('OIDC PKCE/claims, session binding and atomic state/code consumption', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture();
  try {
    /** Synthetic bound callback parameters, never actual authorization codes. */
    const callback = await f.begin();
    await assert.rejects(
      f.second.complete(f.config.id, { ...owner, session: 'wrong' }, callback),
      { code: 'LOGIN_DENIED' }
    );
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = await f.second.complete(f.config.id, owner, callback);
    assert.equal(result.identity.subject, 'subject-1');
    assert.equal(result.identity.protocol, 'oidc');
    assert.equal(result.identity.emailVerified, true);
    assert.equal(result.linked, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.notEqual(f.records[0].session, owner.session);
    assert.notEqual(f.records[0].key, callback.get('state'));
    await assert.rejects(f.first.complete(f.config.id, owner, callback), {
      code: 'LOGIN_DENIED',
    });
    /** Fresh next-step code/ceremony proving old proof is not reused. */
    const next = await f.begin();
    next.set('code', callback.get('code'));
    /** Previous configuration/call count used to assert no unauthorized mutation. */
    const before = f.calls.length;
    await assert.rejects(f.first.complete(f.config.id, owner, next), {
      code: 'LOGIN_DENIED',
    });
    assert.equal(f.calls.length, before);
  } finally {
    await f.close();
  }
});
test('nonce, issuer/audience, authorized party, malformed/future/expired claims and duplicate state fail', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture();
  try {
    // Each hostile signed claim set must deny independently before identity/link success.
    for (const claims of [
      { nonce: 'wrong' },
      { iss: 'https://evil.example' },
      { aud: 'other' },
      { aud: ['client', 'other'] },
      { azp: 'other' },
      { exp: 1 },
      { nbf: 9999999999 },
      { iat: 'malformed' },
    ]) {
      /** Fresh synthetic callback for one hostile claim/dependency case. */
      const cb = await f.begin();
      f.setClaims(claims);
      await assert.rejects(f.first.complete(f.config.id, owner, cb), {
        code: 'LOGIN_DENIED',
      });
    }
    f.setClaims({});
    /** Deliberate duplicate callback/credential candidate expected to deny. */
    const duplicate = await f.begin();
    duplicate.append('state', duplicate.get('state'));
    await assert.rejects(f.first.complete(f.config.id, owner, duplicate), {
      code: 'LOGIN_DENIED',
    });
    /** Fixture whose trusted clock advances past exact proof expiry. */
    const expired = await f.begin();
    f.advance(300000);
    await assert.rejects(f.first.complete(f.config.id, owner, expired), {
      code: 'LOGIN_DENIED',
    });
    assert.equal(auth.verifyOAuthState('a'.repeat(43), 'é'.repeat(43)), false);
  } finally {
    await f.close();
  }
});
test('JWKS rotation and exchange outage never replay consumed attempt', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture();
  try {
    await f.first.complete(f.config.id, owner, await f.begin());
    await new Promise((r) => setTimeout(r, 3));
    f.rotate();
    await f.first.complete(f.config.id, owner, await f.begin());
    assert.equal(f.calls.filter((url) => url === f.config.jwksUrl).length, 2);
    f.outage();
    /** Fresh synthetic callback for one hostile claim/dependency case. */
    const cb = await f.begin();
    await assert.rejects(
      f.first.complete(f.config.id, owner, cb),
      (e) => e.code === 'LOGIN_UNAVAILABLE' && !e.message.includes('PRIVATE')
    );
    /** Observed scripted transport destinations; assertions verify no unintended dispatch. */
    const calls = f.calls.length;
    await assert.rejects(f.second.complete(f.config.id, owner, cb), {
      code: 'LOGIN_DENIED',
    });
    assert.equal(f.calls.length, calls);
  } finally {
    await f.close();
  }
});
test('link/unlink requires fresh proof; unique subject ownership never uses email', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture();
  try {
    await assert.rejects(f.begin(f.first, 'alice'), { code: 'LOGIN_DENIED' });
    assert.equal(f.calls.length, 0);
    f.authorize(true);
    /** Login flow whose fresh link authorization is revoked before callback. */
    const interrupted = await f.begin(f.first, 'alice');
    f.authorize(false);
    await assert.rejects(f.second.complete(f.config.id, owner, interrupted), {
      code: 'LOGIN_DENIED',
    });
    assert.equal(f.calls.length, 0);
    f.authorize(true);
    f.setClaims({ email_verified: false });
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = await f.first.complete(
      f.config.id,
      owner,
      await f.begin(f.first, 'alice')
    );
    assert.equal(result.linked, true);
    assert.equal(result.identity.email, undefined);
    await assert.rejects(
      f.second.complete(f.config.id, owner, await f.begin(f.second, 'bob')),
      { code: 'LOGIN_DENIED' }
    );
    f.authorize(false);
    await assert.rejects(
      f.first.unlink(
        { tenant: owner.tenant, account: 'alice' },
        owner.session,
        f.config.id,
        'subject-1'
      ),
      { code: 'LOGIN_DENIED' }
    );
    f.authorize(true);
    assert.equal(
      await f.first.unlink(
        { tenant: owner.tenant, account: 'bob' },
        owner.session,
        f.config.id,
        'subject-1'
      ),
      false
    );
    assert.equal(
      await f.second.unlink(
        { tenant: owner.tenant, account: 'alice' },
        owner.session,
        f.config.id,
        'subject-1'
      ),
      true
    );
  } finally {
    await f.close();
  }
});
test('OAuth user info is not OIDC, unverified email excluded, endpoints/redirects are allowlisted', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture({
    provider: { profile: 'github', protocol: 'oauth2', scopes: ['read:user'] },
  });
  try {
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = await f.first.complete(f.config.id, owner, await f.begin());
    assert.equal(result.identity.protocol, 'oauth2');
    assert.equal(result.identity.subject, '42');
    assert.equal(result.identity.emailVerified, false);
    assert.equal(result.identity.email, undefined);
    assert.equal(f.calls.includes(f.config.jwksUrl), false);
    assert.throws(
      () =>
        auth.createProviderLogin({
          ...f.options,
          providers: [{ ...f.config, profile: 'google' }],
        }),
      { code: 'LOGIN_DENIED' }
    );
    assert.throws(
      () =>
        auth.createProviderLogin({
          ...f.options,
          providers: [
            { ...f.config, tokenEndpoint: 'https://evil.example/token' },
          ],
        }),
      { code: 'LOGIN_DENIED' }
    );
    await assert.rejects(
      f.first.begin(f.config.id, owner, 'https://evil.example/callback'),
      { code: 'LOGIN_DENIED' }
    );
  } finally {
    await f.close();
  }
});
test('slow response cancels reader and close invalidates only its client', async () => {
  let cancelled = 0;
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture({
    options: {
      timeoutMs: 20,
      transport: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        ),
    },
  });
  try {
    /** Fresh synthetic callback for one hostile claim/dependency case. */
    const cb = await f.begin();
    await assert.rejects(f.first.complete(f.config.id, owner, cb), {
      code: 'LOGIN_UNAVAILABLE',
    });
    await f.first.close();
    assert.equal(cancelled, 1);
    await assert.rejects(f.first.begin(f.config.id, owner, redirectUri), {
      code: 'LOGIN_CLOSED',
    });
    assert.ok(await f.begin(f.second));
  } finally {
    await f.close();
  }
});
test('token hash binding and optional user-info subject mismatch are denied', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture();
  try {
    /** Expected token hash for the synthetic access token. */
    const good = createHash('sha256')
      .update('PRIVATE_ACCESS_TOKEN')
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    f.setClaims({ at_hash: good });
    await f.first.complete(f.config.id, owner, await f.begin());
    f.setClaims({ at_hash: 'wrong' });
    await assert.rejects(
      f.first.complete(f.config.id, owner, await f.begin()),
      { code: 'LOGIN_DENIED' }
    );
  } finally {
    await f.close();
  }
});
test('OIDC user-info sub must match ID token; mappings keep vendor-specific trust semantics', async () => {
  /** Scripted OIDC user-info response with a foreign subject. */
  const mismatch = await fixture({
    provider: { loadUserInfo: true },
    userInfo: { sub: 'other' },
  });
  try {
    await assert.rejects(
      mismatch.first.complete(
        mismatch.config.id,
        owner,
        await mismatch.begin()
      ),
      { code: 'LOGIN_DENIED' }
    );
  } finally {
    await mismatch.close();
  }
  // Provider mappings must retain their distinct email-verification semantics.
  for (const profile of ['google', 'microsoft']) {
    /** Isolated fixture owners, scripted transport and deterministic fault controls. */
    const f = await fixture({ provider: { profile } });
    try {
      /** Actual verified identity/state receipt checked by the following assertions. */
      const result = await f.first.complete(
        f.config.id,
        owner,
        await f.begin()
      );
      assert.equal(result.identity.emailVerified, profile === 'google');
    } finally {
      await f.close();
    }
  }
  /** Scripted OAuth profile case with explicit verification semantics. */
  const discord = await fixture({
    provider: {
      profile: 'discord',
      protocol: 'oauth2',
      scopes: ['identify', 'email'],
    },
    userInfo: { id: '123456', verified: true, email: 'verified@example.test' },
  });
  try {
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = await discord.first.complete(
      discord.config.id,
      owner,
      await discord.begin()
    );
    assert.equal(result.identity.subject, '123456');
    assert.equal(result.identity.emailVerified, true);
  } finally {
    await discord.close();
  }
});
test('simultaneous callbacks consume once; declared authorization issuer is mandatory', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture({ provider: { requireAuthorizationIssuer: true } });
  try {
    /** Missing-issuer callback expected to deny before token exchange. */
    const invalid = await f.begin();
    await assert.rejects(f.first.complete(f.config.id, owner, invalid), {
      code: 'LOGIN_DENIED',
    });
    /** Fresh synthetic callback for one hostile claim/dependency case. */
    const cb = await f.begin();
    cb.set('iss', f.config.issuer);
    /** Concurrent outcomes used to assert exactly one credential/state completion. */
    const results = await Promise.allSettled([
      f.first.complete(f.config.id, owner, cb),
      f.second.complete(f.config.id, owner, cb),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1
    );
  } finally {
    await f.close();
  }
});
test('pending store failure retains admission until native settlement and deadline prevents later exchange', async () => {
  let release, started;
  /** Deterministic start gate for a blocked native/store operation. */
  const ready = new Promise((resolve) => (started = resolve));
  /** Reference fixture retained while one manager injects a dependency failure. */
  const base = await fixture();
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = {
    ...base.options.store,
    async take(...args) {
      /** Actual reference store result delayed by the host-controlled test gate. */
      const value = await base.options.store.take(...args);
      started();
      await new Promise((resolve) => (release = resolve));
      return value;
    },
  };
  /** Inert serialized client data or isolated provider client; no browser is started. */
  const client = auth.createProviderLogin({
    ...base.options,
    store,
    maxPending: 1,
    timeoutMs: 15,
  });
  try {
    /** Synthetic bound callback parameters, never actual authorization codes. */
    const callback = await base.begin(client);
    /** Outstanding test-controlled native/store work; actual settlement must retain its slot. */
    const pending = client.complete(base.config.id, owner, callback);
    await ready;
    await assert.rejects(pending, { code: 'LOGIN_UNAVAILABLE' });
    await assert.rejects(client.begin(base.config.id, owner, redirectUri), {
      code: 'LOGIN_CAPACITY',
    });
    let closed = false;
    /** Observed close promise; it must wait for actual fixture work settlement. */
    const closing = client.close().then(() => (closed = true));
    await Promise.resolve();
    assert.equal(closed, false);
    release();
    await closing;
    assert.equal(base.calls.length, 0);
  } finally {
    release?.();
    await client.close();
    await base.close();
  }
});

test('OAuth state indexes are keyed MACs of generated 256-bit tokens, not password hashes', async () => {
  /** Native HMAC used to assert exact protocol index compatibility, not password hashing. */
  const { createHmac } = require('node:crypto');
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = await fixture();
  try {
    /** Synthetic bound callback parameters, never actual authorization codes. */
    const callback = await f.begin();
    /** Generated opaque synthetic state whose keyed lookup identity is asserted. */
    const state = callback.get('state');
    /** Captured bound attempt; verifier/state remain private to this test. */
    const record = f.records.at(-1);
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(state, 'base64url').length, 32);
    /** Expected exact domain-separated protocol lookup digest helper.
     * @param {string} domain - Fixed expected protocol purpose.
     * @param {unknown[]} values - Exact synthetic identity tuple.
     * @returns {string} Expected exact domain-separated protocol lookup digest helper. */
    const index = (domain, values) =>
      createHmac('sha256', f.options.bindingKey)
        .update(JSON.stringify(['zeruxjs.auth.provider.v1', domain, ...values]))
        .digest('base64url');
    assert.equal(record.key, index('state', [f.config.id, state]));
    assert.equal(
      record.session,
      index('session', [owner.tenant, owner.session])
    );
    assert.notEqual(record.key, state);
    assert.notEqual(record.session, owner.session);
    assert.equal(
      f.calls.length,
      0,
      'creating a local login attempt makes no provider request'
    );
  } finally {
    await f.close();
  }
});
