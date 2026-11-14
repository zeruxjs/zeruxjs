import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailManager } from '../dist/index.js';

/**
 * Create isolated consent/tracking state and a synthetic SMTP manager.
 *
 * @param {object} tracking - Explicit tracking adapter or deliberate failing hooks.
 * @returns {object} Owned manager and captured fixture data; caller must close the manager.
 */
function setup(tracking) {
  /** Captured synthetic native envelopes; no message leaves the test process. */
  const sent = [];
  /** Owned manager over an injected transport; each test registers failure-safe close. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'main',
        defaults: { from: 'team@example.com', tracking: { enabled: true } },
        transport: {
          /**
           * Capture synthetic SMTP acceptance without opening a network connection.
           *
           * @param {object} content - Private normalized synthetic SMTP envelope.
           * @returns {Promise<object>} Fixture acceptance facts, not inbox-delivery evidence.
           */
          async sendMail(content) {
            sent.push(content);
            return {
              messageId: String(sent.length),
              accepted: ['person@example.com'],
            };
          },
        },
      },
    ],
    tracking,
    /**
     * Deliberately fail the optional tracking error observer.
     *
     * @returns {void} Throws only for this fixture; accepted SMTP must remain successful.
     */
    onTrackingError() {
      throw Error('logging failed');
    },
  });
  return { manager, sent };
}

test('email tracking only applies when explicitly enabled on message or send options', async (t) => {
  /** Captured tracking invocations; an account default must not activate them. */
  const calls = [];
  /** Owned manager plus private captured fixture values; cleanup closes the manager after this case. */
  const { manager, sent } = setup({
    /**
     * Instrument only the explicitly opted-in synthetic message in memory.
     *
     * @param {string} html - Synthetic email HTML; never injected into a browser.
     * @param {object} context - Private instrumentation context retained only in this fixture.
     * @returns {string} Fixture HTML marker, or deliberate instrumentation failure; never a remote fetch.
     */
    instrumentHtml(html, context) {
      calls.push(context);
      return html + '<!-- tracked -->';
    },
    /**
     * Observe synthetic post-acceptance tracking independently of SMTP success.
     *
     * @returns {void} Records fixture metadata or deliberately throws; no resend may follow.
     */
    onSent() {
      calls.push('sent');
    },
  });
  // Close native wrapper ownership even when an assertion fails.
  t.after(() => manager.close());
  /** Synthetic inert message reused to compare explicit tracking choices. */
  const message = {
    to: 'person@example.com',
    subject: 'Info',
    html: '<p>Hello</p>',
    text: 'Hello',
  };
  await manager.send(message, { htmlMode: 'trusted' });
  await manager.send(message, {
    htmlMode: 'trusted',
    tracking: { enabled: true, opens: false, clicks: true, campaign: 'launch' },
  });
  await manager.send(
    { ...message, tracking: { enabled: true } },
    { htmlMode: 'trusted', tracking: false }
  );
  assert.equal(sent.length, 3);
  assert.doesNotMatch(sent[0].html, /tracked/);
  assert.match(sent[1].html, /tracked/);
  assert.doesNotMatch(sent[2].html, /tracked/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].message.tracking.opens, false);
  await manager.close();
});

test('failed instrumentation and failed telemetry never interrupt SMTP delivery', async (t) => {
  /** Owned manager plus private captured fixture values; cleanup closes the manager after this case. */
  const { manager, sent } = setup({
    /**
     * Instrument only the explicitly opted-in synthetic message in memory.
     *
     * @returns {string} Fixture HTML marker, or deliberate instrumentation failure; never a remote fetch.
     */
    instrumentHtml() {
      throw Error('tracking down');
    },
    /**
     * Observe synthetic post-acceptance tracking independently of SMTP success.
     *
     * @returns {void} Records fixture metadata or deliberately throws; no resend may follow.
     */
    onSent() {
      throw Error('database down');
    },
  });
  // Close native wrapper ownership even when an assertion fails.
  t.after(() => manager.close());
  /** Private send result checked for explicit tracking identity/acceptance semantics. */
  const result = await manager.send(
    {
      to: 'person@example.com',
      subject: 'Hi',
      html: '<p>Safe</p>',
      text: 'Safe',
      tracking: { enabled: true },
    },
    { htmlMode: 'trusted' }
  );
  assert.equal(result.messageId, '1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].html, '<p>Safe</p>');
  await manager.close();
});
