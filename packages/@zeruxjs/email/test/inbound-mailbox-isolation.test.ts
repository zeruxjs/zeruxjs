import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createEmailReceiver,
  createMemoryInboxStore,
  createInboxApi,
  createDatabaseMailboxSync,
} from '../dist/index.js';

/** Explicit synthetic IMAP account/folder allowlist; credentials never reach a real server. */
const account = {
  name: 'support',
  protocol: 'imap',
  host: 'imap.example.test',
  auth: { user: 'alice@example.test', password: 'secret' },
  mailbox: 'INBOX',
  mailboxes: ['Archive', 'Invoices'],
  maxMessagesPerPoll: 50,
};
/**
 * Map authored bytes to fixed inert MIME fields without accessing a remote mailbox.
 *
 * @param {Buffer} buffer - Authored synthetic source bytes.
 * @returns {Promise<object>} Synthetic metadata; no script/HTML/source evaluation.
 */
const parse = async (buffer) => ({
  subject: buffer.toString(),
  text: 'safe',
  from: { value: [{ address: 'sender@example.test' }] },
});
/**
 * Create a finite sequential multi-folder protocol fixture with captured operations.
 *
 * @param {Record<string, object[]>} data - Finite folder-to-message corpus; no remote URL/client selection.
 * @param {bigint} validity - Explicit synthetic UIDVALIDITY epoch, default 10n.
 * @returns {object} Injected clients and local capture; no real TLS/client concurrency qualification.
 */
