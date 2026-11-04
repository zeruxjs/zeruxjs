import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyCoordinator, privacyCsvCell } from 'zeruxjs/privacy';
function fixture() {
  let now = 10000,
    authorized = true,
    failExecute = false,
    failCheckpoint = false,
    eraseCalls = 0;
  const jobs = new Map(),
    journal = [],
    receipts = new Map(),
    pages = new Map();
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
  const store = {
    contract: 'privacy-jobs-cas-v1',
    durability: 'durable',
    async get(t, id) {
      return structuredClone(jobs.get(t + id) ?? null);
    },
    async cas(rev, next) {
      if (failCheckpoint && next.participants.some((p) => p.pages)) {
        failCheckpoint = false;
        throw Error('lost-checkpoint-password');
      }
      const k = next.tenant + next.id;
      if ((jobs.get(k)?.revision ?? null) !== rev) return false;
      jobs.set(k, structuredClone(next));
      journal.push(structuredClone(next));
      return true;
    },
  };
  const matching = (c) =>
    rows
      .filter(
        (r) =>
          r.tenant === c.tenant &&
          r.subject === c.subject &&
          (!c.cursor || r.id > c.cursor),
      )
      .slice(0, c.limit);
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
    async preview(c) {
      const found = matching(c);
      return {
        scanned: found.length,
        affected: 0,
        held: found.filter((r) => r.held).length,
        next: found.length === c.limit ? found.at(-1).id : null,
        done: found.length < c.limit,
      };
    },
    async execute(c) {
      eraseCalls++;
      if (failExecute) throw Error('private-password-and-payload');
      const found = matching(c),
        eligible = found.filter((r) => !r.held);
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
      if (c.operation === 'erase')
        for (const r of eligible) rows.splice(rows.indexOf(r), 1);
      receipts.set(c.pageKey, structuredClone(result));
      return result;
    },
    async recover(c) {
      return structuredClone(receipts.get(c.pageKey) ?? null);
    },
  };
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
    async preview() {
      throw Error('never');
    },
    async execute() {
      throw Error('never');
    },
    async recover() {
      return null;
    },
  };
  const exports = {
    async putPage(c, b, expiry) {
      const old = pages.get(c.pageKey);
      if (old && !Buffer.from(old.bytes).equals(b))
        throw Error('different bytes');
      pages.set(c.pageKey, {
        bytes: Buffer.from(b),
        expiry,
        tenant: c.tenant,
        job: c.jobId,
      });
    },
    async *read(j, signal) {
      for (const p of pages.values()) {
        signal.throwIfAborted();
        if (p.tenant === j.tenant && p.job === j.id) {
          if (now >= p.expiry) throw Error('expired');
          yield p.bytes;
        }
      }
    },
  };
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
  const coordinator = createPrivacyCoordinator(options);
  const reference = (j) => ({ tenant: j.tenant, id: j.id });
  async function prepare(operation = 'erase') {
    let j = await coordinator.create(operation, 'verified-proof', 'operator');
    while (j.phase === 'preview')
      j = await coordinator.preview(reference(j), 'operator');
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
  const f = fixture();
  try {
    const initial = await f.coordinator.create(
      'erase',
      'verified-proof',
      'operator',
    );
    const ref = f.reference(initial);
    await assert.rejects(f.coordinator.resume(ref, 'operator'), /APPROVAL/);
    await assert.rejects(
      f.coordinator.approve(ref, 'approved', 'operator'),
      /NOT_PREVIEWED/,
    );
    let j = initial;
    while (j.phase === 'preview')
      j = await f.coordinator.preview(ref, 'operator');
    assert.equal(f.rows.length, 3);
    assert.equal(f.calls(), 0);
    await assert.rejects(
      f.coordinator.approve(ref, 'forged', 'operator'),
      /APPROVAL/,
    );
    await f.coordinator.approve(ref, 'approved', 'operator');
    for (let n = 0; n < 5; n++) {
      j = await f.coordinator.resume(ref, 'operator');
      if (j.phase === 'partial') break;
    }
    assert.equal(j.phase, 'partial');
    assert.equal(j.participants[0].affected, 1);
    assert.equal(j.participants[0].held, 1);
    assert.equal(j.participants[1].state, 'unsupported');
    assert.deepEqual(
      f.rows.map((r) => r.id),
      ['b', 'c'],
    );
    assert.doesNotMatch(
      JSON.stringify(f.journal),
      /private-a|private-held|other-tenant/,
    );
    assert.equal(j.approval.evidence, 'approval-ref');
  } finally {
    await f.coordinator.close();
  }
});
test('identity, tenant, revoked resume and approval expiry fail closed', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.coordinator.create('erase', 'email@example.test', 'operator'),
      /IDENTITY/,
    );
    const j = await f.prepare();
    await assert.rejects(
      f.coordinator.inspect(
        { ...f.reference(j), tenant: 'tenant-b' },
        'operator',
      ),
      /NOT_FOUND/,
    );
    f.revoke();
    await assert.rejects(
      f.coordinator.resume(f.reference(j), 'operator'),
      /DENIED/,
    );
    assert.equal(f.calls(), 0);
  } finally {
    await f.coordinator.close();
  }
  const g = fixture();
  try {
    const j = await g.prepare();
    g.setTime(16000);
    await assert.rejects(
      g.coordinator.resume(g.reference(j), 'operator'),
      /APPROVAL/,
    );
    assert.equal(g.calls(), 0);
  } finally {
    await g.coordinator.close();
  }
});
test('lost checkpoint resumes from durable receipt with no repeated deletion; dependency errors stay redacted', async () => {
  const f = fixture();
  try {
    let j = await f.prepare();
    f.loseCheckpoint();
    await assert.rejects(
      f.coordinator.resume(f.reference(j), 'operator'),
      /PARTICIPANT_UNCERTAIN/,
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
  const g = fixture();
  try {
    const j = await g.prepare();
    g.setFailure(true);
    await assert.rejects(
      g.coordinator.resume(g.reference(j), 'operator'),
      /PARTICIPANT_UNCERTAIN/,
    );
    const state = await g.coordinator.resume(g.reference(j), 'operator');
    assert.equal(state.participants[0].state, 'uncertain');
    assert.equal(g.calls(), 1);
    assert.doesNotMatch(JSON.stringify(state), /private-password-and-payload/);
  } finally {
    await g.coordinator.close();
  }
});
test('private portable export is bounded, expires, rechecks access and guards CSV formulas', async () => {
  const f = fixture();
  try {
    let j = await f.prepare('export');
    for (let n = 0; n < 5; n++) {
      j = await f.coordinator.resume(f.reference(j), 'operator');
      if (j.phase === 'partial') break;
    }
    let text = '';
    for await (const b of f.coordinator.download(f.reference(j), 'operator'))
      text += Buffer.from(b).toString();
    assert.match(text, /private-a/);
    assert.doesNotMatch(text, /other-tenant|private-held/);
    assert.equal(f.rows.length, 3);
    f.setTime(11001);
    await assert.rejects(async () => {
      for await (const _ of f.coordinator.download(
        f.reference(j),
        'operator',
      )) {
      }
    }, /EXPORT_UNAVAILABLE/);
    assert.equal(
      privacyCsvCell(' =HYPERLINK("evil")'),
      '"\' =HYPERLINK(""evil"")"',
    );
    assert.equal(privacyCsvCell('ordinary'), '"ordinary"');
  } finally {
    await f.coordinator.close();
  }
});
test('secret projection rejection and close retain unsettled work until cooperative cleanup', async () => {
  const f = fixture();
  try {
    f.options.projectExport = () => ({ password: 'never' });
    const j = await f.prepare('export');
    await assert.rejects(
      f.coordinator.resume(f.reference(j), 'operator'),
      /SECRET_EXPORT/,
    );
    assert.equal(f.pages.size, 0);
  } finally {
    await f.coordinator.close();
  }
  const g = fixture();
  let entered;
  const began = new Promise((r) => (entered = r));
  g.adapter.preview = (ctx) =>
    new Promise((resolve, reject) => {
      entered();
      ctx.signal.addEventListener('abort', () => reject(Error('aborted')), {
        once: true,
      });
    });
  const j = await g.coordinator.create('erase', 'verified-proof', 'operator');
  const pending = g.coordinator.preview(g.reference(j), 'operator');
  await began;
  await g.coordinator.close();
  await assert.rejects(pending, /CANCELLED/);
  assert.equal(g.coordinator.status().pending, 0);
  await assert.rejects(
    g.coordinator.inspect(g.reference(j), 'operator'),
    /CLOSED/,
  );
});
test('failed discovery is durable/read-only and a new coordinator resumes only approved claims', async () => {
  const f = fixture();
  const original = f.adapter.preview;
  let calls = 0;
  f.adapter.preview = async (c) => {
    if (calls++ === 0) throw Error('secret-discovery');
    return original(c);
  };
  let second;
  try {
    const j = await f.coordinator.create('erase', 'verified-proof', 'operator');
    await assert.rejects(
      f.coordinator.preview(f.reference(j), 'operator'),
      /PREVIEW_UNAVAILABLE/,
    );
    const state = await f.coordinator.inspect(f.reference(j), 'operator');
    assert.equal(state.participants[0].state, 'failed');
    assert.equal(state.participants[0].code, 'UNAVAILABLE');
    assert.equal(f.rows.length, 3);
    await f.coordinator.close();
    second = createPrivacyCoordinator(f.options);
    let next = state;
    while (next.phase === 'preview')
      next = await second.preview(f.reference(next), 'operator');
    next = await second.approve(f.reference(next), 'approved', 'operator');
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
  const f = fixture();
  let cleaned = false;
  try {
    let j = await f.prepare('export');
    for (let i = 0; i < 5 && j.phase !== 'partial'; i++)
      j = await f.coordinator.resume(f.reference(j), 'operator');
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
        'operator',
      )) {
      }
    }, /DENIED/);
    assert.equal(cleaned, true);
    assert.equal(f.coordinator.status().pending, 0);
  } finally {
    await f.coordinator.close();
  }
});
test('export-store outage is redacted and releases stream ownership', async () => {
  const f = fixture();
  try {
    let j = await f.prepare('export');
    for (let i = 0; i < 5 && j.phase !== 'partial'; i++)
      j = await f.coordinator.resume(f.reference(j), 'operator');
    f.options.exports.read = async function* () {
      throw Error('private-access-key');
    };
    await assert.rejects(
      async () => {
        for await (const _ of f.coordinator.download(
          f.reference(j),
          'operator',
        )) {
        }
      },
      (error) =>
        error.code === 'EXPORT_UNAVAILABLE' &&
        !error.message.includes('private-access-key'),
    );
    assert.equal(f.coordinator.status().pending, 0);
  } finally {
    await f.coordinator.close();
  }
});
