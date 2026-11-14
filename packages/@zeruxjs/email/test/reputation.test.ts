import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryReputationLedger,
  createEmailReputationService,
  createEmailManager,
  createDatabaseReputationLedger,
} from '../dist/index.js';
/** Fixed UTC host clock for repeatable rolling-window assertions. */
const timestamp = Date.UTC(2026, 9, 12, 10);
/**
 * Create an isolated observed-feedback evaluator with deterministic host time.
 *
 * @param {object} policy - Explicit threshold overrides, empty by default.
 * @returns {object} Process-local heuristic service; no provider DNS/reputation grade is claimed.
 */
const create = (policy = {}) =>
  createEmailReputationService({
    ledger: createMemoryReputationLedger(),
    now: () => timestamp,
    policy: { minimumAccepted: 10, ...policy },
  });
test('rolling sender health applies AWS-like thresholds to observed feedback', async () => {
  /** Local observed-feedback evaluator; status is a heuristic, never a provider reputation grade. */
  const service = create();
  // Populate a finite deterministic feedback cohort; counts and scan ceilings remain explicit.
  for (let i = 0; i < 20; i++) {
    await service.recordAccepted(
      'marketing',
      `recipient${i}@example.test`,
      `smtp-${i}`
    );
  }
  // Populate a finite deterministic feedback cohort; counts and scan ceilings remain explicit.
  for (let i = 0; i < 2; i++) {
    await service.recordFeedback({
      account: 'marketing',
      email: `recipient${i}@example.test`,
      kind: 'hard-bounce',
      eventId: `b-${i}`,
    });
  }
  /** Observed rolling-window snapshot with explicit denominator and sample coverage. */
  const state = await service.snapshot('marketing');
  assert.equal(state.accepted, 20);
  assert.equal(state.hardBounces, 2);
  assert.equal(state.bouncePercent, 10);
  assert.equal(state.status, 'paused');
  assert.equal(
    (await service.checkBeforeSend('marketing', 'marketing')).allowed,
    false
  );
  assert.equal(
    (await service.checkBeforeSend('marketing', 'transactional')).allowed,
    true
  );
  assert.equal((await service.snapshot('separate')).status, 'healthy');
  assert.equal(
    await service.recordFeedback({
      account: 'marketing',
      email: 'recipient0@example.test',
      kind: 'hard-bounce',
      eventId: 'b-0',
    }),
    false
  );
  assert.equal((await service.snapshot('marketing')).hardBounces, 2);
});
test('incomplete feedback is not confused with inbox delivery and scan caps fail closed', async () => {
  /** Local evaluator with a strict scan ceiling; overflow must reject rather than report partial health. */
  const svc = create({ scanLimit: 100 });
  // Populate a finite deterministic feedback cohort; counts and scan ceilings remain explicit.
  for (let i = 0; i < 100; i++) {
    await svc.recordAccepted('sender', `recipient${i}@example.test`, `id-${i}`);
  }
  assert.equal((await svc.snapshot('sender')).accepted, 100);
  await svc.recordAccepted('sender', 'extra@example.test', 'id-overflow');
  await assert.rejects(svc.snapshot('sender'), /scan limit/);
});
test('manager consults reputation before SMTP and does not retry accepted mail when telemetry fails', async (t) => {
  let sends = 0,
    reputationCalls = 0;
  /** Synthetic consent fixture; marketing permission still depends on independent reputation admission. */
  const preferences = {
    isSubscribed: async () => true,
    makeUnsubscribeUrl: () => 'https://example.test/u',
  };
  /** Owned manager with a synthetic SMTP transport; close it through the test cleanup hook. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'sender',
        defaults: { from: 'mail@example.test' },
        transport: {
          /**
           * Return explicit SMTP-acceptance facts without contacting a server.
           *
           * @returns {Promise<object>} Synthetic accepted recipient and message identifier.
           */
          async sendMail() {
            sends++;
            return {
              accepted: ['recipient@example.test'],
              messageId: '<smtp-id@server.test>',
            };
          },
        },
      },
    ],
    preferences,
    reputation: {
      checkBeforeSend: async (_account, purpose) => ({
        allowed: purpose === 'transactional',
      }),
      recordAccepted: async () => {
        reputationCalls++;
        throw new Error('db offline');
      },
    },
  });
  // Native manager ownership must settle even if an assertion fails.
  t.after(() => manager.close());
  await assert.rejects(
    manager.send({
      to: 'recipient@example.test',
      subject: 'Sale',
      text: 'Hi',
      purpose: 'marketing',
    }),
    { code: 'EMAIL_REPUTATION_PAUSED' }
  );
  assert.equal(sends, 0);
  await manager.send({
    to: 'recipient@example.test',
    subject: 'Receipt',
    text: 'Done',
  });
  assert.equal(sends, 1);
  assert.equal(reputationCalls, 1);
});
/**
 * Implement only the structured database operations needed by this fixture.
 *
 * @returns {object} Process-local protocol fixture; it is not a transaction or native database qualification.
 */
