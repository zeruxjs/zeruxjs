import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createEmailReceiver,
  createDatabaseMailboxSync,
  createIncomingSyncProcessor,
  createDatabaseInboxStore,
  createMemoryInboxStore,
  sweepInboundRetention,
  inspectInboundSafety,
} from '../dist/index.js';
/** Fixed bridge for the built native SQLite dependency; no caller-selected package imports. */
const require = createRequire(import.meta.url);
/** Public native factory used only with owned synthetic database paths. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Fixed structured database operation context, separate from operator application state. */
const context = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Borrow only explicit structured operations from an owned synthetic SQLite connector.
 *
 * @param {object} c - Owned native SQLite fixture; cleanup stays outside this borrowed adapter.
 * @returns {object} Borrowed database port; native disconnect remains externally owned.
 */
const dbFrom = (c) =>
  Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (input) => c.execute({ op, ...input }, context)]
    )
  );
/** Explicit synthetic account/budgets; injected clients never use its fixture password remotely. */
const account = {
  name: 'inbox',
  protocol: 'imap',
  host: 'mail.example.test',
  auth: { user: 'mail@example.test', password: 'secret' },
  maxMessagesPerPoll: 2,
  maxMailboxMessages: 6,
};
/**
 * Create a finite injected protocol inventory with explicit UID epoch/next bounds.
 *
 * @param {object[]} items - Finite synthetic UID inventory.
 * @param {bigint} validity - Explicit fixture UIDVALIDITY, default 12n.
 * @returns {object} Synthetic clients and captured queries; no real TLS/mailbox access.
 */
function fakeImap(items, validity = 12n) {
  /** Captured finite native UID queries; no actual mailbox search. */
  const searched = [];
  return {
    searched,
    connections: {
      /**
       * Return an injected IMAP object or reject an unexpected protocol call.
       *
       * @returns {Promise<object>} Synthetic protocol client with no socket/authentication exchange.
       */
      async imap() {
        return {
          mailbox: {
            exists: items.length,
            uidValidity: validity,
            uidNext: BigInt(Math.max(0, ...items.map((i) => i.uid)) + 1),
          },
          /**
           * Complete synthetic connection setup without network I/O.
           *
           * @returns {Promise<void>} Fixture operation settled.
           */
          async connect() {},
          /**
           * Return explicit fixture lock ownership without locking a real mailbox.
           *
           * @returns {Promise<object>} Synthetic release handle; read/write semantics are asserted separately.
           */
          async getMailboxLock() {
            return {
              /**
               * Release the no-op synthetic mailbox lock.
               *
               * @returns {void} No external resource is affected.
               */
              release() {},
            };
          },
          /**
           * Return only the finite authored UID inventory and capture its native query.
           *
           * @param {object} query - Explicit native UID-range request captured only by the fixture.
           * @returns {Promise<number[]>} Synthetic immutable UIDs; no remote search.
           */
          async search(query) {
            searched.push(query);
            return items.map((i) => i.uid);
          },
          /**
           * Return authored bytes for the exact synthetic UID.
           *
           * @param {number} uid - Exact immutable synthetic UID.
           * @returns {Promise<object | false>} Synthetic source/size metadata or absence.
           */
          async fetchOne(uid) {
            /** Synthetic UID match; no arbitrary remote message lookup. */
            const found = items.find((item) => item.uid === uid);
            return found ? { source: Buffer.from(`M${uid}`), size: 2 } : false;
          },
          /**
           * Complete synthetic IMAP cleanup without a remote connection.
           *
           * @returns {Promise<void>} Fixture operation settled.
           */
          async logout() {},
        };
      },
      /**
       * Return an injected POP3 object or reject an unexpected protocol call.
       *
       * @returns {Promise<object>} Synthetic protocol client with no socket/authentication exchange.
       */
      async pop3() {
        throw Error('wrong protocol');
      },
    },
  };
}
/**
 * Return authored hostile MIME/attachment fixture data without executing or fetching it.
 *
 * @param {Buffer} _raw - Authored MIME bytes; this fixture deliberately does not parse their content.
 * @returns {Promise<object>} Untrusted synthetic content for scanner/omission assertions.
 */
