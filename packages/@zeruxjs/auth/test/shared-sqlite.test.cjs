const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');
const auth = require('../dist/index.js');
// Test-only persistence implementation: real synchronous SQLite pins, no awaits inside BEGIN/COMMIT.
// It verifies the shared CAS contract; it is not a shipped/general database adapter.
test('independent SQLite connections persist consumption/revocation and preserve exact zero-row CAS', async () => {
    const { createConnector } = await import('@zeruxjs/db-sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'auth-cas-'));
    const connectors = [], managers = [];
    const account = { tenant: 'a', account: 'alice' };
    try {
        for (let i = 0; i < 2; i++) connectors.push(await createConnector({ driver: 'node', filename: join(dir, 'auth.sqlite'), busyTimeoutMs: 100, journalMode: 'wal' }));
        const result = connectors[0].transactionSync(tx => tx.execute({ op: 'createTable', table: 'auth_state', columns: [{ name: 'id', type: 'text', primary: true }, { name: 'revision', type: 'text' }, { name: 'value', type: 'text' }, { name: 'expires', type: 'integer' }] }));
        assert.equal(result.ok, true);
        const indexKey = randomBytes(32), keys = [{ id: 'v1', key: randomBytes(32) }];
        const adapter = db => ({
            capability: 'auth-cas-v1',
            async read(key) {
                const row = db.transactionSync(tx => tx.select({ table: 'auth_state', where: { field: 'id', operator: 'eq', value: key }, limit: 1 })).rows[0];
                return row && row.expires > Date.now() ? { revision: row.revision, value: JSON.parse(row.value) } : null;
            },
            async compareAndSwap(key, revision, value, expiresAt) {
                return db.transactionSync(tx => {
                    tx.delete({ table: 'auth_state', where: { and: [{ field: 'id', operator: 'eq', value: key }, { field: 'expires', operator: 'lte', value: Date.now() }] } });
                    const values = { revision: randomBytes(24).toString('base64url'), value: JSON.stringify(value), expires: expiresAt };
                    if (revision === null) {
                        if (tx.select({ table: 'auth_state', where: { field: 'id', operator: 'eq', value: key }, limit: 1 }).rowCount) return false;
                        return tx.insert({ table: 'auth_state', values: { id: key, ...values } }).affectedCount === 1;
                    }
                    return tx.update({ table: 'auth_state', values, where: { and: [{ field: 'id', operator: 'eq', value: key }, { field: 'revision', operator: 'eq', value: revision }] } }).affectedCount === 1;
                });
            }
        });
        for (const db of connectors) managers.push(auth.createSharedAuth({ store: adapter(db), indexKey, keys, activeKeyId: 'v1', authorizeFresh: async () => true }));
        const issued = await managers[0].issueSession(account, { device: 'a', scopes: ['read'], ttlMs: 10000 });
        assert.ok(await managers[1].verifySession(account, issued.token));
        const c = await managers[0].issueChallenge(account, { purpose: 'magic', ttlMs: 10000 });
        const results = await Promise.all(managers.map(m => m.consumeChallenge(account, { ...c, purpose: 'magic' })));
        assert.deepEqual(results.sort(), [false, true]);
        await managers[1].revoke(account);
        assert.equal(await managers[0].verifySession(account, issued.token), null);
        const rows = connectors[0].transactionSync(tx => tx.select({ table: 'auth_state' })).rows;
        assert.equal(rows.length, 1); assert.equal(JSON.stringify(rows).includes(issued.token), false);
        assert.equal(JSON.stringify(rows).includes(c.secret), false);
        assert.equal(await adapter(connectors[0]).compareAndSwap(rows[0].id, 'wrong-revision', JSON.parse(rows[0].value), Date.now() + 10000), false);
    } finally {
        await Promise.all(managers.map(m => m.close()));
        for (const db of connectors.reverse()) await db.disconnect();
        rmSync(dir, { recursive: true, force: true });
    }
});
