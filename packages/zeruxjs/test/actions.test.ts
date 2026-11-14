import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createConnector } from '@zeruxjs/db-sqlite';
import { createCsrfProtection } from '@zeruxjs/security';
import {
  strictObject,
  string,
  pipe,
  minLength,
} from '@zeruxjs/validator/schemas';
import { createSharedAuth, createMemoryAuthPersistence } from '@zeruxjs/auth';
import { createActionRegistry, renderActionFields } from 'zeruxjs/actions';
import { createPinnedActionStore } from 'zeruxjs/action-stores';
import { createSqliteActionStore } from 'zeruxjs/action-stores/sqlite';
import { createApplicationLifecycle } from 'zeruxjs';
import { createPinnedTransaction } from '@zeruxjs/db';
/** Build a structured journal key predicate.
 * @param {string} key - Opaque synthetic claim key.
 * @returns {object} Equality predicate without raw SQL.
 */
const where = (key) => ({ field: 'key', operator: 'eq', value: key });
/** Strict tenant/note action input schema rejecting unknown and empty fields. */
const schema = strictObject({
  tenant: string(),
  note: pipe(string(), minLength(1)),
});
/** Host-verified synthetic principal; request form fields cannot replace this identity. */
const identity = {
  tenant: 'tenantA',
  subject: 'accountA',
  sessionId: 'sessionA',
};
/** Create a persistent isolated WAL action fixture with host-bound authorization.
 * @param {object} input - Explicit registry policy overrides for authentication/deadline fixtures.
 * @returns {Promise<object>} Fixture owner; close registries before native handles and temporary files.
 */
