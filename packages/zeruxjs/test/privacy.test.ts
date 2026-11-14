import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyCoordinator, privacyCsvCell } from 'zeruxjs/privacy';
/** Create isolated synthetic records and reference stores for privacy orchestration checks.
 * @returns {object} Coordinator owner, policies and synthetic inspection/failure controls.
 */
function fixture() {
  let now = 10000,
    authorized = true,
    failExecute = false,
    failCheckpoint = false,
    eraseCalls = 0;
  /** Reference CAS job state in memory; this fixture does not qualify production durability. */
  const jobs = new Map();
  /** Redacted job snapshots checked to ensure erased payloads never enter audit state. */
  const journal = [];
  /** Participant page receipts used to simulate recovery after a lost coordinator checkpoint. */
  const receipts = new Map();
  /** Private export page bytes retained only by this synthetic expiry-aware store. */
  const pages = new Map();
  /** Synthetic cross-tenant records including a retention hold; no real user data is touched. */
  const rows = [
    {
      id: 'a',
      tenant: 'tenant-a',
      subject: 'subject-a',
      value: 'private-a',
      held: false,
    },
    {
      id: 'b',
      tenant: 'tenant-a',
      subject: 'subject-a',
      value: 'private-held',
      held: true,
    },
    {
      id: 'c',
      tenant: 'tenant-b',
      subject: 'subject-a',
      value: 'other-tenant',
      held: false,
    },
  ];
  /** Reference CAS store declaring the protocol for isolated tests, not a shipped durable adapter. */
  const store = {
    contract: 'privacy-jobs-cas-v1',
    durability: 'durable',
    /** Read a cloned tenant-bound reference job without exposing mutable store state.
     * @param {string} t - Verified tenant namespace.
     * @param {string} id - Opaque job identifier.
     * @returns {Promise<object | null>} Stored synthetic job clone or null.
     */
    async get(t, id) {
      return structuredClone(jobs.get(t + id) ?? null);
    },
    /** Conditionally replace a job revision or simulate lost checkpoint acknowledgement.
     * @param {number | null} rev - Expected stored revision, or null for create-only insertion.
     * @param {object} next - Validated replacement job checkpoint.
     * @returns {Promise<boolean>} Whether the exact expected revision was replaced.
     */
    async cas(rev, next) {
      if (failCheckpoint && next.participants.some((p) => p.pages)) {
        failCheckpoint = false;
        throw Error('lost-checkpoint-password');
      }
      /** Tenant-bound synthetic job lookup key used for revision comparison. */
      const k = next.tenant + next.id;
      if ((jobs.get(k)?.revision ?? null) !== rev) {
        return false;
      }
      jobs.set(k, structuredClone(next));
      journal.push(structuredClone(next));
      return true;
    },
  };
  /** Select only the verified subject/tenant page before participant work.
   * @param {object} c - Authorized participant context with cursor and limit.
   * @returns {object[]} Bounded matching synthetic rows.
   */
  const matching = (c) =>
    rows
      .filter(
        (r) =>
          r.tenant === c.tenant &&
          r.subject === c.subject &&
          (!c.cursor || r.id > c.cursor)
      )
      .slice(0, c.limit);
  /** Explicit synthetic record participant reporting both supported scope and backup limits. */
  const adapter = {
    coverage: {
      id: 'records',
      version: 1,
      find: true,
      export: true,
      erase: true,
      records: ['synthetic-rows'],
      outside: ['backups'],
    },
    /** Discover only an authorized bounded page; unsupported participants must remain uncalled.
     * @param {object} c - Verified subject/tenant, cursor and page limit.
     * @returns {Promise<object>} Read-only page counts and continuation; the unsupported fixture deliberately throws.
     */
    async preview(c) {
      /** Bounded authorized page selected before counting holds or eligible records. */
      const found = matching(c);
      return {
        scanned: found.length,
        affected: 0,
        held: found.filter((r) => r.held).length,
        next: found.length === c.limit ? found.at(-1).id : null,
        done: found.length < c.limit,
      };
    },
    /** Apply only approved synthetic page work while preserving tenant and retention holds.
     * @param {object} c - Authorized page context with stable recovery receipt key.
     * @returns {Promise<object>} Page receipt; the unsupported/failure fixtures deliberately reject.
     */
    async execute(c) {
      eraseCalls++;
      if (failExecute) {
        throw Error('private-password-and-payload');
      }
      /** Bounded authorized page selected before counting holds or eligible records. */
      const found = matching(c);
      /** Selected records outside retention holds; only these may be exported or erased. */
      const eligible = found.filter((r) => !r.held);
      /** Participant page receipt persisted separately for uncertain-checkpoint recovery. */
      const result = {
        scanned: found.length,
        affected: eligible.length,
        held: found.length - eligible.length,
        next: found.length === c.limit ? found.at(-1).id : null,
        done: found.length < c.limit,
        ...(c.operation === 'export'
          ? { data: eligible.map((r) => ({ value: r.value })) }
          : {}),
      };
      if (c.operation === 'erase') {
        for (const r of eligible) {
          rows.splice(rows.indexOf(r), 1);
        }
      }
      receipts.set(c.pageKey, structuredClone(result));
      return result;
    },
    /** Read the stable page receipt without repeating a protected deletion.
     * @param {object} c - Verified page context and recovery key.
     * @returns {Promise<object | null>} Cloned receipt when known, otherwise null.
     */
    async recover(c) {
      return structuredClone(receipts.get(c.pageKey) ?? null);
    },
  };
  /** Explicit unsupported provider participant whose external records remain outside scope. */
  const outside = {
    coverage: {
      id: 'provider',
      version: 1,
      find: false,
      export: false,
      erase: false,
      records: [],
      outside: ['remote-provider'],
    },
    /** Discover only an authorized bounded page; unsupported participants must remain uncalled.
     * @returns {Promise<object>} Read-only page counts and continuation; the unsupported fixture deliberately throws.
     */
    async preview() {
      throw Error('never');
    },
    /** Apply only approved synthetic page work while preserving tenant and retention holds.
     * @returns {Promise<object>} Page receipt; the unsupported/failure fixtures deliberately reject.
     */
    async execute() {
      throw Error('never');
    },
    /** Read the stable page receipt without repeating a protected deletion.
     * @returns {Promise<object | null>} Cloned receipt when known, otherwise null.
     */
    async recover() {
      return null;
    },
  };
  /** Private synthetic export store enforcing stable page bytes and access expiry. */
  const exports = {
    /** Persist one synthetic private export page with idempotent byte comparison.
     * @param {object} c - Tenant/job/page context authorized by the coordinator.
     * @param {Uint8Array} b - Bounded projected export bytes.
     * @param {number} expiry - Absolute fixture expiry timestamp.
     * @returns {Promise<void>} Completes after the synthetic private page is recorded.
     */
    async putPage(c, b, expiry) {
      /** Prior export page checked before accepting an idempotent repeated write. */
      const old = pages.get(c.pageKey);
      if (old && !Buffer.from(old.bytes).equals(b)) {
        throw Error('different bytes');
      }
      pages.set(c.pageKey, {
        bytes: Buffer.from(b),
        expiry,
        tenant: c.tenant,
        job: c.jobId,
      });
    },
    /** Stream only matching nonexpired fixture pages and cooperate with cancellation.
     * @param {object} j - Authorized tenant/job record.
     * @param {AbortSignal} signal - Download cancellation signal checked before each page.
     * @returns {AsyncGenerator<Uint8Array>} Bounded synthetic page bytes; no public object URL is created.
     */
    async *read(j, signal) {
      for (const p of pages.values()) {
        signal.throwIfAborted();
        if (p.tenant === j.tenant && p.job === j.id) {
          if (now >= p.expiry) {
            throw Error('expired');
          }
          yield p.bytes;
        }
      }
    },
  };
  /** Host authorization, verified subject resolution and bounded participant/export policies. */
  const options = {
    policyVersion: 'policy-v1',
    store,
    participants: [adapter, outside],
    exports,
    now: () => now,
    pageSize: 1,
    exportTtlMs: 1000,
    resolveSubject: async (_principal, proof) =>
      proof === 'verified-proof'
        ? { tenant: 'tenant-a', subject: 'subject-a' }
        : null,
    authorize: async (_a, s, p) =>
      authorized && p === 'operator' && s.tenant === 'tenant-a',
    approve: async (_job, _hash, e) =>
      e === 'approved'
        ? {
            evidence: 'approval-ref',
            actor: 'operator-ref',
            expiresAt: now + 5000,
          }
        : null,
    projectExport: (r) => ({ value: r.value }),
  };
  /** Owned orchestrator closed after all synthetic participant and export work settles. */
  const coordinator = createPrivacyCoordinator(options);
  /** Project only tenant/job identity for subsequent authorized operations.
   * @param {object} j - Existing authorized job record.
   * @returns {object} Opaque tenant-bound job reference without payloads.
   */
  const reference = (j) => ({ tenant: j.tenant, id: j.id });
  /** Complete read-only discovery and explicitly approve one synthetic job.
   * @param {string} operation - Explicit export or erase operation; defaults to erase in this fixture.
   * @returns {Promise<object>} Approved checkpoint ready for bounded resume calls.
   */
  async function prepare(operation = 'erase') {
    let j = await coordinator.create(operation, 'verified-proof', 'operator');
    while (j.phase === 'preview') {
      j = await coordinator.preview(reference(j), 'operator');
    }
    return coordinator.approve(reference(j), 'approved', 'operator');
  }
  return {
    coordinator,
    options,
    store,
    rows,
    journal,
    receipts,
    pages,
    reference,
    prepare,
    adapter,
    setTime: (v) => (now = v),
    revoke: () => (authorized = false),
    setFailure: (v) => (failExecute = v),
    loseCheckpoint: () => (failCheckpoint = true),
    calls: () => eraseCalls,
  };
}
test('preview never erases; approved bounded pages preserve holds/tenant and report external partial scope', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  try {
    /** Created job requiring read-only discovery before approval or execution. */
    const initial = await f.coordinator.create(
      'erase',
      'verified-proof',
      'operator'
    );
    /** Tenant-bound reference reused for preview, approval and resumable bounded work. */
    const ref = f.reference(initial);
    await assert.rejects(f.coordinator.resume(ref, 'operator'), /APPROVAL/);
    await assert.rejects(
      f.coordinator.approve(ref, 'approved', 'operator'),
      /NOT_PREVIEWED/
    );
    let j = initial;
    while (j.phase === 'preview') {
      j = await f.coordinator.preview(ref, 'operator');
    }
    assert.equal(f.rows.length, 3);
    assert.equal(f.calls(), 0);
    await assert.rejects(
      f.coordinator.approve(ref, 'forged', 'operator'),
      /APPROVAL/
    );
    await f.coordinator.approve(ref, 'approved', 'operator');
    for (let n = 0; n < 5; n++) {
      j = await f.coordinator.resume(ref, 'operator');
      if (j.phase === 'partial') {
        break;
      }
    }
    assert.equal(j.phase, 'partial');
    assert.equal(j.participants[0].affected, 1);
    assert.equal(j.participants[0].held, 1);
    assert.equal(j.participants[1].state, 'unsupported');
    assert.deepEqual(
      f.rows.map((r) => r.id),
      ['b', 'c']
    );
    assert.doesNotMatch(
      JSON.stringify(f.journal),
      /private-a|private-held|other-tenant/
    );
    assert.equal(j.approval.evidence, 'approval-ref');
  } finally {
    await f.coordinator.close();
  }
});
test('identity, tenant, revoked resume and approval expiry fail closed', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  try {
    await assert.rejects(
      f.coordinator.create('erase', 'email@example.test', 'operator'),
      /IDENTITY/
    );
    /** Authorized job checkpoint inspected before resuming another bounded page. */
    const j = await f.prepare();
    await assert.rejects(
      f.coordinator.inspect(
        { ...f.reference(j), tenant: 'tenant-b' },
        'operator'
      ),
      /NOT_FOUND/
    );
    f.revoke();
    await assert.rejects(
      f.coordinator.resume(f.reference(j), 'operator'),
      /DENIED/
    );
    assert.equal(f.calls(), 0);
  } finally {
    await f.coordinator.close();
  }
  /** Independent fixture used to isolate expiry, dependency outage or cancellation behavior. */
  const g = fixture();
  try {
    /** Authorized job checkpoint inspected before resuming another bounded page. */
    const j = await g.prepare();
    g.setTime(16000);
    await assert.rejects(
      g.coordinator.resume(g.reference(j), 'operator'),
      /APPROVAL/
    );
    assert.equal(g.calls(), 0);
  } finally {
    await g.coordinator.close();
  }
});
test('lost checkpoint resumes from durable receipt with no repeated deletion; dependency errors stay redacted', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  try {
    let j = await f.prepare();
    f.loseCheckpoint();
    await assert.rejects(
      f.coordinator.resume(f.reference(j), 'operator'),
      /PARTICIPANT_UNCERTAIN/
    );
    assert.equal(f.calls(), 1);
    j = await f.coordinator.inspect(f.reference(j), 'operator');
    assert.equal(j.participants[0].state, 'uncertain');
    assert.equal(j.participants[0].pages, 0);
    j = await f.coordinator.resume(f.reference(j), 'operator');
    assert.equal(j.participants[0].pages, 1);
    assert.equal(f.calls(), 1);
    assert.equal(j.participants[0].affected, 1);
  } finally {
    await f.coordinator.close();
  }
  /** Independent fixture used to isolate expiry, dependency outage or cancellation behavior. */
  const g = fixture();
  try {
    /** Authorized job checkpoint inspected before resuming another bounded page. */
    const j = await g.prepare();
    g.setFailure(true);
    await assert.rejects(
      g.coordinator.resume(g.reference(j), 'operator'),
      /PARTICIPANT_UNCERTAIN/
    );
    /** Redacted stored job checkpoint reporting uncertain/failed state without private causes. */
    const state = await g.coordinator.resume(g.reference(j), 'operator');
    assert.equal(state.participants[0].state, 'uncertain');
    assert.equal(g.calls(), 1);
    assert.doesNotMatch(JSON.stringify(state), /private-password-and-payload/);
  } finally {
    await g.coordinator.close();
  }
});
test('private portable export is bounded, expires, rechecks access and guards CSV formulas', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  try {
    let j = await f.prepare('export');
    for (let n = 0; n < 5; n++) {
      j = await f.coordinator.resume(f.reference(j), 'operator');
      if (j.phase === 'partial') {
        break;
      }
    }
    let text = '';
    for await (const b of f.coordinator.download(f.reference(j), 'operator')) {
      text += Buffer.from(b).toString();
    }
    assert.match(text, /private-a/);
    assert.doesNotMatch(text, /other-tenant|private-held/);
    assert.equal(f.rows.length, 3);
    f.setTime(11001);
    await assert.rejects(async () => {
      for await (const _ of f.coordinator.download(
        f.reference(j),
        'operator'
      )) {
        /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
      }
    }, /EXPORT_UNAVAILABLE/);
    assert.equal(
      privacyCsvCell(' =HYPERLINK("evil")'),
      '"\' =HYPERLINK(""evil"")"'
    );
    assert.equal(privacyCsvCell('ordinary'), '"ordinary"');
  } finally {
    await f.coordinator.close();
  }
});
test('secret projection rejection and close retain unsettled work until cooperative cleanup', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  try {
    f.options.projectExport = () => ({ password: 'never' });
    /** Authorized job checkpoint inspected before resuming another bounded page. */
    const j = await f.prepare('export');
    await assert.rejects(
      f.coordinator.resume(f.reference(j), 'operator'),
      /SECRET_EXPORT/
    );
    assert.equal(f.pages.size, 0);
  } finally {
    await f.coordinator.close();
  }
  /** Independent fixture used to isolate expiry, dependency outage or cancellation behavior. */
  const g = fixture();
  let entered;
  /** Barrier proving participant preview entered before coordinator cancellation. */
  const began = new Promise((r) => (entered = r));
  g.adapter.preview = (ctx) =>
    new Promise((resolve, reject) => {
      entered();
      ctx.signal.addEventListener('abort', () => reject(Error('aborted')), {
        once: true,
      });
    });
  /** Authorized job checkpoint inspected before resuming another bounded page. */
  const j = await g.coordinator.create('erase', 'verified-proof', 'operator');
  /** In-flight preview promise retained until cooperative abort settles. */
  const pending = g.coordinator.preview(g.reference(j), 'operator');
  await began;
  await g.coordinator.close();
  await assert.rejects(pending, /CANCELLED/);
  assert.equal(g.coordinator.status().pending, 0);
  await assert.rejects(
    g.coordinator.inspect(g.reference(j), 'operator'),
    /CLOSED/
  );
});
test('failed discovery is durable/read-only and a new coordinator resumes only approved claims', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  /** Original fixture participant/export callback retained for the narrow failure/revocation wrapper. */
  const original = f.adapter.preview;
  let calls = 0;
  f.adapter.preview = async (c) => {
    if (calls++ === 0) {
      throw Error('secret-discovery');
    }
    return original(c);
  };
  let second;
  try {
    /** Authorized job checkpoint inspected before resuming another bounded page. */
    const j = await f.coordinator.create('erase', 'verified-proof', 'operator');
    await assert.rejects(
      f.coordinator.preview(f.reference(j), 'operator'),
      /PREVIEW_UNAVAILABLE/
    );
    /** Redacted stored job checkpoint reporting uncertain/failed state without private causes. */
    const state = await f.coordinator.inspect(f.reference(j), 'operator');
    assert.equal(state.participants[0].state, 'failed');
    assert.equal(state.participants[0].code, 'UNAVAILABLE');
    assert.equal(f.rows.length, 3);
    await f.coordinator.close();
    second = createPrivacyCoordinator(f.options);
    let next = state;
    while (next.phase === 'preview') {
      next = await second.preview(f.reference(next), 'operator');
    }
    next = await second.approve(f.reference(next), 'approved', 'operator');
    /** Concurrent resume outcomes checked for one approved claim rather than global atomic erasure. */
    const outcomes = await Promise.allSettled([
      second.resume(f.reference(next), 'operator'),
      second.resume(f.reference(next), 'operator'),
    ]);
    assert.ok(outcomes.some((x) => x.status === 'fulfilled'));
    assert.equal(f.calls(), 1);
    assert.equal(f.rows.filter((r) => r.id === 'a').length, 0);
  } finally {
    await second?.close();
    await f.coordinator.close();
  }
});
test('download access revocation stops the next chunk and returns the owned iterator', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  let cleaned = false;
  try {
    let j = await f.prepare('export');
    for (let i = 0; i < 5 && j.phase !== 'partial'; i++) {
      j = await f.coordinator.resume(f.reference(j), 'operator');
    }
    /** Original fixture participant/export callback retained for the narrow failure/revocation wrapper. */
    const original = f.options.exports.read;
    f.options.exports.read = async function* (job, signal) {
      try {
        for await (const chunk of original(job, signal)) {
          yield chunk;
          f.revoke();
          yield Buffer.from('not-authorized');
        }
      } finally {
        cleaned = true;
      }
    };
    await assert.rejects(async () => {
      for await (const _ of f.coordinator.download(
        f.reference(j),
        'operator'
      )) {
        /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
      }
    }, /DENIED/);
    assert.equal(cleaned, true);
    assert.equal(f.coordinator.status().pending, 0);
  } finally {
    await f.coordinator.close();
  }
});
test('export-store outage is redacted and releases stream ownership', async () => {
  /** Isolated privacy fixture; all destructive operations affect synthetic rows only. */
  const f = fixture();
  try {
    let j = await f.prepare('export');
    for (let i = 0; i < 5 && j.phase !== 'partial'; i++) {
      j = await f.coordinator.resume(f.reference(j), 'operator');
    }
    // eslint-disable-next-line require-yield -- This negative fixture throws before yielding to exercise iterator failure cleanup.
    f.options.exports.read = async function* () {
      throw Error('private-access-key');
    };
    await assert.rejects(
      async () => {
        for await (const _ of f.coordinator.download(
          f.reference(j),
          'operator'
        )) {
          /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
        }
      },
      (error) =>
        error.code === 'EXPORT_UNAVAILABLE' &&
        !error.message.includes('private-access-key')
    );
    assert.equal(f.coordinator.status().pending, 0);
  } finally {
    await f.coordinator.close();
  }
});
