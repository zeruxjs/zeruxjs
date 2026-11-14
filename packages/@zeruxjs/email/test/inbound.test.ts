import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createDatabaseInboxStore,
  createMemoryInboxStore,
  createEmailReceiver,
  createIncomingPollProcessor,
} from '../dist/index.js';
/** Fixed ESM/CommonJS bridge for the built native SQLite dependency. */
const require = createRequire(import.meta.url);
/** Public SQLite factory used only with owned disposable test state. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Fixed structured database context; never operator application state. */
const context = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Borrow a finite structured operation port from one owned SQLite fixture.
 *
 * @param {object} c - Owned native synthetic SQLite connector; close stays outside this adapter.
 * @returns {object} Borrowed database port with no independent native lifetime.
 */
const dbFrom = (c) =>
  Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (input) => c.execute({ op, ...input }, context),
    ])
  );
/**
 * Return only authored safe fixture HTML unchanged; this is not a production sanitizer.
 *
 * @param {string} html - Authored safe fixture HTML only.
 * @returns {Promise<string>} Fixed fixture HTML; no DOM/script/URL execution.
 */
const sanitizeHtml = async (html) => html;
/**
 * Map synthetic byte inputs to authored MIME metadata without parsing untrusted remote mail.
 *
 * @param {Buffer} raw - Synthetic source bytes used solely for deterministic metadata identity.
 * @returns {Promise<object>} Fixed metadata and three attachment bytes for validation assertions.
 */
const parse = async (raw) => ({
  messageId: `<${raw.toString('utf8')}>`,
  subject: 'New mail',
  text: 'body text',
  html: '<p>safe test</p>',
  from: { value: [{ address: 'alice@example.test' }] },
  to: { value: [{ address: 'support@example.test' }] },
  attachments: [
    {
      filename: 'report.txt',
      contentType: 'text/plain',
      size: 3,
      content: Buffer.from('PDF'),
    },
  ],
  date: new Date('2026-10-13T04:00:00Z'),
});
/**
 * Create an injected protocol client with finite UIDs and explicit lock/logout capture.
 *
 * @param {object[]} messages - Finite private UID/source fixture records.
 * @param {bigint} uidValidity - Explicit synthetic epoch, default 1n.
 * @returns {object} Client factory, captured actions and fetch count; no real TLS/network connection.
 */
function fakeImap(messages, uidValidity = 1n) {
  /** Captured synthetic IMAP connect/lock/release/logout ordering. */
  const actions = [];
  let calls = 0;
  /** Explicit injected IMAP/POP3 capabilities; no network authentication or TLS is exercised. */
  const connections = {
    /**
     * Create an injected IMAP protocol object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic client; no socket or authentication exchange.
     */
    async imap() {
      return {
        mailbox: { exists: messages.length, uidValidity },
        /**
         * Record or complete synthetic connection establishment without network I/O.
         *
         * @returns {Promise<void>} Fixture connect settled.
         */
        async connect() {
          actions.push('connect');
        },
        /**
         * Capture the explicitly requested mailbox/read-only mode and return fixture release ownership.
         *
         * @param {string} mailbox - Explicit authored mailbox name.
         * @param {object} settings - Explicit readOnly lock mode; first poll fixture asserts it is true.
         * @returns {Promise<object>} Synthetic release handle; it is not a native server lock.
         */
        async getMailboxLock(mailbox, settings) {
          assert.equal(settings.readOnly, true);
          actions.push('lock:' + mailbox);
          return {
            /**
             * Record release of the fixture mailbox lock exactly at operation cleanup.
             *
             * @returns {void} Updates only the local action/event capture.
             */
            release() {
              actions.push('unlock');
            },
          };
        },
        /**
         * Return only the finite fixture UID inventory.
         *
         * @returns {Promise<number[]>} Synthetic immutable UIDs, never actual mailbox data.
         */
        async search() {
          return messages.map((m) => m.uid);
        },
        /**
         * Return bounded synthetic bytes for the selected UID.
         *
         * @param {number} uid - Exact synthetic immutable UID.
         * @returns {Promise<object | false>} Source/size metadata or false for an absent UID.
         */
        async fetchOne(uid) {
          calls++;
          /** Synthetic message selected by exact immutable UID. */
          const m = messages.find((m) => m.uid === uid);
          return m ? { size: m.source.length, source: m.source } : false;
        },
        /**
         * Record synthetic IMAP logout after each settled operation.
         *
         * @returns {Promise<void>} Fixture connection completion.
         */
        async logout() {
          actions.push('logout');
        },
      };
    },
    /**
     * Create an injected POP3 protocol object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic client; no socket or authentication exchange.
     */
    async pop3() {
      throw Error('unexpected');
    },
  };
  return { connections, actions, calls: () => calls };
}
/**
 * Declare only a synthetic authenticated account configuration for injected protocol tests.
 *
 * @returns {object} Fixed fixture settings; its password is not a deployment credential.
 */