async function fixture(input = {}) {
  /** Isolated WAL database project removed only after registry and connector shutdown. */
  const root = await mkdtemp(path.join(os.tmpdir(), 'zx095-'));
  /** Persistent SQLite fixture path shared only by the two test-owned connectors. */
  const filename = path.join(root, 'actions.sqlite');
  /** Owned native SQLite connector providing synchronous pinned fixture writes. */
  const db = await createConnector({
    filename,
    driver: 'node',
    journalMode: 'wal',
    busyTimeoutMs: 100,
  });
  db.transactionSync((tx) => {
    tx.execute({
      op: 'createTable',
      table: 'action_records',
      columns: [
        { name: 'key', type: 'text', primary: true },
        { name: 'digest', type: 'text' },
        { name: 'owner', type: 'text' },
        { name: 'expires', type: 'integer' },
        { name: 'state', type: 'text' },
      ],
    });
    tx.execute({
      op: 'createTable',
      table: 'notes',
      columns: [
        { name: 'tenant', type: 'text' },
        { name: 'note', type: 'text' },
      ],
    });
  });
  /** Fixture journal performing claim/finish on the same transaction as the action mutation. */
  const journal = {
    durable: true,
    /** Reserve or inspect a claim on the supplied pin without a second transaction.
     * @param {object} tx - Pinned transaction used for the journal operation.
     * @param {object} claim - Claim binding input digest, owner and expiry.
     * @returns {string} Claimed, pending, committed or conflicting journal state.
     */
    reserve(tx, claim) {
      /** Existing claim receipt checked for input conflict and committed/pending replay state. */
      const old = tx.select({
        table: 'action_records',
        where: where(claim.key),
      }).rows[0];
      if (old) {
        if (old.digest !== claim.digest) {
          return 'conflict';
        }
        if (old.state === 'committed') {
          return 'committed';
        }
        return 'pending';
      }
      tx.insert({
        table: 'action_records',
        values: {
          key: claim.key,
          digest: claim.digest,
          owner: claim.owner,
          expires: claim.expiresAt,
          state: 'pending',
        },
      });
      return 'claimed';
    },
    /** Complete only the pending claim owned by the committing mutation.
     * @param {object} tx - Same pin supplied to the protected write.
     * @param {object} claim - Principal/input-bound claim to finish.
     * @returns {boolean} Whether the expected owned claim was completed.
     */
    finish(tx, claim) {
      return (
        tx.update({
          table: 'action_records',
          values: { state: 'committed' },
          where: {
            and: [
              where(claim.key),
              { field: 'owner', operator: 'eq', value: claim.owner },
              { field: 'digest', operator: 'eq', value: claim.digest },
              { field: 'state', operator: 'eq', value: 'pending' },
            ],
          },
        }).affectedCount === 1
      );
    },
  };
  /** Action persistence wrapper borrowing the explicit transaction and journal owners. */
  const store = createSqliteActionStore({
    transactionSync: db.transactionSync,
    journal,
  });
  /** CSRF helper using a fixed synthetic key; no production credential is loaded. */
  const csrf = createCsrfProtection({ secret: Buffer.alloc(32, 8) });
  /** All fixture registry owners closed before disconnecting their borrowed database. */
  const registries = [];
  let invalidations = 0,
    writes = 0;
  /** Create another action registry over the fixture store.
   * @param {object} [overrides] - Explicit host policy/store overrides.
   * @returns {object} Registry owner and opaque registered action reference.
   */
  const make = (overrides = {}) => {
    /** Owned action registry binding authenticated principal, CSRF and persistence policy. */
    const registry = createActionRegistry({
      origin: 'https://app.test',
      key: Buffer.alloc(32, 7),
      csrf,
      store,
      authenticate: async () => identity,
      ...input,
      ...overrides,
    });
    registries.push(registry);
    /** Opaque action reference registered before serving any requests. */
    const ref = registry.register('save-note', {
      schema,
      authorize: (data, ctx) => data.tenant === ctx.principal.tenant,
      /** Perform the authored note mutation only through the supplied transaction.
       * @param {object} tx - Pinned action transaction.
       * @param {{note: string}} data - Validated note data.
       * @param {object} ctx - Server-verified principal context.
       * @returns {void} Writes the synthetic note; FAIL deliberately throws to verify rollback.
       */
      write(tx, data, ctx) {
        writes++;
        tx.insert({
          table: 'notes',
          values: { tenant: ctx.principal.tenant, note: data.note },
        });
        if (data.note === 'FAIL') {
          throw Error('PRIVATE database error');
        }
      },
      successRedirect: '/notes',
      /** Run fixture invalidation only after persistence and expose postcommit failure honestly.
       * @returns {void | Promise<void>} Fixture receipt or controlled asynchronous invalidation settlement.
       */
      invalidate() {
        invalidations++;
        assert.ok(rows().length > 0);
      },
    });
    return { registry, ref };
  };
  /** Read committed synthetic notes through the synchronous connector.
   * @returns {object[]} Committed fixture records only.
   */
  const rows = () =>
    db.transactionSync((tx) => tx.select({ table: 'notes' })).rows;
  /** Initial registered action pair returned by the isolated fixture. */
  const original = make();
  return {
    root,
    filename,
    db,
    journal,
    store,
    csrf,
    ...original,
    make,
    rows,
    get writes() {
      return writes;
    },
    get invalidations() {
      return invalidations;
    },
    /** Drain all registries before disconnecting the borrowed native database.
     * @returns {Promise<void>} Resolves after the isolated database files are removed.
     */
    async close() {
      await Promise.all(registries.map((registry) => registry.close()));
      assert.equal(
        db.transactionSync((tx) => tx.select({ table: 'notes' })).ok,
        true
      );
      await db.disconnect();
      await rm(root, { recursive: true, force: true });
    },
  };
}
/** Create a native-shaped action POST with explicit authored fields.
 * @param {object} form - Signed form action and hidden fields.
 * @param {object} [fields] - User input under validation.
 * @param {object} [options] - Synthetic request overrides.
 * @returns {Request} Fresh bounded form request for one registry call.
 */
const request = (
  form,
  fields = { tenant: 'tenantA', note: 'hello' },
  options = {}
) =>
  new Request('https://app.test' + form.action, {
    method: 'POST',
    headers: {
      origin: 'https://app.test',
      accept: 'application/json',
      ...options.headers,
    },
    body: new URLSearchParams({ ...form.fields, ...fields }),
    ...options,
  });