function multiDriver(data, validity = 10n) {
  /** Captured finite protocol operations; no mailbox names or private data enter application telemetry. */
  const requests = [];
  let opened = '';
  return {
    requests,
    connections: {
      /**
       * Return a synthetic IMAP client or reject a deliberately unexpected protocol call.
       *
       * @returns {Promise<object>} Injected client without sockets or real credentials.
       */
      async imap() {
        return {
          mailbox: { exists: 0, uidValidity: validity, uidNext: 20n },
          /**
           * Record synthetic connection setup without network I/O.
           *
           * @returns {Promise<void>} Local fixture capture updated.
           */
          async connect() {
            requests.push('connect');
          },
          /**
           * Select one fixture folder and capture the requested read/write mode.
           *
           * @param {string} folder - Explicit configured fixture folder.
           * @param {object} settings - Explicit requested fixture lock mode.
           * @param {boolean} settings.readOnly - Read versus mutation request recorded by this fixture.
           * @returns {Promise<object>} Synthetic release capability; it is not a native server lock.
           */
          async getMailboxLock(folder, { readOnly }) {
            requests.push(`${folder}:${readOnly ? 'read' : 'write'}`);
            opened = folder;
            this.mailbox = {
              exists: (data[folder] ?? []).length,
              uidValidity: validity,
              uidNext: 20n,
            };
            return {
              /**
               * Record synthetic lock release; no external resource is touched.
               *
               * @returns {void} Local capture updated.
               */
              release() {
                requests.push('unlock');
              },
            };
          },
          /**
           * Return finite UIDs only from the selected fixture folder.
           *
           * @param {object} query - Native UID query captured for bounds assertions.
           * @returns {Promise<number[]>} Synthetic UID inventory under explicit folder/epoch bounds.
           */
          async search(query) {
            requests.push(query);
            return (data[opened] ?? []).map((item) => item.uid);
          },
          /**
           * Return only authored bytes for the exact selected fixture UID.
           *
           * @param {number} uid - Exact immutable synthetic message UID.
           * @returns {Promise<object | false>} Synthetic size/source metadata or false for absence.
           */
          async fetchOne(uid) {
            /** Synthetic message selected only from the current fixture folder and exact UID. */
            const item = (data[opened] ?? []).find((item) => item.uid === uid);
            return item
              ? { size: item.source.length, source: item.source }
              : false;
          },
          /**
           * Capture mutation only for the selected folder and exact UID.
           *
           * @param {number} uid - Exact immutable synthetic message UID.
           * @param {string[]} flags - Explicit mutation flags from the receiver.
           * @returns {Promise<void>} Local flag capture; no real mailbox changes.
           */
          async messageFlagsAdd(uid, flags) {
            requests.push(`flag:${opened}:${uid}:${flags[0]}`);
          },
          /**
           * Record synthetic IMAP completion after operation settlement.
           *
           * @returns {Promise<void>} Local protocol capture updated.
           */
          async logout() {
            requests.push('logout');
          },
        };
      },
      /**
       * Return a synthetic POP3 client or reject a deliberately unexpected protocol call.
       *
       * @returns {Promise<object>} Injected client without sockets or real credentials.
       */
      async pop3() {
        throw new Error('Unexpected POP3 connection');
      },
    },
  };
}
test('one account can poll separate allowlisted IMAP mailboxes without UID collision', async (t) => {
  /** Process-local inbox reference state; restart/durability guarantees are not inferred. */
  const store = createMemoryInboxStore();
  /** Injected multi-folder protocol fixture with explicit UIDVALIDITY/UIDNEXT bounds. */
  const driver = multiDriver({
    INBOX: [{ uid: 1, source: Buffer.from('inbox') }],
    Archive: [{ uid: 1, source: Buffer.from('archive') }],
  });
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [account],
    store,
    connections: driver.connections,
    parse,
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  /** First authorized folder poll; continuation remains bound to that exact mailbox. */
  const first = await receiver.poll('support', {
    mailbox: 'INBOX',
    cursor: { afterUid: 0, mailbox: 'INBOX' },
  });
  /** Other authorized folder poll; identical UIDs must not collide across folders. */
  const second = await receiver.poll('support', {
    mailbox: 'Archive',
    cursor: { afterUid: 0, mailbox: 'Archive' },
  });
  assert.equal(first.stored, 1);
  assert.equal(second.stored, 1);
  assert.equal(first.nextCursor.mailbox, 'INBOX');
  assert.equal(second.nextCursor.mailbox, 'Archive');
  assert.notEqual(first.newIds[0], second.newIds[0]);
  /** Private bounded stored messages used to verify explicit folder identities. */
  const items = (await store.page('support')).items;
  assert.deepEqual(items.map((m) => m.mailbox).sort(), ['Archive', 'INBOX']);
  await assert.rejects(
    receiver.poll('support', { mailbox: 'Drafts' }),
    /not configured/
  );
  await assert.rejects(
    receiver.poll('support', { mailbox: 'Archive', cursor: first.nextCursor }),
    /cross-mailbox/
  );
  assert.equal(
    (
      await receiver.poll('support', {
        mailbox: 'Archive',
        cursor: second.nextCursor,
      })
    ).stored,
    0
  );
  assert.ok(driver.requests.includes('Archive:read'));
  assert.equal(driver.requests.filter((x) => x === 'Archive:write').length, 0);
});
test('pollConfiguredMailboxes only scans explicitly configured folders and no POP3 folder name is accepted', async (t) => {
  /** Injected multi-folder protocol fixture with explicit UIDVALIDITY/UIDNEXT bounds. */
  const driver = multiDriver({ INBOX: [], Archive: [], Invoices: [] });
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: driver.connections,
    parse,
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  /** Finite configured-folder poll receipts; discovery never adds arbitrary remote folders. */
  const results = await receiver.pollConfiguredMailboxes();
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.nextCursor.mailbox),
    ['INBOX', 'Archive', 'Invoices']
  );
  /** Owned synthetic POP3 receiver; named mailbox options must reject before protocol work. */
  const pop = createEmailReceiver({
    accounts: [
      {
        name: 'pop',
        protocol: 'pop3',
        host: 'pop.example.test',
        auth: { user: 'test', password: 'test' },
      },
    ],
    connections: {
      ...driver.connections,
      /**
       * Return a synthetic POP3 client or reject a deliberately unexpected protocol call.
       *
       * @returns {Promise<object>} Injected client without sockets or real credentials.
       */
      async pop3() {
        return {
          /**
           * Return only the finite synthetic stable-identity list, including deliberate duplicates.
           *
           * @returns {Promise<string[][]>} Fixture UIDL rows; duplicates must reject before retrieval.
           */
          async UIDL() {
            return [];
          },
          /**
           * Record or complete the synthetic POP3 cleanup command.
           *
           * @returns {Promise<void>} Local fixture completion without remote deletion.
           */
          async QUIT() {},
        };
      },
    },
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => pop.close());
  await assert.rejects(
    pop.poll('pop', { mailbox: 'Archive' }),
    /no named mailboxes/
  );
  assert.throws(
    () =>
      createEmailReceiver({
        accounts: [{ ...account, mailboxes: ['Archive', 'Archive'] }],
      }),
    /allowlist/
  );
  assert.throws(
    () =>
      createEmailReceiver({
        accounts: [{ ...account, mailboxes: ['Bad\rMailbox'] }],
      }),
    /allowlist/
  );
});
test('inbox API authorizes selected mailbox before invoking manual polling', async (t) => {
  /** Injected multi-folder protocol fixture with explicit UIDVALIDITY/UIDNEXT bounds. */
  const driver = multiDriver({ INBOX: [], Archive: [] });
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: driver.connections,
    parse,
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  /** Captured inbox authorization contexts; denied folder access must precede any protocol request. */
  const attempts = [];
  /** Authorized inbox API or borrowed per-folder sync controller over explicit fixture ports. */
  const inbox = createInboxApi({
    store: createMemoryInboxStore(),
    receiver,
    authorize: async (ctx) => {
      attempts.push(ctx);
      return ctx.account === 'support' && ctx.mailbox !== 'Archive';
    },
  });
  await assert.rejects(inbox.poll('support', 'Archive'), /access denied/);
  assert.equal(driver.requests.length, 0);
  assert.equal((await inbox.poll('support', 'INBOX')).account, 'support');
  assert.ok(
    attempts.some((a) => a.operation === 'poll' && a.mailbox === 'Archive')
  );
  await assert.rejects(
    inbox.poll('support', 'Bad\nfolder'),
    /Invalid inbox mailbox/
  );
});
test('IMAP UID cursor and remote mutations reject invalid, cross-folder and out-of-range values', async (t) => {
  /** Injected multi-folder protocol fixture with explicit UIDVALIDITY/UIDNEXT bounds. */
  const driver = multiDriver({
    INBOX: [{ uid: 1, source: Buffer.from('ok') }],
  });
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: driver.connections,
    parse,
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  // Exercise only finite explicitly invalid UID/attachment cases; no real protocol connection.
  for (const afterUid of [-1, 2 ** 32, 2.3]) {
    await assert.rejects(
      receiver.poll('support', { cursor: { afterUid } }),
      /cursor/
    );
  }
  /** Maximum valid cursor receipt; native UIDNEXT bounds prevent invalid/future range scans. */
  const terminal = await receiver.poll('support', {
    cursor: { afterUid: 0xffffffff, mailbox: 'INBOX' },
  });
  assert.equal(terminal.nextCursor.afterUid, 0xffffffff);
  assert.ok(!driver.requests.some((r) => typeof r === 'object'));
  /** Private synthetic JSON-mode message with immutable UID/folder identity. */
  const msg = (await receiver.poll('support')).messages[0];
  await assert.rejects(
    receiver.markSeen('support', { ...msg, remoteId: String(2 ** 32) }),
    /identity|not found/
  );
  await assert.rejects(
    receiver.markSeen('support', { ...msg, mailbox: 'Unlisted' }),
    /identity|not found/
  );
  assert.equal(await receiver.markSeen('support', msg), true);
  assert.ok(driver.requests.includes('flag:INBOX:1:\\Seen'));
});
test('bad POP3 UIDL duplicates are rejected before RETR, without deleting remote mail', async (t) => {
  /** Captured synthetic POP3 commands; duplicate identity must reject before RETR/DELE. */
  const actions = [];
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [
      {
        name: 'pop',
        protocol: 'pop3',
        host: 'pop.example.test',
        auth: { user: 'a', password: 'b' },
      },
    ],
    connections: {
      /**
       * Return a synthetic IMAP client or reject a deliberately unexpected protocol call.
       *
       * @returns {Promise<object>} Injected client without sockets or real credentials.
       */
      async imap() {
        throw Error('unexpected');
      },
      /**
       * Return a synthetic POP3 client or reject a deliberately unexpected protocol call.
       *
       * @returns {Promise<object>} Injected client without sockets or real credentials.
       */
      async pop3() {
        return {
          /**
           * Return only the finite synthetic stable-identity list, including deliberate duplicates.
           *
           * @returns {Promise<string[][]>} Fixture UIDL rows; duplicates must reject before retrieval.
           */
          async UIDL() {
            return [
              ['1', 'same'],
              ['2', 'same'],
            ];
          },
          /**
           * Record deliberately observable synthetic retrieval without a network request.
           *
           * @returns {Promise<string>} Authored mail text; duplicate-UIDL tests must never invoke this.
           */
          async RETR() {
            actions.push('RETR');
            return 'mail';
          },
          /**
           * Record or complete the synthetic POP3 cleanup command.
           *
           * @returns {Promise<void>} Local fixture completion without remote deletion.
           */
          async QUIT() {
            actions.push('QUIT');
          },
          /**
           * Record an unexpected synthetic deletion attempt so the test can deny it.
           *
           * @returns {Promise<void>} Local capture only; the receiver must not invoke this capability.
           */
          async DELE() {
            actions.push('DELE');
          },
        };
      },
    },
    parse,
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  await assert.rejects(receiver.poll('pop'), /duplicate POP3 UIDL/);
  assert.deepEqual(actions, ['QUIT']);
});
test('malformed MIME and oversized custom-parser attachments are rejected or omitted before callback', async (t) => {
  /** Injected multi-folder protocol fixture with explicit UIDVALIDITY/UIDNEXT bounds. */
  const driver = multiDriver({
    INBOX: [{ uid: 5, source: Buffer.from('safe') }],
  });
  // Exercise only finite explicitly invalid UID/attachment cases; no real protocol connection.
  for (const bad of [{ size: -1 }, { content: 'not-bytes' }, { size: 1.3 }]) {
    /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
    const receiver = createEmailReceiver({
      accounts: [account],
      mode: 'json',
      connections: driver.connections,
      parse: async () => ({ attachments: [{ filename: 'bad.txt', ...bad }] }),
    });
    // Stop admission after individually awaited fixture operations, even on assertion failure.
    t.after(() => receiver.close());
    await assert.rejects(receiver.poll('support'), /Invalid MIME attachment/);
  }
  let uploads = 0,
    scans = 0;
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [{ ...account, maxMessageBytes: 1024 }],
    mode: 'json',
    connections: driver.connections,
    parse: async () => ({
      attachments: [
        { filename: 'too-big.dat', size: 4096, content: Buffer.from('data') },
      ],
    }),
    attachmentContent: 'base64',
    saveAttachment: async () => {
      uploads++;
      return 'private:ref';
    },
    inspectAttachment: async () => {
      scans++;
      return 'clean';
    },
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  /** Synthetic message selected only from the current fixture folder and exact UID. */
  const item = (await receiver.poll('support')).messages[0].attachments[0];
  assert.equal(item.size, 4096);
  assert.equal(item.contentOmitted, true);
  assert.equal(item.contentBase64, undefined);
  assert.equal(item.storedReference, undefined);
  assert.equal(uploads, 0);
  assert.equal(scans, 0);
});
test('JSON delivery callback failures do not advance incremental IMAP cursor', async (t) => {
  /** Injected multi-folder protocol fixture with explicit UIDVALIDITY/UIDNEXT bounds. */
  const driver = multiDriver({
    INBOX: [{ uid: 7, source: Buffer.from('replay') }],
  });
  let fail = true,
    attempts = 0;
  /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: driver.connections,
    parse,
    onMessage: async () => {
      attempts++;
      if (fail) {
        throw Error('downstream unavailable');
      }
    },
  });
  // Stop admission after individually awaited fixture operations, even on assertion failure.
  t.after(() => receiver.close());
  await assert.rejects(
    receiver.poll('support', { cursor: { afterUid: 0 } }),
    /downstream unavailable/
  );
  fail = false;
  /** Retry receipt after the trusted callback recovers; failed callback must not advance the cursor. */
  const result = await receiver.poll('support', { cursor: { afterUid: 0 } });
  assert.equal(result.stored, 1);
  assert.equal(result.nextCursor.afterUid, 19);
  assert.equal(attempts, 2);
});
test('separate SQLite checkpoints fence and isolate worker progress per IMAP folder', async () => {
  /** Fixed module bridge for the built native SQLite connector. */
  const require = createRequire(import.meta.url);
  /** Public native SQLite factory; fixtures use only owned disposable journal paths. */
  const { createConnector } = require('../../db-sqllite/dist/index.js');
  /** Owned temporary checkpoint directory, removed after native connections settle. */
  const temp = await mkdtemp(join(tmpdir(), 'zerux-mailbox-checkpoint-'));
  /** Synthetic database path inside the owned temporary directory. */
  const path = join(temp, 'mail.db');
  /** First owned native checkpoint connection; cleanup must cover partial startup. */
  let firstConnection;
  let secondConnection;
  // Own cleanup before any native open, including partial startup failure.
  try {
    firstConnection = await createConnector({
      filename: path,
      driver: 'node',
    });
    /** Second owned connection testing committed folder-scoped progress. */
    secondConnection = await createConnector({
      filename: path,
      driver: 'node',
    });
    /** Fixed private structured database context, separate from operator application state. */
    const ctx = {
      connection: {
        slug: 'main',
        name: 'main',
        connector: '@zeruxjs/db-sqlite',
        options: {},
      },
    };
    /**
     * Borrow only structured checkpoint operations from an owned native fixture.
     *
     * @param {object} c - Owned native SQLite connector; close remains outside this adapter.
     * @returns {object} Borrowed database port with no independent close ownership.
     */
    const from = (c) =>
      Object.fromEntries(
        ['createTable', 'insert', 'select', 'update'].map((op) => [
          op,
          (arg) => c.execute({ op, ...arg }, ctx),
        ])
      );
    /** Captured synthetic poll names/folders/cursors; no actual mailbox is read. */
    const received = [];
    /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
    const receiver = {
      poll: async (name, { mailbox, cursor }) => {
        received.push({ name, mailbox, cursor });
        return {
          stored: 1,
          nextCursor: {
            uidValidity: '12',
            mailbox,
            afterUid: cursor.afterUid + 1,
          },
        };
      },
    };

    /** Authorized inbox API or borrowed per-folder sync controller over explicit fixture ports. */
    const inbox = createDatabaseMailboxSync({
      db: from(firstConnection),
      id: 'main-sync',
      account: 'support',
      mailbox: 'INBOX',
      receiver,
    });
    /** Separate folder-bound sync controller sharing only the native synthetic database. */
    const archive = createDatabaseMailboxSync({
      db: from(secondConnection),
      id: 'main-sync',
      account: 'support',
      mailbox: 'Archive',
      receiver,
    });
    assert.equal((await inbox.runOnce('worker-a')).state.cursor.afterUid, 1);
    assert.equal((await archive.runOnce('worker-b')).state.cursor.afterUid, 1);
    assert.equal((await inbox.runOnce('worker-a')).state.cursor.afterUid, 2);
    assert.equal((await archive.get()).cursor.afterUid, 1);
    assert.deepEqual(
      received.map((r) => r.mailbox),
      ['INBOX', 'Archive', 'INBOX']
    );
    assert.equal((await archive.resetCursor()).cursor.afterUid, 0);
    assert.equal((await inbox.get()).cursor.afterUid, 2);
  } finally {
    // Attempt both disconnects and owned-folder cleanup after any earlier rejection.
    try {
      await firstConnection?.disconnect();
    } finally {
      try {
        await secondConnection?.disconnect();
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
  }
});
test('legacy unscoped checkpoint adopts the initial folder but refuses later implicit folder changes', async () => {
  /** Fixed module bridge for the built native SQLite connector. */
  const require = createRequire(import.meta.url);
  /** Public native SQLite factory; fixtures use only owned disposable journal paths. */
  const { createConnector } = require('../../db-sqllite/dist/index.js');
  /** Owned temporary checkpoint directory, removed after native connections settle. */
  const temp = await mkdtemp(
    join(tmpdir(), 'zerux-mailbox-checkpoint-legacy-')
  );
  /** Owned native fixture for legacy checkpoint adoption/reset. */
  let connector;
  // Own cleanup before any native open, including partial startup failure.
  try {
    connector = await createConnector({
      filename: join(temp, 'mail.db'),
      driver: 'node',
    });
    /** Fixed private structured database context, separate from operator application state. */
    const ctx = {
      connection: {
        slug: 'main',
        name: 'main',
        connector: '@zeruxjs/db-sqlite',
        options: {},
      },
    };
    /** Borrowed structured database port over the owned legacy fixture. */
    const db = Object.fromEntries(
      ['createTable', 'insert', 'select', 'update'].map((op) => [
        op,
        (input) => connector.execute({ op, ...input }, ctx),
      ])
    );
    let currentFolder = 'Archive';
    /** Explicit receiver/poll capability; factory wrappers own admission close, while sync stubs borrow no native client. */
    const receiver = {
      poll: async (_name, { cursor }) => {
        if (cursor.mailbox && cursor.mailbox !== currentFolder) {
          throw new Error('cross-mailbox cursor refused');
        }
        return {
          stored: 1,
          nextCursor: {
            mailbox: currentFolder,
            uidValidity: '12',
            afterUid: cursor.afterUid + 1,
          },
        };
      },
    };

    /** Explicit legacy unscoped checkpoint controller; implicit folder changes must fail until reset. */
    const legacy = createDatabaseMailboxSync({
      db,
      id: 'legacy',
      account: 'support',
      receiver,
    });
    assert.equal((await legacy.runOnce('worker')).state.mailbox, 'Archive');
    assert.equal((await legacy.runOnce('worker')).state.cursor.afterUid, 2);
    currentFolder = 'INBOX';
    await assert.rejects(
      legacy.runOnce('worker'),
      /cross-mailbox cursor refused/
    );
    assert.equal((await legacy.get()).status, 'failed');
    await legacy.resetCursor();
    assert.equal((await legacy.runOnce('worker')).state.mailbox, 'INBOX');
  } finally {
    try {
      await connector?.disconnect();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
});
