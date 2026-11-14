/** Node test entry; no application server or live provider is started. */
const { test } = require('node:test');
/** Local assertions over synthetic cryptographic/persistence fixtures. */
const assert = require('node:assert/strict');
/** Native fixture entropy for ephemeral keys; never production key material. */
const { randomBytes } = require('node:crypto');
/** Built package public authentication exports under test. */
const auth = require('../dist/index.js');
/** Synthetic host-verified account/tenant; never a real user identity. */
const account = { tenant: 'tenant-a', account: 'alice' };
/** Create isolated credential owners with deterministic clocks, explicit proof policy and scripted native failures.
 * @param {object} extra - Explicit trusted fixture overrides, default empty.
 * @returns {object|Promise<object>} Fixture handles with explicit close/clear teardown.
 */
function fixture(extra = {}) {
  let time = 60000,
    authorized = true;
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = auth.createMemoryAuthPersistence({
    now: () => time,
    maxAccounts: 2,
  });
  /** Explicit private fixture RP/provider/clock/authorization settings. */
  const config = {
    store,
    indexKey: randomBytes(32),
    keys: [{ id: 'old', key: randomBytes(32) }],
    activeKeyId: 'old',
    now: () => time,
    authorizeFresh: async () => authorized,
    ...extra,
  };
  /** First independent fixture manager sharing only the declared reference store. */
  const first = auth.createSharedAuth(config);
  /** Independent fixture manager/credential sharing only explicitly supplied reference state. */
  const second = auth.createSharedAuth(config);
  return {
    first,
    second,
    store,
    config,
    advance: (ms: number) => (time += ms),
    deny: () => (authorized = false),
    close: async () => {
      await first.close();
      await second.close();
      store.clear();
    },
  };
}
test('cross-manager sessions: inventory, exact scopes, tenant binding, rotate and revoke', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  try {
    /** Actual committed issuance receipt checked for expiry/scope/secret behavior. */
    const issued = await f.first.issueSession(account, {
      device: 'laptop',
      scopes: ['read'],
      ttlMs: 10000,
    });
    assert.equal(
      (await f.second.verifySession(account, issued.token, 'read')).device,
      'laptop'
    );
    assert.equal(
      await f.second.verifySession(account, issued.token, 'write'),
      null
    );
    assert.equal(
      await f.second.verifySession(
        { ...account, tenant: 'other' },
        issued.token
      ),
      null
    );
    assert.equal((await f.first.inventory(account)).length, 1);
    /** New atomically rotated bearer receipt; the old token must no longer verify. */
    const rotated = await f.second.rotateSession(account, issued.token, [
      'admin',
    ]);
    assert.notEqual(rotated.session.id, issued.session.id);
    assert.equal(await f.first.verifySession(account, issued.token), null);
    assert.ok(await f.first.verifySession(account, rotated.token, 'admin'));
    assert.equal(await f.second.revoke(account, rotated.session.id), 1);
    assert.equal(await f.first.verifySession(account, rotated.token), null);
    /** Fixture whose trusted clock advances past exact proof expiry. */
    const expired = await f.first.issueSession(account, {
      device: 'phone',
      scopes: [],
      ttlMs: 10,
    });
    f.advance(10);
    assert.equal(await f.second.verifySession(account, expired.token), null);
    f.deny();
    await assert.rejects(f.first.revoke(account), { code: 'AUTH_INVALID' });
    await assert.rejects(f.first.inventory(account), { code: 'AUTH_INVALID' });
  } finally {
    await f.close();
  }
});
test('atomic challenge consume, purpose/account binding, attempts and exact expiry', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  try {
    // Verify reset/otp/magic proof stays account/purpose-bound and consumes once across managers.
    for (const purpose of ['reset', 'otp', 'magic']) {
      /** Private synthetic purpose-bound challenge issuance receipt. */
      const c = await f.first.issueChallenge(account, {
        purpose,
        ttlMs: 10000,
        maxAttempts: 2,
      });
      /** Deliberately wrong challenge purpose used to assert exact binding. */
      const wrong = purpose === 'otp' ? 'reset' : 'otp';
      assert.equal(
        await f.second.consumeChallenge(account, { ...c, purpose: wrong }),
        false
      );
      assert.equal(
        await f.second.consumeChallenge(
          { ...account, account: 'bob' },
          { ...c, purpose }
        ),
        false
      );
      /** Concurrent one-use challenge results; only one manager may consume proof. */
      const decisions = await Promise.all(
        [f.first, f.second].map((manager) =>
          manager.consumeChallenge(account, { ...c, purpose })
        )
      );
      assert.deepEqual(decisions.sort(), [false, true]);
      assert.equal(
        await f.first.consumeChallenge(account, { ...c, purpose }),
        false
      );
    }
    /** Private synthetic purpose-bound challenge issuance receipt. */
    const c = await f.first.issueChallenge(account, {
      purpose: 'otp',
      ttlMs: 10000,
      maxAttempts: 2,
    });
    /** Known-wrong synthetic code that cannot accidentally equal the issued OTP. */
    const wrongSecret = c.secret === '000000' ? '999999' : '000000';
    // Exhaust exactly the configured failure budget; correct proof cannot revive the challenge.
    for (let i = 0; i < 2; i++) {
      assert.equal(
        await f.first.consumeChallenge(account, {
          ...c,
          purpose: 'otp',
          secret: wrongSecret,
        }),
        false
      );
    }
    assert.equal(
      await f.second.consumeChallenge(account, { ...c, purpose: 'otp' }),
      false
    );
    /** Fixture whose trusted clock advances past exact proof expiry. */
    const expired = await f.first.issueChallenge(account, {
      purpose: 'reset',
      ttlMs: 10,
    });
    f.advance(10);
    assert.equal(
      await f.second.consumeChallenge(account, {
        ...expired,
        purpose: 'reset',
      }),
      false
    );
  } finally {
    await f.close();
  }
});
test('TOTP replay is atomic across managers and credentials are bounded', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable test-only secret or RFC vector; never a production key. */
  const secret = auth.generateTotpSecret();
  try {
    /** Private deterministic/fixture TOTP code tested only against isolated replay state. */
    const code = auth.generateTotp(secret, { now: 60000 });
    /** Concurrent outcomes used to assert exactly one credential/state completion. */
    const results = await Promise.all(
      [f.first, f.second].map((m) =>
        m.consumeTotp(account, 'authenticator', code, secret, { window: 0 })
      )
    );
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(
      await f.first.consumeTotp(account, 'authenticator', code, secret),
      false
    );
    f.advance(30000);
    /** Fresh next-step code/ceremony proving old proof is not reused. */
    const next = auth.generateTotp(secret, { now: 90000 });
    assert.equal(
      await f.second.consumeTotp(account, 'authenticator', next, secret, {
        window: 0,
      }),
      true
    );
    await assert.rejects(
      f.first.consumeTotp(account, 'a', code, secret, { digits: '6}.*{' }),
      { code: 'AUTH_INVALID' }
    );
    assert.throws(
      () => auth.generateTotp(secret, { algorithm: 'md5' }),
      /Invalid TOTP algorithm/
    );
  } finally {
    await f.close();
  }
});
test('key rotation: previous verification, new issuance, retirement invalidates old sessions/challenges', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  let rotating, retired;
  try {
    /** Earlier session/key-generation receipt retained to verify rotation compatibility. */
    const old = await f.first.issueSession(account, {
      device: 'a',
      scopes: [],
      ttlMs: 10000,
    });
    /** Fresh one-use challenge bound to the account/session/kind. */
    const challenge = await f.first.issueChallenge(account, {
      purpose: 'magic',
      ttlMs: 10000,
    });
    /** Fresh disposable rotating key; host input bytes must remain untouched. */
    const nextKey = { id: 'next', key: randomBytes(32) };
    rotating = auth.createSharedAuth({
      ...f.config,
      keys: [...f.config.keys, nextKey],
      activeKeyId: 'next',
    });
    assert.ok(await rotating.verifySession(account, old.token));
    /** Fresh next-step code/ceremony proving old proof is not reused. */
    const next = await rotating.issueSession(account, {
      device: 'b',
      scopes: [],
      ttlMs: 10000,
    });
    retired = auth.createSharedAuth({
      ...f.config,
      keys: [nextKey],
      activeKeyId: 'next',
    });
    assert.equal(await retired.verifySession(account, old.token), null);
    assert.ok(await retired.verifySession(account, next.token));
    assert.equal(
      await retired.consumeChallenge(account, {
        ...challenge,
        purpose: 'magic',
      }),
      false
    );
    assert.equal(await rotating.revoke(account), 2);
    assert.equal(await retired.verifySession(account, next.token), null);
  } finally {
    await rotating?.close();
    await retired?.close();
    await f.close();
  }
});
test('cookie boundary rejects duplicate, encoded, malformed and control-bearing credentials', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  try {
    /** Private synthetic session bearer returned only after state commit. */
    const { token } = await f.first.issueSession(account, {
      device: 'a',
      scopes: [],
      ttlMs: 1000,
    });
    assert.equal(
      auth.readAuthSessionCookie(`other=1; __Host-session=${token}`),
      token
    );
    assert.match(
      auth.authSessionCookie(token, 1),
      /Secure; HttpOnly; SameSite=Strict/
    );
    // Reject duplicate, encoded, control-bearing and malformed selected cookies uniformly.
    for (const header of [
      `__Host-session=${token}; __Host-session=${token}`,
      '__Host-session=%41',
      `__Host-session=${token}\r\nX: y`,
      'broken',
      'x='.repeat(9000),
    ]) {
      assert.equal(auth.readAuthSessionCookie(header), null);
    }
    assert.throws(() => auth.authSessionCookie('bad\r\n', 10), {
      code: 'AUTH_INVALID',
    });
  } finally {
    await f.close();
  }
});
test('backend failure is redacted; pending operations drain before close and borrowed store survives', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  await f.close();
  let release: (() => void) | undefined,
    calls = 0;
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = {
    capability: 'auth-cas-v1',
    read: async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error('private-db-password');
    },
    compareAndSwap: async () => true,
  };
  /** Owned verification manager, drained before clearing borrowed fixture stores. */
  const manager = auth.createSharedAuth({ ...f.config, store, maxPending: 1 });
  /** Outstanding storage lookup whose rejection and actual cleanup are observed. */
  const operation = manager.verifySession(
    account,
    `${'a'.repeat(22)}.${'b'.repeat(43)}`
  );
  await assert.rejects(manager.inventory(account), { code: 'AUTH_CAPACITY' });
  let settled = false;
  /** Observed close promise; it must wait for actual fixture work settlement. */
  const closing = manager.close().then(() => (settled = true));
  await Promise.resolve();
  assert.equal(settled, false);
  await assert.rejects(manager.revoke(account), { code: 'AUTH_CLOSED' });
  if (!release) {
    throw new Error('Pending auth operation did not expose a release handle');
  }
  release();
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AUTH_UNAVAILABLE' &&
      !error.message.includes('password') &&
      'cause' in error &&
      error.cause instanceof Error &&
      error.cause.message === 'private-db-password'
  );
  await closing;
  assert.equal(calls, 1);
  assert.equal(settled, true);
});
test('capacity, invalid policies, memory direct boundaries and failed writes do not return credentials', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  try {
    await assert.rejects(
      f.first.issueSession(account, { device: 'a', scopes: ['*'], ttlMs: 1 }),
      { code: 'AUTH_INVALID' }
    );
    await assert.rejects(
      f.first.issueChallenge(account, { purpose: 'reset', ttlMs: 900001 }),
      { code: 'AUTH_INVALID' }
    );
    // Fill the explicit challenge cap without evicting still-live proofs.
    for (let i = 0; i < 32; i++) {
      await f.first.issueChallenge(account, { purpose: 'otp', ttlMs: 1000 });
    }
    await assert.rejects(
      f.first.issueChallenge(account, { purpose: 'otp', ttlMs: 1000 }),
      { code: 'AUTH_CAPACITY' }
    );
    await assert.rejects(
      f.store.compareAndSwap(
        'a'.repeat(43),
        null,
        { sessions: [], challenges: [], steps: { __proto__: null, bad: 0 } },
        100000
      ),
      { code: 'AUTH_INVALID' }
    );
    /** Manager whose CAS always loses; it must not return an issued credential. */
    const unavailable = auth.createSharedAuth({
      ...f.config,
      store: {
        capability: 'auth-cas-v1',
        read: async () => null,
        compareAndSwap: async () => false,
      },
    });
    try {
      await assert.rejects(
        unavailable.issueSession(account, {
          device: 'a',
          scopes: [],
          ttlMs: 1,
        }),
        { code: 'AUTH_UNAVAILABLE' }
      );
    } finally {
      await unavailable.close();
    }
  } finally {
    await f.close();
  }
});
test('challenge revocation isolates purposes and fresh authorization denies rotation without mutation', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  try {
    /** Synthetic magic challenge isolated from reset-purpose revocation. */
    const magic = await f.first.issueChallenge(account, {
      purpose: 'magic',
      ttlMs: 1000,
    });
    /** Synthetic reset challenge used to prove purpose-specific invalidation. */
    const reset = await f.first.issueChallenge(account, {
      purpose: 'reset',
      ttlMs: 1000,
    });
    assert.equal(await f.second.revokeChallenges(account, 'magic'), 1);
    assert.equal(
      await f.first.consumeChallenge(account, { ...magic, purpose: 'magic' }),
      false
    );
    assert.equal(
      await f.first.consumeChallenge(account, { ...reset, purpose: 'reset' }),
      true
    );
    /** Actual committed issuance receipt checked for expiry/scope/secret behavior. */
    const issued = await f.first.issueSession(account, {
      device: 'a',
      scopes: ['read'],
      ttlMs: 1000,
    });
    /** Detached public session metadata; mutation must not grant new scopes. */
    const inventory = await f.first.inventory(account);
    inventory[0].scopes.push('admin');
    assert.equal(
      await f.second.verifySession(account, issued.token, 'admin'),
      null
    );
    assert.equal('digest' in inventory[0], false);
    assert.equal('kid' in inventory[0], false);
    f.deny();
    await assert.rejects(
      f.first.rotateSession(account, issued.token, ['admin']),
      { code: 'AUTH_INVALID' }
    );
    await assert.rejects(f.first.revokeChallenges(account), {
      code: 'AUTH_INVALID',
    });
    assert.ok(await f.second.verifySession(account, issued.token, 'read'));
  } finally {
    await f.close();
  }
});
test('bounded TOTP enrollment, account expiry cleanup and fail-closed malformed adapter success', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable test-only secret or RFC vector; never a production key. */
  const secret = auth.generateTotpSecret();
  /** Private deterministic/fixture TOTP code tested only against isolated replay state. */
  const code = auth.generateTotp(secret, { now: 60000 });
  try {
    // Fill the enrolled credential replay-map cap without losing existing step guards.
    for (let i = 0; i < 16; i++) {
      assert.equal(
        await f.first.consumeTotp(account, `credential-${i}`, code, secret),
        true
      );
    }
    await assert.rejects(
      f.first.consumeTotp(account, 'overflow', code, secret),
      { code: 'AUTH_CAPACITY' }
    );
    assert.equal(f.store.size, 1);
    f.advance(3600000);
    assert.equal(f.store.size, 0);
    /** Adapter returning a truthy nonboolean CAS result; it must fail closed. */
    const malformed = auth.createSharedAuth({
      ...f.config,
      store: {
        capability: 'auth-cas-v1',
        read: async () => null,
        compareAndSwap: async () => 1,
      },
    });
    try {
      await assert.rejects(
        malformed.issueSession(account, { device: 'a', scopes: [], ttlMs: 10 }),
        { code: 'AUTH_UNAVAILABLE' }
      );
    } finally {
      await malformed.close();
    }
  } finally {
    await f.close();
  }
});
