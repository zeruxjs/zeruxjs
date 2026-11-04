const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const auth = require('../dist/index.js');
const account = { tenant: 'tenant-a', account: 'alice' };
function fixture(extra = {}) {
    let time = 60000, authorized = true;
    const store = auth.createMemoryAuthPersistence({ now: () => time, maxAccounts: 2 });
    const config = { store, indexKey: randomBytes(32), keys: [{ id: 'old', key: randomBytes(32) }], activeKeyId: 'old', now: () => time, authorizeFresh: async () => authorized, ...extra };
    const first = auth.createSharedAuth(config), second = auth.createSharedAuth(config);
    return { first, second, store, config, advance: ms => time += ms, deny: () => authorized = false, close: async () => { await first.close(); await second.close(); store.clear(); } };
}
test('cross-manager sessions: inventory, exact scopes, tenant binding, rotate and revoke', async () => {
    const f = fixture();
    try {
        const issued = await f.first.issueSession(account, { device: 'laptop', scopes: ['read'], ttlMs: 10000 });
        assert.equal((await f.second.verifySession(account, issued.token, 'read')).device, 'laptop');
        assert.equal(await f.second.verifySession(account, issued.token, 'write'), null);
        assert.equal(await f.second.verifySession({ ...account, tenant: 'other' }, issued.token), null);
        assert.equal((await f.first.inventory(account)).length, 1);
        const rotated = await f.second.rotateSession(account, issued.token, ['admin']);
        assert.notEqual(rotated.session.id, issued.session.id);
        assert.equal(await f.first.verifySession(account, issued.token), null);
        assert.ok(await f.first.verifySession(account, rotated.token, 'admin'));
        assert.equal(await f.second.revoke(account, rotated.session.id), 1);
        assert.equal(await f.first.verifySession(account, rotated.token), null);
        const expired = await f.first.issueSession(account, { device: 'phone', scopes: [], ttlMs: 10 });
        f.advance(10); assert.equal(await f.second.verifySession(account, expired.token), null);
        f.deny(); await assert.rejects(f.first.revoke(account), { code: 'AUTH_INVALID' });
        await assert.rejects(f.first.inventory(account), { code: 'AUTH_INVALID' });
    } finally { await f.close(); }
});
test('atomic challenge consume, purpose/account binding, attempts and exact expiry', async () => {
    const f = fixture();
    try {
        for (const purpose of ['reset', 'otp', 'magic']) {
            const c = await f.first.issueChallenge(account, { purpose, ttlMs: 10000, maxAttempts: 2 });
            const wrong = purpose === 'otp' ? 'reset' : 'otp';
            assert.equal(await f.second.consumeChallenge(account, { ...c, purpose: wrong }), false);
            assert.equal(await f.second.consumeChallenge({ ...account, account: 'bob' }, { ...c, purpose }), false);
            const decisions = await Promise.all([f.first, f.second].map(manager => manager.consumeChallenge(account, { ...c, purpose })));
            assert.deepEqual(decisions.sort(), [false, true]);
            assert.equal(await f.first.consumeChallenge(account, { ...c, purpose }), false);
        }
        const c = await f.first.issueChallenge(account, { purpose: 'otp', ttlMs: 10000, maxAttempts: 2 });
        const wrongSecret = c.secret === '000000' ? '999999' : '000000';
        for (let i = 0; i < 2; i++) assert.equal(await f.first.consumeChallenge(account, { ...c, purpose: 'otp', secret: wrongSecret }), false);
        assert.equal(await f.second.consumeChallenge(account, { ...c, purpose: 'otp' }), false);
        const expired = await f.first.issueChallenge(account, { purpose: 'reset', ttlMs: 10 });
        f.advance(10); assert.equal(await f.second.consumeChallenge(account, { ...expired, purpose: 'reset' }), false);
    } finally { await f.close(); }
});
test('TOTP replay is atomic across managers and credentials are bounded', async () => {
    const f = fixture(), secret = auth.generateTotpSecret();
    try {
        const code = auth.generateTotp(secret, { now: 60000 });
        const results = await Promise.all([f.first, f.second].map(m => m.consumeTotp(account, 'authenticator', code, secret, { window: 0 })));
        assert.deepEqual(results.sort(), [false, true]);
        assert.equal(await f.first.consumeTotp(account, 'authenticator', code, secret), false);
        f.advance(30000);
        const next = auth.generateTotp(secret, { now: 90000 });
        assert.equal(await f.second.consumeTotp(account, 'authenticator', next, secret, { window: 0 }), true);
        await assert.rejects(f.first.consumeTotp(account, 'a', code, secret, { digits: '6}.*{' }), { code: 'AUTH_INVALID' });
        assert.throws(() => auth.generateTotp(secret, { algorithm: 'md5' }), /Invalid TOTP algorithm/);
    } finally { await f.close(); }
});
test('key rotation: previous verification, new issuance, retirement invalidates old sessions/challenges', async () => {
    const f = fixture(); let rotating, retired;
    try {
        const old = await f.first.issueSession(account, { device: 'a', scopes: [], ttlMs: 10000 });
        const challenge = await f.first.issueChallenge(account, { purpose: 'magic', ttlMs: 10000 });
        const nextKey = { id: 'next', key: randomBytes(32) };
        rotating = auth.createSharedAuth({ ...f.config, keys: [...f.config.keys, nextKey], activeKeyId: 'next' });
        assert.ok(await rotating.verifySession(account, old.token));
        const next = await rotating.issueSession(account, { device: 'b', scopes: [], ttlMs: 10000 });
        retired = auth.createSharedAuth({ ...f.config, keys: [nextKey], activeKeyId: 'next' });
        assert.equal(await retired.verifySession(account, old.token), null);
        assert.ok(await retired.verifySession(account, next.token));
        assert.equal(await retired.consumeChallenge(account, { ...challenge, purpose: 'magic' }), false);
        assert.equal(await rotating.revoke(account), 2);
        assert.equal(await retired.verifySession(account, next.token), null);
    } finally { await rotating?.close(); await retired?.close(); await f.close(); }
});
test('cookie boundary rejects duplicate, encoded, malformed and control-bearing credentials', async () => {
    const f = fixture();
    try {
        const { token } = await f.first.issueSession(account, { device: 'a', scopes: [], ttlMs: 1000 });
        assert.equal(auth.readAuthSessionCookie(`other=1; __Host-session=${token}`), token);
        assert.match(auth.authSessionCookie(token, 1), /Secure; HttpOnly; SameSite=Strict/);
        for (const header of [`__Host-session=${token}; __Host-session=${token}`, '__Host-session=%41', `__Host-session=${token}\r\nX: y`, 'broken', 'x='.repeat(9000)]) assert.equal(auth.readAuthSessionCookie(header), null);
        assert.throws(() => auth.authSessionCookie('bad\r\n', 10), { code: 'AUTH_INVALID' });
    } finally { await f.close(); }
});
test('backend failure is redacted; pending operations drain before close and borrowed store survives', async () => {
    const f = fixture(); await f.close();
    let release, calls = 0;
    const store = { capability: 'auth-cas-v1', read: async () => { calls++; await new Promise(resolve => release = resolve); throw new Error('private-db-password'); }, compareAndSwap: async () => true };
    const manager = auth.createSharedAuth({ ...f.config, store, maxPending: 1 });
    const operation = manager.verifySession(account, `${'a'.repeat(22)}.${'b'.repeat(43)}`);
    await assert.rejects(manager.inventory(account), { code: 'AUTH_CAPACITY' });
    let settled = false; const closing = manager.close().then(() => settled = true);
    await Promise.resolve(); assert.equal(settled, false);
    await assert.rejects(manager.revoke(account), { code: 'AUTH_CLOSED' });
    release();
    await assert.rejects(operation, error => error.code === 'AUTH_UNAVAILABLE' && !error.message.includes('password') && error.cause.message === 'private-db-password');
    await closing; assert.equal(calls, 1); assert.equal(settled, true);
});
test('capacity, invalid policies, memory direct boundaries and failed writes do not return credentials', async () => {
    const f = fixture();
    try {
        await assert.rejects(f.first.issueSession(account, { device: 'a', scopes: ['*'], ttlMs: 1 }), { code: 'AUTH_INVALID' });
        await assert.rejects(f.first.issueChallenge(account, { purpose: 'reset', ttlMs: 900001 }), { code: 'AUTH_INVALID' });
        for (let i = 0; i < 32; i++) await f.first.issueChallenge(account, { purpose: 'otp', ttlMs: 1000 });
        await assert.rejects(f.first.issueChallenge(account, { purpose: 'otp', ttlMs: 1000 }), { code: 'AUTH_CAPACITY' });
        await assert.rejects(f.store.compareAndSwap('a'.repeat(43), null, { sessions: [], challenges: [], steps: { __proto__: null, bad: 0 } }, 100000), { code: 'AUTH_INVALID' });
        const unavailable = auth.createSharedAuth({ ...f.config, store: { capability: 'auth-cas-v1', read: async () => null, compareAndSwap: async () => false } });
        try { await assert.rejects(unavailable.issueSession(account, { device: 'a', scopes: [], ttlMs: 1 }), { code: 'AUTH_UNAVAILABLE' }); } finally { await unavailable.close(); }
    } finally { await f.close(); }
});
test('challenge revocation isolates purposes and fresh authorization denies rotation without mutation', async () => {
    const f = fixture();
    try {
        const magic = await f.first.issueChallenge(account, { purpose: 'magic', ttlMs: 1000 });
        const reset = await f.first.issueChallenge(account, { purpose: 'reset', ttlMs: 1000 });
        assert.equal(await f.second.revokeChallenges(account, 'magic'), 1);
        assert.equal(await f.first.consumeChallenge(account, { ...magic, purpose: 'magic' }), false);
        assert.equal(await f.first.consumeChallenge(account, { ...reset, purpose: 'reset' }), true);
        const issued = await f.first.issueSession(account, { device: 'a', scopes: ['read'], ttlMs: 1000 });
        const inventory = await f.first.inventory(account); inventory[0].scopes.push('admin');
        assert.equal(await f.second.verifySession(account, issued.token, 'admin'), null);
        assert.equal('digest' in inventory[0], false); assert.equal('kid' in inventory[0], false);
        f.deny();
        await assert.rejects(f.first.rotateSession(account, issued.token, ['admin']), { code: 'AUTH_INVALID' });
        await assert.rejects(f.first.revokeChallenges(account), { code: 'AUTH_INVALID' });
        assert.ok(await f.second.verifySession(account, issued.token, 'read'));
    } finally { await f.close(); }
});
test('bounded TOTP enrollment, account expiry cleanup and fail-closed malformed adapter success', async () => {
    const f = fixture(), secret = auth.generateTotpSecret(), code = auth.generateTotp(secret, { now: 60000 });
    try {
        for (let i = 0; i < 16; i++) assert.equal(await f.first.consumeTotp(account, `credential-${i}`, code, secret), true);
        await assert.rejects(f.first.consumeTotp(account, 'overflow', code, secret), { code: 'AUTH_CAPACITY' });
        assert.equal(f.store.size, 1);
        f.advance(3600000); assert.equal(f.store.size, 0);
        const malformed = auth.createSharedAuth({ ...f.config, store: { capability: 'auth-cas-v1', read: async () => null, compareAndSwap: async () => 1 } });
        try { await assert.rejects(malformed.issueSession(account, { device: 'a', scopes: [], ttlMs: 10 }), { code: 'AUTH_UNAVAILABLE' }); } finally { await malformed.close(); }
    } finally { await f.close(); }
});
