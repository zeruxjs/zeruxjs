import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailManager,
  createEmailPreferenceService,
  createMemoryConsentStore,
} from '../dist/index.js';

/**
 * Create only fixed synthetic HTTPS/capability policy for local tests.
 *
 * @returns {object} Fixture settings; no environment/remote credentials are accessed.
 */
const config = () => ({
  baseUrl: 'https://mail.example.test',
  secret: 'unit-test-secret-only-'.repeat(4),
});
/**
 * Build a synthetic message whose marketing purpose must be explicit.
 *
 * @param {string} to - Synthetic recipient, default subscriber@example.com.
 * @param {string} purpose - Explicit message purpose, default marketing.
 * @returns {object} Single-recipient inert message input.
 */
const message = (to = 'subscriber@example.com', purpose = 'marketing') => ({
  to,
  purpose,
  subject: 'Newsletter',
  text: 'News',
});
/**
 * Create isolated synthetic transport capture with explicit borrowed consent storage.
 *
 * @param {object | undefined} store - Optional shared consent fixture; omitted means an independent memory reference store.
 * @returns {object} Owned manager plus consent/captured envelopes; caller must close the manager.
 */
function setup(store) {
  /** Captured synthetic normalized envelopes; no SMTP connection. */
  const sent = [];
  /** Process-local or explicitly shared fixture consent state; never inferred from tracking. */
  const preferences = createEmailPreferenceService({ ...config(), store });
  /** Owned synthetic mail manager; each consumer registers failure-safe close. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'news',
        defaults: { from: 'hello@example.test', purpose: 'marketing' },
        transport: {
          /**
           * Capture synthetic SMTP acceptance or deliberately reject an unexpected native call.
           *
           * @param {object} mail - Private normalized synthetic SMTP envelope.
           * @returns {Promise<object>} Synthetic acceptance facts, or fixture rejection; no inbox-delivery claim.
           */
          async sendMail(mail) {
            sent.push(mail);
            return { messageId: String(sent.length), accepted: mail.to };
          },
        },
      },
    ],
    preferences,
  });
  return { preferences, manager, sent };
}
test('marketing requires explicit opt-in even if account defaults include marketing purpose', async (t) => {
  /** Owned fixture manager with private consent and capture state. */
  const { manager, preferences, sent } = setup();
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => manager.close());
  /** Synthetic transactional acceptance; account defaults must not silently select marketing. */
  const standard = await manager.send({
    to: 'subscriber@example.com',
    subject: 'Receipt',
    text: 'Paid',
  });
  assert.equal(standard.messageId, '1');
  await assert.rejects(manager.send(message()), {
    code: 'EMAIL_CONSENT_REQUIRED',
  });
  await assert.rejects(
    manager.send(message('subscriber@example.com', 'marketing'), {
      tracking: { enabled: false },
    }),
    { code: 'EMAIL_CONSENT_REQUIRED' }
  );
  await preferences.subscribe('SUBSCRIBER@EXAMPLE.COM', {
    source: 'signup-form',
    proof: 'double-opt-in-event-123',
  });
  await manager.send(message());
  assert.equal(sent.length, 2);
  assert.match(
    sent[1].headers['List-Unsubscribe'],
    /^<https:\/\/mail\.example\.test\/_zerux\/email\/unsubscribe\//
  );
  assert.equal(
    sent[1].headers['List-Unsubscribe-Post'],
    'List-Unsubscribe=One-Click'
  );
  assert.doesNotMatch(
    sent[1].headers['List-Unsubscribe'],
    /subscriber|example.com/i
  );
});
test('marketing is single-recipient and blocked with Cc/Bcc, invalid purpose, or unavailable service', async (t) => {
  /** Owned fixture manager with private consent and capture state. */
  const { manager, preferences, sent } = setup();
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => manager.close());
  await preferences.subscribe('subscriber@example.com', {
    source: 'checkout',
    proof: 'yes',
  });
  await assert.rejects(
    manager.send({
      ...message(),
      to: ['subscriber@example.com', 'friend@example.com'],
    }),
    { code: 'EMAIL_MARKETING_RECIPIENTS' }
  );
  await assert.rejects(
    manager.send({ ...message(), cc: 'other@example.com' }),
    { code: 'EMAIL_MARKETING_RECIPIENTS' }
  );
  await assert.rejects(
    manager.send({ ...message(), bcc: 'other@example.com' }),
    { code: 'EMAIL_MARKETING_RECIPIENTS' }
  );
  await assert.rejects(
    manager.send({ ...message(), purpose: 'promotion' }),
    /Invalid email purpose/
  );
  assert.equal(sent.length, 0);
  /** Owned manager deliberately missing consent storage; marketing must fail closed. */
  const noPrefs = createEmailManager({
    accounts: [
      {
        name: 'news',
        defaults: { from: 'sender@example.com' },
        transport: {
          /**
           * Capture synthetic SMTP acceptance or deliberately reject an unexpected native call.
           *
           * @returns {Promise<object>} Synthetic acceptance facts, or fixture rejection; no inbox-delivery claim.
           */
          async sendMail() {
            throw Error('no');
          },
        },
      },
    ],
  });
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => noPrefs.close());
  await assert.rejects(noPrefs.send(message()), {
    code: 'EMAIL_CONSENT_UNAVAILABLE',
  });
});
test('one-click GET and HEAD never unsubscribe; POST commits and retries are idempotent', async (t) => {
  /** Owned fixture manager with private consent and capture state. */
  const { preferences, manager, sent } = setup();
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => manager.close());
  await preferences.subscribe('subscriber@example.com', {
    source: 'verified',
    proof: 'signup-record',
  });
  /** Private synthetic encrypted capability URL; never log it in real application telemetry. */
  const url = preferences.makeUnsubscribeUrl('subscriber@example.com');
  // Safe observation methods must leave committed subscription state unchanged.
  for (const method of ['GET', 'HEAD']) {
    /** Direct Fetch-handler result; GET/HEAD must not mutate committed consent. */
    const response = await preferences.handle(new Request(url, { method }));
    assert.equal(response.status, 200);
    if (method === 'GET') {
      assert.match(await response.text(), /Unsubscribe from marketing emails/);
    }
  }
  assert.equal(await preferences.isSubscribed('subscriber@example.com'), true);
  /**
   * Submit the exact one-click body to the local preference handler.
   *
   * @returns {Promise<Response>} Local committed/failed unsubscribe response without a network operation.
   */
  const post = () =>
    preferences.handle(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
    );
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal(await preferences.isSubscribed('subscriber@example.com'), false);
  await assert.rejects(manager.send(message()), {
    code: 'EMAIL_CONSENT_REQUIRED',
  });
  assert.equal(sent.length, 0);
});
test('link cannot be tampered with, is encrypted, and rejects bad request bodies', async () => {
  /** Process-local or explicitly shared fixture consent state; never inferred from tracking. */
  const preferences = createEmailPreferenceService(config());
  /** Private synthetic encrypted capability URL; never log it in real application telemetry. */
  const url = preferences.makeUnsubscribeUrl('private+secret@example.com');
  assert.doesNotMatch(url, /private|secret@example.com/i);
  /** Deliberately tampered encrypted capability; invalid proof must not reveal private data. */
  const invalid = url.slice(0, -1) + (url.endsWith('A') ? 'B' : 'A');
  assert.equal((await preferences.handle(new Request(invalid))).status, 404);
  assert.equal(
    (
      await preferences.handle(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: 'List-Unsubscribe=One-Click',
        })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await preferences.handle(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click&other=1',
        })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await preferences.handle(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'x'.repeat(400),
        })
      )
    ).status,
    400
  );
  assert.equal(
    (await preferences.handle(new Request(url, { method: 'DELETE' }))).status,
    405
  );
  assert.equal(
    (await preferences.handle(new Request(url + '?tracking=1'))).status,
    404
  );
});
test('shared store coordinates different service instances and refuses sends when unavailable', async (t) => {
  /** Explicit shared process-local reference consent store; no durable cross-worker claim. */
  const store = createMemoryConsentStore();
  /** First fixture manager sharing the explicit consent store and synthetic key. */
  const a = setup(store);
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => a.manager.close());
  /** Second fixture manager checking shared committed fixture consent visibility. */
  const b = setup(store);
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => b.manager.close());
  await a.preferences.subscribe('subscriber@example.com', {
    source: 'verified',
    proof: 'db-proof',
  });
  await b.manager.send(message());
  assert.equal(b.sent.length, 1);
  /** Private synthetic capability URL issued under the common fixture key. */
  const link = a.preferences.makeUnsubscribeUrl('subscriber@example.com');
  assert.equal(
    (
      await b.preferences.handle(
        new Request(link, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
        })
      )
    ).status,
    200
  );
  await assert.rejects(a.manager.send(message()), {
    code: 'EMAIL_CONSENT_REQUIRED',
  });
  /** Owned fixture manager with deliberately unavailable consent persistence. */
  const failed = setup({
    /**
     * Deliberately fail the fixture consent read to exercise outage denial.
     *
     * @returns {Promise<never>} Always rejects; unavailable consent must not authorize sending.
     */
    async get() {
      throw Error('db offline');
    },
    /**
     * Deliberately fail the fixture consent commit to exercise explicit HTTP failure.
     *
     * @returns {Promise<never>} Always rejects; failed persistence cannot acknowledge unsubscribe success.
     */
    async set() {
      throw Error('db offline');
    },
  });
  // Close wrapper ownership even if consent/header assertions fail.
  t.after(() => failed.manager.close());
  await assert.rejects(failed.manager.send(message()), {
    code: 'EMAIL_CONSENT_UNAVAILABLE',
  });
  assert.equal(
    (
      await failed.preferences.handle(
        new Request(link, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
        })
      )
    ).status,
    503
  );
  assert.equal(failed.sent.length, 0);
});
test('opt-in needs evidence and expired links cannot update preferences', async () => {
  /** Inert preference service used for evidence/lifetime validation; no transport or listener. */
  const service = createEmailPreferenceService({
    ...config(),
    maxAgeMs: 86_400_000,
  });
  await assert.rejects(
    service.subscribe('reader@example.com', { source: '', proof: '' }),
    /evidence/
  );
  assert.throws(
    () => createEmailPreferenceService({ ...config(), secret: 'short' }),
    /32 bytes/
  );
  assert.throws(
    () =>
      createEmailPreferenceService({
        ...config(),
        baseUrl: 'http://example.test',
      }),
    /HTTPS/
  );
  assert.throws(
    () => createEmailPreferenceService({ ...config(), maxAgeMs: 1 }),
    /lifetime/
  );
  /** Private synthetic encrypted capability URL; never log it in real application telemetry. */
  const url = service.makeUnsubscribeUrl('reader@example.com');
  assert.equal((await service.handle(new Request(url))).status, 200);
});
