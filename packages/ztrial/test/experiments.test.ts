import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunner } from 'ztrial';
import {
  createExperimentCatalog,
  evolveExperimentCatalog,
  createExperimentEvaluator,
  experimentAnalyticsSchema,
} from 'ztrial/experiments';
import {
  createEventSchemaRegistry,
  validateRegisteredEvent,
} from '@zeruxjs/analytics';
/** Fixed synthetic opaque tenant token; never a real customer identifier. */
const tenant = 'tenant_0123456789';
/** Fixed synthetic authenticated-context subject token for the known deterministic vector. */
const subject = 'subject_0123456789';
/** Synthetic repeated32byte fixture key only; never production entropy or a recommended secret. */
const salt = Buffer.alloc(32, 7);
/** Explicit inert three-variant retained initial rollout fixture using integer basis points. */
const initial = {
  id: 'checkout',
  version: 1,
  salt: 'allocation_salt_v1',
  environments: ['production'],
  migration: 'initial',
  variants: [
    { name: 'control', weight: 3000 },
    { name: 'compact', weight: 3000 },
    { name: 'express', weight: 4000 },
  ],
};
/** Build a fresh immutable known fixture catalog without executing a test or collecting analytics.
 * @returns {object} Branded synthetic immutable rollout snapshot. */
const catalog = () => createExperimentCatalog([initial]);
/** Return a synthetic trusted-resolver output; production authentication must never accept arbitrary principal overrides this way.
 * @param {object} extra Explicit test-only context variations for denial/eligibility assertions.
 * @returns {object} Synthetic opaque tenant/subject/environment/consent binding. */
const context = (extra = {}) => ({
  tenant,
  subject,
  environment: 'production',
  consent: 'granted',
  ...extra,
});
/** Acquire a synthetic tenant-fixed evaluator with explicit test-only context resolution and optional controlled dependency doubles.
 * @param {object} cat Known branded fixture catalog.
 * @param {object} extra Explicit trusted synthetic configuration/dependency overrides.
 * @returns {object} Owned evaluator; each acquiring test awaits close to drain its own work/key copy. */
const evaluator = (cat = catalog(), extra = {}) =>
  createExperimentEvaluator({
    catalog: cat,
    tenant,
    tenantSalt: salt,
    resolveContext: (principal) => context(principal),
    ...extra,
  });
/** Create an in-memory linearizable-operation double for the declared durable contract; this test double is not a production durable adapter or cross-process proof.
 * @returns {object} Isolated synthetic definition/assignment maps and explicit register/get/CAS callbacks.
 */
