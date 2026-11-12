import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailManager,
  createEmailQueue,
  createEmailPreferenceService,
  createInboxApi,
  resolveAttachmentScope,
  classifySmtpRecipients,
  describeSmtpRecipients,
  isRetryableSmtpError,
} from '@zeruxjs/email';
/**
 * Build a synthetic private message with explicit override fields.
 *
 * @param {object} extra - Explicit synthetic message overrides, empty by default.
 * @returns {object} Inert message data; no execution or network request.
 */
const message = (extra = {}) => ({
  to: 'reader@example.test',
  subject: 'Hello',
  text: 'World',
  ...extra,
});
/**
 * Create an owned bounded manager around a deliberately injected synthetic transport.
 *
 * @param {object} transport - Injected native send/verification/close fixture; no real sockets.
 * @param {object} options - Explicit per-case budgets/consent/tracking policy, empty by default.
 * @returns {object} Manager requiring explicit close after its actual work settles.
 */
const service = (transport, options = {}) =>
  createEmailManager({
    accounts: [
      { name: 'primary', transport, defaults: { from: 'sender@example.test' } },
    ],
    ...options,
  });
test('per-recipient acceptance/rejection is precise and partial rejection never resends accepted recipients', async () => {
  let calls = 0;
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service({
    /**
     * Simulate native send outcomes, including deliberate partial acceptance and private failures.
     *
     * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
     */
    async sendMail() {
      calls++;
      return {
        accepted: ['reader@example.test'],
        rejected: ['retry@example.test', 'gone@example.test'],
        rejectedErrors: [
          { recipient: 'retry@example.test', responseCode: 450 },
          { recipient: 'gone@example.test', responseCode: 550 },
        ],
      };
    },
  });
  try {
    /** Private normalized outcome inspected for explicit acceptance/uncertainty semantics. */
    const result = await mail.send(
      message({ cc: ['retry@example.test', 'gone@example.test'] })
    );
    assert.equal(result.submissionStatus, 'partial');
    assert.deepEqual(
      result.recipientOutcomes.map((r) => r.status),
      ['accepted', 'transient', 'permanent']
    );
    assert.deepEqual(describeSmtpRecipients(result.recipientOutcomes), {
      accepted: 1,
      rejected: 0,
      transient: 1,
      permanent: 1,
      uncertain: 0,
    });
    assert.equal(calls, 1);
    assert.equal(
      classifySmtpRecipients(['x@example.test'], {})[0].status,
      'uncertain'
    );
  } finally {
    await mail.close();
  }
});
test('deadline after known SMTP acceptance returns acceptance and fences duplicate idempotent sends', async () => {
  let release,
    sends = 0;
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(
    {
      /**
       * Simulate native send outcomes, including deliberate partial acceptance and private failures.
       *
       * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
       */
      async sendMail() {
        sends++;
        return { accepted: ['reader@example.test'] };
      },
    },
    {
      sendTimeoutMs: 10,
      tracking: {
        instrumentHtml: (html) => html,
        onSent: () => new Promise((resolve) => (release = resolve)),
      },
    }
  );
  try {
    /** Stable private synthetic input used to check idempotency and snapshotted addresses. */
    const payload = message({
      tracking: { enabled: true },
      idempotencyKey: 'accepted-once',
    });
    /** Private normalized outcome inspected for explicit acceptance/uncertainty semantics. */
    const result = await mail.send(payload);
    assert.equal(result.submissionStatus, 'accepted');
    assert.equal(result.telemetryIncomplete, true);
    assert.equal(sends, 1);
    assert.equal((await mail.send(payload)).submissionStatus, 'accepted');
    assert.equal(sends, 1);
    assert.equal(mail.status().pending, 1);
  } finally {
    release();
    await mail.close();
  }
  assert.equal(mail.status().pending, 0);
});
test('ambiguous timeout/cancellation retain capacity and uncertain-key fences without leaking transport causes', async () => {
  let release,
    sends = 0;
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(
    {
      sendMail: () => {
        sends++;
        return new Promise((resolve) => (release = resolve));
      },
    },
    { maxConcurrentSends: 1, sendTimeoutMs: 10 }
  );
  /** Stable private synthetic input used to check idempotency and snapshotted addresses. */
  const payload = message({ idempotencyKey: 'uncertain-key' });
  try {
    await assert.rejects(
      mail.send(payload),
      (e) =>
        e.code === 'EMAIL_SMTP_UNCERTAIN' &&
        e.outcomes[0].status === 'uncertain' &&
        !JSON.stringify(e).includes('reader@example.test')
    );
    assert.equal(mail.status().pending, 1);
    await assert.rejects(
      mail.send(payload),
      (e) => e.code === 'EMAIL_SMTP_UNCERTAIN'
    );
    await assert.rejects(
      mail.send(message()),
      (e) => e.code === 'EMAIL_SEND_OVERLOAD'
    );
    assert.equal(sends, 1);
  } finally {
    release({ accepted: ['reader@example.test'] });
    await mail.close();
  }
  /** Owned local cancellation scope; it must never select a remote endpoint. */
  const controller = new AbortController();
  let submitted = false;
  /** Separate owned manager testing cooperative request cancellation. */
  const second = service({
    sendMail: (_data, { signal }) => {
      submitted = true;
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(Error('PRIVATE SMTP token')),
          { once: true }
        )
      );
    },
  });
  /** Actual unsettled synthetic send promise; observe it after cancellation. */
  const sending = second.send(message(), { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submitted, true);
  controller.abort('PRIVATE');
  await assert.rejects(
    sending,
    (e) => e.code === 'EMAIL_SMTP_UNCERTAIN' && !e.message.includes('PRIVATE')
  );
  await second.close();
});
test('pre-send cancellation prevents acquisition and failed verification releases owned pools only once', async () => {
  /** Owned local cancellation scope; it must never select a remote endpoint. */
  const controller = new AbortController();
  controller.abort();
  let sends = 0,
    closed = 0;
  /** Injected native protocol fixture; it never opens SMTP or logs its private cause. */
  const transport = {
    /**
     * Simulate native send outcomes, including deliberate partial acceptance and private failures.
     *
     * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
     */
    async sendMail() {
      sends++;
      return {};
    },
    /**
     * Reject native verification with a synthetic private cause.
     *
     * @returns {Promise<never>} Always rejects; the manager must expose only its normalized public error.
     */
    async verify() {
      throw Error('PRIVATE verify password');
    },
    /**
     * Count the fixture native close without contacting external resources.
     *
     * @returns {void} Updates only the local close counter.
     */
    close() {
      closed++;
    },
  };
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(transport);
  await assert.rejects(
    mail.send(message(), { signal: controller.signal }),
    (e) => e.code === 'EMAIL_SEND_CANCELLED'
  );
  assert.equal(sends, 0);
  await assert.rejects(
    mail.verify(),
    (e) => e.code === 'EMAIL_VERIFY_FAILED' && !e.message.includes('PRIVATE')
  );
  assert.equal(closed, 1);
  await mail.close();
  assert.equal(closed, 1);
  /** Manager wrapper with ownTransport false; native fixture close ownership remains external. */
  const borrowed = createEmailManager({
    accounts: [
      {
        name: 'primary',
        transport,
        ownTransport: false,
        defaults: { from: 'sender@example.test' },
      },
    ],
  });
  await assert.rejects(borrowed.verify());
  await borrowed.close();
  assert.equal(closed, 1);
});
test('file stream failure and underflow release iterators, preserve uncertain SMTP state and never leak paths', async () => {
  let returned = 0,
    reads = 0;
  /** Borrowed files-protocol fixture with exact recorded lengths and cooperative synthetic iterators. */
  const files = {
    /**
     * Report only the fixed fixture byte length and MIME metadata.
     *
     * @returns {Promise<object>} Recorded object metadata used to enforce stream length bounds.
     */
    async stat() {
      return { size: 3, contentType: 'text/plain' };
    },
    /**
     * Open a cooperative finite synthetic byte source without filesystem/network I/O.
     *
     * @returns {Promise<AsyncIterable<Buffer>>} Synthetic iterable whose actual settlement owns the reader slot.
     */
    async read() {
      reads++;
      return {
        /**
         * Yield explicit synthetic bytes, optionally waiting or failing to test cleanup.
         *
         * @returns {AsyncGenerator<Buffer>} Fixture byte stream; cancellation does not force arbitrary JavaScript settlement.
         */
        async *[Symbol.asyncIterator]() {
          try {
            yield Buffer.from('a');
            throw Error('PRIVATE attachment path');
          } finally {
            returned++;
          }
        },
      };
    },
  };
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(
    {
      /**
       * Simulate native send outcomes, including deliberate partial acceptance and private failures.
       *
       * @param {object} data - Private normalized envelope with snapshotted recipients and bounded attachment wrappers.
       * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
       */
      async sendMail(data) {
        // Consume the finite fixture to actual settlement or its declared failure; do not infer retry safety.
        for (const attachment of data.attachments) {
          // Consume the finite fixture to actual settlement or its declared failure; do not infer retry safety.
          for await (const _chunk of attachment.content) {
            /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
          }
        }
        return { accepted: ['reader@example.test'] };
      },
    },
    { files }
  );
  try {
    await assert.rejects(
      mail.send(
        message({
          attachments: [
            {
              filename: 'file.txt',
              file: { bucket: 'reports', key: 'PRIVATE' },
            },
          ],
        })
      ),
      (e) => e.code === 'EMAIL_SMTP_UNCERTAIN' && !e.message.includes('PRIVATE')
    );
    assert.equal(reads, 1);
    assert.equal(returned, 1);
  } finally {
    await mail.close();
  }
  /** Owned attachment wrapper scope; dispose after actual fixture iterator settlement. */
  const scope = await resolveAttachmentScope(
    [{ filename: 'short', file: { bucket: 'reports', key: 'file' } }],
    {
      files: {
        /**
         * Report only the fixed fixture byte length and MIME metadata.
         *
         * @returns {Promise<object>} Recorded object metadata used to enforce stream length bounds.
         */
        async stat() {
          return { size: 3, contentType: 'text/plain' };
        },
        /**
         * Open a cooperative finite synthetic byte source without filesystem/network I/O.
         *
         * @returns {Promise<AsyncIterable<Buffer>>} Synthetic iterable whose actual settlement owns the reader slot.
         */
        async read() {
          return (async function* () {
            yield Buffer.from('a');
          })();
        },
      },
    }
  );
  try {
    await assert.rejects(async () => {
      // Consume the finite fixture to actual settlement or its declared failure; do not infer retry safety.
      for await (const _ of scope.attachments[0].content) {
        /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
      }
    }, /shorter/);
  } finally {
    await scope.dispose();
  }
});
test('attachment streams are lazy, concurrent source reads are bounded, and failed preparation closes earlier wrappers', async () => {
  let reads = 0,
    release;
  /** Borrowed files-protocol fixture with exact recorded lengths and cooperative synthetic iterators. */
  const files = {
    /**
     * Report only the fixed fixture byte length and MIME metadata.
     *
     * @returns {Promise<object>} Recorded object metadata used to enforce stream length bounds.
     */
    async stat() {
      return { size: 1, contentType: 'text/plain' };
    },
    /**
     * Open a cooperative finite synthetic byte source without filesystem/network I/O.
     *
     * @returns {Promise<AsyncIterable<Buffer>>} Synthetic iterable whose actual settlement owns the reader slot.
     */
    async read() {
      reads++;
      return {
        /**
         * Yield explicit synthetic bytes, optionally waiting or failing to test cleanup.
         *
         * @returns {AsyncGenerator<Buffer>} Fixture byte stream; cancellation does not force arbitrary JavaScript settlement.
         */
        async *[Symbol.asyncIterator]() {
          await new Promise((resolve) => (release = resolve));
          yield Buffer.from('x');
        },
      };
    },
  };
  /** Owned attachment wrapper scope; dispose after actual fixture iterator settlement. */
  const scope = await resolveAttachmentScope(
    ['a', 'b'].map((key) => ({
      filename: key,
      file: { bucket: 'reports', key },
    })),
    { files, maxAttachmentStreams: 1 }
  );
  assert.equal(reads, 0);
  /** Actual unsettled fixture send/iterator promise; caller timeout does not settle it. */
  const first = (async () => {
    // Consume the finite fixture to actual settlement or its declared failure; do not infer retry safety.
    for await (const _ of scope.attachments[0].content) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  })();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    async () => {
      // Consume the finite fixture to actual settlement or its declared failure; do not infer retry safety.
      for await (const _ of scope.attachments[1].content) {
        /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
      }
    },
    (e) => e.code === 'EMAIL_ATTACHMENT_LIMIT'
  );
  assert.equal(reads, 1);
  release();
  await first;
  await scope.dispose();
  await assert.rejects(
    resolveAttachmentScope(
      [
        { filename: 'a', file: { bucket: 'reports', key: 'file' } },
        { filename: '../bad', content: 'bad' },
      ],
      { files }
    ),
    /filename/
  );
  assert.equal(reads, 1);
});
test('memory queue never automatically retries unqualified network errors or DATA uncertainty', async () => {
  // Consume the finite fixture to actual settlement or its declared failure; do not infer retry safety.
  for (const error of [
    Object.assign(Error('unknown'), { code: 'ECONNRESET' }),
    Object.assign(Error('data'), { code: 'ETIMEDOUT', command: 'DATA' }),
  ]) {
    let calls = 0;
    /** Owned local retry queue; destructive/ambiguous native outcomes must never be retried automatically. */
    const queue = createEmailQueue(
      {
        /**
         * Deliberately reject a local queue send with the selected ambiguous outcome.
         *
         * @returns {Promise<never>} Always rejects; queue retry policy must not infer safe replay.
         */
        async send() {
          calls++;
          throw error;
        },
      },
      { retries: 5, backoffMs: 0 }
    );
    try {
      await assert.rejects(queue.enqueue(message()));
      assert.equal(calls, 1);
      assert.equal(isRetryableSmtpError(error), false);
    } finally {
      await queue.close();
    }
  }
  assert.equal(
    isRetryableSmtpError({ responseCode: 450, command: 'RCPT TO' }),
    true
  );
  assert.equal(isRetryableSmtpError({ responseCode: 550 }), false);
});
test('one-click unsubscribe blocks marketing despite analytics failure; inbox denial runs before reads', async () => {
  /** Process-local synthetic committed-consent state with a public fixture key. */
  const preferences = createEmailPreferenceService({
    baseUrl: 'https://mail.example.test',
    secret: 'long-lived-test-secret'.repeat(3),
  });
  await preferences.subscribe('reader@example.test', {
    source: 'verified-signup',
    proof: 'host',
  });
  let sends = 0;
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(
    {
      /**
       * Simulate native send outcomes, including deliberate partial acceptance and private failures.
       *
       * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
       */
      async sendMail() {
        sends++;
        return { accepted: ['reader@example.test'] };
      },
    },
    {
      preferences,
      tracking: {
        /**
         * Deliberately fail optional tracking before instrumentation can alter the message.
         *
         * @returns {never} Throws a synthetic dependency outage; SMTP must retain its independent outcome.
         */
        instrumentHtml() {
          throw Error('analytics offline');
        },
        onSent: async () => {
          throw Error('analytics offline');
        },
      },
    }
  );
  try {
    /** Explicit private marketing message; tracking consent remains independent. */
    const marketing = message({
      purpose: 'marketing',
      tracking: { enabled: true },
      html: '<p>Hello</p>',
    });
    /** Known synthetic SMTP acceptance before unsubscribe; telemetry failure must not replay it. */
    const initial = await mail.send(marketing);
    assert.equal(initial.submissionStatus, 'accepted');
    /** Private normalized outcome inspected for explicit acceptance/uncertainty semantics. */
    const result = await preferences.handle(
      new Request(preferences.makeUnsubscribeUrl('reader@example.test'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
    );
    assert.equal(result.status, 200);
    await assert.rejects(
      mail.send(marketing),
      (e) => e.code === 'EMAIL_CONSENT_REQUIRED'
    );
    assert.equal(sends, 1);
  } finally {
    await mail.close();
  }
  let reads = 0;
  /** Inert inbox API with an explicit denial policy; unauthorized reads must not reach storage. */
  const api = createInboxApi({
    store: {
      /**
       * Count an unauthorized inbox read if incorrectly invoked.
       *
       * @returns {Promise<object>} Empty synthetic page; authorization should prevent this capability from running.
       */
      async page() {
        reads++;
        return { items: [], nextCursor: null };
      },
    },
    authorize: () => false,
  });
  await assert.rejects(api.list({ account: 'primary' }), /denied/);
  assert.equal(reads, 0);
});
test('truthy authorization and malformed subscription state cannot authorize SMTP', async () => {
  let calls = 0;
  /** Injected native protocol fixture; it never opens SMTP or logs its private cause. */
  const transport = {
    /**
     * Simulate native send outcomes, including deliberate partial acceptance and private failures.
     *
     * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
     */
    async sendMail() {
      calls++;
      return {};
    },
  };
  /** Owned manager whose host authorization returns a nonboolean truthy value; it must deny. */
  const forbidden = service(transport, { authorize: () => 'yes' });
  await assert.rejects(
    forbidden.send(message()),
    (e) => e.code === 'EMAIL_FORBIDDEN'
  );
  await forbidden.close();
  /** Owned manager whose consent callback returns invalid state; it must fail closed. */
  const consent = service(transport, {
    preferences: {
      isSubscribed: async () => 'subscribed',
      makeUnsubscribeUrl: () => 'https://mail.example/unsubscribe',
    },
  });
  await assert.rejects(
    consent.send(message({ purpose: 'marketing' })),
    (e) => e.code === 'EMAIL_CONSENT_UNAVAILABLE'
  );
  await consent.close();
  assert.equal(calls, 0);
});
test('verification/failover deadlines do not release actual native ownership early or begin a backup send', async () => {
  let release,
    sendCalls = 0,
    closes = 0;
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = createEmailManager({
    sendTimeoutMs: 10,
    maxConcurrentSends: 1,
    accounts: [
      {
        name: 'primary',
        transport: {
          verify: () => new Promise((resolve) => (release = resolve)),
          sendMail: async () => {
            sendCalls++;
            return {};
          },
          /**
           * Count the fixture native close without contacting external resources.
           *
           * @returns {void} Updates only the local close counter.
           */
          close() {
            closes++;
          },
        },
        defaults: { from: 'sender@example.test' },
      },
      {
        name: 'backup',
        transport: {
          verify: async () => true,
          sendMail: async () => {
            sendCalls++;
            return {};
          },
        },
        defaults: { from: 'sender@example.test' },
      },
    ],
  });
  await assert.rejects(
    mail.sendWithVerifiedFailover(message(), ['primary', 'backup']),
    (e) => e.code === 'EMAIL_VERIFY_DEADLINE'
  );
  assert.equal(sendCalls, 0);
  assert.equal(mail.status().pending, 1);
  let done = false;
  /** Actual manager-close promise; it cannot settle before native fixture work finishes. */
  const closing = mail.close().then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(done, false);
  release(true);
  await closing;
  assert.equal(closes, 1);
  assert.equal(mail.status().pending, 0);
});
test('coalesced waiters have independent observation deadlines without duplicating or cancelling the owned send', async () => {
  let release,
    calls = 0;
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(
    {
      sendMail: () => {
        calls++;
        return new Promise((resolve) => (release = resolve));
      },
    },
    { sendTimeoutMs: 1000 }
  );
  try {
    /** Stable private synthetic input used to check idempotency and snapshotted addresses. */
    const payload = message({ idempotencyKey: 'coalesced' });
    /** Actual unsettled fixture send/iterator promise; caller timeout does not settle it. */
    const first = mail.send(payload);
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      mail.send(payload, { timeoutMs: 2 }),
      (e) => e.code === 'EMAIL_SMTP_UNCERTAIN'
    );
    assert.equal(calls, 1);
    assert.equal(mail.status().waiters, 0);
    release({ accepted: ['reader@example.test'] });
    assert.equal((await first).submissionStatus, 'accepted');
  } finally {
    await mail.close();
  }
});
test('recipient and attachment addresses are snapshotted before asynchronous authorization', async () => {
  let resume;
  /** Captured synthetic private envelope snapshots; never a real SMTP delivery. */
  const sent = [];
  /** Owned synthetic mail manager; each test must release cooperative fixture gates before close. */
  const mail = service(
    {
      /**
       * Simulate native send outcomes, including deliberate partial acceptance and private failures.
       *
       * @param {object} data - Private normalized envelope with snapshotted recipients and bounded attachment wrappers.
       * @returns {Promise<object>} Fixture acceptance or explicit failure; no message is delivered to a real server.
       */
      async sendMail(data) {
        sent.push(data);
        return { accepted: ['reader@example.test'] };
      },
    },
    { authorize: () => new Promise((resolve) => (resume = resolve)) }
  );
  try {
    /** Mutable synthetic recipient object; async authorization must not change the snapshotted envelope. */
    const address = { address: 'reader@example.test' };
    /** Stable private synthetic input used to check idempotency and snapshotted addresses. */
    const payload = message({ to: address });
    /** Actual synthetic send waiting on host authorization; resolve and observe before teardown. */
    const pending = mail.send(payload);
    address.address = 'changed@example.test';
    await new Promise((resolve) => setImmediate(resolve));
    resume(true);
    await pending;
    assert.equal(sent[0].to[0].address, 'reader@example.test');
  } finally {
    await mail.close();
  }
});
