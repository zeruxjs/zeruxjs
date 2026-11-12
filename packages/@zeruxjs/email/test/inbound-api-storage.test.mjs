import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createDatabaseInboxStore,
  createMappedDatabaseInboxStore,
  createInboxApi,
  createEmailReceiver,
  createMemoryInboxStore,
} from '../dist/index.js';
/** Fixed ESM/CommonJS bridge for the built native SQLite adapter. */
const require = createRequire(import.meta.url);
/** Public SQLite factory used only with owned disposable test state. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Fixed synthetic database operation context, not operator application storage. */
const context = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Borrow only a finite structured operation allowlist from an owned native fixture.
 *
 * @param {object} c - Owned native SQLite connector; lifetime stays outside the borrowed facade.
 * @returns {object} Borrowed port; native disconnect stays with withDb.
 */
const facade = (c) =>
  Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (input) => c.execute({ op, ...input }, context)]
    )
  );
/**
 * Derive a deterministic synthetic opaque inbox identity.
 *
 * @param {number} n - Finite synthetic identity/corpus number.
 * @returns {string} Fixed-width hexadecimal fixture identifier, not proof of authorization.
 */
const id = (n) => n.toString(16).padStart(64, '0');
/**
 * Create authored inert private inbox metadata without parsing remote mail.
 *
 * @param {number} n - Finite synthetic identity/corpus number.
 * @param {string} account - Explicit synthetic account, default support; it is not a browser tenant claim.
 * @returns {object} Synthetic message with explicit account, unverified safety and stable timestamps.
 */
const record = (n, account = 'support') => ({
  id: id(n),
  account,
  protocol: 'imap',
  mailbox: 'INBOX',
  remoteId: String(n),
  uidValidity: '42',
  subject: n % 2 ? 'Monthly invoice' : 'Welcome',
  from: [`person${n}@example.org`],
  to: ['support@example.org'],
  cc: [],
  receivedAt: 1000 + n,
  html: '<p>safe</p>',
  text: 'message body',
  bodyTruncated: false,
  attachments:
    n === 2
      ? [{ filename: 'receipt.pdf', contentType: 'application/pdf', size: 12 }]
      : [],
  safety: {
    risk: n === 3 ? 'review' : 'low',
    score: 0,
    flags: n === 3 ? ['possible_spam'] : [],
    authentication: 'unverified',
    engine: 'zerux-heuristic-v1',
  },
});
/**
 * Own two disposable SQLite connections for one async fixture callback.
 *
 * @param {(first: object, second: object) => Promise<void>} fn - Trusted fixture callback receiving borrowed ports over two owned connections.
 * @returns {Promise<void>} Callback and native cleanup settled; no operator state or external service.
 */
