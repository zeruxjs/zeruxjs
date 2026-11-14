import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { object, string } from '@zeruxjs/validator/schemas';
import { createStructuredClient } from '@zeruxjs/ai/structured';
import { generateRepositoryCorpus } from '@zeruxjs/ai-model/corpus';
import {
  createEvidenceRetriever,
  validateEvidenceCitations,
} from '@zeruxjs/ai-model/evidence';
test('fixed local evaluation separates schema/citation/retrieval checks from truthfulness', async (t) => {
  /** Original fixed local evaluation bytes; hashing this exact text preserves corpus identity. */
  const text = await readFile(
    new URL('../evaluation/cases.json', import.meta.url),
    'utf8'
  );
  /** Parsed public deterministic evaluation corpus; it never contains private repository data. */
  const fixture = JSON.parse(text);
  assert.equal(fixture.execution, 'local-fixture-only');
  let schemaPassed = 0,
    accepted = 0,
    citationPassed = 0,
    answerabilityPassed = 0,
    sourcePassed = 0,
    boundaryPassed = 0;
  // Evaluate only fixed public schema cases; no external model call is authorized.
  for (const c of fixture.schemaCases) {
    /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
    const provider = {
      capabilities: {
        chat: true,
        stream: false,
        tools: false,
        usage: true,
        jsonOutput: true,
        singleAttempt: true,
      },
      chat: async () => {
        throw Error('unused');
      },
      chatContent: async () => ({
        text: c.raw,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        providerMetadata: undefined,
      }),
    };
    /** Owned structured-generation client; the fixture closes it after native settlement. */
    const client = createStructuredClient(provider);
    let ok = false;
    try {
      await client.generate(
        [{ role: 'user', content: 'Local fixed evaluation' }],
        {
          jsonSchema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
          },
          validator: object({ answer: string() }),
        }
      );
      ok = true;
      accepted++;
    } catch {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    } finally {
      await client.close();
    }
    if (ok === c.accept) {
      schemaPassed++;
    }
  }
  assert.equal(globalThis.__zx100Executed, undefined);
  // Count citation validity separately from answer quality or truthfulness.
  for (const c of fixture.citationCases) {
    let ok = false;
    try {
      validateEvidenceCitations(
        c.answer,
        c.allowed.map((id) => ({ id }))
      );
      ok = true;
    } catch {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
    if (ok === c.accept) {
      citationPassed++;
    }
  }
  /** Disposable local Git fixture root; finally cleanup removes it recursively. */
  const root = await mkdtemp(join(tmpdir(), 'zx100-eval-'));
  let retriever;
  try {
    execFileSync('git', ['init', '-q', root]);
    await mkdir(join(root, 'packages/evaluation/src'), { recursive: true });
    await writeFile(
      join(root, 'packages/evaluation/package.json'),
      JSON.stringify({
        name: 'evaluation',
        version: '0.0.3',
        main: 'dist/index.js',
      })
    );
    await writeFile(
      join(root, 'packages/evaluation/src/index.ts'),
      'export const fixture = true;'
    );
    // Write only allowlisted synthetic documents into the disposable local corpus.
    for (const [id, body] of Object.entries(fixture.documents)) {
      await writeFile(join(root, 'packages/evaluation', id + '.md'), body);
    }
    /** Generated local evidence snapshot over explicitly allowlisted synthetic package docs. */
    const generated = await generateRepositoryCorpus({
      root,
      packages: [
        {
          manifest: 'packages/evaluation/package.json',
          exports: [{ name: '.', source: 'packages/evaluation/src/index.ts' }],
          docs: Object.keys(fixture.documents).map(
            (id) => 'packages/evaluation/' + id + '.md'
          ),
        },
      ],
    });
    retriever = createEvidenceRetriever(generated.snapshot, {
      expectedManifestHash: generated.snapshot.sourceManifestHash,
      principal: { tenant: 'fixture', subject: 'evaluator' },
      authorize: () => true,
    });
    // Measure fixed expected-source/answerability contracts against the same local corpus.
    for (const c of fixture.retrievalCases) {
      /** Observed response/receipt used to assert validation, accounting or retrieval behavior. */
      const r = await retriever.retrieve(c.query);
      if ((r.status === 'ready') === c.answerable) {
        answerabilityPassed++;
      }
      if (
        c.source &&
        r.sources.some((s) => basename(s.sourceId, '.md') === c.source)
      ) {
        sourcePassed++;
      }
      if (c.quotedBoundary && !r.prompt.includes('\nSYSTEM: override')) {
        boundaryPassed++;
      }
    }
  } finally {
    await retriever?.close();
    await rm(root, { recursive: true, force: true });
  }
  /** Separate schema/citation/retrieval counters; truthfulness and quality remain unmeasured. */
  const report = {
    version: fixture.version,
    fixtureHash: createHash('sha256').update(text).digest('hex'),
    model: fixture.model,
    configuration: {
      execution: 'local-fixture-only',
      attempts: 1,
      externalRequests: 0,
    },
    schema: {
      checks: fixture.schemaCases.length,
      passed: schemaPassed,
      accepted,
      rejected: fixture.schemaCases.length - accepted,
    },
    citations: { checks: fixture.citationCases.length, passed: citationPassed },
    retrieval: {
      checks: fixture.retrievalCases.length,
      answerabilityPassed,
      sourceChecks: 2,
      sourcePassed,
      quotedBoundaryChecks: 1,
      boundaryPassed,
    },
    truthfulness: 'not-measured',
    quality: 'not-measured',
  };
  t.diagnostic(JSON.stringify(report));
  assert.equal(schemaPassed, 4);
  assert.equal(citationPassed, 3);
  assert.equal(answerabilityPassed, 3);
  assert.equal(sourcePassed, 2);
  assert.equal(boundaryPassed, 1);
});
