/** Node test entry; no application server or live provider is started. */
const { test } = require('node:test');
/** Local assertions over synthetic cryptographic/persistence fixtures. */
const assert = require('node:assert/strict');
/** Owned SQLite fixture directory creation/teardown helpers. */
const { mkdtempSync, rmSync } = require('node:fs');
/** Native temporary root used for owned synthetic fixtures. */
const { tmpdir } = require('node:os');
/** Native path join used only under the owned temporary root. */
const { join } = require('node:path');
/** Native fixture entropy for ephemeral keys; never production key material. */
const { randomBytes } = require('node:crypto');
/** Built package public authentication exports under test. */
const auth = require('../dist/index.js');
// Test-only persistence implementation: real synchronous SQLite pins, no awaits inside BEGIN/COMMIT.
// It verifies the shared CAS contract; it is not a shipped/general database adapter.
test('independent SQLite connections persist consumption/revocation and preserve exact zero-row CAS', async () => {
  /** Public SQLite factory used for disposable synthetic persistent state. */
  const { createConnector } = await import('@zeruxjs/db-sqlite');
  /** Owned temporary fixture root removed in finally. */
  const dir = mkdtempSync(join(tmpdir(), 'auth-cas-'));
  /** Owned independent SQLite connections to the same disposable fixture database. */
  const connectors = [];
  /** Owned shared-auth instances drained before SQLite teardown. */
  const managers = [];
  /** Synthetic host-verified account/tenant; never a real user identity. */
  const account = { tenant: 'a', account: 'alice' };
  try {
    // Open independent connections only to the same owned disposable fixture database.
    for (let i = 0; i < 2; i++) {
      connectors.push(
        await createConnector({
          driver: 'node',
          filename: join(dir, 'auth.sqlite'),
          busyTimeoutMs: 100,
          journalMode: 'wal',
        })
      );
    }
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = connectors[0].transactionSync((tx) =>
      tx.execute({
        op: 'createTable',
        table: 'auth_state',
        columns: [
          { name: 'id', type: 'text', primary: true },
          { name: 'revision', type: 'text' },
          { name: 'value', type: 'text' },
          { name: 'expires', type: 'integer' },
        ],
      })
    );
    assert.equal(result.ok, true);
    /** Disposable stable fixture account-index secret, separate from rotating token keys. */
    const indexKey = randomBytes(32);
    /** Disposable explicitly shared fixture token-key ring. */
    const keys = [{ id: 'v1', key: randomBytes(32) }];
    /** Injected native/synthetic state adapter used only against isolated data.
     * @param {object} db - Owned disposable synchronous SQLite connector.
     * @returns {object} Injected native/synthetic state adapter used only against isolated data. */
    const adapter = (db) => ({
      capability: 'auth-cas-v1',
      async read(key) {
        /** Current synthetic SQLite state row checked before returning a snapshot. */
        const row = db.transactionSync((tx) =>
          tx.select({
            table: 'auth_state',
            where: { field: 'id', operator: 'eq', value: key },
            limit: 1,
          })
        ).rows[0];
        return row && row.expires > Date.now()
          ? { revision: row.revision, value: JSON.parse(row.value) }
          : null;
      },
      async compareAndSwap(key, revision, value, expiresAt) {
        return db.transactionSync((tx) => {
          tx.delete({
            table: 'auth_state',
            where: {
              and: [
                { field: 'id', operator: 'eq', value: key },
                { field: 'expires', operator: 'lte', value: Date.now() },
              ],
            },
          });
          /** New opaque revision/serialized state/expiry written on the same synchronous pin. */
          const values = {
            revision: randomBytes(24).toString('base64url'),
            value: JSON.stringify(value),
            expires: expiresAt,
          };
          if (revision === null) {
            if (
              tx.select({
                table: 'auth_state',
                where: { field: 'id', operator: 'eq', value: key },
                limit: 1,
              }).rowCount
            ) {
              return false;
            }
            return (
              tx.insert({ table: 'auth_state', values: { id: key, ...values } })
                .affectedCount === 1
            );
          }
          return (
            tx.update({
              table: 'auth_state',
              values,
              where: {
                and: [
                  { field: 'id', operator: 'eq', value: key },
                  { field: 'revision', operator: 'eq', value: revision },
                ],
              },
            }).affectedCount === 1
          );
        });
      },
    });
    // Share explicit fixture key/persistence policy across independent managers.
    for (const db of connectors) {
      managers.push(
        auth.createSharedAuth({
          store: adapter(db),
          indexKey,
          keys,
          activeKeyId: 'v1',
          authorizeFresh: async () => true,
        })
      );
    }
    /** Actual committed issuance receipt checked for expiry/scope/secret behavior. */
    const issued = await managers[0].issueSession(account, {
      device: 'a',
      scopes: ['read'],
      ttlMs: 10000,
    });
    assert.ok(await managers[1].verifySession(account, issued.token));
    /** Private synthetic purpose-bound challenge issuance receipt. */
    const c = await managers[0].issueChallenge(account, {
      purpose: 'magic',
      ttlMs: 10000,
    });
    /** Concurrent outcomes used to assert exactly one credential/state completion. */
    const results = await Promise.all(
      managers.map((m) =>
        m.consumeChallenge(account, { ...c, purpose: 'magic' })
      )
    );
    assert.deepEqual(results.sort(), [false, true]);
    await managers[1].revoke(account);
    assert.equal(await managers[0].verifySession(account, issued.token), null);
    /** Persisted synthetic account rows checked for absence of bearer/code plaintext. */
    const rows = connectors[0].transactionSync((tx) =>
      tx.select({ table: 'auth_state' })
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(rows).includes(issued.token), false);
    assert.equal(JSON.stringify(rows).includes(c.secret), false);
    assert.equal(
      await adapter(connectors[0]).compareAndSwap(
        rows[0].id,
        'wrong-revision',
        JSON.parse(rows[0].value),
        Date.now() + 10000
      ),
      false
    );
  } finally {
    await Promise.all(managers.map((m) => m.close()));
    // Drain managers first, then disconnect owned SQLite handles before deleting the fixture root.
    for (const db of connectors.reverse()) {
      await db.disconnect();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
