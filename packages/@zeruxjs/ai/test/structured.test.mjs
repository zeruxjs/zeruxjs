import test from 'node:test';
import assert from 'node:assert/strict';
import { object, string } from '@zeruxjs/validator';
import { createStructuredClient } from '@zeruxjs/ai/structured';
import { createGeminiProvider, withRetry } from '@zeruxjs/ai';
/** Declarative output schema plus independent validator; provider claims alone are insufficient. */
const schema = {
  jsonSchema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  },
  validator: object({ answer: string() }),
};
/** Synthetic public text conversation reused without repository or personal input. */
const messages = [{ role: 'user', content: 'Return an answer as data' }];
/**
 * Build a controlled rich result to exercise validation and usage admission.
 * @param {string} text - Synthetic output, possibly deliberately malformed JSON.
 * @param {object} usage - Reported counts; defaults to a complete consistent fixture.
 * @returns {object} Rich response containing inert text and private synthetic metadata.
 */
const result = (
  text,
  usage = { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
) => ({
  text,
  usage,
  finishReason: 'stop',
  providerMetadata: { private: 'not logged' },
});
/**
 * Script successive buffered native responses and expose an exact call counter.
 * @param {object[]} responses - Controlled sequence; the last result repeats if more calls occur.
 * @returns {object} Injected provider plus observed call count; no external inference.
 */
function provider(responses) {
  let calls = 0;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = {
    capabilities: {
      chat: true,
      stream: false,
      tools: false,
      usage: true,
      jsonOutput: true,
      singleAttempt: true,
    },
    async chat() {
      throw Error('wrong entry');
    },
    async chatContent(m, o) {
      assert.equal(o.maxTokens > 0, true);
      return responses[Math.min(calls++, responses.length - 1)];
    },
  };
  return {
    p,
    get calls() {
      return calls;
    },
  };
}
test('native JSON independently validates, repairs finitely, reports usage/versioned price, and keeps input inert', async () => {
  /** Scripted response sequence includes invalid output before a bounded successful repair. */
  const fixture = provider([
    result('{"answer":1}'),
    result('{"answer":"globalThis.__zx100Executed=true"}'),
  ]);
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(fixture.p, {
    budgets: { maxAttempts: 2 },
    pricing: {
      id: 'fixture',
      version: 'v1',
      currency: 'USD',
      inputMicrosPerMillionTokens: 1000000,
      outputMicrosPerMillionTokens: 2000000,
    },
  });
  try {
    delete globalThis.__zx100Executed;
    /** Observed response/receipt used to assert validation, accounting or retrieval behavior. */
    const r = await client.generate(messages, schema);
    assert.equal(r.data.answer, 'globalThis.__zx100Executed=true');
    assert.equal(globalThis.__zx100Executed, undefined);
    assert.equal(r.mode, 'native');
    assert.equal(r.ledger.attempts, 2);
    assert.equal(r.ledger.usage.reportedTotalTokens, 10);
    assert.equal(r.ledger.cost.state, 'estimated');
    assert.equal(r.ledger.cost.micros, 14);
    assert.equal(r.ledger.cost.pricing.version, 'v1');
    assert.equal(JSON.stringify(r.ledger).includes('Return an answer'), false);
  } finally {
    await client.close();
  }
});
test('unsupported capability needs explicit fallback; wrapped retries/tool side effects reject', async () => {
  let calls = 0;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = {
    capabilities: {
      chat: true,
      stream: false,
      tools: false,
      usage: false,
      singleAttempt: true,
    },
    chat: async () => {
      calls++;
      return '{"answer":"fallback"}';
    },
  };
  /** Native JSON capability is absent; default policy must reject rather than imply a constraint. */
  const rejected = createStructuredClient(p);
  try {
    await assert.rejects(
      rejected.generate(messages, schema),
      (e) => e.code === 'unsupported'
    );
    assert.equal(calls, 0);
  } finally {
    await rejected.close();
  }
  /** Opt-in text-json fallback still independently validates returned data. */
  const explicit = createStructuredClient(p, { fallback: 'text-json' });
  try {
    /** Observed response/receipt used to assert validation, accounting or retrieval behavior. */
    const r = await explicit.generate(messages, schema);
    assert.equal(r.mode, 'text-json');
    assert.equal(r.ledger.usage.state, 'unknown');
    assert.equal(r.ledger.cost.state, 'unknown');
  } finally {
    await explicit.close();
  }
  assert.throws(() => createStructuredClient(withRetry(p, { attempts: 2 })));
  assert.throws(() =>
    createStructuredClient({
      ...p,
      capabilities: { ...p.capabilities, tools: true },
    })
  );
  assert.throws(() => createStructuredClient({ chat: p.chat }));
});
test('invalid/deep/oversized JSON and repair exhaustion remain bounded', async () => {
  // Exercise malformed, deep and wrong-type output without changing the request ledger.
  for (const raw of [
    'bad json',
    '{"answer":1}',
    '{"answer":' + '['.repeat(20) + '0' + ']'.repeat(20) + '}',
  ]) {
    /** Scripted provider and call counter expose admission/repair behavior without external inference. */
    const f = provider([result(raw)]);
    /** Owned structured-generation client; the fixture closes it after native settlement. */
    const client = createStructuredClient(f.p, {
      budgets: { maxAttempts: 2, maxJsonDepth: 8 },
    });
    try {
      await assert.rejects(
        client.generate(messages, schema),
        (e) => e.code === 'attempt-budget'
      );
      assert.equal(f.calls, 2);
    } finally {
      await client.close();
    }
  }
  /** Scripted provider and call counter expose admission/repair behavior without external inference. */
  const f = provider([result('{"answer":"' + 'x'.repeat(1000) + '"}')]);
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(f.p, {
    budgets: { maxAttempts: 3, maxOutputBytes: 100 },
  });
  try {
    await assert.rejects(
      client.generate(messages, schema),
      (e) => e.code === 'output-budget'
    );
    assert.equal(f.calls, 1);
  } finally {
    await client.close();
  }
});
test('unknown usage stops repairs; token/cost admission rejects before another attempt', async () => {
  /** Scripted provider and call counter expose admission/repair behavior without external inference. */
  const f = provider([result('bad', {})]);
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(f.p, { budgets: { maxAttempts: 2 } });
  try {
    await assert.rejects(
      client.generate(messages, schema),
      (e) => e.code === 'unknown-usage' && e.ledger.usage.state === 'unknown'
    );
    assert.equal(f.calls, 1);
  } finally {
    await client.close();
  }
  // Check token and price admission independently before another transport attempt.
  for (const budgets of [{ maxTotalTokens: 1 }, { maxCostMicros: 0 }]) {
    /** Scripted provider and call counter expose admission/repair behavior without external inference. */
    const f = provider([result('{"answer":"ok"}')]);
    /** Owned structured-generation client; the fixture closes it after native settlement. */
    const client = createStructuredClient(f.p, {
      budgets,
      pricing: {
        id: 'fixture',
        version: 'v1',
        currency: 'USD',
        inputMicrosPerMillionTokens: 1000000,
        outputMicrosPerMillionTokens: 1000000,
      },
    });
    try {
      await assert.rejects(client.generate(messages, schema), (e) =>
        ['token-budget', 'cost-budget'].includes(e.code)
      );
      assert.equal(f.calls, 0);
    } finally {
      await client.close();
    }
  }
  /** Independent second provider fixture prevents mutable call state leaking between cases. */
  const f2 = provider([
    result('bad', { inputTokens: 5000, outputTokens: 2, totalTokens: 5002 }),
  ]);
  /** Second independent client verifies ledger limits without reusing earlier request state. */
  const c2 = createStructuredClient(f2.p, {
    budgets: { maxAttempts: 3, maxTotalTokens: 6000 },
  });
  try {
    await assert.rejects(
      c2.generate(messages, schema),
      (e) => e.code === 'token-budget'
    );
    assert.equal(f2.calls, 1);
  } finally {
    await c2.close();
  }
});
test('cancellation/overload retains native slots until actual cleanup, and provider failures never auto-replay', async () => {
  let release;
  /** Scripted provider and call counter expose admission/repair behavior without external inference. */
  const f = provider([]);
  f.p.chatContent = () => new Promise((r) => (release = r));
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(f.p, { maxConcurrent: 1 });
  try {
    /** Caller-owned cancellation source used to inspect retained work and listener cleanup. */
    const abort = new AbortController();
    /** Unsettled operation retained so cancellation/overload assertions observe its terminal rejection. */
    const pending = client.generate(messages, schema, { signal: abort.signal });
    await new Promise((r) => setImmediate(r));
    await assert.rejects(
      client.generate(messages, schema),
      (e) => e.code === 'overloaded'
    );
    abort.abort();
    await assert.rejects(pending, (e) => e.code === 'cancelled');
    assert.equal(client.status().pending, 1);
    let closed = false;
    /** Close promise retained to verify cleanup waits for actual work settlement. */
    const closing = client.close().then(() => (closed = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(closed, false);
    release(result('{"answer":"late"}'));
    await closing;
    assert.equal(client.status().pending, 0);
  } finally {
    await client.close();
  }
  let calls = 0;
  /** Injected dependency failure must become a redacted provider error without automatic replay. */
  const broken = {
    ...f.p,
    chatContent: async () => {
      calls++;
      throw Error('secret credential');
    },
  };
  /** Owned structured client for the current error/budget case; close drains native work. */
  const c = createStructuredClient(broken, { budgets: { maxAttempts: 4 } });
  try {
    await assert.rejects(
      c.generate(messages, schema),
      (e) => e.code === 'provider' && !String(e).includes('secret')
    );
    assert.equal(calls, 1);
  } finally {
    await c.close();
  }
});
test('native per-request reader budget cancels oversized response and invalid-native output preserves usage for repairs', async () => {
  let calls = 0,
    cancels = 0;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createGeminiProvider({
    apiKey: 'fixture',
    model: 'fixture',
    fetch: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: calls === 1 ? 'bad' : '{"answer":"ok"}' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 2,
            totalTokenCount: 5,
          },
        })
      );
    },
  });
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(p, { budgets: { maxAttempts: 2 } });
  try {
    assert.equal((await client.generate(messages, schema)).data.answer, 'ok');
    assert.equal(calls, 2);
  } finally {
    await client.close();
  }
  /** Oversized synthetic provider response used to verify reader cancellation and byte limits. */
  const big = createGeminiProvider({
    apiKey: 'fixture',
    model: 'fixture',
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('x'.repeat(1000)));
          },
          cancel() {
            cancels++;
          },
        })
      ),
  });
  /** Owned structured client for the current error/budget case; close drains native work. */
  const c = createStructuredClient(big, { budgets: { maxOutputBytes: 100 } });
  try {
    await assert.rejects(c.generate(messages, schema));
    assert.equal(cancels, 1);
  } finally {
    await c.close();
  }
});
test('overall deadline returns an unknown-usage reservation and retains native ownership', async () => {
  let release;
  /** Scripted provider and call counter expose admission/repair behavior without external inference. */
  const f = provider([]);
  f.p.chatContent = () => new Promise((r) => (release = r));
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(f.p, {
    budgets: {
      timeoutMs: 10,
      maxInputTokensPerAttempt: 1000,
      maxOutputTokensPerAttempt: 100,
      maxTotalTokens: 5000,
    },
  });
  try {
    await assert.rejects(
      client.generate(messages, schema),
      (e) =>
        e.code === 'timeout' &&
        e.ledger.usage.state === 'unknown' &&
        e.ledger.usage.accountedTokens === 1100
    );
    assert.equal(client.status().pending, 1);
    /** Close promise inspected before releasing deliberately noncooperative fixture work. */
    const close = client.close();
    release(result('{"answer":"late"}'));
    await close;
  } finally {
    await client.close();
  }
});
test('explicit unknown-usage reservation remains cumulative and cost stops a repair before dispatch', async () => {
  /** Scripted provider and call counter expose admission/repair behavior without external inference. */
  const f = provider([result('bad', {})]);
  /** Owned structured-generation client; the fixture closes it after native settlement. */
  const client = createStructuredClient(f.p, {
    budgets: { maxAttempts: 2, unknownUsage: 'reserve' },
  });
  try {
    await assert.rejects(
      client.generate(messages, schema),
      (e) =>
        e.code === 'attempt-budget' &&
        e.ledger.usage.state === 'unknown' &&
        e.ledger.usage.accountedTokens === 10240
    );
    assert.equal(f.calls, 2);
  } finally {
    await client.close();
  }
  /** Independent second provider fixture prevents mutable call state leaking between cases. */
  const f2 = provider([result('bad')]);
  /** Second independent client verifies ledger limits without reusing earlier request state. */
  const c2 = createStructuredClient(f2.p, {
    pricing: {
      id: 'fixture',
      version: 'v1',
      currency: 'USD',
      inputMicrosPerMillionTokens: 1000000,
      outputMicrosPerMillionTokens: 1000000,
    },
    budgets: { maxAttempts: 2, maxCostMicros: 5120 },
  });
  try {
    await assert.rejects(
      c2.generate(messages, schema),
      (e) => e.code === 'cost-budget'
    );
    assert.equal(f2.calls, 1);
  } finally {
    await c2.close();
  }
});
test('known fallback wrappers and side-effect providers cannot enter repair execution', async () => {
  /** Public fallback wrapper is imported to verify its single-attempt denial contract. */
  const { withFallback } = await import('@zeruxjs/ai');
  /** Scripted provider and call counter expose admission/repair behavior without external inference. */
  const f = provider([result('bad')]);
  assert.throws(() =>
    createStructuredClient(withFallback(f.p, f.p), {
      qualifiedProvider: { singleAttempt: true, sideEffects: 'none' },
    })
  );
  let effects = 0;
  /** Deliberately executable-looking inert data; assertions verify no code/tool execution occurs. */
  const dangerous = {
    ...f.p,
    capabilities: { ...f.p.capabilities, tools: true },
    chatContent: async () => {
      effects++;
      return result('bad');
    },
  };
  assert.throws(() =>
    createStructuredClient(dangerous, { budgets: { maxAttempts: 4 } })
  );
  assert.equal(effects, 0);
  assert.equal(f.calls, 0);
});