const parse = async (_raw) => ({
  subject: 'Verify password urgently',
  text: 'Hi',
  html: '<script>alert(1)</script><a href="https://evil.test">https://bank.example</a><img src="https://tracker.test/a">',
  from: { value: [{ address: 'sender@example.test' }] },
  attachments: [
    {
      filename: 'setup.exe',
      contentType: 'application/octet-stream',
      content: Buffer.from([0, 255, 2]),
    },
  ],
});
test('JSON-only IMAP needs no tables and returns untrusted content flags and capped attachment bytes', async (t) => {
  /** Captured synthetic onMessage callbacks; never exported as default telemetry. */
  const observed = [];
  /** Injected IMAP fixture with finite UID inventory and explicit epoch. */
  const d = fakeImap([{ uid: 3 }, { uid: 4 }, { uid: 5 }]);
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: d.connections,
    parse,
    sanitizeHtml: async () => '<p>sanitized</p>',
    attachmentContent: 'base64',
    onMessage: (m) => {
      observed.push(m);
    },
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  /** First bounded poll/checkpoint result; native persistence and remote delivery remain separate. */
  const first = await receiver.poll('inbox', { cursor: { afterUid: 0 } });
  assert.equal(first.stored, 2);
  assert.equal(first.messages.length, 2);
  assert.equal(first.nextCursor.afterUid, 4);
  assert.equal(first.messages[0].html, '<p>sanitized</p>');
  assert.equal(
    first.messages[0].attachments[0].contentBase64,
    Buffer.from([0, 255, 2]).toString('base64')
  );
  assert.ok(first.messages[0].safety.flags.includes('active_html'));
  assert.ok(first.messages[0].safety.flags.includes('executable_attachment'));
  assert.ok(first.messages[0].safety.flags.includes('suspicious_link'));
  assert.equal(first.messages[0].safety.authentication, 'unverified');
  assert.equal(first.messages[0].protocol, 'imap');
  assert.equal(JSON.stringify(first).includes('secret'), false);
  /** Continued poll/checkpoint controller/result under explicit UID cursor scope. */
  const second = await receiver.poll('inbox', { cursor: first.nextCursor });
  assert.equal(second.stored, 1);
  assert.equal(second.messages[0].remoteId, '5');
  assert.equal(observed.length, 3);
  assert.ok(d.searched.every((s) => 'uid' in s));
  assert.throws(() => receiver.page('inbox'), /No inbox store/);
  await assert.rejects(
    receiver.poll('inbox', { cursor: { uidValidity: '9', afterUid: 2 } }),
    /UIDVALIDITY changed/
  );
});
test('JSON-mode POP3 exposes parsed fields with user-owned persistence and never deletes', async (t) => {
  let n = 0;
  /** Captured synthetic POP3 cleanup sequence; no remote deletion. */
  const commands = [];
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [
      {
        name: 'pop',
        protocol: 'pop3',
        host: 'pop.example.test',
        auth: { user: 'a', password: 'b' },
      },
    ],
    mode: 'json',
    parse: async (raw) => ({
      text: `bytes:${raw.toString('hex')}`,
      attachments: [],
    }),
    connections: {
      /**
       * Return an injected IMAP object or reject an unexpected protocol call.
       *
       * @returns {Promise<object>} Synthetic protocol client with no socket/authentication exchange.
       */
      async imap() {
        throw Error('not IMAP');
      },
      /**
       * Return an injected POP3 object or reject an unexpected protocol call.
       *
       * @returns {Promise<object>} Synthetic protocol client with no socket/authentication exchange.
       */
      async pop3() {
        return {
          /**
           * Return only the finite synthetic POP3 identity inventory.
           *
           * @returns {Promise<string[][]>} Authored stable identity rows; not remote mailbox data.
           */
          async UIDL() {
            return [['1', 'one']];
          },
          /**
           * Yield authored binary fixture bytes through an explicit finite iterator.
           *
           * @returns {Promise<AsyncGenerator<Buffer>>} Synthetic byte stream, never a remote attachment fetch.
           */
          async RETR() {
            return (async function* () {
              yield Buffer.from([0, 255]);
            })();
          },
          /**
           * Capture synthetic POP3 cleanup without deleting any message.
           *
           * @returns {Promise<void>} Local cleanup capture updated.
           */
          async QUIT() {
            commands.push('QUIT');
          },
        };
      },
    },
    onMessage: async (msg) => {
      n++;
      assert.equal(msg.text, 'bytes:00ff');
    },
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  assert.equal((await receiver.poll('pop')).messages.length, 1);
  assert.equal((await receiver.poll('pop')).messages.length, 1);
  assert.equal(n, 2);
  assert.deepEqual(commands, ['QUIT', 'QUIT']);
});
test('strict inline attachment bound reports omissions instead of dumping payloads', async (t) => {
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    connections: fakeImap([{ uid: 1 }]).connections,
    mode: 'json',
    attachmentContent: 'base64',
    maxInlineAttachmentBytes: 1024,
    parse: async () => ({
      attachments: [{ filename: 'giant.bin', content: Buffer.alloc(2048) }],
    }),
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  /** Private synthetic received message checked for explicit omission or normalized filename. */
  const row = (await receiver.poll('inbox')).messages[0];
  assert.equal(row.attachments[0].contentBase64, undefined);
  assert.equal(row.attachments[0].contentOmitted, true);
  assert.ok(row.safety.flags.includes('attachment_content_omitted'));
});
test('heuristic signals are advisory and do not claim genuine authentication or malware detection', () => {
  /** Pure lexical advisory result for authored low-risk markup; not authentication evidence. */
  const low = inspectInboundSafety({
    subject: 'Normal',
    from: ['sender@example.test'],
    html: '<p>ok</p>',
  });
  assert.equal(low.risk, 'low');
  assert.equal(low.authentication, 'unverified');
  /** Pure lexical advisory result for hostile authored metadata; not malware certification. */
  const high = inspectInboundSafety({
    subject: 'Verify password urgently',
    from: [],
    html: '<iframe src="x"></iframe>',
    attachments: [{ filename: 'runner.ps1' }],
  });
  assert.equal(high.risk, 'high');
  assert.ok(high.flags.includes('executable_attachment'));
});
test('database mailbox checkpoint fences workers, resumes after lease expiry and preserves UID cursor', async () => {
  /** Owned temporary database directory removed after native handles settle. */
  const directory = await mkdtemp(join(tmpdir(), 'zerux-inbound64-'));
  /** Synthetic SQLite path inside the owned directory. */
  const path = join(directory, 'inbox.db');
  // Track optional native/task ownership before acquisition so every partial failure is covered.
  let a;
  let b;
  let time;
  let block;
  let resolvePoll;
  let stalled;
  try {
    a = await createConnector({ filename: path, driver: 'node' });
    b = await createConnector({ filename: path, driver: 'node' });
    time = 10_000;
    block = false;
    /** Explicit receiver/poll capability; only factory wrappers own admission close. */
    const receiver = {
      poll: async (_account, { cursor }) => {
        if (block) {
          return new Promise((resolve) => {
            resolvePoll = () =>
              resolve({
                stored: 1,
                nextCursor: { uidValidity: '5', afterUid: cursor.afterUid + 1 },
              });
          });
        }
        return {
          stored: 2,
          nextCursor: { uidValidity: '5', afterUid: cursor.afterUid + 2 },
        };
      },
    };
    /** First bounded poll/checkpoint result; native persistence and remote delivery remain separate. */
    const first = createDatabaseMailboxSync({
      db: dbFrom(a),
      id: 'worker-job',
      account: 'inbox',
      receiver,
      now: () => time,
      leaseMs: 3000,
    });
    /** Continued poll/checkpoint controller/result under explicit UID cursor scope. */
    const second = createDatabaseMailboxSync({
      db: dbFrom(b),
      id: 'worker-job',
      account: 'inbox',
      receiver,
      now: () => time,
      leaseMs: 3000,
    });
    /** Committed synthetic checkpoint result with explicit cursor progress. */
    const page = await first.runOnce('a');
    assert.equal(page.state.cursor.afterUid, 2);
    assert.equal((await second.get()).cursor.afterUid, 2);
    block = true;
    /** Actual unresolved synthetic poll task; resolve/observe before closing native storage. */
    stalled = first.runOnce('a');
    // Allow the async worker to acquire the lease and begin its remote poll.
    for (let i = 0; i < 40 && !resolvePoll; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(typeof resolvePoll, 'function');
    assert.equal((await second.runOnce('b')).busy, true);
    time += 3001;
    block = false;
    /** New epoch-owner result after controlled expiry; stale completion must be fenced. */
    const takeover = await second.runOnce('b');
    assert.equal(takeover.state.cursor.afterUid, 4);
    resolvePoll();
    await assert.rejects(stalled, /lease lost/);
    assert.equal((await first.get()).cursor.afterUid, 4);
    /** Explicit reset receipt; it is a management action, never inferred from a changed folder. */
    const reset = await first.resetCursor();
    assert.equal(reset.cursor.afterUid, 0);
  } finally {
    // Unblock both already-entered and not-yet-entered synthetic polls before native close.
    block = false;
    resolvePoll?.();
    await stalled?.catch(() => {});
    try {
      await a?.disconnect();
    } finally {
      try {
        await b?.disconnect();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});
test('external spam and attachment scanners annotate messages without persisting unsafe binary data', async (t) => {
  let uploads = 0;
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: fakeImap([{ uid: 1 }]).connections,
    parse,
    sanitizeHtml: async () => '<p>safe</p>',
    attachmentContent: 'base64',
    inspectRaw: async () => 'malware',
    inspectAttachment: async () => 'blocked',
    saveAttachment: async () => {
      uploads++;
      return 'private://asset';
    },
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  /** Private synthetic message after trusted scanner annotation; no unsafe binary persistence. */
  const msg = (await receiver.poll('inbox')).messages[0];
  assert.ok(msg.safety.flags.includes('external_malware'));
  assert.ok(msg.safety.flags.includes('attachment_scanner_blocked'));
  assert.equal(msg.safety.externalVerdict, 'malware');
  assert.equal(msg.attachments[0].contentOmitted, true);
  assert.equal(msg.attachments[0].contentBase64, undefined);
  assert.equal(uploads, 0);
});
test('scanner failures propagate rather than being interpreted as clean', async (t) => {
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: fakeImap([{ uid: 1 }]).connections,
    parse,
    inspectRaw: async () => {
      throw Error('scan unavailable');
    },
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  await assert.rejects(receiver.poll('inbox'), /scan unavailable/);
});

test('dry-run retention and explicit local erasure preserve remote messages and respect host legal holds', async (t) => {
  /** Process-local inbox or borrowed native store containing only synthetic records. */
  const store = createMemoryInboxStore();
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    store,
    connections: fakeImap([{ uid: 1 }, { uid: 2 }, { uid: 3 }]).connections,
    parse: async (raw) => ({ subject: raw.toString('utf8') }),
    now: () => 1000,
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  assert.equal((await receiver.poll('inbox')).stored, 2);
  let shouldErase = false;
  /** Explicit account/cutoff/approval retention policy; local cleanup never grants remote deletion. */
  const policy = {
    store,
    account: 'inbox',
    olderThan: 2000,
    canErase: async () => shouldErase,
  };
  assert.equal((await sweepInboundRetention(policy)).eligible, 0);
  shouldErase = true;
  /** Default no-erasure preview; eligible counts do not imply committed deletion. */
  const dry = await sweepInboundRetention(policy);
  assert.equal(dry.eligible, 2);
  assert.equal(dry.erased, 0);
  /** Approved synthetic local retention result; no real user data is touched. */
  const erased = await sweepInboundRetention({ ...policy, dryRun: false });
  assert.equal(erased.erased, 2);
  assert.equal((await store.page('inbox', null, 20)).items.length, 0);
  assert.equal((await receiver.poll('inbox')).stored, 2); // local cleanup does not delete server mail
});
test('real SQLite inbox retention requires explicit opt-in and database delete', async (t) => {
  /** Owned temporary database directory removed after native handles settle. */
  const directory = await mkdtemp(join(tmpdir(), 'zerux-inbox-retain-'));
  /** Synthetic SQLite path inside the owned directory. */
  const path = join(directory, 'mail.db');
  /** Owned native inbox connection over an isolated temporary file. */
  let c;
  try {
    c = await createConnector({ filename: path, driver: 'node' });
    /** Borrowed structured port over the owned synthetic native handle. */
    const db = dbFrom(c);
    /** Process-local inbox or borrowed native store containing only synthetic records. */
    const store = createDatabaseInboxStore(db);
    /** Explicit receiver/poll capability; only factory wrappers own admission close. */
    const receiver = createEmailReceiver({
      accounts: [account],
      store,
      connections: fakeImap([{ uid: 10 }]).connections,
      parse: async () => ({ subject: 'mail' }),
      now: () => 1000,
    });
    // Stop admission after individually awaited fixture polls, even if an assertion fails.
    t.after(() => receiver.close());
    assert.equal((await receiver.poll('inbox')).stored, 1);
    /** Approved synthetic native retention receipt; optional side effects remain separate. */
    const report = await sweepInboundRetention({
      store,
      account: 'inbox',
      olderThan: 2000,
      dryRun: false,
      canErase: async () => true,
    });
    assert.equal(report.erased, 1);
    assert.equal((await store.page('inbox', null, 20)).items.length, 0);
  } finally {
    try {
      await c?.disconnect();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
test('JSON mode can explicitly set IMAP seen using immutable remote identity without inbox table', async (t) => {
  let marked = 0;
  /** Injected protocol client for exact UID-mode seen mutation; no live IMAP connection. */
  const con = {
    /**
     * Return an injected IMAP object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic protocol client with no socket/authentication exchange.
     */
    async imap() {
      return {
        mailbox: { exists: 1, uidValidity: 12n, uidNext: 2n },
        /**
         * Complete synthetic connection setup without network I/O.
         *
         * @returns {Promise<void>} Fixture operation settled.
         */
        async connect() {},
        /**
         * Return explicit fixture lock ownership without locking a real mailbox.
         *
         * @param {string} _name - Explicit mailbox name, intentionally unused by the no-op lock fixture.
         * @param {object} settings - Explicit requested lock policy.
         * @param {boolean} settings.readOnly - Requested mode; this fixture owns no real server lock.
         * @returns {Promise<object>} Synthetic release handle; read/write semantics are asserted separately.
         */
        async getMailboxLock(_name, { readOnly: _readOnly }) {
          return {
            /**
             * Release the no-op synthetic mailbox lock.
             *
             * @returns {void} No external resource is affected.
             */
            release() {},
          };
        },
        /**
         * Return only the finite authored UID inventory and capture its native query.
         *
         * @returns {Promise<number[]>} Synthetic immutable UIDs; no remote search.
         */
        async search() {
          return [1];
        },
        /**
         * Return authored bytes for the exact synthetic UID.
         *
         * @returns {Promise<object | false>} Synthetic source/size metadata or absence.
         */
        async fetchOne() {
          return { source: Buffer.from('x') };
        },
        /**
         * Count an explicitly requested exact-UID synthetic seen mutation.
         *
         * @returns {Promise<void>} Local mutation counter only; no real mailbox changes.
         */
        async messageFlagsAdd() {
          marked++;
        },
        /**
         * Complete synthetic IMAP cleanup without a remote connection.
         *
         * @returns {Promise<void>} Fixture operation settled.
         */
        async logout() {},
      };
    },
    /**
     * Return an injected POP3 object or reject an unexpected protocol call.
     *
     * @returns {Promise<object>} Synthetic protocol client with no socket/authentication exchange.
     */
    async pop3() {
      throw Error('POP3 not expected');
    },
  };
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: con,
    parse: async () => ({}),
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  /** Immutable synthetic JSON-mode message identity used to authorize a native-shaped mutation. */
  const item = (await receiver.poll('inbox')).messages[0];
  assert.equal(await receiver.markSeen('inbox', item), true);
  assert.equal(marked, 1);
  await assert.rejects(
    receiver.markSeen('inbox', { ...item, remoteId: '55' }),
    /identity/
  );
});

test('mailbox sync queue adapter never accepts credentials or message content', async () => {
  /** Explicit opaque-reference sync processor; credentials/content in job bodies must reject. */
  const task = createIncomingSyncProcessor(async () => ({
    runOnce: async (worker) => ({ owner: worker }),
  }));
  assert.deepEqual(
    await task({ data: { id: 'imap-sync', account: 'inbox' } }, 'worker-a'),
    { owner: 'worker-a' }
  );
  await assert.rejects(
    task(
      { data: { id: 'imap-sync', account: 'inbox', password: 'secret' } },
      'worker-a'
    ),
    /only id and account/
  );
});
test('unsafe MIME attachment filenames are normalized before host callbacks receive them', async (t) => {
  let filename;
  /** Explicit receiver/poll capability; only factory wrappers own admission close. */
  const receiver = createEmailReceiver({
    accounts: [account],
    mode: 'json',
    connections: fakeImap([{ uid: 8 }]).connections,
    parse: async () => ({
      attachments: [
        { filename: '../../some\\\\escape.exe', content: Buffer.from('x') },
      ],
    }),
    saveAttachment: async (ctx) => {
      filename = ctx.attachment.filename;
      return 'opaque:1';
    },
  });
  // Stop admission after individually awaited fixture polls, even if an assertion fails.
  t.after(() => receiver.close());
  /** Private synthetic received message checked for explicit omission or normalized filename. */
  const row = (await receiver.poll('inbox')).messages[0];
  assert.equal(row.attachments[0].filename, 'escape.exe');
  assert.equal(filename, 'escape.exe');
  assert.ok(row.safety.flags.includes('executable_attachment'));
});
