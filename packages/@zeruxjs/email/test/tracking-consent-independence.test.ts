import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailManager,
  createEmailPreferenceService,
} from '../dist/index.js';

/**
 * Create isolated consent/tracking state and a synthetic SMTP manager.
 *
 * @returns {object} Owned manager and captured fixture data; caller must close the manager.
 */
function setup() {
  /** Captured synthetic SMTP envelopes; acceptance is not inbox delivery. */
  const delivered = [];
  /** Captured explicit tracking callbacks; marketing consent must not implicitly populate them. */
  const events = [];
  /** Process-local consent fixture with a public synthetic secret; no remote collection. */
  const preferences = createEmailPreferenceService({
    baseUrl: 'https://mail.example.test',
    secret: 'secure-preferences-'.repeat(3),
  });
  /** Owned manager over an injected transport; each test registers failure-safe close. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'main',
        defaults: { from: 'sender@example.test' },
        transport: {
          /**
           * Capture synthetic SMTP acceptance without opening a network connection.
           *
           * @param {object} mail - Private normalized synthetic SMTP envelope.
           * @returns {Promise<object>} Fixture acceptance facts, not inbox-delivery evidence.
           */
          async sendMail(mail) {
            delivered.push(mail);
            return { messageId: `smtp-${delivered.length}`, accepted: mail.to };
          },
        },
      },
    ],
    preferences,
    tracking: {
      /**
       * Instrument only the explicitly opted-in synthetic message in memory.
       *
       * @param {string} html - Synthetic email HTML; never injected into a browser.
       * @param {object} event - Private tracking event retained only in this fixture.
       * @returns {string} Fixture HTML marker, or deliberate instrumentation failure; never a remote fetch.
       */
      instrumentHtml(html, event) {
        events.push(['render', event]);
        return html + '<img src="https://events.example.test/1x1.gif">';
      },
      /**
       * Observe synthetic post-acceptance tracking independently of SMTP success.
       *
       * @param {object} event - Private tracking event retained only in this fixture.
       * @returns {void} Records fixture metadata or deliberately throws; no resend may follow.
       */
      onSent(event) {
        events.push(['sent', event]);
      },
    },
  });
  return { delivered, events, preferences, manager };
}
test('transactional tracking is independent of marketing consent and exposes report ID', async (t) => {
  /** Owned manager plus private captured fixture values; cleanup closes the manager after this case. */
  const { delivered, events, preferences, manager } = setup();
  // Close native wrapper ownership even when an assertion fails.
  t.after(() => manager.close());
  await preferences.unsubscribe('reader@example.test');
  /** Private send result checked for explicit tracking identity/acceptance semantics. */
  const result = await manager.send(
    {
      to: 'reader@example.test',
      subject: 'Invoice',
      text: 'Paid',
      html: '<p>Paid</p>',
      purpose: 'transactional',
      tracking: { enabled: true, opens: true, clicks: true },
    },
    { htmlMode: 'trusted' }
  );
  assert.match(result.trackingId, /^[0-9a-f-]{36}$/);
  assert.equal(events.length, 2);
  assert.match(delivered[0].html, /1x1\.gif/);
  assert.equal(delivered[0].headers['List-Unsubscribe'], undefined);
  await assert.rejects(
    manager.send({
      to: 'reader@example.test',
      subject: 'Promotion',
      text: 'News',
      purpose: 'marketing',
      tracking: { enabled: true },
    }),
    { code: 'EMAIL_CONSENT_REQUIRED' }
  );
});
test('marketing consent never enables email activity tracking implicitly', async (t) => {
  /** Owned manager plus private captured fixture values; cleanup closes the manager after this case. */
  const { delivered, events, preferences, manager } = setup();
  // Close native wrapper ownership even when an assertion fails.
  t.after(() => manager.close());
  await preferences.subscribe('reader@example.test', {
    source: 'signup',
    proof: 'verified-example',
  });
  /** Private send result checked for explicit tracking identity/acceptance semantics. */
  const result = await manager.send(
    {
      to: 'reader@example.test',
      subject: 'News',
      text: 'News',
      html: '<p>New</p>',
      purpose: 'marketing',
    },
    { htmlMode: 'trusted' }
  );
  assert.equal(result.trackingId, undefined);
  assert.equal(events.length, 0);
  assert.doesNotMatch(delivered[0].html, /1x1\.gif/);
  assert.equal(
    delivered[0].headers['List-Unsubscribe-Post'],
    'List-Unsubscribe=One-Click'
  );
});
