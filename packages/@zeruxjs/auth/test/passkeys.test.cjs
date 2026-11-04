const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, randomBytes, sign } = require('node:crypto');
const { encodeCBOR } = require('@levischuck/tiny-cbor');
const auth = require('../dist/index.js');
const account = { tenant: 'tenant-a', account: 'alice' }, session = 'server-session-id';
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const hash = bytes => createHash('sha256').update(bytes).digest();
function authenticator() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' }), id = randomBytes(32);
    const cose = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
    function data(rpId, flags, counter) { const tail = Buffer.alloc(5); tail[0] = flags; tail.writeUInt32BE(counter, 1); return Buffer.concat([hash(rpId), tail]); }
    return {
        id: b64(id),
        registration(options, extra = {}) {
            const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: 'https://example.test', crossOrigin: false, ...extra.client }));
            const length = Buffer.alloc(2); length.writeUInt16BE(id.length);
            const authData = Buffer.concat([data(extra.rpId ?? 'example.test', extra.flags ?? 0x45, 0), Buffer.alloc(16), length, id, cose]);
            return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(client), attestationObject: b64(encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]))) } };
        },
        assertion(options, userHandle, counter = 1, extra = {}) {
            const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: 'https://example.test', crossOrigin: false, ...extra.client }));
            const authData = data(extra.rpId ?? 'example.test', extra.flags ?? 5, counter);
            const signature = sign('sha256', Buffer.concat([authData, hash(client)]), privateKey);
            if (extra.tamper) signature[signature.length - 1] ^= 1;
            return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signature), userHandle } };
        }
    };
}
function fixture(extra = {}) {
    let now = 10000, authorized = true;
    const store = auth.createMemoryPasskeyStore();
    const config = { store, rpId: 'example.test', rpName: 'Example', origins: ['https://example.test'], bindingKey: randomBytes(32), authorizeFresh: async () => authorized, now: () => now, ...extra };
    const manager = auth.createPasskeyManager(config), other = auth.createPasskeyManager(config);
    return { manager, other, config, store, deny: () => authorized = false, advance: value => now += value, close: async () => { await manager.close(); await other.close(); store.clear(); } };
}
async function enroll(f, device) {
    const begun = await f.manager.beginRegistration(account, session, 'Alice');
    const result = await f.other.completeRegistration(account, session, begun.id, device.registration(begun.options));
    assert.equal(result.credentialId, device.id); return begun.options.user.id;
}
test('real software credential registration and ES256 assertion; replay/counter and ownership checks', async () => {
    const f = fixture(), device = authenticator();
    try {
        const handle = await enroll(f, device);
        const begun = await f.manager.beginAuthentication(account, session);
        const response = device.assertion(begun.options, handle);
        const result = await f.other.completeAuthentication(account, session, begun.id, response);
        assert.equal(result.method, 'webauthn'); assert.equal(result.account, 'alice');
        await assert.rejects(f.manager.completeAuthentication(account, session, begun.id, response), { code: 'PASSKEY_DENIED' });
        const next = await f.manager.beginAuthentication(account, session);
        await assert.rejects(f.manager.completeAuthentication(account, session, next.id, device.assertion(next.options, handle, 1)), { code: 'PASSKEY_DENIED' });
        const third = await f.manager.beginAuthentication(account, session);
        await assert.rejects(f.manager.completeAuthentication({ ...account, tenant: 'other' }, session, third.id, device.assertion(third.options, handle, 2)), { code: 'PASSKEY_DENIED' });
        await assert.rejects(f.manager.completeAuthentication(account, 'wrong-session', third.id, device.assertion(third.options, handle, 2)), { code: 'PASSKEY_DENIED' });
        assert.equal((await f.manager.completeAuthentication(account, session, third.id, device.assertion(third.options, handle, 2))).credentialId, device.id);
    } finally { await f.close(); }
});
test('wrong origin/RP/challenge, absent presence/verification and cross-origin registration fail', async () => {
    const f = fixture(), device = authenticator();
    try {
        for (const extra of [{ client: { origin: 'https://evil.test' } }, { rpId: 'evil.test' }, { client: { challenge: 'wrong' } }, { flags: 0x41 }, { flags: 0x44 }, { client: { crossOrigin: true } }]) {
            const begun = await f.manager.beginRegistration(account, session, 'Alice');
            await assert.rejects(f.manager.completeRegistration(account, session, begun.id, device.registration(begun.options, extra)), error => error.code === 'PASSKEY_DENIED' && error.message === 'PASSKEY_DENIED');
            await assert.rejects(f.manager.completeRegistration(account, session, begun.id, device.registration(begun.options)), { code: 'PASSKEY_DENIED' });
        }
        assert.equal((await f.store.list({ ...account, rpId: 'example.test' })).length, 0);
    } finally { await f.close(); }
});
test('assertion signature, RP/origin, userHandle and UV failures are denied without accepting counters', async () => {
    const f = fixture(), device = authenticator();
    try {
        const handle = await enroll(f, device);
        for (const extra of [{ tamper: true }, { rpId: 'other.test' }, { client: { origin: 'https://evil.test' } }, { flags: 1 }, { flags: 4 }, { client: { crossOrigin: true } }]) {
            const begun = await f.manager.beginAuthentication(account, session);
            await assert.rejects(f.manager.completeAuthentication(account, session, begun.id, device.assertion(begun.options, handle, 1, extra)), { code: 'PASSKEY_DENIED' });
        }
        const begun = await f.manager.beginAuthentication(account, session);
        await assert.rejects(f.manager.completeAuthentication(account, session, begun.id, device.assertion(begun.options, b64(randomBytes(32)))), { code: 'PASSKEY_DENIED' });
    } finally { await f.close(); }
});
test('lost-device recovery atomically consumes all codes and revokes credentials/in-flight ceremonies', async () => {
    const f = fixture(), device = authenticator();
    try {
        const handle = await enroll(f, device), codes = await f.manager.createRecoveryCodes(account, session, 60000);
        const pending = await f.manager.beginAuthentication(account, session);
        const results = await Promise.allSettled([f.manager.recover(account, session, codes[0]), f.other.recover(account, session, codes[0])]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.find(r => r.status === 'fulfilled').value.method, 'recovery');
        await assert.rejects(f.manager.recover(account, session, codes[1]), { code: 'PASSKEY_DENIED' });
        await assert.rejects(f.manager.completeAuthentication(account, session, pending.id, device.assertion(pending.options, handle)), { code: 'PASSKEY_DENIED' });
        assert.equal((await f.store.list({ ...account, rpId: 'example.test' })).length, 0);
        await enroll(f, authenticator()); // host's fresh-proof callback authorizes replacement enrollment
    } finally { await f.close(); }
});
test('unauthorized enrollment/recovery enrollment/removal, expiry and invalid policies', async () => {
    const f = fixture();
    try {
        const device = authenticator(), begun = await f.manager.beginRegistration(account, session, 'Alice');
        f.deny();
        await assert.rejects(f.manager.beginRegistration(account, session, 'Alice'), { code: 'PASSKEY_DENIED' });
        await assert.rejects(f.manager.completeRegistration(account, session, begun.id, device.registration(begun.options)), { code: 'PASSKEY_DENIED' });
        await assert.rejects(f.manager.createRecoveryCodes(account, session, 10000), { code: 'PASSKEY_DENIED' });
        await assert.rejects(f.manager.removeCredential(account, session, device.id), { code: 'PASSKEY_DENIED' });
        assert.throws(() => auth.createPasskeyManager({ ...f.config, origins: ['https://evil.test'] }), { code: 'PASSKEY_DENIED' });
    } finally { await f.close(); }
    const expired = fixture();
    try {
        const device = authenticator(), begun = await expired.manager.beginRegistration(account, session, 'Alice');
        expired.advance(120000);
        await assert.rejects(expired.manager.completeRegistration(account, session, begun.id, device.registration(begun.options)), { code: 'PASSKEY_DENIED' });
        const codes = await expired.manager.createRecoveryCodes(account, session, 1000); expired.advance(1000);
        await assert.rejects(expired.manager.recover(account, session, codes[0]), { code: 'PASSKEY_DENIED' });
    } finally { await expired.close(); }
});
test('store outage and pending cleanup do not expose payloads or erase host keys', async () => {
    const base = fixture(); let release;
    const store = { ...base.store, list: async () => { await new Promise(resolve => release = resolve); throw Error('private-db-credential'); } };
    const manager = auth.createPasskeyManager({ ...base.config, store, maxPending: 1 });
    try {
        const pending = manager.beginRegistration(account, session, 'Alice');
        await Promise.resolve();
        await assert.rejects(manager.beginRegistration(account, session, 'Alice'), { code: 'PASSKEY_CAPACITY' });
        let closed = false; const closing = manager.close().then(() => closed = true);
        await Promise.resolve(); assert.equal(closed, false);
        await assert.rejects(manager.beginRegistration(account, session, 'Alice'), { code: 'PASSKEY_CLOSED' });
        release(); await assert.rejects(pending, error => error.code === 'PASSKEY_UNAVAILABLE' && !error.message.includes('credential') && error.cause.message === 'private-db-credential');
        await closing; assert.ok(base.config.bindingKey.some(byte => byte !== 0));
    } finally { await manager.close(); await base.close(); }
});
test('recovery fences assertion already taken by a verifier and zero counters use revision CAS', async () => {
    const f = fixture(), device = authenticator(), scope = { ...account, rpId: 'example.test' }; let racing;
    try {
        const handle = await enroll(f, device), codes = await f.manager.createRecoveryCodes(account, session, 60000);
        const begun = await f.manager.beginAuthentication(account, session);
        let release, taken;
        const ready = new Promise(resolve => taken = resolve);
        const store = { ...f.store, takeChallenge: async (...args) => { const result = await f.store.takeChallenge(...args); taken(); await new Promise(resolve => release = resolve); return result; } };
        racing = auth.createPasskeyManager({ ...f.config, store });
        const verification = racing.completeAuthentication(account, session, begun.id, device.assertion(begun.options, handle));
        await ready; await f.other.recover(account, session, codes[0]); release();
        await assert.rejects(verification, { code: 'PASSKEY_DENIED' });
        assert.equal((await f.store.list(scope)).length, 0);
        // A fresh zero-counter credential can succeed, but the same stored revision cannot advance twice.
        const newDevice = authenticator(); await enroll(f, newDevice);
        const challenge = await f.manager.beginAuthentication(account, session);
        const lease = await f.store.takeChallenge(scope, challenge.id, session, 'authentication', 10000);
        const [credential] = await f.store.list(scope);
        assert.equal(await f.store.advance(scope, credential.id, credential.revision, 0, lease.epoch, false), true);
        assert.equal(await f.store.advance(scope, credential.id, credential.revision, 0, lease.epoch, false), false);
    } finally { await racing?.close(); await f.close(); }
});
test('bounded direct response processing, challenge limits and RP-wide credential uniqueness', async () => {
    const f = fixture(), device = authenticator();
    try {
        await enroll(f, device);
        const begun = await f.manager.beginAuthentication(account, session);
        const oversized = { type: 'public-key', id: device.id, rawId: device.id, response: { clientDataJSON: 'a'.repeat(131073) } };
        await assert.rejects(f.manager.completeAuthentication(account, session, begun.id, oversized), { code: 'PASSKEY_DENIED' });
        const otherAccount = { ...account, account: 'bob' };
        const duplicate = await f.manager.beginRegistration(otherAccount, session, 'Bob');
        await assert.rejects(f.manager.completeRegistration(otherAccount, session, duplicate.id, device.registration(duplicate.options)), { code: 'PASSKEY_DENIED' });
        for (let i = 0; i < 8; i++) await f.manager.beginAuthentication(account, session);
        await assert.rejects(f.manager.beginAuthentication(account, session), { code: 'PASSKEY_CAPACITY' });
    } finally { await f.close(); }
});
test('concurrent assertion claims allow one completion; non-counting authenticator still requires fresh challenge', async () => {
    const f = fixture(), device = authenticator();
    try {
        const handle = await enroll(f, device), begun = await f.manager.beginAuthentication(account, session);
        const response = device.assertion(begun.options, handle, 0);
        const results = await Promise.allSettled([f.manager.completeAuthentication(account, session, begun.id, response), f.other.completeAuthentication(account, session, begun.id, response)]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        const next = await f.manager.beginAuthentication(account, session);
        assert.equal((await f.other.completeAuthentication(account, session, next.id, device.assertion(next.options, handle, 0))).method, 'webauthn');
    } finally { await f.close(); }
});
