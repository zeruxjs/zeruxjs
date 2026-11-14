import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailManager,
  classifySmtpAcceptance,
  describeSmtpOutcome,
  createMarketingFeedbackEndpoint,
  createMemoryMarketingSuppressionStore,
  createMarketingSuppressionService,
} from '../dist/index.js';
/** Synthetic validated envelope/body used for native acceptance classification. */
const example = {
  from: 'test@example.test',
  to: 'buyer@example.test',
  subject: 'Hello',
  text: 'World',
};
/**
 * Create an owned bounded manager around an injected synthetic SMTP function.
 *
 * @param {Function} sendMail - Trusted fixture function returning declared native outcomes.
 * @param {object} opts - Explicit fixture policy overrides, empty by default.
 * @returns {object} Owned manager; callers must close it after actual fixture work settles.
 */
function manager(sendMail, opts = {}) {
  return createEmailManager({
    accounts: [
      {
        name: 'sender',
        defaults: { from: 'test@example.test' },
        transport: { sendMail },
      },
    ],
    ...opts,
  });
}
test('SMTP outcome only counts validated envelope recipients, never infers delivery', () => {
  /** Synthetic partial SMTP acceptance with complete envelope attribution; never inbox delivery. */
  const complete = classifySmtpAcceptance(
    ['A@example.test', 'b@example.test'],
    { accepted: ['a@example.test'], rejected: ['b@example.test'] }
  );
  assert.equal(complete.status, 'partial');
  assert.equal(complete.complete, true);
  assert.equal(
    classifySmtpAcceptance(['a@example.test'], {}).status,
    'unknown'
  );
  assert.deepEqual(
    classifySmtpAcceptance(['a@example.test'], { rejected: ['a@example.test'] })
      .rejected,
    ['a@example.test']
  );
  assert.equal(
    classifySmtpAcceptance(['a@example.test'], { rejected: ['a@example.test'] })
      .status,
    'rejected'
  );
  assert.equal(
    classifySmtpAcceptance(['a@example.test'], {
      accepted: ['a@example.test'],
      rejected: ['a@example.test'],
    }).status,
    'unknown'
  );
  /** Unrecognized native recipient result; classification must remain unknown. */
  const wrong = classifySmtpAcceptance(['a@example.test'], {
    accepted: ['intruder@example.test'],
  });
  assert.equal(wrong.status, 'unknown');
  assert.equal(wrong.warning, 'unrecognized-recipient');
  assert.deepEqual(describeSmtpOutcome(wrong), {
    status: 'unknown',
    acceptedCount: 0,
    rejectedCount: 0,
    complete: false,
    warning: 'unrecognized-recipient',
  });
});
test('manager records ONLY reported SMTP-accepted recipients and does not call onSent for unknown', async (t) => {
  /** Captured synthetic reputation updates; only reported accepted envelope recipients may enter. */
  const recorded = [];
  /** Captured address-free diagnostic projections; no raw native envelope is exposed. */
  const warnings = [];
  /** Captured optional post-acceptance tracking callbacks; unknown SMTP must not trigger them. */
  const sent = [];
  /** Owned manager over the injected synthetic transport; register close before assertions. */
  const svc = manager(
    async () => ({ messageId: 'generated', response: '250 accepted message' }),
    {
      reputation: {
        checkBeforeSend: async () => ({ allowed: true }),
        recordAccepted: async (...a) => recorded.push(a),
      },
      tracking: {
        instrumentHtml: (html) => html,
        onSent: async (entry) => sent.push(entry),
      },
      onSmtpWarning: (warning) => warnings.push(warning),
    }
  );
  // Keep native cleanup independent of assertion success; never replay a send during cleanup.
  t.after(() => svc.close());
  /** Private normalized SMTP outcome checked for explicit status and acceptance coverage. */
  const result = await svc.send({ ...example, tracking: { enabled: true } });
  assert.equal(result.submissionStatus, 'unknown');
  assert.equal(result.acceptanceComplete, false);
  assert.equal(recorded.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(warnings[0].reason, 'unreported-outcome');
  assert.doesNotMatch(JSON.stringify(warnings), /buyer@/);
  await svc.close();
});
test('manager reports partial SMTP acceptance without claiming all recipients delivered', async (t) => {
  /** Captured accepted-recipient values kept only inside this private fixture. */
  const accepted = [];
  /** Owned manager over the injected synthetic transport; register close before assertions. */
  const svc = manager(
    async () => ({
      accepted: ['Buyer@example.test'],
      rejected: ['second@example.test'],
      messageId: 'smtp',
    }),
    {
      reputation: {
        checkBeforeSend: async () => ({ allowed: true }),
        recordAccepted: async (_a, recipient) => accepted.push(recipient),
      },
    }
  );
  // Keep native cleanup independent of assertion success; never replay a send during cleanup.
  t.after(() => svc.close());
  /** Private normalized SMTP outcome checked for explicit status and acceptance coverage. */
  const result = await svc.send({ ...example, cc: 'second@example.test' });
  assert.equal(result.submissionStatus, 'partial');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(accepted, ['buyer@example.test']);
});
test('idempotency key is bound to the message and tracking policy for concurrent and completed sends', async (t) => {
  let sends = 0,
    release;
  /** Owned synthetic native-send gate used to exercise idempotency conflict without replay. */
  const pending = new Promise((resolve) => (release = resolve));
  /** Owned manager over the injected synthetic transport; register close before assertions. */
  const svc = manager(async () => {
    sends++;
    await pending;
    return { accepted: ['buyer@example.test'], messageId: 'id' };
  });
  // Keep native cleanup independent of assertion success; never replay a send during cleanup.
  t.after(async () => {
    release?.();
    await first.catch(() => {});
    await svc.close();
  });
  /** Actual unsettled send promise; release/observe it before closing after failed assertions. */
  const first = svc.send({ ...example, idempotencyKey: 'once' });
  await assert.rejects(
    svc.send({ ...example, subject: 'Another', idempotencyKey: 'once' }),
    { code: 'EMAIL_IDEMPOTENCY_CONFLICT' }
  );
  release();
  await first;
  await assert.rejects(
    svc.send({ ...example, text: 'Changed', idempotencyKey: 'once' }),
    { code: 'EMAIL_IDEMPOTENCY_CONFLICT' }
  );
  assert.equal(
    (await svc.send({ ...example, idempotencyKey: 'once' })).skipped,
    true
  );
  assert.equal(sends, 1);
});
/**
 * Call the authenticated feedback handler locally without opening a listener.
 *
 * @param {object} endpoint - Explicit registered fixture endpoint.
 * @param {unknown} data - Inert synthetic batch; malformed entries deliberately exercise denial.
 * @returns {Promise<Response>} Local explicit acceptance/failure response.
 */
const post = (endpoint, data) =>
  endpoint.handle(
    new Request('https://test.example.test/_email/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
  );
test('signed mixed-validity feedback batch is rejected BEFORE any suppression write', async () => {
  /** Process-local suppression reference store; no production persistence claim. */
  const store = createMemoryMarketingSuppressionStore();
  /** Explicit local suppression evaluator, separate from optional provider outcome reporting. */
  const suppression = createMarketingSuppressionService({ store });
  /** Local authenticated feedback handler with a fixture verifier; not a vendor signature implementation. */
  const api = createMarketingFeedbackEndpoint({
    verifySignature: () => true,
    parse: (raw) => JSON.parse(Buffer.from(raw).toString()),
    suppression,
  });
  /** Actual unsettled send promise; release/observe it before closing after failed assertions. */
  const first = {
    kind: 'hard-bounce',
    email: 'a@example.test',
    eventId: 'evt1',
  };
  assert.equal(
    (
      await post(api, [
        first,
        { kind: 'unknown', eventId: 'evt2', email: 'b@example.test' },
      ])
    ).status,
    400
  );
  assert.equal(
    (
      await post(api, [
        first,
        { kind: 'manual', eventId: 'evt3', email: 'b@example.test' },
      ])
    ).status,
    400
  );
  assert.equal(
    (
      await post(api, [
        first,
        { kind: 'complaint', eventId: 'evt4', email: 'bad-address' },
      ])
    ).status,
    400
  );
  assert.equal(await suppression.isSuppressed('a@example.test'), false);
  assert.equal((await post(api, [first])).status, 204);
  assert.equal(await suppression.isSuppressed('a@example.test'), true);
});
test('account and provider attribution is validated for entire signed batch before writing', async () => {
  /** Captured store effects; full batch validation must finish before any mutation. */
  const writes = [];
  /** Actual unsettled send promise; release/observe it before closing after failed assertions. */
  const first = {
    kind: 'hard-bounce',
    email: 'a@example.test',
    eventId: 'evt5',
  };
  /** Local feedback handler with explicit fixture attribution/verification callbacks. */
  const endpoint = createMarketingFeedbackEndpoint({
    verifySignature: () => true,
    parse: () => [first, { kind: 'delivered', eventId: 'evt6' }],
    suppression: { recordFeedback: async () => writes.push('suppression') },
    providerOutcomes: {
      record: async () => {
        writes.push('outcome');
        return true;
      },
    },
    feedbackDelivery: (e) => ({
      provider: 'test',
      campaignId: 'campaign',
      messageId: e.eventId === 'evt6' ? 'bad id' : 'message',
      occurredAt: Date.now(),
    }),
  });
  assert.equal((await post(endpoint, [first])).status, 400);
  assert.deepEqual(writes, []);
});
test('provider-authenticated multi-store partial failure returns 503 for safe at-least-once replay', async () => {
  /** Captured failed outcome-store attempts; suppression dedupe must remain independently effective. */
  const seen = [];
  /** Process-local suppression reference store; no production persistence claim. */
  const store = createMemoryMarketingSuppressionStore();
  /** Explicit local suppression evaluator, separate from optional provider outcome reporting. */
  const suppression = createMarketingSuppressionService({ store });
  /** Synthetic private provider feedback used for partial-store-failure replay checks. */
  const event = {
    kind: 'hard-bounce',
    email: 'a@example.test',
    eventId: 'evt7',
  };
  /** Local feedback handler with explicit fixture attribution/verification callbacks. */
  const endpoint = createMarketingFeedbackEndpoint({
    verifySignature: () => true,
    parse: () => [event],
    suppression,
    providerOutcomes: {
      record: async () => {
        seen.push('fail');
        throw Error('DB offline');
      },
    },
    feedbackDelivery: () => ({
      provider: 'trusted',
      campaignId: 'camp',
      messageId: 'message',
      occurredAt: 1000,
    }),
  });
  assert.equal((await post(endpoint, [event])).status, 503);
  assert.equal((await post(endpoint, [event])).status, 503);
  assert.equal((await suppression.status('a@example.test')).eventIds.length, 1);
  assert.equal(seen.length, 2);
});
test('verified failover switches before send; after send error it NEVER retries on backup', async (t) => {
  /** Captured synthetic account selections; no SMTP connection or external message delivery. */
  const sends = [];
  /** Explicit injected transport capabilities with separate verification and send outcomes. */
  const accounts = [
    {
      name: 'primary',
      transport: {
        verify: async () => false,
        sendMail: async () => {
          throw Error('not reached');
        },
      },
      defaults: { from: 'test@example.test' },
    },
    {
      name: 'backup',
      transport: {
        verify: async () => true,
        sendMail: async () => {
          sends.push('backup');
          return { accepted: ['buyer@example.test'] };
        },
      },
      defaults: { from: 'test@example.test' },
    },
  ];
  /** Owned verified-failover manager; switch only before native send begins. */
  const service = createEmailManager({ accounts });
  // Keep native cleanup independent of assertion success; never replay a send during cleanup.
  t.after(() => service.close());
  assert.equal(
    (await service.sendWithVerifiedFailover(example, ['primary', 'backup']))
      .account,
    'backup'
  );
  assert.deepEqual(sends, ['backup']);
  await assert.rejects(service.sendWithVerifiedFailover(example, ['primary']), {
    code: 'EMAIL_NO_VERIFIED_TRANSPORT',
  });
  /** Owned manager whose primary send has an ambiguous outcome; backup must never run. */
  const risky = createEmailManager({
    accounts: [
      {
        name: 'primary',
        transport: {
          verify: async () => true,
          sendMail: async () => {
            sends.push('primary');
            throw Error('ambiguous SMTP timeout');
          },
        },
        defaults: { from: 'test@example.test' },
      },
      {
        name: 'backup',
        transport: {
          verify: async () => true,
          sendMail: async () => {
            sends.push('backup-again');
            return { accepted: ['buyer@example.test'] };
          },
        },
        defaults: { from: 'test@example.test' },
      },
    ],
  });
  // Keep native cleanup independent of assertion success; never replay a send during cleanup.
  t.after(() => risky.close());
  await assert.rejects(
    risky.sendWithVerifiedFailover(example, ['primary', 'backup']),
    { code: 'EMAIL_SMTP_UNCERTAIN' }
  );
  assert.deepEqual(sends, ['backup', 'primary']);
});
test('SMTP security rules prevent deliberate STARTTLS downgrade and invalid timeouts', async () => {
  /** Public SMTP policy validator imported from the built package; no network resource. */
  const { validateSmtp } = await import('../dist/index.js');
  assert.throws(
    () =>
      validateSmtp({ host: 'smtp.example.test', port: 587, ignoreTLS: true }),
    /unsafe/
  );
  assert.throws(
    () =>
      validateSmtp({ host: 'smtp.example.test', port: 587, requireTLS: false }),
    /unsafe/
  );
  assert.throws(
    () => validateSmtp({ host: 'smtp.example.test', port: 465, secure: false }),
    /TLS/
  );
  assert.throws(
    () =>
      validateSmtp({ host: 'smtp.example.test', port: 587, socketTimeout: -1 }),
    /timeout/
  );
  assert.doesNotThrow(() =>
    validateSmtp({ host: 'smtp.example.test', port: 465, secure: true })
  );
});
test('duplicate event IDs in authenticated provider batch are deduplicated; conflicting reuse aborts batch', async () => {
  /** Captured deduplicated event identities; conflicting same-ID facts must reject atomically before writes. */
  const written = [];
  /** Synthetic complaint identity whose duplicate/conflicting reuse is explicitly tested. */
  const a = {
    kind: 'complaint',
    eventId: 'duplicate1',
    email: 'a@example.test',
  };
  /** Local feedback handler with explicit fixture attribution/verification callbacks. */
  const endpoint = createMarketingFeedbackEndpoint({
    verifySignature: () => true,
    parse: (raw) => JSON.parse(Buffer.from(raw).toString()),
    suppression: { recordFeedback: async (evt) => written.push(evt.eventId) },
  });
  assert.equal((await post(endpoint, [a, { ...a }])).status, 204);
  assert.deepEqual(written, ['duplicate1']);
  assert.equal(
    (await post(endpoint, [a, { ...a, email: 'different@example.test' }]))
      .status,
    400
  );
  assert.deepEqual(written, ['duplicate1']);
});