function imapAccount() {
  return {
    name: 'support',
    protocol: 'imap',
    host: 'imap.example.test',
    auth: { user: 'support@example.test', password: 'secret' },
    maxMessagesPerPoll: 50,
  };
}
test('IMAP TLS receiver is read-only, persists MIME metadata once across two SQLite connections', async (t) => {
  /** Owned temporary directory removed after both native connections settle. */
  const directory = await mkdtemp(join(tmpdir(), 'zerux-imap-'));
  /** Synthetic SQLite database path inside the owned directory. */
  const file = join(directory, 'mail.sqlite');
  /** First owned native database connection; cleanup must also cover partial startup. */
  let c1;
  /** Second owned native handle checking committed inbox dedupe visibility. */
  let c2;
  try {
    // Begin cleanup ownership before either open so a failed second connection cannot leak the first.
    c1 = await createConnector({ filename: file, driver: 'node' });
    c2 = await createConnector({ filename: file, driver: 'node' });
    /** First borrowed database inbox-store port over the owned synthetic connection. */
    const first = createDatabaseInboxStore(dbFrom(c1));
    /** Second borrowed store port used to check committed identities. */
    const second = createDatabaseInboxStore(dbFrom(c2));
    /** Finite synthetic UID/source corpus; no live mailbox content. */
    const messages = [
      { uid: 1, source: Buffer.from('one') },
      { uid: 2, source: Buffer.from('two') },
    ];
    /** Injected protocol fixture with captured native-operation ordering. */
    const driver = fakeImap(messages);
    /** Captured synthetic attachment references; no real files service is called. */
    const uploaded = [];
    /**
     * Create an owned admission wrapper over an explicit borrowed store and injected driver.
     *
     * @param {object} store - Borrowed inbox persistence fixture.
     * @returns {object} Receiver requiring close after actual poll operations settle.
     */
    const make = (store) =>
      createEmailReceiver({
        accounts: [imapAccount()],
        store,
        connections: driver.connections,
        parse,
        sanitizeHtml,
        saveAttachment: async ({ messageId, content }) => {
          assert.equal(content.toString(), 'PDF');
          uploaded.push(messageId);
          return `files://${messageId}`;
        },
      });
    /** First owned receiver wrapper; close stops admission after poll settlement. */
    const a = make(first);
    // Stop receiver admission even after failed assertions; polls here are individually awaited.
    t.after(() => a.close());
    /** Second receiver wrapper sharing native dedupe state; caller owns admission close. */
    const b = make(second);
    // Stop receiver admission even after failed assertions; polls here are individually awaited.
    t.after(() => b.close());
    assert.deepEqual((await a.poll('support')).stored, 2);
    assert.equal((await b.poll('support')).stored, 0);
    /** Bounded private inbox page checked for metadata/identity consistency. */
    const page = await second.page('support');
    assert.equal(page.items.length, 2);
    assert.ok(
      page.items.every((m) =>
        m.attachments[0].storedReference?.startsWith('files://')
      )
    );
    assert.equal(page.items[0].protocol, 'imap');
    assert.equal(page.items[0].uidValidity, '1');
    assert.equal(page.items[0].text, 'body text');
    assert.equal(driver.calls(), 2);
    assert.equal(
      JSON.stringify(await second.page('support')).includes('secret'),
      false
    );
    assert.equal(uploaded.length, 2);
    assert.deepEqual(driver.actions.slice(0, 3), [
      'connect',
      'lock:INBOX',
      'unlock',
    ]);
    await a.close();
    await assert.rejects(a.poll('support'), /closed/);
  } finally {
    // Attempt every owned close and directory cleanup even if an earlier close rejects.
    try {
      await c1?.disconnect();
    } finally {
      try {
        await c2?.disconnect();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});
test('IMAP UIDVALIDITY reset creates distinct inbox identity for reused UID', async (t) => {
  /** Process-local inbox fixture; it does not provide restart or multi-worker durability. */
  const store = createMemoryInboxStore();
  /** Synthetic UID reused under distinct UIDVALIDITY epochs to test identity separation. */
  const msg = [{ uid: 7, source: Buffer.from('hello') }];
  // Exercise only the finite explicit epoch/invalid-policy cases; never contact a real server.
  for (const valid of [10n, 11n]) {
    /** Owned receiver admission wrapper; injected operation cleanup and borrowed store ownership remain separate. */
    const receiver = createEmailReceiver({
      accounts: [imapAccount()],
      store,
      connections: fakeImap(msg, valid).connections,
      parse,
      sanitizeHtml,
    });
    // Stop receiver admission even after failed assertions; polls here are individually awaited.
    t.after(() => receiver.close());
    assert.equal((await receiver.poll('support')).stored, 1);
  }
  assert.equal((await store.page('support', null, 10)).items.length, 2);
});
test('POP3 UIDL deduplicates across message reordering without issuing DELE', async (t) => {
  /** Captured synthetic POP3 command sequence; DELE must never be issued. */
  const commands = [];
  /** Process-local inbox fixture; it does not provide restart or multi-worker durability. */
  const store = createMemoryInboxStore();
  let order = [
    ['1', 'stable-a'],
    ['2', 'stable-b'],
  ];
  /** Explicit injected IMAP/POP3 capabilities; no network authentication or TLS is exercised. */
  const connections = {
    /**
     * Create an injected IMAP protocol object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic client; no socket or authentication exchange.
     */
    async imap() {
      throw Error('unexpected');
    },
    /**
     * Create an injected POP3 protocol object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic client; no socket or authentication exchange.
     */
    async pop3() {
      return {
        /**
         * Return the current synthetic message-number/stable-identity ordering.
         *
         * @returns {Promise<string[][]>} Finite fixture UIDL list; stable identities survive reordering.
         */
        async UIDL() {
          commands.push('UIDL');
          return order;
        },
        /**
         * Return only the declared synthetic message-number text and record retrieval.
         *
         * @param {number} n - Current synthetic POP3 message number.
         * @returns {Promise<string>} Fixed fixture bytes/text; no remote mailbox is read.
         */
        async RETR(n) {
          commands.push(`RETR:${n}`);
          return `Mail ${n}`;
        },
        /**
         * Record synthetic POP3 completion without deleting messages.
         *
         * @returns {Promise<void>} Local protocol capture updated.
         */
        async QUIT() {
          commands.push('QUIT');
        },
      };
    },
  };
  /** Owned receiver admission wrapper; injected operation cleanup and borrowed store ownership remain separate. */
  const receiver = createEmailReceiver({
    accounts: [
      {
        name: 'backup',
        protocol: 'pop3',
        host: 'pop.example.test',
        auth: { user: 'backup@example.test', password: 'hidden' },
      },
    ],
    store,
    connections,
    parse,
    sanitizeHtml,
  });
  // Stop receiver admission even after failed assertions; polls here are individually awaited.
  t.after(() => receiver.close());
  assert.equal((await receiver.poll('backup')).stored, 2);
  order = [
    ['1', 'stable-b'],
    ['2', 'stable-a'],
  ];
  assert.equal((await receiver.poll('backup')).stored, 0);
  assert.equal(commands.filter((c) => c.startsWith('RETR')).length, 2);
  assert.equal(
    commands.some((c) => c === 'DELE'),
    false
  );
  /** Explicit opaque-account poll processor; queue bodies must never contain credentials. */
  const jobs = createIncomingPollProcessor(receiver);
  assert.equal((await jobs({ data: { account: 'backup' } })).stored, 0);
  await assert.rejects(
    jobs({ data: { account: 'backup', password: 'oops' } }),
    /only a receive account/
  );
});
test('invalid options fail before network, and oversized mail is skipped', async (t) => {
  // Exercise only the finite explicit epoch/invalid-policy cases; never contact a real server.
  for (const changed of [
    { secure: false },
    { auth: { user: 'a', accessToken: 'token' }, protocol: 'pop3' },
    { host: 'invalid:443' },
    { maxMessageBytes: 50 },
    { mailbox: '\r\nInjected' },
  ]) {
    assert.throws(() =>
      createEmailReceiver({
        accounts: [{ ...imapAccount(), ...changed }],
        store: createMemoryInboxStore(),
      })
    );
  }
  /** Injected protocol fixture with captured native-operation ordering. */
  const driver = fakeImap([{ uid: 1, source: Buffer.alloc(1500) }]);
  /** Owned receiver admission wrapper; injected operation cleanup and borrowed store ownership remain separate. */
  const receiver = createEmailReceiver({
    accounts: [{ ...imapAccount(), maxMessageBytes: 1024 }],
    store: createMemoryInboxStore(),
    connections: driver.connections,
    parse,
  });
  // Stop receiver admission even after failed assertions; polls here are individually awaited.
  t.after(() => receiver.close());
  assert.equal((await receiver.poll('support')).oversized, 1);
});
test('mailbox contents are truncated with explicit coverage indicator and no binary attachment in DB', async (t) => {
  /** Process-local inbox fixture; it does not provide restart or multi-worker durability. */
  const store = createMemoryInboxStore();
  /** Injected protocol fixture with captured native-operation ordering. */
  const driver = fakeImap([{ uid: 3, source: Buffer.from('hello') }]);
  /** Owned receiver admission wrapper; injected operation cleanup and borrowed store ownership remain separate. */
  const receiver = createEmailReceiver({
    accounts: [imapAccount()],
    store,
    connections: driver.connections,
    parse: async () => ({
      subject: 'A',
      text: 'x'.repeat(25000),
      attachments: [
        { filename: 'big.dat', content: Buffer.from('RAW_SECRET') },
      ],
    }),
  });
  // Stop receiver admission even after failed assertions; polls here are individually awaited.
  t.after(() => receiver.close());
  assert.equal((await receiver.poll('support')).stored, 1);
  /** Private stored inbox metadata checked for explicit truncation and UID validity. */
  const row = (await store.page('support')).items[0];
  assert.equal(row.bodyTruncated, true);
  assert.equal(row.text.length, 24000);
  assert.equal(JSON.stringify(row).includes('RAW_SECRET'), false);
});

test('IMAP markSeen uses explicit write lock and refuses UIDVALIDITY reuse', async (t) => {
  /** Process-local inbox fixture; it does not provide restart or multi-worker durability. */
  const store = createMemoryInboxStore();
  /** Captured synthetic write-lock/flag/logout sequence; no remote mailbox is changed. */
  const events = [];
  let validity = 5n;
  /** Explicit injected IMAP/POP3 capabilities; no network authentication or TLS is exercised. */
  const connections = {
    /**
     * Create an injected IMAP protocol object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic client; no socket or authentication exchange.
     */
    async imap() {
      return {
        mailbox: { exists: 1, uidValidity: validity },
        /**
         * Record or complete synthetic connection establishment without network I/O.
         *
         * @returns {Promise<void>} Fixture connect settled.
         */
        async connect() {},
        /**
         * Capture the explicitly requested mailbox/read-only mode and return fixture release ownership.
         *
         * @param {string} mailbox - Explicit authored mailbox name.
         * @param {object} settings - Explicit requested fixture lock mode.
         * @param {boolean} settings.readOnly - Read versus mutation lock request captured by this fixture.
         * @returns {Promise<object>} Synthetic release handle; it is not a native server lock.
         */
        async getMailboxLock(mailbox, { readOnly }) {
          events.push(`lock:${readOnly}`);
          return {
            /**
             * Record release of the fixture mailbox lock exactly at operation cleanup.
             *
             * @returns {void} Updates only the local action/event capture.
             */
            release() {
              events.push('unlock');
            },
          };
        },
        /**
         * Return only the finite fixture UID inventory.
         *
         * @returns {Promise<number[]>} Synthetic immutable UIDs, never actual mailbox data.
         */
        async search() {
          return [23];
        },
        /**
         * Return bounded synthetic bytes for the selected UID.
         *
         * @returns {Promise<object | false>} Source/size metadata or false for an absent UID.
         */
        async fetchOne() {
          return { source: Buffer.from('hello'), size: 5 };
        },
        /**
         * Capture flags only for the exact requested UID under explicit UID mode.
         *
         * @param {number} uid - Exact synthetic immutable UID.
         * @param {string[]} flags - Explicit flag list supplied by the receiver.
         * @param {object} options - Explicit UID-mode options; fixture requires uid true.
         * @returns {Promise<void>} Local mutation capture; no real mailbox changes.
         */
        async messageFlagsAdd(uid, flags, options) {
          events.push(`flag:${uid}:${flags[0]}`);
          assert.deepEqual(options, { uid: true });
        },
        /**
         * Return the fixed synthetic mailbox inventory.
         *
         * @returns {Promise<object[]>} Authored INBOX/Archive records, not a live server listing.
         */
        async list() {
          return [{ path: 'INBOX' }, { path: 'Archive' }];
        },
        /**
         * Record synthetic IMAP logout after each settled operation.
         *
         * @returns {Promise<void>} Fixture connection completion.
         */
        async logout() {
          events.push('logout');
        },
      };
    },
    /**
     * Create an injected POP3 protocol object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic client; no socket or authentication exchange.
     */
    async pop3() {
      throw Error('unexpected');
    },
  };
  /** Owned receiver admission wrapper; injected operation cleanup and borrowed store ownership remain separate. */
  const receiver = createEmailReceiver({
    accounts: [imapAccount()],
    store,
    parse,
    sanitizeHtml,
    connections,
  });
  // Stop receiver admission even after failed assertions; polls here are individually awaited.
  t.after(() => receiver.close());
  await receiver.poll('support');
  /** Private stored inbox metadata checked for explicit truncation and UID validity. */
  const row = (await store.page('support', null, 5)).items[0];
  assert.deepEqual(
    (await receiver.folders('support')).map((i) => i.path),
    ['INBOX', 'Archive']
  );
  validity = 6n;
  await assert.rejects(
    receiver.markSeen('support', row.id),
    /UIDVALIDITY changed/
  );
  validity = 5n;
  assert.equal(await receiver.markSeen('support', row.id), true);
  assert.ok(events.includes('lock:false'));
  assert.ok(events.includes('flag:23:\\Seen'));
});
