import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnthropicProvider,
  createGeminiProvider,
  createAiProviderRegistry,
  withFallback,
  withRetry,
  AiProviderError,
} from '../dist/index.js';
import { createHttpFake } from 'ztrial/http';
/** Synthetic public text conversation reused without repository or personal input. */
const messages = [
  { role: 'system', content: 'Be concise' },
  { role: 'user', content: 'hello' },
];
/** Synthetic Anthropic text/usage response with a split multibyte text marker. */
const a = {
  type: 'message',
  content: [{ type: 'text', text: 'Hi 🌟' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 3 },
  extra: { version: 'fixture' },
};
/** Synthetic Gemini first-candidate response with cumulative token metadata. */
const g = {
  candidates: [
    { content: { parts: [{ text: 'Hi 🌟' }] }, finishReason: 'STOP' },
  ],
  usageMetadata: {
    promptTokenCount: 5,
    candidatesTokenCount: 3,
    totalTokenCount: 8,
  },
  modelVersion: 'fixture',
};
/**
 * Encode fixture objects into literal SSE frames.
 * @param {object[]} frames - Controlled native event envelopes.
 * @returns {string} Joined data lines with explicit frame delimiters.
 */
const sse = (frames) =>
  frames.map((v) => 'data: ' + JSON.stringify(v) + '\n\n').join('');
/** Ordered message-start/content/usage/stop fixture, including fragmented Unicode text. */
const anthropicFrames = [
  {
    type: 'message_start',
    message: { usage: { input_tokens: 5, output_tokens: 0 } },
  },
  { type: 'content_block_start', content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi 🌟' } },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 3 },
  },
  { type: 'message_stop' },
];
/**
 * Split UTF-8 into deliberately tiny chunks, including inside multibyte code points.
 * @param {string} text - Synthetic native event text.
 * @returns {ReadableStream<Uint8Array>} Finite test stream; no socket or external provider is opened.
 */
function split(text) {
  /** UTF-8 byte representation split into small chunks to exercise incremental decoding. */
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes, (byte) => ({ data: new Uint8Array([byte]) }));
}
// Run each native wire contract against an independent scoped injected HTTP fixture.
for (const kind of ['anthropic', 'gemini']) {
  test(`${kind}: real scoped HTTP fake, fragmented Unicode, wire mapping, metadata and disposal`, async () => {
    /** Expected fixed buffered operation path for the selected native adapter. */
    const path =
      kind === 'anthropic'
        ? '/v1/messages'
        : '/v1beta/models/fixture:generateContent';
    /** Expected SSE operation path; endpoint construction never uses generated arguments. */
    const streaming =
      kind === 'anthropic'
        ? path
        : '/v1beta/models/fixture:streamGenerateContent?alt=sse';
    /** Scoped injected HTTP fixture; its dispose/assert hooks own route matching and cleanup. */
    const fake = createHttpFake({
      origin: 'https://provider.test',
      routes:
        kind === 'anthropic'
          ? [
              {
                method: 'POST',
                path,
                responses: [
                  { body: JSON.stringify(a) },
                  {
                    headers: { 'content-type': 'text/event-stream' },
                    chunks: split(sse(anthropicFrames)),
                  },
                ],
              },
            ]
          : [
              {
                method: 'POST',
                path,
                responses: [{ body: JSON.stringify(g) }],
              },
              {
                method: 'POST',
                path: streaming,
                responses: [
                  {
                    headers: { 'content-type': 'text/event-stream' },
                    chunks: split(sse([g])),
                  },
                ],
              },
            ],
    });
    let sent;
    try {
      /** Private synthetic configuration; dummy credentials never authorize an external service. */
      const config = {
        apiKey: 'secret',
        model: 'fixture',
        baseUrl:
          'https://provider.test' + (kind === 'anthropic' ? '/v1' : '/v1beta'),
        fetch: async (url, options) => {
          sent = {
            url: String(url),
            headers: options.headers,
            body: JSON.parse(options.body),
            redirect: options.redirect,
          };
          return fake.fetch(url, options);
        },
      };
      /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
      const p =
        kind === 'anthropic'
          ? createAnthropicProvider({ ...config, apiVersion: '2026-10-21' })
          : createGeminiProvider(config);
      /** Observed fixture result, asserted below without executing any returned strings. */
      const result = await p.chatResult(messages);
      assert.equal(result.text, 'Hi 🌟');
      assert.equal(result.finishReason, 'stop');
      assert.equal(result.usage.inputTokens, 5);
      assert.deepEqual(result.providerMetadata, kind === 'anthropic' ? a : g);
      assert.equal(sent.redirect, 'error');
      assert.equal(
        sent.headers.get(kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key'),
        'secret'
      );
      assert.ok(!sent.url.includes('secret'));
      if (kind === 'anthropic') {
        assert.equal(sent.body.messages[0].role, 'system');
      } else {
        assert.equal(sent.body.systemInstruction.parts[0].text, 'Be concise');
        assert.equal(sent.body.contents[0].role, 'user');
      }
      /** Captured bounded fixture events used to check ordering and redaction. */
      const events = [];
      // Retain event order to distinguish text deltas from cumulative metadata.
      // Inspect unknown native events without treating metadata as model instructions.
      for await (const event of p.streamEvents(messages)) {
        events.push(event);
      }
      assert.equal(
        events
          .filter((e) => e.type === 'text')
          .map((e) => e.text)
          .join(''),
        'Hi 🌟'
      );
      assert.equal(events.at(-1).usage.outputTokens, 3);
      assert.equal(events.at(-1).finishReason, 'stop');
      fake.assertDone();
    } finally {
      await fake.close();
      assert.equal(fake.diagnostics().activeStreams, 0);
    }
  });
}
test('explicit registration tokens, capability denial and legacy version mapping', async () => {
  let body;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createAnthropicProvider({
    apiKey: 'x',
    model: 'fixture',
    apiVersion: '2023-06-01',
    fetch: async (_, o) => {
      body = JSON.parse(o.body);
      return new Response(JSON.stringify(a));
    },
  });
  assert.equal(await p.chat(messages), 'Hi 🌟');
  assert.equal(body.system, 'Be concise');
  assert.equal(body.messages.length, 1);
  /** Application-local borrowed-provider registry; the fixture controls registration and close. */
  const registry = createAiProviderRegistry(1);
  /** Registration identity lease used to verify disposal cannot remove a replacement. */
  const token = registry.register('primary', p);
  assert.equal(registry.get('primary', ['usage']), p);
  assert.throws(() => registry.get('primary', ['tools']));
  assert.throws(() => registry.register('primary', p));
  token.dispose();
  registry.register('primary', p);
  token.dispose();
  assert.equal(registry.get('primary'), p);
  registry.close();
  assert.throws(() => registry.get('primary'));
  await assert.rejects(p.chat([{ role: 'tool', content: 'denied' }]));
  assert.throws(() => createAnthropicProvider({ apiKey: 'x', model: 'x' }));
  await assert.rejects(
    createAnthropicProvider({
      apiKey: 'x',
      model: 'x',
      apiVersion: '2026-10-21',
    }).chat(messages, { temperature: 1 })
  );
});
test('errors are redacted; transient retry and pre-output fallback never replay a partial stream', async () => {
  let calls = 0,
    cancelled = false;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createGeminiProvider({
    apiKey: 'secret',
    model: 'fixture',
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 429, headers: { 'retry-after': '1' } }
      );
    },
  });
  await assert.rejects(
    p.chat(messages),
    (error) =>
      error instanceof AiProviderError &&
      error.status === 429 &&
      error.retryable &&
      !String(error).includes('secret')
  );
  assert.equal(cancelled, true);
  /** Explicit retry wrapper over injected failures, with finite attempts and no live dispatch. */
  const retry = withRetry(p, { attempts: 2, delayMs: 0, maxDelayMs: 0 });
  await assert.rejects(retry.chat(messages));
  assert.equal(calls, 3);
  let fallback = 0;
  /** Synthetic fallback whose invocation counter detects unsafe post-output replay. */
  const secondary = {
    async chat() {
      fallback++;
      return 'fallback';
    },
  };
  /**
   * Collect a fixture stream for assertions without interpreting generated content.
   * @param {object} provider - Injected text-stream provider.
   * @returns {Promise<string>} Joined deltas; partial-stream errors propagate to the assertion.
   */
  const collect = async (provider) => {
    let value = '';
    // Collect the controlled stream solely for fallback assertions.
    // Advance and close the injected stream to exercise early-return cleanup.
    for await (const text of provider.stream(messages)) {
      value += text;
    }
    return value;
  };
  assert.equal(await collect(withFallback(p, secondary)), 'fallback');
  /** Injected stream emits text before failing; fallback must not duplicate its output. */
  const partial = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    fetch: async () =>
      new Response(
        sse([
          { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
          { error: { message: 'secret' } },
        ]),
        { headers: { 'content-type': 'text/event-stream' } }
      ),
  });
  await assert.rejects(collect(withFallback(partial, secondary)));
  assert.equal(fallback, 1);
});
test('abort pending reader, timeout, overload, request/frame bounds and early-return cleanup', async () => {
  let cancelled = 0;
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    maxConcurrent: 1,
    maxQueued: 0,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      ),
  });
  /** Caller-owned abort controller used to verify cancellation independently of native settlement. */
  const controller = new AbortController();
  /** Retain the iterable before acquiring its reader-facing iterator. */
  const cancellableStream = p.stream(messages, { signal: controller.signal });
  /** The test owns iterator cancellation and verifies reader cleanup. */
  const iter = cancellableStream[Symbol.asyncIterator]();
  /** Unsettled operation retained so cancellation/overload assertions observe its terminal rejection. */
  const pending = iter.next();
  await new Promise((r) => setImmediate(r));
  await assert.rejects(p.chat(messages), /queue/);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(cancelled, 1);
  /** Restricted request budget fixture; rejection must happen before any transport invocation. */
  const small = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    maxRequestBytes: 10,
    fetch: async () => {
      throw Error('must not open');
    },
  });
  await assert.rejects(small.chat(messages), /size/);
  /** Short-deadline injected provider; tests observe cooperative reader cancellation. */
  const timed = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    timeoutMs: 5,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        })
      ),
  });
  await assert.rejects(timed.chat(messages));
  assert.equal(cancelled, 2);
  /** Synthetic stream/adapter fixture; its configured reader lifecycle is asserted below. */
  const stream = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(sse([g])));
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      ),
  });
  // Advance and close the injected stream to exercise early-return cleanup.
  for await (const text of stream.stream(messages)) {
    assert.equal(text, 'Hi 🌟');
    break;
  }
  assert.equal(cancelled, 3);
  /** Oversized synthetic provider response used to verify reader cancellation and byte limits. */
  const big = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    fetch: async () =>
      new Response(
        'data: ' + JSON.stringify({ x: 'x'.repeat(140000) }) + '\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      ),
  });
  await assert.rejects(async () => {
    // Consume the deliberate failure stream so size/MIME/order/encoding errors are observable.
    for await (const _ of big.stream(messages)) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, /frame/);
});
test('provider-specific stream errors, blocked outcomes, incomplete/invalid UTF-8 and unknown events', async () => {
  /**
   * Construct a native adapter over an explicit synthetic event sequence.
   * @param {object[]} frames - Controlled Anthropic event envelopes.
   * @returns {object} Injected provider; no live network inference is performed.
   */
  const makeA = (frames) =>
    createAnthropicProvider({
      apiKey: 'x',
      model: 'fixture',
      apiVersion: '2026-10-21',
      fetch: async () =>
        new Response(sse(frames), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
  /** Provider-declared stream error fixture; private error text must not leak publicly. */
  const bad = makeA([
    {
      type: 'error',
      error: { type: 'overloaded_error', message: 'secret-key' },
    },
  ]);
  await assert.rejects(
    async () => {
      // Consume the deliberate failure stream so size/MIME/order/encoding errors are observable.
      for await (const _ of bad.stream(messages)) {
        /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
      }
    },
    (error) =>
      error instanceof AiProviderError &&
      error.providerMetadata.code === 'overloaded_error' &&
      !JSON.stringify(error).includes('secret-key')
  );
  /** Unknown native events remain private metadata without becoming executable instructions. */
  const rich = makeA([
    { type: 'ping' },
    ...anthropicFrames.slice(0, 1),
    { type: 'future_event', safe: 'retained' },
    ...anthropicFrames.slice(1),
  ]);
  /** Captured bounded fixture events used to check ordering and redaction. */
  const events = [];
  // Inspect unknown native events without treating metadata as model instructions.
  for await (const e of withRetry(rich).streamEvents(messages)) {
    events.push(e);
  }
  assert.ok(
    events.some(
      (e) => e.type === 'metadata' && e.providerMetadata.type === 'future_event'
    )
  );
  /** Bounded admission/registry owner used to test capability or resource limits. */
  const limited = createAiProviderRegistry();
  limited.register('rich', withRetry(rich));
  assert.ok(limited.get('rich', ['usage']).chatResult);
  limited.close();
  /** Gemini safety-block fixture distinguishes blocked output from successful empty text. */
  const blocked = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    fetch: async () =>
      new Response(
        JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } })
      ),
  });
  assert.equal((await blocked.chatResult(messages)).finishReason, 'blocked');
  /** Anthropic event sequence deliberately omits terminal completion to require failure. */
  const truncated = makeA(anthropicFrames.slice(0, -1));
  await assert.rejects(async () => {
    // Consume the deliberate failure stream so size/MIME/order/encoding errors are observable.
    for await (const _ of truncated.stream(messages)) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, /Incomplete/);
  /** Deliberately unsupported response/encoding fixture, expected to reject without replay. */
  const invalid = createGeminiProvider({
    apiKey: 'x',
    model: 'fixture',
    fetch: async () =>
      new Response(new Uint8Array([0xff]), {
        headers: { 'content-type': 'text/event-stream' },
      }),
  });
  await assert.rejects(async () => {
    // Consume the deliberate failure stream so size/MIME/order/encoding errors are observable.
    for await (const _ of invalid.stream(messages)) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, AiProviderError);
});
test('OpenAI-compatible request budget and invalid-MIME/error body cancellation', async () => {
  /** Public factory loaded from compiled output to check the legacy adapter alongside native ones. */
  const { createOpenAICompatibleProvider } = await import('../dist/index.js');
  let calls = 0,
    cancels = 0;
  /** Private synthetic configuration; dummy credentials never authorize an external service. */
  const config = {
    apiKey: 'secret',
    model: 'fixture',
    baseUrl: 'https://provider.test',
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancels++;
          },
        }),
        { status: 500 }
      );
    },
  };
  await assert.rejects(
    createOpenAICompatibleProvider({ ...config, maxRequestBytes: 1 }).chat(
      messages
    ),
    /too large/
  );
  assert.equal(calls, 0);
  await assert.rejects(createOpenAICompatibleProvider(config).chat(messages));
  assert.equal(cancels, 1);
  /** Synthetic provider fixture; injected methods/transport avoid live model calls. */
  const p = createOpenAICompatibleProvider({
    ...config,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancels++;
          },
        }),
        { headers: { 'content-type': 'text/plain' } }
      ),
  });
  await assert.rejects(async () => {
    // Consume the deliberate failure stream so size/MIME/order/encoding errors are observable.
    for await (const _ of p.stream(messages)) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, /event-stream/);
  assert.equal(cancels, 2);
});
