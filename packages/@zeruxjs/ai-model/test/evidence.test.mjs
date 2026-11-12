import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { generateRepositoryCorpus } from '@zeruxjs/ai-model/corpus';
import { createKnowledgeBase } from '@zeruxjs/ai-model';
import {
  createEvidenceRetriever,
  createEvidenceAssistant,
  validateEvidenceCitations,
} from '@zeruxjs/ai-model/evidence';
/** Fixed public multilingual/adversarial corpus, including a hidden source and repeated-keyword distractor. */
const data = {
  'routing.md': 'Routing uses explicit request handlers.',
  'cache.md': 'Cache policies keep personalized content private.',
  'session.md': 'Session records require fresh authorization.',
  'unicode.md': '路由配置要求明确处理程序。',
  'drinks.md': 'Un café est une boisson.',
  'duplicate.md': 'Routing uses explicit request handlers.',
  'noise.md': 'routing cache session '.repeat(250),
  'hidden.md': 'routing HIDDEN_FIXTURE_DO_NOT_RETRIEVE',
};
/** Fixed query/expected-source pairs keep baseline and configured ranking comparisons reproducible. */
const queries = [
  ['routing', 'routing.md'],
  ['cache', 'cache.md'],
  ['session', 'session.md'],
  ['路由', 'unicode.md'],
  ['cafe', 'drinks.md'],
];
/**
 * Create an isolated synthetic Git repository with explicitly selected public sources.
 * @returns {Promise<object>} Fixture state and an owned close callback that removes only its temporary root.
 */