test('native WAL persistence atomically handles concurrent claims and principal/input-bound replay', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  let other, second;
  try {
    other = await createConnector({
      filename: f.filename,
      driver: 'node',
      journalMode: 'wal',
      busyTimeoutMs: 100,
    });
    second = f.make({
      store: createSqliteActionStore({
        transactionSync: other.transactionSync,
        journal: f.journal,
      }),
    });
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = f.registry.form(f.ref, identity);
    assert.equal(second.ref.ref, f.ref.ref);
    assert.doesNotMatch(form.action, /save-note/);
    /** Concurrent action outcomes proving only one claim executes the protected mutation. */
    const results = await Promise.all([
      f.registry.handle(f.ref, request(form)),
      second.registry.handle(second.ref, request(form)),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal(f.rows().length, 1);
    assert.equal(f.writes, 1);
    assert.equal(
      (await second.registry.handle(second.ref, request(form))).status,
      200
    );
    assert.equal(f.writes, 1);
    assert.equal(
      (
        await second.registry.handle(
          second.ref,
          request(form, { tenant: 'tenantA', note: 'different' })
        )
      ).status,
      409
    );
    assert.equal(f.invalidations, 2);
    assert.equal(f.registry.pending, 0);
  } finally {
    await second?.registry.close();
    await other?.disconnect();
    await f.close();
  }
});
test('forged origin/CSRF/key, denied tenant, duplicates, schema/private errors and unsupported files never write', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  try {
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = f.registry.form(f.ref, identity);
    /** Denied or malformed synthetic requests that must all reject before writing. */
    const checks = [
      request(form, { tenant: 'tenantB', note: 'private' }),
      request(form, { tenant: 'tenantA', note: '' }),
      request(
        form,
        { tenant: 'tenantA', note: 'x' },
        {
          headers: {
            origin: 'https://evil.test',
            accept: 'application/json',
          },
        }
      ),
      request({
        ...form,
        fields: { ...form.fields, _action_csrf: 'forged' },
      }),
      request({
        ...form,
        fields: {
          ...form.fields,
          _action_key: form.fields._action_key.slice(0, -1) + 'X',
        },
      }),
    ];
    assert.deepEqual(
      await Promise.all(
        checks.map(async (req) => (await f.registry.handle(f.ref, req)).status)
      ),
      [403, 422, 403, 403, 403]
    );
    /** Base request whose duplicate-field variant must fail without private-value echoes. */
    const duplicate = request(form);
    /** Authored form bytes carrying synthetic note input and signed hidden fields. */
    const body = new URLSearchParams({
      ...form.fields,
      tenant: 'tenantA',
      note: 'PRIVATE',
    });
    body.append('note', 'another');
    /** Duplicate-field response checked for a bounded sanitized validation failure. */
    const bad = await f.registry.handle(
      f.ref,
      new Request(duplicate.url, {
        method: 'POST',
        headers: { origin: 'https://app.test', accept: 'application/json' },
        body,
      })
    );
    assert.equal(bad.status, 400);
    assert.doesNotMatch(await bad.text(), /PRIVATE|another/);
    /** Schema failure response exposing only field issue metadata. */
    const invalid = await f.registry.handle(
      f.ref,
      request(form, { tenant: 'tenantA', note: '' })
    );
    assert.equal((await invalid.json()).issues[0].path, 'note');
    /** Unsupported file-body fixture that must not reach an action mutation. */
    const multipart = new FormData();
    multipart.set('file', new Blob(['PRIVATE CONTENT']), 'private.txt');
    assert.equal(
      (
        await f.registry.handle(
          f.ref,
          new Request(duplicate.url, {
            method: 'POST',
            headers: { origin: 'https://app.test' },
            body: multipart,
          })
        )
      ).status,
      415
    );
    assert.equal(
      (
        await f.registry.handle(
          f.ref,
          new Request(duplicate.url, {
            headers: { origin: 'https://app.test' },
          })
        )
      ).status,
      405
    );
    assert.equal(f.rows().length, 0);
    assert.equal(f.invalidations, 0);
  } finally {
    await f.close();
  }
});
test('rollback leaves a durable blocked claim; lost commit acknowledgement is resolved by replay without rerunning', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  try {
    /** Failed form or store fixture used to verify rollback and claim fencing. */
    const failed = f.registry.form(f.ref, identity);
    assert.equal(
      (
        await f.registry.handle(
          f.ref,
          request(failed, { tenant: 'tenantA', note: 'FAIL' })
        )
      ).status,
      503
    );
    assert.equal(f.rows().length, 0);
    assert.equal(f.invalidations, 0);
    assert.equal(
      (
        await f.registry.handle(
          f.ref,
          request(failed, { tenant: 'tenantA', note: 'FAIL' })
        )
      ).status,
      409
    );
    /** Registry simulating loss of acknowledgement after the underlying commit completed. */
    const lost = f.make({
      store: {
        ...f.store,
        /** Simulate acknowledgement loss only after the underlying store commit finishes.
         * @param {unknown[]} args - Unchanged action-store commit arguments forwarded once.
         * @returns {Promise<never>} Always throws the intentional postcommit acknowledgement failure.
         */
        async commit(...args) {
          await f.store.commit(...args);
          throw Error('lost commit acknowledgement PRIVATE');
        },
      },
    });
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = lost.registry.form(lost.ref, identity);
    /** Action outcome inspected separately from committed database state. */
    const result = await lost.registry.handle(lost.ref, request(form));
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /PRIVATE|acknowledgement/);
    assert.equal(f.rows().length, 1);
    assert.equal(f.invalidations, 0);
    assert.equal((await f.registry.handle(f.ref, request(form))).status, 200);
    assert.equal(f.rows().length, 1);
    assert.equal(f.invalidations, 1);
  } finally {
    await f.close();
  }
});
test('ordinary HTTP POST returns 303 without JavaScript, and unknown references remain uncallable', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  let app, server;
  try {
    app = await createApplicationLifecycle({
      rootDir: f.root,
      config: {},
      providers: { database: async () => null, cache: async () => null },
    });
    f.registry.attach(app.runtime().asPluginApi());
    app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/notes',
        method: 'GET',
        handler: () => '<h1>Saved</h1>',
      });
    server = createServer(
      (req, res) => void app.handle(req, res).catch(() => res.destroy())
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Ephemeral loopback origin for no-JavaScript and disconnect fixture requests. */
    const base = `http://127.0.0.1:${server.address().port}`;
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = f.registry.form(f.ref, identity);
    assert.match(renderActionFields(form), /name="_action_csrf"/);
    /** Action outcome inspected separately from committed database state. */
    const result = await fetch(base + form.action, {
      method: 'POST',
      headers: { origin: 'https://app.test', accept: 'text/html' },
      body: new URLSearchParams({
        ...form.fields,
        tenant: 'tenantA',
        note: 'no JavaScript',
      }),
      redirect: 'manual',
    });
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), '/notes');
    assert.match(
      await (await fetch(base + result.headers.get('location'))).text(),
      /Saved/
    );
    assert.equal(f.rows().length, 1);
    /** Response for an unregistered opaque action reference, which must remain uncallable. */
    const forged = await fetch(base + '/_zerux/actions/' + 'z'.repeat(43), {
      method: 'POST',
      body: 'x=y',
    });
    assert.equal(forged.status, 404);
    assert.equal(f.rows().length, 1);
  } finally {
    await app?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    await f.close();
  }
});
test('real shared-auth verification is required per replay, and signed expiry prevents late reexecution', async () => {
  /** Shared-auth owner backed only by synthetic in-memory persistence. */
  const auth = createSharedAuth({
    store: createMemoryAuthPersistence(),
    indexKey: Buffer.alloc(32, 2),
    keys: [{ id: 'current', key: Buffer.alloc(32, 3) }],
    activeKeyId: 'current',
    authorizeFresh: async () => true,
  });
  /** Explicit tenant/account binding used for session issuance and verification. */
  const account = { tenant: 'tenantA', account: 'accountA' };
  let f;
  try {
    /** Synthetic session receipt whose token is confined to the authenticated request fixture. */
    const issued = await auth.issueSession(account, {
      device: 'test',
      scopes: ['mutate'],
      ttlMs: 60000,
    });
    f = await fixture({
      ttlMs: 1000,
      authenticate: async (req) => {
        /** Candidate opaque session token parsed from the fixture cookie before verification. */
        const raw = /^session=([A-Za-z0-9_.-]+)$/.exec(
          req.headers.get('cookie') ?? ''
        )?.[1];
        if (!raw) {
          return null;
        }
        /** Verified session result required again for every replay attempt. */
        const session = await auth.verifySession(account, raw, 'mutate');
        return session
          ? {
              tenant: account.tenant,
              subject: account.account,
              sessionId: session.id,
            }
          : null;
      },
    });
    /** Verified form principal carrying the issued session identity. */
    const who = { ...identity, sessionId: issued.session.id };
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = f.registry.form(f.ref, who);
    assert.equal((await f.registry.handle(f.ref, request(form))).status, 401);
    /** Build an authenticated request with the issued opaque session token.
     * @returns {Request} Fresh form POST retaining origin and content-type checks.
     */
    const req = () =>
      new Request(request(form), {
        headers: {
          origin: 'https://app.test',
          accept: 'application/json',
          cookie: 'session=' + issued.token,
          'content-type': 'application/x-www-form-urlencoded',
        },
      });
    assert.equal((await f.registry.handle(f.ref, req())).status, 200);
    await new Promise((r) => setTimeout(r, 1050));
    assert.equal((await f.registry.handle(f.ref, req())).status, 409);
    assert.equal(f.rows().length, 1);
    await auth.revoke(account, issued.session.id);
    assert.equal((await f.registry.handle(f.ref, req())).status, 401);
  } finally {
    await f?.close();
    await auth.close();
  }
});
test('store outage, authorization cancellation and SQLite thenable rejection retain ownership and never invalidate', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  try {
    /** Registry with an intentionally unavailable claim store; mutation must remain uncalled. */
    const broken = f.make({
      store: {
        ...f.store,
        claim: async () => {
          throw Error('PRIVATE unavailable');
        },
      },
    });
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = broken.registry.form(broken.ref, identity);
    assert.equal(
      (await broken.registry.handle(broken.ref, request(form))).status,
      503
    );
    assert.equal(f.invalidations, 0);
    /** Already aborted caller signal proving cancellation prevents persistence. */
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      (
        await f.registry.handle(
          f.ref,
          request(f.registry.form(f.ref, identity), undefined, {
            signal: controller.signal,
          })
        )
      ).status,
      408
    );
    /** Synthetic idempotency claim binding key, digest, owner and expiry. */
    const claim = {
      key: 'k'.repeat(43),
      digest: 'd'.repeat(43),
      owner: 'o'.repeat(32),
      expiresAt: Date.now() + 60000,
    };
    await f.store.claim(claim, new AbortController().signal, Date.now() + 1000);
    await assert.rejects(
      f.store.commit(
        claim,
        () => Promise.resolve(),
        new AbortController().signal,
        Date.now() + 1000
      ),
      /Async work/
    );
    assert.equal(f.rows().length, 0);
    assert.equal(f.registry.pending, 0);
  } finally {
    await f.close();
  }
});
test('async action store uses the db-owned real pin for write and completion, and releases on failure', async () => {
  /** Pinned transaction references checked to distinguish reservation from commit leases. */
  const sessions = [];
  /** Synthetic journal state restored from its transaction snapshot on rollback. */
  const pins = new Map();
  /** Ordered synthetic lease terminal receipts proving release on success and failure. */
  const calls = [];
  let sequence = 0;
  /** Injected pinned transaction adapter exercising database-owned orchestration only. */
  const adapter = {
    capabilities: {
      isolationLevels: ['serializable'],
      timeout: 'cooperative',
      savepoints: false,
      transactionalDdl: false,
    },
    /** Allocate a synthetic pinned lease with snapshot-based rollback receipts.
     * @returns {object} Callbacks bound to one synthetic transaction identity.
     */
    acquire() {
      /** Fresh synthetic lease ID retained by its transaction callbacks. */
      const id = ++sequence;
      let snapshot;
      return {
        /** Capture pretransaction synthetic journal state before writes.
         * @returns {void} Stores a rollback snapshot and records begin.
         */
        begin() {
          snapshot = new Map(pins);
          calls.push(['begin', id]);
        },
        /** Return an inert synthetic query receipt for transaction contract checks.
         * @returns {object} Empty successful query result; no native driver is contacted.
         */
        execute() {
          return { ok: true, rows: [], rowCount: 0, affectedCount: 0 };
        },
        /** Record successful completion on this acquired synthetic lease.
         * @returns {void} Appends the commit receipt for the current pin.
         */
        commit() {
          calls.push(['commit', id]);
        },
        /** Restore synthetic journal state to its pretransaction snapshot.
         * @returns {void} Records rollback after removing partial writes.
         */
        rollback() {
          pins.clear();
          for (const [key, value] of snapshot) {
            pins.set(key, value);
          }
          calls.push(['rollback', id]);
        },
        /** Record lease release after the terminal transaction action.
         * @returns {void} Appends one fixture release receipt.
         */
        release() {
          calls.push(['release', id]);
        },
      };
    },
  };
  /** Actual shared pinned transaction wrapper over the synthetic lease adapter. */
  const transaction = createPinnedTransaction(adapter, {
    name: 'fixture',
    slug: 'fixture',
    connector: 'fixture',
    options: {},
  });
  /** Synthetic idempotency claim binding key, digest, owner and expiry. */
  const claim = {
    key: 'k'.repeat(43),
    digest: 'd'.repeat(43),
    owner: 'o'.repeat(32),
    expiresAt: Date.now() + 60000,
  };
  let written;
  /** Action persistence wrapper borrowing the explicit transaction and journal owners. */
  const store = createPinnedActionStore({
    transaction,
    journal: {
      durable: true,
      /** Reserve or inspect a claim on the supplied pin without a second transaction.
       * @param {object} tx - Pinned transaction used for the journal operation.
       * @param {object} c - Synthetic async-pin claim used by the adapter fixture.
       * @returns {string} Claimed, pending, committed or conflicting journal state.
       */
      reserve(tx, c) {
        sessions.push(tx);
        pins.set(c.key, 'pending');
        return 'claimed';
      },
      /** Complete only the pending claim owned by the committing mutation.
       * @param {object} tx - Same pin supplied to the protected write.
       * @param {object} c - Synthetic async journal claim.
       * @returns {boolean} Whether the expected owned claim was completed.
       */
      finish(tx, c) {
        assert.equal(tx, written);
        pins.set(c.key, 'committed');
        return true;
      },
    },
  });
  await store.claim(claim, new AbortController().signal, Date.now() + 1000);
  await store.commit(
    claim,
    (tx) => {
      written = tx;
      sessions.push(tx);
    },
    new AbortController().signal,
    Date.now() + 1000
  );
  assert.notEqual(sessions[0], sessions[1]);
  assert.equal(pins.get(claim.key), 'committed');
  assert.equal(calls.filter(([name]) => name === 'release').length, 2);
  /** Failed form or store fixture used to verify rollback and claim fencing. */
  const failed = createPinnedActionStore({
    transaction,
    journal: { durable: true, reserve: () => 'claimed', finish: () => false },
  });
  /** Independent claim whose failed completion must not leave a partial mutation. */
  const next = { ...claim, key: 'm'.repeat(43) };
  await assert.rejects(
    failed.commit(
      next,
      () => {
        pins.set(next.key, 'partial');
      },
      new AbortController().signal,
      Date.now() + 1000
    ),
    /ownership lost/
  );
  assert.equal(pins.has(next.key), false);
  assert.equal(calls.filter(([name]) => name === 'rollback').length, 1);
  assert.equal(calls.filter(([name]) => name === 'release').length, 3);
});
test('post-commit invalidation failures disclose committed state and replay only revalidation', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  let calls = 0;
  /** Owned action registry binding authenticated principal, CSRF and persistence policy. */
  const registry = createActionRegistry({
    origin: 'https://app.test',
    key: Buffer.alloc(32, 6),
    csrf: f.csrf,
    store: f.store,
    authenticate: async () => identity,
  });
  /** Opaque action reference registered before serving any requests. */
  const ref = registry.register('cache', {
    schema,
    authorize: () => true,
    /** Perform the authored note mutation only through the supplied transaction.
     * @param {object} tx - Pinned action transaction.
     * @param {{note: string}} data - Validated note data.
     * @returns {void} Writes the synthetic note; FAIL deliberately throws to verify rollback.
     */
    write(tx, data) {
      tx.insert({
        table: 'notes',
        values: { tenant: 'tenantA', note: data.note },
      });
    },
    successRedirect: '/notes',
    /** Run fixture invalidation only after persistence and expose postcommit failure honestly.
     * @returns {void | Promise<void>} Fixture receipt or controlled asynchronous invalidation settlement.
     */
    invalidate() {
      calls++;
      if (calls === 1) {
        throw Error('PRIVATE cache outage');
      }
    },
  });
  try {
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = registry.form(ref, identity);
    /** Initial postcommit invalidation failure response retaining committed outcome semantics. */
    const first = await registry.handle(ref, request(form));
    assert.equal(first.status, 503);
    assert.equal((await first.json()).outcome, 'committed');
    assert.equal(f.rows().length, 1);
    assert.equal((await registry.handle(ref, request(form))).status, 200);
    assert.equal(calls, 2);
    assert.equal(f.rows().length, 1);
  } finally {
    await registry.close();
    await f.close();
  }
});
test('action registration preflights conflicts and rolls back partial registry attachment', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  try {
    /** Additional opaque action reference used to exercise partial route attachment rollback. */
    const second = f.registry.register('second', {
      schema,
      authorize: () => true,
      /** Perform the authored note mutation only through the supplied transaction.
       * @returns {void} Writes the synthetic note; FAIL deliberately throws to verify rollback.
       */
      write() {},
      successRedirect: '/notes',
    });
    /** Synthetic host route map proving failed registry attachment removes prior additions. */
    const routes = new Map();
    /** Explicit host registration facade with an intentional second-route failure. */
    const api = {
      hasRoute: () => false,
      /** Fail the second synthetic route registration to exercise attachment rollback.
       * @param {{pattern: string}} route - Authored action route under registration.
       * @returns {void} Adds the first route; the next registration deliberately throws.
       */
      addRoute(route) {
        if (routes.size === 1) {
          throw Error('host registration failure');
        }
        routes.set(route.pattern, route);
      },
      removeRoute: (path) => routes.delete(path),
      /** Inert host hook for a fixture whose attachment fails before activation.
       * @returns {void} No live generation cleanup is installed by this synthetic host.
       */
      onDispose() {},
    };
    assert.throws(() => f.registry.attach(api), /host registration failure/);
    assert.equal(routes.size, 0);
    await f.registry.close();
    assert.throws(() => f.registry.form(second, identity));
  } finally {
    await f.close();
  }
});
test('actual client disconnect after a committed write retains its receipt and never repeats the mutation', async () => {
  /** Isolated action fixture owning registries, native database and temporary files. */
  const f = await fixture();
  let app, server, release, entered;
  /** Barrier proving committed invalidation began before the native client disconnects. */
  const ready = new Promise((resolve) => (entered = resolve));
  /** Controlled invalidation wait released after the committed response connection is lost. */
  const blocked = new Promise((resolve) => (release = resolve));
  let invalidations = 0;
  try {
    /** Opaque action reference registered before serving any requests. */
    const ref = f.registry.register('disconnect', {
      schema,
      authorize: () => true,
      /** Perform the authored note mutation only through the supplied transaction.
       * @param {object} tx - Pinned action transaction.
       * @param {{note: string}} input - Validated disconnect-fixture note.
       * @returns {void} Writes the synthetic note; FAIL deliberately throws to verify rollback.
       */
      write(tx, input) {
        tx.insert({
          table: 'notes',
          values: { tenant: 'tenantA', note: input.note },
        });
      },
      successRedirect: '/notes',
      /** Run fixture invalidation only after persistence and expose postcommit failure honestly.
       * @returns {void | Promise<void>} Fixture receipt or controlled asynchronous invalidation settlement.
       */
      async invalidate() {
        if (++invalidations === 1) {
          entered();
          await blocked;
        }
      },
    });
    app = await createApplicationLifecycle({
      rootDir: f.root,
      config: {},
      providers: { database: async () => null, cache: async () => null },
    });
    f.registry.attach(app.runtime().asPluginApi());
    server = createServer(
      (req, res) => void app.handle(req, res).catch(() => res.destroy())
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Ephemeral loopback origin for no-JavaScript and disconnect fixture requests. */
    const base = `http://127.0.0.1:${server.address().port}`;
    /** Signed principal-bound action form reused deliberately for replay/conflict checks. */
    const form = f.registry.form(ref, identity);
    /** Authored form bytes carrying synthetic note input and signed hidden fields. */
    const body = new URLSearchParams({
      ...form.fields,
      tenant: 'tenantA',
      note: 'committed before disconnect',
    }).toString();
    let outgoing;
    /** Native client terminal event promise attached before deliberately destroying its request. */
    const gone = new Promise((resolve) => {
      outgoing = httpRequest(
        base + form.action,
        {
          method: 'POST',
          headers: {
            origin: 'https://app.test',
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
          },
        },
        (res) => res.resume()
      );
      outgoing.once('error', resolve);
      outgoing.once('close', resolve);
      outgoing.end(body);
    });
    await ready;
    assert.equal(f.rows().length, 1);
    outgoing.destroy();
    await gone;
    release();
    for (let i = 0; i < 100 && f.registry.pending; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(f.registry.pending, 0);
    /** Explicit replay response checked against the durable receipt without repeating the write. */
    const retry = await fetch(base + form.action, {
      method: 'POST',
      headers: {
        origin: 'https://app.test',
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    assert.equal(retry.status, 200);
    assert.equal(f.rows().length, 1);
    assert.equal(invalidations, 2);
  } finally {
    release?.();
    await app?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await f.close();
  }
});
