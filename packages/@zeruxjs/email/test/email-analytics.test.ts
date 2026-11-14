import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailManager } from '../dist/index.js';
test('email instrumentation is opt-in and telemetry failure does not duplicate delivered mail', async (t) => {
  /** Captured synthetic native envelopes; no message leaves the test process. */
  const sent = [];
  /** Captured synthetic instrumentation/send/error callbacks; never a live analytics store. */
  const tracked = [];
  /** Owned manager over an injected transport; each test registers failure-safe close. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'primary',
        transport: {
          /**
           * Capture synthetic SMTP acceptance without opening a network connection.
           *
           * @param {object} data - Private normalized synthetic SMTP envelope.
           * @returns {Promise<object>} Fixture acceptance facts, not inbox-delivery evidence.
           */
          async sendMail(data) {
            sent.push(data);
            return { messageId: 'mail-1', accepted: ['reader@example.net'] };
          },
        },
        defaults: { from: 'sender@example.net' },
      },
    ],
    tracking: {
      /**
       * Instrument only the explicitly opted-in synthetic message in memory.
       *
       * @param {string} html - Synthetic email HTML; never injected into a browser.
       * @param {object} c - Private instrumentation/send context retained only in this fixture.
       * @returns {string} Fixture HTML marker, or deliberate instrumentation failure; never a remote fetch.
       */
      async instrumentHtml(html, c) {
        tracked.push({ name: 'instrument', c });
        return html.replace(
          '</body>',
          '<img src="https://events.example/pixel" /></body>'
        );
      },
      /**
       * Observe synthetic post-acceptance tracking independently of SMTP success.
       *
       * @param {object} c - Private instrumentation/send context retained only in this fixture.
       * @returns {void} Records fixture metadata or deliberately throws; no resend may follow.
       */
      async onSent(c) {
        tracked.push({ name: 'sent', c });
        throw new Error('DB down');
      },
    },
    onTrackingError: () => tracked.push({ name: 'failure' }),
  });
  // Close native wrapper ownership even when an assertion fails.
  t.after(() => manager.close());
  await manager.send(
    {
      to: 'reader@example.net',
      subject: 'No tracking',
      text: 'Hi',
      html: '<body>Hi</body>',
    },
    { htmlMode: 'trusted' }
  );
  await manager.send(
    {
      to: 'reader@example.net',
      subject: 'Tracked',
      text: 'Hi',
      html: '<body>Hi</body>',
      tracking: { enabled: true },
    },
    { htmlMode: 'trusted' }
  );
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[0].html, /pixel/);
  assert.match(sent[1].html, /pixel/);
  assert.deepEqual(
    tracked.map((x) => x.name),
    ['instrument', 'sent', 'failure']
  );
  await manager.close();
});