function fakeDb() {
  /** Process-local table maps for the structured database protocol fixture; no real database transaction. */
  const rows = new Map();
  return {
    /**
     * Initialize a named in-memory table idempotently.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed fixture table name.
     * @returns {Promise<object>} Synthetic success acknowledgement.
     */
    async createTable({ table }) {
      rows.set(table, rows.get(table) ?? new Map());
      return { ok: true };
    },
    /**
     * Reserve a unique synthetic row identity and reject duplicate primary keys.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed fixture table name.
     * @param {object} query.values - Synthetic insert values including the unique id.
     * @returns {Promise<object>} Synthetic create result; no durable commit is claimed.
     */
    async insert({ table, values }) {
      if (rows.get(table).has(values.id)) {
        throw Error('unique');
      }
      rows.get(table).set(values.id, { ...values });
      return { ok: true };
    },
    /**
     * Evaluate only fixture predicates and return deterministic bounded rows.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed fixture table name.
     * @param {object} query.where - Structured equality/range predicates supported only by this fixture.
     * @param {number} query.limit - Finite fixture page size, default 500.
     * @param {number} query.offset - Fixture offset, default zero.
     * @returns {Promise<object>} Synthetic page; real connector semantics are tested separately.
     */
    async select({ table, where, limit = 500, offset = 0 }) {
      /** Detached finite row list before this fake adapter applies supported predicates and keyset ordering. */
      const data = [...rows.get(table).values()];
      return {
        ok: true,
        rows: data
          .filter((row) => {
            if (where?.and) {
              return where.and.every((cond) => {
                if (cond.operator === 'eq') {
                  return row[cond.field] === cond.value;
                }
                return row[cond.field] >= cond.value;
              });
            }
            return row.id === where?.value;
          })
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(offset, offset + limit),
      };
    },
  };
}
test('database reputation events survive service instances and provider dedupe', async () => {
  /** Borrowed process-local structured database fixture shared by both service instances. */
  const db = fakeDb();
  /** First evaluator over the shared fixture ledger; not a separate durable database. */
  const first = createEmailReputationService({
    ledger: createDatabaseReputationLedger(db),
    now: () => timestamp,
    policy: { minimumAccepted: 1 },
  });
  /** Second evaluator over the same fixture ledger, used to check native identity deduplication. */
  const second = createEmailReputationService({
    ledger: createDatabaseReputationLedger(db),
    now: () => timestamp,
    policy: { minimumAccepted: 1 },
  });
  await first.recordAccepted('shared', 'x@example.test', 'smtp-id');
  await first.recordFeedback({
    account: 'shared',
    email: 'x@example.test',
    kind: 'complaint',
    eventId: 'provider-1',
  });
  assert.equal(
    await second.recordFeedback({
      account: 'shared',
      email: 'x@example.test',
      kind: 'complaint',
      eventId: 'provider-1',
    }),
    false
  );
  /** Observed shared-ledger counters; SMTP acceptance does not prove inbox delivery. */
  const snapshot = await second.snapshot('shared');
  assert.equal(snapshot.accepted, 1);
  assert.equal(snapshot.complaints, 1);
  assert.equal(snapshot.status, 'paused');
});
test('signed provider feedback can feed suppression and account reputation independently', async () => {
  /** Explicit public feedback/suppression factories imported from the built package; no dynamic user module selection. */
  const {
    createMarketingFeedbackEndpoint,
    createMemoryMarketingSuppressionStore,
    createMarketingSuppressionService,
  } = await import('../dist/index.js');
  /** Separate process-local suppression ledger; it must update independently of reputation counters. */
  const suppression = createMarketingSuppressionService({
    store: createMemoryMarketingSuppressionStore(),
  });
  /** Local reputation evaluator receiving only explicitly verified fixture feedback. */
  const rep = create();
  /** Authenticated local Fetch handler; the signature stub is not a vendor verifier. */
  const endpoint = createMarketingFeedbackEndpoint({
    suppression,
    reputation: rep,
    feedbackAccount: () => 'smtp',
    verifySignature: async (_raw, h) => h.get('x-signed') === 'trusted',
    parse: (raw) => JSON.parse(Buffer.from(raw).toString('utf8')),
  });
  /** Synthetic provider feedback at the fixed clock, without real recipient data. */
  const event = {
    email: 'r@example.test',
    eventId: 'b1',
    kind: 'hard-bounce',
    at: timestamp,
  };
  /**
   * Construct a synthetic signed/unsigned webhook request for direct handler invocation.
   *
   * @param {boolean} signed - Whether to include the synthetic verifier header.
   * @returns {Request} Local Fetch request; signature proof here is only a fixture stub.
   */
  const request = (signed) =>
    new Request('https://example.test/_email/feedback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signed ? { 'x-signed': 'trusted' } : {}),
      },
      body: JSON.stringify([event]),
    });
  assert.equal((await endpoint.handle(request(false))).status, 401);
  assert.equal((await endpoint.handle(request(true))).status, 204);
  assert.equal((await endpoint.handle(request(true))).status, 204);
  assert.equal((await rep.snapshot('smtp')).hardBounces, 1);
  assert.equal(await suppression.isSuppressed('r@example.test'), true);
});
test('a reputation scan exactly at its configured limit is complete, but an overflowing scan fails closed', async () => {
  /** Finite process-local reference ledger used to exercise exact versus overflowing scan coverage. */
  const ledger = createMemoryReputationLedger();
  /** Local observed-feedback evaluator; status is a heuristic, never a provider reputation grade. */
  const service = createEmailReputationService({
    ledger,
    now: () => timestamp,
    policy: { minimumAccepted: 1, scanLimit: 100 },
  });
  // Populate a finite deterministic feedback cohort; counts and scan ceilings remain explicit.
  for (let i = 0; i < 100; i++) {
    await service.recordAccepted(
      'marketing',
      `sample${i}@example.test`,
      `accepted-${i}`
    );
  }
  /** Snapshot exactly at the configured scan limit; reported-only coverage remains explicit. */
  const full = await service.snapshot('marketing');
  assert.equal(full.accepted, 100);
  assert.equal(full.sampleSufficient, true);
  assert.equal(full.feedbackCoverage, 'reported-only');
  await service.recordAccepted(
    'marketing',
    'overflow@example.test',
    'accepted-overflow'
  );
  await assert.rejects(service.snapshot('marketing'), /scan limit/);
});
test('optional soft-bounce thresholds protect reputation without changing hard-bounce defaults', async () => {
  /** Local observed-feedback evaluator; status is a heuristic, never a provider reputation grade. */
  const service = createEmailReputationService({
    ledger: createMemoryReputationLedger(),
    now: () => timestamp,
    policy: {
      minimumAccepted: 10,
      warnSoftBouncePercent: 5,
      pauseSoftBouncePercent: 15,
    },
  });
  // Populate a finite deterministic feedback cohort; counts and scan ceilings remain explicit.
  for (let i = 0; i < 20; i++) {
    await service.recordAccepted(
      'marketing',
      `soft${i}@example.test`,
      `smtp-soft-${i}`
    );
  }
  // Populate a finite deterministic feedback cohort; counts and scan ceilings remain explicit.
  for (let i = 0; i < 3; i++) {
    await service.recordFeedback({
      account: 'marketing',
      email: `soft${i}@example.test`,
      eventId: `soft-${i}`,
      kind: 'soft-bounce',
    });
  }
  /** Observed rolling-window snapshot with explicit denominator and sample coverage. */
  const state = await service.snapshot('marketing');
  assert.equal(state.softBouncePercent, 15);
  assert.equal(state.status, 'paused');
  assert.equal(
    (await service.checkBeforeSend('marketing', 'marketing')).allowed,
    false
  );
  assert.throws(
    () =>
      createEmailReputationService({
        ledger: createMemoryReputationLedger(),
        policy: { warnSoftBouncePercent: 5 },
      }),
    /Soft-bounce/
  );
  /** No-feedback snapshot with insufficient sample; absence is not a known healthy delivery denominator. */
  const empty = await service.snapshot('no-feedback');
  assert.equal(empty.sampleSufficient, false);
});