function storeFixture() {
  /** Isolated in-memory fixture definition fingerprints, never a production durable journal. */
  const definitions = new Map();
  /** Isolated private fixture assignments or injected assignment-store double; no live primary is queried. */
  const assignments = new Map();
  return {
    definitions,
    assignments,
    contract: 'ztrial-experiment-store-v1',
    durability: 'durable',
    /** Simulate immutable definition unique-insert/compare in this isolated synchronous-before-await map fixture.
     * @param {object} d - Known synthetic scope/experiment/version/fingerprint tuple.
     * @returns {Promise<string>} Known registered/same/conflict result; no real database write occurs.
     */
    async register(d) {
      /** Synthetic immutable-definition map tuple, excluding raw subject identity. */
      const key = JSON.stringify([d.scope, d.experiment, d.version]);
      /** Existing isolated fixture definition/assignment/receipt snapshot used for known comparison outcomes. */
      const old = definitions.get(key);
      if (old !== undefined) {
        return old === d.fingerprint ? 'same' : 'conflict';
      }
      definitions.set(key, d.fingerprint);
      return 'registered';
    },
    /** Return a detached private synthetic assignment snapshot from only this fixture map.
     * @param {string} key - Evaluator-generated private fixture HMAC reference.
     * @returns {Promise<object | null>} Cloned fixture record or absence, never a live external query.
     */
    async get(key) {
      return structuredClone(assignments.get(key) ?? null);
    },
    /** Simulate exact revision ownership with an immediate isolated-map compare/write, without claiming cross-process database atomicity.
     * @param {string} key - Stable private evaluator-generated fixture reference.
     * @param {number | null} revision - Known expected fixture revision or null for unique insert.
     * @param {object} next - Frozen next declared synthetic assignment.
     * @returns {Promise<boolean>} Known synthetic comparison outcome; no live primary/storage is involved.
     */
    async cas(key, revision, next) {
      /** Existing isolated fixture definition/assignment/receipt snapshot used for known comparison outcomes. */
      const old = assignments.get(key);
      if ((old?.revision ?? null) !== revision) {
        return false;
      }
      assignments.set(key, structuredClone(next));
      return true;
    },
  };
}
test('stable named multi-variant assignment, detached configuration, and no test-runner registration', async () => {
  /** Detached mutable input fixture proving catalog construction does not retain later weight edits. */
  const config = structuredClone(initial);
  /** Fresh immutable synthetic catalog used by isolated evaluators. */
  const cat = createExperimentCatalog([config]);
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(cat);
  /** Separately owned evaluator exercising preserved/restored/error/recording policies without sharing mutable context. */
  const b = evaluator(cat);
  config.variants[0].weight = 9999;
  try {
    /** Actual sanitized evaluation receipt compared with known allocation/denial/migration facts. */
    const result = await a.evaluate('checkout', {});
    assert.equal(result.status, 'assigned');
    assert.equal(result.variant, 'compact');
    assert.deepEqual(await a.evaluate('checkout', {}), result);
    assert.deepEqual(await b.evaluate('checkout', {}), result);
    assert.ok(initial.variants.some((v) => v.name === result.variant));
    assert.equal(result.explanation.algorithm, 'hmac-sha256-basis-points-v1');
    assert.doesNotMatch(
      JSON.stringify(result),
      /subject_0123456789|tenant_0123456789/
    );
    assert.ok(Object.isFrozen(cat.definitions[0].variants));
    /** Independent inert test registry proving experiment evaluation registers no test case. */
    const runner = createRunner();
    runner.test('independent', () => {});
    await a.evaluate('checkout', {});
    /** Actual independent runner outcome, unrelated to experiment statistical significance. */
    const summary = await runner.runTests();
    assert.equal(summary.results.length, 1);
    assert.equal(summary.passed, 1);
    /** Observed deterministic named variants over synthetic opaque subjects; not a statistical significance calculation. */
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      seen.add(
        (
          await a.evaluate('checkout', {
            subject: 'subject_' + String(i).padStart(12, '0'),
          })
        ).variant
      );
    }
    assert.equal(seen.size, 3);
  } finally {
    await a.close();
    await b.close();
  }
  assert.deepEqual(salt, Buffer.alloc(32, 7));
});
test('weights, duplicate names, uncontrolled rollouts, environment/config accessors and overrides reject', () => {
  for (const definition of [
    {
      ...initial,
      variants: [
        { name: 'a', weight: 100 },
        { name: 'b', weight: 100 },
      ],
    },
    {
      ...initial,
      variants: [
        { name: 'a', weight: -1 },
        { name: 'b', weight: 10001 },
      ],
    },
    {
      ...initial,
      variants: [
        { name: 'a', weight: 0.5 },
        { name: 'b', weight: 9999.5 },
      ],
    },
    {
      ...initial,
      variants: [
        { name: 'a', weight: 5000 },
        { name: 'a', weight: 5000 },
      ],
    },
    { ...initial, environments: ['production', 'production'] },
    { ...initial, version: 2 },
    { ...initial, migration: 'preserve' },
  ]) {
    assert.throws(() => createExperimentCatalog([definition]));
  }
  assert.throws(
    () =>
      evolveExperimentCatalog(catalog(), [
        { ...initial, version: 1, migration: 'rebucket' },
      ]),
    (e) => e.code === 'MIGRATION_REQUIRED'
  );
  assert.throws(
    () =>
      evolveExperimentCatalog(catalog(), [
        {
          ...initial,
          version: 2,
          migration: 'preserve',
          variants: [
            { name: 'control', weight: 5000 },
            { name: 'compact', weight: 5000 },
          ],
        },
      ]),
    (e) => e.code === 'PRESERVED_VARIANT_REMOVED'
  );
  assert.throws(() => evaluator(catalog(), { tenantSalt: new Uint8Array(16) }));
  assert.throws(() =>
    evaluator(catalog(), {
      overrides: [
        { experiment: 'checkout', version: 1, subject, variant: 'invented' },
      ],
    })
  );
  let called = 0;
  assert.throws(() =>
    createExperimentCatalog([
      {
        ...initial,
        get variants() {
          called++;
          return [];
        },
      },
    ])
  );
  assert.equal(called, 0);
});
test('verified tenant, consent and environment denial occur before store/recorder effects', async () => {
  let calls = 0;
  /** Controlled in-memory assignment dependency double, including explicit injected outage behavior. */
  const store = storeFixture();
  /** Original fixture register callback retained before instrumenting side-effect counts. */
  const native = store.register;
  store.register = async (...args) => {
    calls++;
    return native(...args);
  };
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), { store });
  try {
    for (const [extra, reason] of [
      [{ tenant: 'tenant_9876543210' }, 'tenant'],
      [{ consent: 'denied' }, 'consent'],
      [{ consent: 'unknown' }, 'consent'],
      [{ environment: 'staging' }, 'environment'],
    ]) {
      assert.deepEqual(await a.evaluate('checkout', extra), {
        status: 'denied',
        reason,
      });
    }
    assert.equal(calls, 0);
    await assert.rejects(
      a.evaluate('checkout', { subject: 'email@example.com' }),
      (e) => e.code === 'INVALID_IDENTITY'
    );
    assert.equal(calls, 0);
  } finally {
    await a.close();
  }
});
test('tenant isolation, deterministic trusted overrides and sticky existing assignments', async () => {
  /** Shared isolated map double proving explicit scope/version/CAS semantics, not distributed durability. */
  const shared = storeFixture();
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), {
    store: shared,
    overrides: [
      { experiment: 'checkout', version: 1, subject, variant: 'express' },
    ],
  });
  try {
    /** Actual sanitized trusted-override receipt, excluding tenant/subject traits. */
    const assigned = await a.evaluate('checkout', {});
    assert.equal(assigned.variant, 'express');
    assert.equal(assigned.explanation.reason, 'override');
    /** Owned later evaluator proving a stored current-version assignment wins over changed trusted overrides. */
    const second = evaluator(catalog(), {
      store: shared,
      overrides: [
        { experiment: 'checkout', version: 1, subject, variant: 'compact' },
      ],
    });
    try {
      assert.equal((await second.evaluate('checkout', {})).variant, 'express');
    } finally {
      await second.close();
    }
    /** Second fixed synthetic opaque tenant proving private key/scope separation. */
    const otherTenant = 'tenant_9876543210';
    /** Owned separate-tenant evaluator whose host context remains fixed to that synthetic tenant. */
    const other = createExperimentEvaluator({
      catalog: catalog(),
      tenant: otherTenant,
      tenantSalt: Buffer.alloc(32, 8),
      store: shared,
      resolveContext: () => context({ tenant: otherTenant }),
    });
    try {
      await other.evaluate('checkout', {});
      assert.equal(shared.assignments.size, 2);
      /** Actual private synthetic assignment snapshots checked for tenant/reference isolation. */
      const rows = [...shared.assignments.values()];
      assert.notEqual(rows[0].key, rows[1].key);
      assert.notEqual(rows[0].scope, rows[1].scope);
      assert.doesNotMatch(
        JSON.stringify(rows),
        /subject_0123456789|tenant_0123456789/
      );
    } finally {
      await other.close();
    }
  } finally {
    await a.close();
  }
});
test('preserve/rebucket migrations require explicit versions and durable history; same-version changes and salt rotation fail closed', async () => {
  /** Shared isolated map double proving explicit scope/version/CAS semantics, not distributed durability. */
  const shared = storeFixture();
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), {
    store: shared,
    overrides: [
      { experiment: 'checkout', version: 1, subject, variant: 'express' },
    ],
  });
  await a.evaluate('checkout', {});
  await a.close();
  /** Immutable explicit next-version preservation rollout retaining zero-weight named history. */
  const preserve = evolveExperimentCatalog(catalog(), [
    {
      ...initial,
      version: 2,
      migration: 'preserve',
      variants: [
        { name: 'control', weight: 10000 },
        { name: 'compact', weight: 0 },
        { name: 'express', weight: 0 },
      ],
    },
  ]);
  assert.throws(
    () => evaluator(preserve),
    (e) => e.code === 'PRESERVE_REQUIRES_DURABLE_STORE'
  );
  /** Separately owned evaluator exercising preserved/restored/error/recording policies without sharing mutable context. */
  const b = evaluator(preserve, { store: shared });
  try {
    /** Actual sanitized evaluation receipt compared with known allocation/denial/migration facts. */
    const result = await b.evaluate('checkout', {});
    assert.equal(result.variant, 'express');
    assert.equal(result.version, 2);
    assert.equal(result.explanation.reason, 'preserved');
  } finally {
    await b.close();
  }
  /** Immutable explicit later rebucket rollout; never a hidden weight mutation. */
  const rebucket = evolveExperimentCatalog(preserve, [
    {
      ...initial,
      version: 3,
      migration: 'rebucket',
      variants: [
        { name: 'control', weight: 10000 },
        { name: 'express', weight: 0 },
      ],
    },
  ]);
  /** Owned separate evaluator exercising rebucket/recording-ignore/cancellation behavior. */
  const c = evaluator(rebucket, { store: shared });
  try {
    /** Actual sanitized evaluation receipt compared with known allocation/denial/migration facts. */
    const result = await c.evaluate('checkout', {});
    assert.equal(result.variant, 'control');
    assert.equal(result.version, 3);
    assert.equal(result.explanation.reason, 'rebucketed');
  } finally {
    await c.close();
  }
  /** Owned old-version evaluator expected to reject a newer persisted fixture assignment. */
  const rollback = evaluator(catalog(), { store: shared });
  await assert.rejects(
    rollback.evaluate('checkout', {}),
    (e) => e.code === 'ROLLBACK_OR_UNKNOWN_VERSION'
  );
  await rollback.close();
  /** Owned same-version redefinition evaluator expected to fail before independent assignment. */
  const changed = evaluator(
    createExperimentCatalog([
      {
        ...initial,
        variants: [
          { name: 'control', weight: 5000 },
          { name: 'express', weight: 5000 },
        ],
      },
    ]),
    { store: shared }
  );
  await assert.rejects(
    changed.evaluate('checkout', {}),
    (e) => e.code === 'VERSION_CONFLICT'
  );
  await changed.close();
  /** Owned evaluator with a deliberately different synthetic key, proving unplanned salt changes fail closed. */
  const rotated = evaluator(catalog(), {
    store: shared,
    tenantSalt: Buffer.alloc(32, 9),
  });
  await assert.rejects(
    rotated.evaluate('checkout', {}),
    (e) => e.code === 'VERSION_CONFLICT'
  );
  await rotated.close();
});
test('parallel CAS assignment and idempotent analytics recording contain no traits and validate against public schema', async () => {
  /** Isolated private fixture assignments or injected assignment-store double; no live primary is queried. */
  const assignments = storeFixture();
  /** Bounded isolated synthetic unique exposure receipts; not a real analytics durable sink. */
  const receipts = new Map();
  /** Finite public analytics schema data derived from the actual fixture catalog. */
  const schema = experimentAnalyticsSchema(catalog());
  /** Actual analytics schema registry over only the finite synthetic schema; no collection service starts. */
  const registry = createEventSchemaRegistry([schema]);
  /** Explicit controlled synthetic once/capacity/failure callback, not live analytics acceptance. */
  const recorder = {
    contract: 'ztrial-experiment-recorder-v1',
    async recordOnce(receipt) {
      /** Existing isolated fixture definition/assignment/receipt snapshot used for known comparison outcomes. */
      const old = receipts.get(receipt.id);
      if (old) {
        assert.deepEqual(old, receipt);
        return 'duplicate';
      }
      receipts.set(receipt.id, structuredClone(receipt));
      validateRegisteredEvent(
        {
          name: schema.name,
          source: 'server',
          site: tenant,
          consent: 'granted',
          properties: {
            experiment: receipt.experiment,
            version: receipt.version,
            variant: receipt.variant,
          },
        },
        registry
      );
      return 'recorded';
    },
  };
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), {
    store: assignments,
    maxRecordPending: 16,
    recording: { recorder, failure: 'error' },
  });
  try {
    /** Actual concurrent sanitized receipts proving one synthetic assignment/receipt identity. */
    const replies = await Promise.all(
      Array.from({ length: 10 }, () => a.evaluate('checkout', {}))
    );
    assert.equal(new Set(replies.map((r) => r.variant)).size, 1);
    assert.equal(assignments.assignments.size, 1);
    assert.equal(receipts.size, 1);
    assert.equal(replies.filter((r) => r.recording === 'recorded').length, 1);
    assert.doesNotMatch(
      JSON.stringify([...receipts.values()]),
      /subject_0123456789|tenant_0123456789/
    );
  } finally {
    await a.close();
  }
});
test('dependency failure never silently falls back or leaks private diagnostics; explicit recorder failure policy', async () => {
  /** Controlled in-memory assignment dependency double, including explicit injected outage behavior. */
  const store = storeFixture();
  store.get = async () => {
    throw Error('PRIVATE subject token');
  };
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), { store });
  try {
    await assert.rejects(
      a.evaluate('checkout', {}),
      (e) =>
        e.code === 'DEPENDENCY_UNAVAILABLE' && !e.message.includes('PRIVATE')
    );
  } finally {
    await a.close();
  }
  /** Explicit controlled synthetic once/capacity/failure callback, not live analytics acceptance. */
  const recorder = {
    contract: 'ztrial-experiment-recorder-v1',
    async recordOnce() {
      throw Error('PRIVATE analytics unavailable');
    },
  };
  /** Separately owned evaluator exercising preserved/restored/error/recording policies without sharing mutable context. */
  const b = evaluator(catalog(), { recording: { recorder, failure: 'error' } });
  /** Owned separate evaluator exercising rebucket/recording-ignore/cancellation behavior. */
  const c = evaluator(catalog(), {
    recording: { recorder, failure: 'ignore' },
  });
  try {
    await assert.rejects(
      b.evaluate('checkout', {}),
      (e) => e.code === 'RECORDING_UNCERTAIN' && !e.message.includes('PRIVATE')
    );
    assert.equal((await c.evaluate('checkout', {})).recording, 'failed');
  } finally {
    await b.close();
    await c.close();
  }
});
test('timeout/cancellation retains actual pending capacity and close drains borrowed dependencies', async () => {
  let finish,
    closed = 0;
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), {
    timeoutMs: 10,
    maxConcurrent: 1,
    resolveContext: () => new Promise((resolve) => (finish = resolve)),
  });
  await assert.rejects(
    a.evaluate('checkout', {}),
    (e) => e.code === 'DEADLINE'
  );
  assert.equal(a.diagnostics().pending, 1);
  await assert.rejects(
    a.evaluate('checkout', {}),
    (e) => e.code === 'OVERLOAD'
  );
  let done = false;
  /** Actual evaluator close promise retained while a controlled dependency remains unsettled. */
  const closing = a.close().then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(done, false);
  finish(context());
  await closing;
  assert.equal(a.diagnostics().pending, 0);
  await assert.rejects(a.evaluate('checkout', {}), (e) => e.code === 'CLOSED');
  /** Controlled in-memory assignment dependency double, including explicit injected outage behavior. */
  const store = {
    ...storeFixture(),
    close() {
      closed++;
    },
  };
  /** Separately owned evaluator exercising preserved/restored/error/recording policies without sharing mutable context. */
  const b = evaluator(catalog(), { store });
  await b.evaluate('checkout', {});
  await b.close();
  assert.equal(closed, 0);
  /** Owned already-aborted fixture signal whose private reason must not leak into public diagnostics. */
  const controller = new AbortController();
  controller.abort('PRIVATE');
  /** Owned separate evaluator exercising rebucket/recording-ignore/cancellation behavior. */
  const c = evaluator();
  try {
    await assert.rejects(
      c.evaluate('checkout', {}, { signal: controller.signal }),
      (e) => e.code === 'CANCELLED' && !e.message.includes('PRIVATE')
    );
  } finally {
    await c.close();
  }
});
test('recording capacity is explicit and recording concurrency never queues unlimited callbacks', async () => {
  /** Bounded isolated synthetic unique exposure receipts; not a real analytics durable sink. */
  const receipts = new Map();
  /** Explicit controlled synthetic once/capacity/failure callback, not live analytics acceptance. */
  const recorder = {
    contract: 'ztrial-experiment-recorder-v1',
    async recordOnce(receipt, context) {
      if (receipts.has(receipt.id)) {
        return 'duplicate';
      }
      if (receipts.size >= context.limit) {
        return 'capacity';
      }
      receipts.set(receipt.id, receipt);
      return 'recorded';
    },
  };
  /** Owned synthetic evaluator; all tests close it after actual pending work settles. */
  const a = evaluator(catalog(), {
    recording: { recorder, failure: 'error', maxRecords: 1 },
  });
  try {
    assert.equal((await a.evaluate('checkout', {})).recording, 'recorded');
    assert.equal((await a.evaluate('checkout', {})).recording, 'duplicate');
    await assert.rejects(
      a.evaluate('checkout', { subject: 'subject_9876543210' }),
      (e) => e.code === 'RECORDING_CAPACITY'
    );
    assert.equal(receipts.size, 1);
  } finally {
    await a.close();
  }
  let finish;
  /** Separately owned evaluator exercising preserved/restored/error/recording policies without sharing mutable context. */
  const b = evaluator(catalog(), {
    maxRecordPending: 1,
    recording: {
      failure: 'error',
      recorder: {
        contract: 'ztrial-experiment-recorder-v1',
        recordOnce: () => new Promise((resolve) => (finish = resolve)),
      },
    },
  });
  /** Actual in-flight synthetic recorder operation held to prove overload rejects instead of unbounded queuing. */
  const first = b.evaluate('checkout', {});
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    b.evaluate('checkout', { subject: 'subject_9876543210' }),
    (e) => e.code === 'RECORDING_OVERLOAD'
  );
  finish('recorded');
  await first;
  await b.close();
  assert.equal(b.diagnostics().recordPending, 0);
});