async function withDb(fn) {
  /** Owned temporary database directory removed after both native handles settle. */
  const dir = await mkdtemp(join(tmpdir(), 'zerux-inbox65-'));
  // Cleanup ownership starts before either native acquisition.
  let first;
  let second;
  try {
    first = await createConnector({
      filename: join(dir, 'mail.sqlite'),
      driver: 'node',
    });
    second = await createConnector({
      filename: join(dir, 'mail.sqlite'),
      driver: 'node',
    });
    await fn(facade(first), facade(second));
  } finally {
    // Attempt all native and directory cleanup even after an earlier close rejection.
    try {
      await first?.disconnect();
    } finally {
      try {
        await second?.disconnect();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
}
test('managed database inbox still creates table on first use, deduplicates and provides exact pages', async () =>
  withDb(async (a, b) => {
    /** Borrowed managed inbox-store adapter over the first synthetic connection. */
    const storeA = createDatabaseInboxStore(a);
    /** Second borrowed managed store over the same synthetic native database. */
    const storeB = createDatabaseInboxStore(b);
    assert.equal(await storeA.put(record(1)), true);
    assert.equal(await storeB.put(record(1)), false);
    await storeA.put(record(2));
    await storeA.put(record(3));
    /** Bounded private inbox page with an exclusive lookahead continuation. */
    const page = await storeB.page('support', null, 2);
    assert.equal(page.items.length, 2);
    assert.equal(page.done, false);
    assert.ok(page.nextCursor);
    /** Final native keyset page; no phantom next cursor may be returned. */
    const last = await storeB.page('support', page.nextCursor, 2);
    assert.equal(last.items.length, 1);
    assert.equal(last.done, true);
    assert.equal(last.nextCursor, null);
    /** Native page exactly equal to the requested size; completion must still be correct. */
    const exact = await storeB.page('support', null, 3);
    assert.equal(exact.done, true);
    assert.equal(exact.items.length, 3);
    /** Native query proving explicit managed schema creation only in the synthetic database. */
    const tableCheck = await b.select({
      table: 'zerux_email_inbox',
      columns: ['id'],
      limit: 5,
    });
    assert.equal(tableCheck.ok, true);
    assert.equal(tableCheck.rows.length, 3);
  }));
test('application-owned table maps column names without package migration', async () =>
  withDb(async (a, b) => {
    /** Explicit synthetic host-owned table name; mapped adapter must not invent a migration. */
    const table = 'company_received_messages';
    /** Explicit host column mapping for private metadata, independent of default package names. */
    const fields = {
      id: 'message_key',
      account: 'mail_account',
      payload: 'json_data',
      subject: 'email_subject',
      mailbox: 'folder',
      receivedAt: 'arrival_ms',
      from: 'sender_email',
    };
    /** Host-created synthetic schema acknowledgement; adapter createTable is explicitly disabled. */
    const schema = await a.createTable({
      table,
      ifNotExists: true,
      columns: [
        {
          name: fields.id,
          type: 'varchar',
          length: 64,
          primary: true,
          notNull: true,
        },
        { name: fields.account, type: 'varchar', length: 64, notNull: true },
        { name: fields.payload, type: 'text', notNull: true },
        { name: fields.subject, type: 'varchar', length: 1024 },
        { name: fields.mailbox, type: 'varchar', length: 255 },
        { name: fields.receivedAt, type: 'bigint' },
        { name: fields.from, type: 'varchar', length: 320 },
      ],
    });
    assert.equal(schema.ok, true);
    /** First borrowed mapped inbox store using the host-owned fixture schema. */
    const mappedA = createMappedDatabaseInboxStore(a, {
      table,
      columns: fields,
      createTable: false,
    });
    /** Second mapped port checking committed columns and account-scoped erasure. */
    const mappedB = createMappedDatabaseInboxStore(b, {
      table,
      columns: fields,
      createTable: false,
    });
    await mappedA.put(record(7));
    assert.equal((await mappedB.get(id(7))).subject, 'Monthly invoice');
    assert.equal((await mappedB.page('support', null, 30)).items.length, 1);
    /** Private native row projection checked only within this synthetic fixture. */
    const raw = await b.select({
      table,
      columns: Object.values(fields),
      limit: 1,
    });
    assert.equal(raw.rows[0].email_subject, 'Monthly invoice');
    assert.equal(raw.rows[0].sender_email, 'person7@example.org');
    assert.equal(await mappedB.erase(id(7), 'other'), false);
    assert.equal(await mappedB.erase(id(7), 'support'), true);
    assert.equal(await mappedA.get(id(7)), null);
    assert.throws(
      () =>
        createMappedDatabaseInboxStore(a, {
          table,
          columns: { payload: 'mail_account', account: 'mail_account' },
        }),
      /duplicate/
    );
  }));
test('inbox API provides scoped summary pages, bounded filters, safe details and authorized actions', async () => {
  /** Process-local inbox reference state; no restart or distributed guarantee. */
  const store = createMemoryInboxStore();
  // Seed only this finite synthetic multi-account corpus; no operator record is accessed.
  for (let i = 1; i <= 6; i++) {
    await store.put(record(i, i === 6 ? 'billing' : 'support'));
  }
  /** Captured authorized operation labels; no message bodies or account credentials logged. */
  const calls = [];
  let mayErase = false,
    seen = null;
  /** Headless authorized inbox API; storage visibility never replaces host access policy. */
  const inbox = createInboxApi({
    store,
    authorize: ({ operation, account }) => {
      calls.push(operation);
      return (
        (account === 'support' &&
          operation !== 'erase' &&
          operation !== 'markSeen') ||
        (account === 'support' && ['erase', 'markSeen'].includes(operation))
      );
    },
    canErase: async () => mayErase,
    receiver: {
      poll: async () => ({
        account: 'support',
        protocol: 'imap',
        scanned: 1,
        stored: 1,
        duplicates: 0,
        oversized: 0,
        messages: [{ text: 'sensitive' }],
      }),
      markSeen: async (_account, m) => {
        seen = m.id;
        return true;
      },
      accounts: () => [],
    },
  });
  /** First bounded summary page; body fields must be absent. */
  const p1 = await inbox.list({ account: 'support', limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.equal(p1.done, false);
  assert.equal('text' in p1.items[0], false);
  assert.equal('html' in p1.items[0], false);
  /** Next exclusive summary page; previous entries must not repeat. */
  const p2 = await inbox.list({
    account: 'support',
    limit: 2,
    cursor: p1.nextCursor,
  });
  assert.equal(p2.items.length, 2);
  assert.equal(p2.done, false);
  assert.equal((await inbox.get('support', id(1))).html, '<p>safe</p>');
  assert.equal(await inbox.get('support', id(6)), null);
  await assert.rejects(inbox.list({ account: 'billing' }), /denied/);
  /** Bounded subject search with explicit scan coverage rather than invented exact totals. */
  const filtered = await inbox.search({
    account: 'support',
    subject: 'invoice',
    limit: 2,
    maxScanned: 3,
  });
  assert.equal(filtered.items.length, 2);
  assert.equal(filtered.done, false);
  assert.equal(filtered.scanned, 3);
  /** Continued bounded search page under the same authorized account. */
  const next = await inbox.search({
    account: 'support',
    subject: 'invoice',
    limit: 2,
    maxScanned: 5,
    cursor: filtered.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.equal(next.done, true);
  /** Summary search based on advisory risk labels; no malware/authentication certification. */
  const spam = await inbox.search({
    account: 'support',
    risk: 'review',
    limit: 10,
  });
  assert.equal(spam.items.length, 1);
  assert.equal(spam.items[0].id, id(3));
  /** Summary search based on attachment metadata only; it never fetches file URLs. */
  const files = await inbox.search({
    account: 'support',
    hasAttachments: true,
  });
  assert.equal(files.items.length, 1);
  assert.equal(files.items[0].attachmentCount, 1);
  assert.equal(await inbox.markSeen('support', id(2)), true);
  assert.equal(seen, id(2));
  await assert.rejects(inbox.eraseLocal('support', id(1)), /retention policy/);
  mayErase = true;
  assert.equal(await inbox.eraseLocal('support', id(1)), true);
  assert.equal((await inbox.poll('support')).stored, 1);
  assert.ok(
    calls.includes('read') &&
      calls.includes('search') &&
      calls.includes('markSeen') &&
      calls.includes('erase') &&
      calls.includes('poll')
  );
});
test('inbox API authorization required and storage isolation enforced even with a hostile store', async () => {
  assert.throws(
    () => createInboxApi({ store: createMemoryInboxStore() }),
    /authorization callback/
  );
  /** Deliberately hostile store returning another account; API must reject cross-scope rows. */
  const malicious = {
    get: async () => record(2, 'billing'),
    page: async () => ({
      items: [record(2, 'billing')],
      nextCursor: null,
      done: true,
    }),
    put: async () => true,
  };
  /** Explicit authorized headless inbox API over the fixture store/receiver. */
  const api = createInboxApi({ store: malicious, authorize: async () => true });
  assert.equal(await api.get('support', id(2)), null);
  await assert.rejects(api.list({ account: 'support' }), /out-of-scope/);
  await assert.rejects(api.search({ account: 'support' }), /out-of-scope/);
  await assert.rejects(
    api.search({ account: 'support', maxScanned: 99999 }),
    /scan bound/
  );
});
test('JSON receiving still works without creating any table or requiring a DB', async (t) => {
  /** Synthetic configured account; credentials are fixture-only and never used for a network connection. */
  const account = {
    name: 'support',
    protocol: 'imap',
    host: 'imap.example.test',
    auth: { user: 'a', password: 'b' },
  };
  /** Owned receiver admission wrapper over explicit injected protocol clients. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    parse: async () => ({
      subject: 'Hello',
      text: 'plain',
      html: '<p>safe</p>',
    }),
    sanitizeHtml: async (v) => v,
    connections: {
      imap: async () => ({
        mailbox: { exists: 1, uidValidity: 4n, uidNext: 2n },
        connect: async () => {},
        getMailboxLock: async () => ({
          /**
           * Release the synthetic no-op mailbox lock without affecting any remote state.
           *
           * @returns {void} Fixture release complete.
           */
          release() {},
        }),
        search: async () => [1],
        fetchOne: async () => ({ source: Buffer.from('example') }),
        logout: async () => {},
      }),
      pop3: async () => {
        throw Error('unexpected');
      },
    },
  });
  // Stop receiver admission after the individually awaited synthetic protocol operations.
  t.after(() => receiver.close());
  /** Private JSON-mode poll result; no implicit database or remote content fetch. */
  const result = await receiver.poll('support');
  assert.equal(result.messages[0].text, 'plain');
  assert.equal(result.messages[0].html, '<p>safe</p>');
  assert.throws(() => receiver.page('support'), /No inbox store/);
});
test('IMAP read, unread, and flag operations honor UIDVALIDITY and never act on a reused UID', async (t) => {
  /** Captured synthetic UID-mode flag operations; no actual remote mailbox is changed. */
  const mutations = [];
  /** Synthetic configured account; credentials are fixture-only and never used for a network connection. */
  const account = {
    name: 'support',
    protocol: 'imap',
    host: 'imap.example.test',
    auth: { user: 'u', password: 'p' },
  };
  let validity = 42n;
  /** Explicit injected IMAP capability object; no live TLS/authentication exchange. */
  const con = {
    imap: async () => ({
      mailbox: { exists: 1, uidValidity: validity, uidNext: 6n },
      connect: async () => {},
      getMailboxLock: async () => ({
        /**
         * Release the synthetic no-op mailbox lock without affecting any remote state.
         *
         * @returns {void} Fixture release complete.
         */
        release() {},
      }),
      search: async () => [5],
      fetchOne: async () => ({ source: Buffer.from('x') }),
      logout: async () => {},
      messageFlagsAdd: async (id, flags) => {
        mutations.push(['add', id, ...flags]);
      },
      messageFlagsRemove: async (id, flags) => {
        mutations.push(['remove', id, ...flags]);
      },
      list: async () => [{ path: 'INBOX' }, { path: 'Archive' }],
    }),
    pop3: async () => {
      throw Error('POP3 not expected');
    },
  };
  /** Process-local inbox reference state; no restart or distributed guarantee. */
  const store = createMemoryInboxStore();
  /** Owned receiver admission wrapper over explicit injected protocol clients. */
  const receiver = createEmailReceiver({
    accounts: [account],
    store,
    connections: con,
    parse: async () => ({ subject: 'mail' }),
  });
  // Stop receiver admission after the individually awaited synthetic protocol operations.
  t.after(() => receiver.close());
  /** Immutable stored UID/UIDVALIDITY-bound message identity used for authorized mutations. */
  const itemId = (await receiver.poll('support')).newIds[0];
  /** Explicit authorized headless inbox API over the fixture store/receiver. */
  const api = createInboxApi({ store, receiver, authorize: async () => true });
  assert.deepEqual(
    (await api.folders('support')).map((x) => x.path),
    ['INBOX', 'Archive']
  );
  assert.equal(await api.markSeen('support', itemId), true);
  assert.equal(await api.markUnread('support', itemId), true);
  assert.equal(await api.setFlagged('support', itemId, true), true);
  assert.equal(await api.setFlagged('support', itemId, false), true);
  assert.deepEqual(mutations, [
    ['add', 5, '\\Seen'],
    ['remove', 5, '\\Seen'],
    ['add', 5, '\\Flagged'],
    ['remove', 5, '\\Flagged'],
  ]);
  validity = 43n;
  await assert.rejects(
    api.markUnread('support', itemId),
    /UIDVALIDITY changed/
  );
  await assert.rejects(
    api.setFlagged('support', itemId, true),
    /UIDVALIDITY changed/
  );
});