async function fixture() {
  /** Owned temporary root created only for local synthetic corpus verification. */
  const root = await mkdtemp(join(tmpdir(), 'zx018-'));
  execFileSync('git', ['init', '-q', root]);
  await mkdir(join(root, 'packages/demo/src'), { recursive: true });
  await writeFile(
    join(root, 'packages/demo/package.json'),
    JSON.stringify({ name: 'demo', version: '0.0.3', main: 'dist/index.js' })
  );
  await writeFile(
    join(root, 'packages/demo/src/index.ts'),
    'export const api = true;'
  );
  // Write only synthetic public documents into the disposable fixture repository.
  for (const [file, text] of Object.entries(data)) {
    await writeFile(join(root, 'packages/demo', file), text);
  }
  /** Generated synthetic snapshot is the only indexed candidate population for this fixture. */
  const { snapshot } = await generateRepositoryCorpus({
    root,
    packages: [
      {
        manifest: 'packages/demo/package.json',
        exports: [{ name: '.', source: 'packages/demo/src/index.ts' }],
        docs: Object.keys(data).map((f) => 'packages/demo/' + f),
      },
    ],
  });
  return {
    snapshot,
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
/**
 * Configure synthetic verified identity/policy with hidden-source exclusion.
 * @param {object} snapshot - Generated local fixture corpus with current sourceManifestHash.
 * @returns {object} Host-approved synthetic retrieval policy; it grants no production permission.
 */
const config = (snapshot) => ({
  expectedManifestHash: snapshot.sourceManifestHash,
  principal: { tenant: 'one', subject: 'owner' },
  authorize: (_, s) => !s.path.endsWith('/hidden.md'),
  ranking: { foldDiacritics: true },
});
test('declared query corpus compares old and weighted ranking with fixed corpus/settings', async (t) => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
  const retriever = createEvidenceRetriever(f.snapshot, config(f.snapshot));
  try {
    /** Independent baseline/population used to compare ranking or atomic mutation behavior. */
    const base = createKnowledgeBase();
    base.addMany(
      f.snapshot.documents.filter(
        (d) => !d.metadata.sourcePath.endsWith('/hidden.md')
      )
    );
    let baseline = 0,
      weighted = 0,
      settings;
    /** Monotonic benchmark origin measures this fixture only, not production retrieval latency. */
    const start = performance.now();
    // Use the same fixed labeled queries for both ranking configurations.
    for (const [query, expected] of queries) {
      /** Legacy top source from the exact same authorized population used by configured retrieval. */
      const old = base.search(query, 1)[0]?.document.metadata.sourcePath;
      if (old?.endsWith('/' + expected)) {
        baseline++;
      }
      /** Observed authorized evidence/answer receipt; assertions inspect bounds and provenance, not truthfulness. */
      const result = await retriever.retrieve(query);
      settings = result.settings;
      if (result.sources[0]?.sourceId.endsWith('/' + expected)) {
        weighted++;
      }
      assert.ok(
        result.sources.every((s) => !s.sourceId.endsWith('/hidden.md'))
      );
      assert.equal(result.settings.ranking.weights.title, 8);
    }
    t.diagnostic(
      JSON.stringify({
        fixture: 'zx018-v1',
        queries,
        sourceManifestHash: f.snapshot.sourceManifestHash,
        baselineSettings: { titleBoost: 2 },
        settings,
        baselineTop1: baseline,
        weightedTop1: weighted,
        queryCount: queries.length,
        elapsedMs: Math.round((performance.now() - start) * 100) / 100,
      })
    );
    assert.ok(weighted > baseline);
    assert.equal(weighted, 5);
  } finally {
    await retriever.close();
    await f.close();
  }
});
test('full prompt budgets, deterministic ties, duplicate/overlap removal and exact Unicode spans', async () => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
  const retriever = createEvidenceRetriever(f.snapshot, {
    ...config(f.snapshot),
    maxTokens: 2000,
    maxCharacters: 2000,
    maxSources: 20,
  });
  try {
    /** Observed authorized evidence/answer receipt; assertions inspect bounds and provenance, not truthfulness. */
    const result = await retriever.retrieve('routing');
    assert.ok(result.estimatedTokens <= 2000);
    assert.ok(result.prompt.length <= 2000);
    assert.ok(result.deduplicated >= 1);
    /** Repeated result checks determinism under identical corpus/policy rather than statistical quality. */
    const again = await retriever.retrieve('routing');
    assert.deepEqual(again, result);
    // Verify spans against original indexed Unicode text, independently of relevance scores.
    for (const s of result.sources) {
      /** Original public fixture source reconstructs the claimed Unicode-code-point span. */
      const original = data[s.sourceId.split('/').at(-1)];
      if (original) {
        assert.equal(
          Array.from(original).slice(s.span.start, s.span.end).join(''),
          s.excerpt
        );
      }
      // No two accepted excerpts from one source may overlap their code-point intervals.
      for (const other of result.sources) {
        if (s !== other && s.sourceId === other.sourceId) {
          assert.ok(
            s.span.end <= other.span.start || other.span.end <= s.span.start
          );
        }
      }
    }
    /** Returned identities are checked for duplicate packing independently of source count. */
    const before = result.sources.map((s) => s.id);
    assert.equal(new Set(before).size, before.length);
  } finally {
    await retriever.close();
    await f.close();
  }
});
test('thresholds/insufficient evidence prevent provider calls and citations must reference returned evidence', async () => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  let calls = 0;
  /** Independent denied/threshold-scoped owner verifies exclusion before ranking or model dispatch. */
  const denied = createEvidenceRetriever(f.snapshot, {
    ...config(f.snapshot),
    minScore: 1000000,
  });
  /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
  const retriever = createEvidenceRetriever(f.snapshot, config(f.snapshot));
  try {
    /** Insufficient evidence must be explicit and prevent optional provider dispatch. */
    const no = await denied.retrieve('routing');
    assert.equal(no.status, 'insufficient');
    assert.equal(no.reason, 'below-threshold');
    /** Borrowed-provider assistant fixture; the owning retriever/base remains independently scoped. */
    const assistant = createEvidenceAssistant(denied, {
      chat: async () => {
        calls++;
        return 'invented';
      },
    });
    assert.equal((await assistant.answer('routing')).answer, null);
    assert.equal(calls, 0);
    assert.equal(
      (await retriever.retrieve('unmatchedword')).reason,
      'missing-evidence'
    );
    /** Returned authorized scope defines all permissible model citation identities. */
    const evidence = await retriever.retrieve('routing');
    assert.throws(() =>
      validateEvidenceCitations('fake [evidence:outside]', evidence.sources)
    );
    assert.throws(() =>
      validateEvidenceCitations('uncited API exists', evidence.sources)
    );
    /** One returned evidence ID is the only authority for the positive citation fixture. */
    const id = evidence.sources[0].id;
    assert.deepEqual(
      validateEvidenceCitations('Fact [evidence:' + id + ']', evidence.sources),
      [id]
    );
    /** Injected assistant emits an out-of-scope ID and must reject before returning an answer. */
    const bad = createEvidenceAssistant(retriever, {
      chat: async () => 'Claim [evidence:outside]',
    });
    await assert.rejects(bad.answer('routing'), /citation/);
    /** Injected assistant cites an actually returned ID; no live inference or entailment claim. */
    const good = createEvidenceAssistant(retriever, {
      chat: async (messages) => {
        /** Fixture extracts only a returned serialized evidence ID to build its synthetic response. */
        const match = messages[1].content.match(/"id":"([^"]+)"/);
        return 'Supported [evidence:' + match[1] + ']';
      },
    });
    assert.equal((await good.answer('routing')).status, 'answered');
  } finally {
    await retriever.close();
    await denied.close();
    await f.close();
  }
});
test('embedding receives authorized-only documents; unauthorized hits, outage and remote consent fail closed', async () => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  let invoked = 0,
    borrowedClose = 0;
  /** Explicit local embedding fixture records authorized candidates without generating/uploading vectors. */
  const index = {
    capability: 'authorized-candidates-v1',
    location: 'local',
    model: 'fixture-v1',
    async rank(input) {
      invoked++;
      assert.equal(input.principal.tenant, 'one');
      assert.ok(
        input.documents.every((d) => !d.text.includes('HIDDEN_FIXTURE'))
      );
      return {
        coverage: 'partial',
        hits: [
          {
            id: input.documents.find((d) =>
              d.metadata.sourcePath.endsWith('/routing.md')
            ).id,
            score: 0.9,
          },
        ],
      };
    },
    close() {
      borrowedClose++;
    },
  };
  /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
  const retriever = createEvidenceRetriever(f.snapshot, {
    ...config(f.snapshot),
    embedding: index,
  });
  try {
    /** Observed authorized evidence/answer receipt; assertions inspect bounds and provenance, not truthfulness. */
    const result = await retriever.retrieve('routing');
    assert.equal(result.coverage, 'partial');
    assert.equal(result.settings.method, 'embedding');
    assert.equal(result.sources.length, 1);
    assert.throws(() =>
      createEvidenceRetriever(f.snapshot, {
        ...config(f.snapshot),
        embedding: { ...index, location: 'remote' },
      })
    );
    /** Explicit remote-declared adapter still needs fresh host approval before invocation. */
    const remote = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      embedding: { ...index, location: 'remote' },
      allowRemoteEmbedding: true,
      approveRemoteEmbedding: () => false,
    });
    await assert.rejects(remote.retrieve('routing'), /consent/);
    await remote.close();
    /** Denied document identity is used only to forge a negative adapter hit. */
    const hidden = f.snapshot.documents.find((d) =>
      d.metadata.sourcePath.endsWith('/hidden.md')
    );
    /** Injected adapter returns a denied ID; result validation must fail closed. */
    const forged = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      embedding: {
        ...index,
        rank: async () => ({
          coverage: 'complete',
          hits: [{ id: hidden.id, score: 1 }],
        }),
      },
    });
    await assert.rejects(forged.retrieve('routing'), /Unauthorized/);
    await forged.close();
    /** Injected backend failure must reject rather than silently switch scoring semantics. */
    const outage = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      embedding: {
        ...index,
        rank: async () => {
          throw Error('offline');
        },
      },
    });
    await assert.rejects(outage.retrieve('routing'));
    await outage.close();
    assert.equal(invoked, 1);
  } finally {
    await retriever.close();
    assert.equal(borrowedClose, 0);
    await f.close();
  }
});
test('cancellation retains embedding slots and owned close drains native settlement', async () => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  let finish,
    closed = 0;
  /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
  const retriever = createEvidenceRetriever(f.snapshot, {
    ...config(f.snapshot),
    maxPending: 1,
    embedding: {
      capability: 'authorized-candidates-v1',
      location: 'local',
      model: 'fixture',
      rank: () => new Promise((r) => (finish = r)),
      close() {
        closed++;
      },
    },
    ownEmbedding: true,
  });
  try {
    /** Caller-owned abort source; cancellation is tested separately from native settlement. */
    const signal = new AbortController();
    /** Unsettled query retained while cancellation/revocation and ownership are inspected. */
    const pending = retriever.retrieve('routing', signal.signal);
    await new Promise((r) => setImmediate(r));
    signal.abort();
    await assert.rejects(pending, /cancelled/);
    assert.equal(retriever.status().pending, 1);
    await assert.rejects(retriever.retrieve('routing'), /capacity/);
    let drained = false;
    /** Close promise must remain unsettled until the deliberately blocked adapter finishes. */
    const closing = retriever.close().then(() => (drained = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(drained, false);
    finish({ coverage: 'complete', hits: [] });
    await closing;
    assert.equal(closed, 1);
  } finally {
    await f.close();
  }
});
test('changed authorization after embedding rejects the whole ranking; custom estimators and no-room budgets fail safely', async () => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  let allowed = true,
    release;
  /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
  const retriever = createEvidenceRetriever(f.snapshot, {
    ...config(f.snapshot),
    authorize: () => allowed,
    embedding: {
      capability: 'authorized-candidates-v1',
      location: 'local',
      model: 'fixture',
      rank: (input) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              coverage: 'complete',
              hits: [{ id: input.documents[0].id, score: 1 }],
            });
        }),
    },
  });
  try {
    /** Unsettled query retained while cancellation/revocation and ownership are inspected. */
    const pending = retriever.retrieve('routing');
    await new Promise((r) => setImmediate(r));
    allowed = false;
    release();
    await assert.rejects(pending, /authorization changed/);
    /** Minimal context budget returns insufficient rather than treating a tiny fragment as evidence. */
    const small = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      maxTokens: 1,
    });
    assert.equal((await small.retrieve('routing')).status, 'insufficient');
    await small.close();
    /** Pure code-point estimator fixture checks explicit estimator identity and context bounds. */
    const custom = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      maxTokens: 1200,
      estimateTokens: (s) => Array.from(s).length,
      estimatorId: 'fixture-codepoints',
    });
    /** Observed authorized evidence/answer receipt; assertions inspect bounds and provenance, not truthfulness. */
    const result = await custom.retrieve('路由');
    assert.ok(result.estimatedTokens <= 1200);
    assert.equal(result.settings.estimatorId, 'fixture-codepoints');
    await custom.close();
    /** Nonfinite estimator output must reject rather than bypass context accounting. */
    const invalid = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      estimateTokens: () => NaN,
      estimatorId: 'invalid-fixture',
    });
    await assert.rejects(invalid.retrieve('routing'), /token estimate/);
    await invalid.close();
  } finally {
    await retriever.close();
    await f.close();
  }
});
test('invalid ranking weights reject and owned resource close is idempotent', async () => {
  /** Disposable synthetic Git/filesystem fixture; finally cleanup removes its private temporary root. */
  const f = await fixture();
  let closes = 0;
  try {
    assert.throws(() =>
      createEvidenceRetriever(f.snapshot, {
        ...config(f.snapshot),
        ranking: { weights: { title: -1 } },
      })
    );
    assert.throws(() =>
      createEvidenceRetriever(f.snapshot, {
        ...config(f.snapshot),
        ranking: { weights: { typo: 2 } },
      })
    );
    /** Owned scoped retriever; fixture close drains injected adapter work before removing source files. */
    const retriever = createEvidenceRetriever(f.snapshot, {
      ...config(f.snapshot),
      ownEmbedding: true,
      embedding: {
        capability: 'authorized-candidates-v1',
        location: 'local',
        model: 'fixture',
        rank: async () => ({ coverage: 'complete', hits: [] }),
        close() {
          closes++;
        },
      },
    });
    await retriever.close();
    await retriever.close();
    assert.equal(closes, 1);
    await assert.rejects(retriever.retrieve('routing'), /closed/);
  } finally {
    await f.close();
  }
});
