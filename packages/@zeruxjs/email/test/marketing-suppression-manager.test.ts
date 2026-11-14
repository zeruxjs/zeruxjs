import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailManager,
  createEmailPreferenceService,
} from '../dist/index.js';
/**
 * Create an owned synthetic mail manager with independently injected marketing suppression.
 *
 * @param {(email: string) => Promise<boolean>} check - Trusted fixture suppression callback; rejection represents unavailable storage.
 * @returns {object} Manager/consent/count fixture; caller owns manager.close().
 */
const mk = (check: (email: string) => Promise<boolean>) => {
  let sent = 0;
  /** Process-local consent fixture using a public synthetic secret, never production credentials. */
  const prefs = createEmailPreferenceService({
    baseUrl: 'https://mail.example.test',
    secret: 'very-secret'.repeat(10),
  });
  /** Owned SMTP wrapper over an injected transport; callers must close it after each case. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'campaign',
        defaults: { from: 'noreply@example.test' },
        transport: {
          /**
           * Count one synthetic native send without opening SMTP.
           *
           * @returns {Promise<object>} Synthetic message identifier; no inbox delivery is implied.
           */
          async sendMail() {
            sent++;
            return { messageId: `smtp-${sent}` };
          },
        },
      },
    ],
    preferences: prefs,
    marketingSuppression: { isSuppressed: check },
  });
  return { manager, prefs, sends: () => sent };
};
test('direct marketing sends honor durable suppression independently of subscription and tracking', async (t) => {
  /** Owned fixture manager and consent state with a count-only send observer. */
  const f = mk(async () => true);
  // Keep native wrapper cleanup independent of assertion success.
  t.after(() => f.manager.close());
  await f.prefs.subscribe('a@example.test', {
    source: 'signup',
    proof: 'verified',
  });
  await assert.rejects(
    f.manager.send({
      to: 'a@example.test',
      subject: 'Promo',
      text: 'Sale',
      purpose: 'marketing',
      tracking: { enabled: true, opens: true },
    }),
    { code: 'EMAIL_SUPPRESSED' }
  );
  assert.equal(f.sends(), 0);
  /** Synthetic transactional acceptance; marketing suppression must not block unrelated transactional purpose. */
  const transactional = await f.manager.send({
    to: 'a@example.test',
    subject: 'Receipt',
    text: 'Paid',
  });
  assert.equal(transactional.messageId, 'smtp-1');
});
test('suppression backend outage fails closed and pre-SMTP changes can block delivery', async (t) => {
  let calls = 0;
  /** Owned fixture manager and consent state with a count-only send observer. */
  const f = mk(async () => {
    calls++;
    if (calls === 2) {
      return true;
    }
    return false;
  });
  // Keep native wrapper cleanup independent of assertion success.
  t.after(() => f.manager.close());
  await f.prefs.subscribe('a@example.test', {
    source: 'signup',
    proof: 'verified',
  });
  await assert.rejects(
    f.manager.send({
      to: 'a@example.test',
      subject: 'News',
      text: 'Hello',
      purpose: 'marketing',
    }),
    { code: 'EMAIL_SUPPRESSED' }
  );
  assert.equal(f.sends(), 0);
  /** Owned fixture with deliberately unavailable suppression storage; marketing must fail closed. */
  const broken = mk(async () => {
    throw new Error('offline');
  });
  // Keep native wrapper cleanup independent of assertion success.
  t.after(() => broken.manager.close());
  await broken.prefs.subscribe('a@example.test', {
    source: 'signup',
    proof: 'verified',
  });
  await assert.rejects(
    broken.manager.send({
      to: 'a@example.test',
      subject: 'News',
      text: 'Hello',
      purpose: 'marketing',
    }),
    { code: 'EMAIL_SUPPRESSION_UNAVAILABLE' }
  );
});
