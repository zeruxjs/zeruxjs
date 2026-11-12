import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiClient,
  createOpenAICompatibleProvider,
  withFallback,
  withRetry,
  AiProviderError,
} from '../dist/index.js';
test('chat provider sends request to exact endpoint', async () => {
  let url;
  let body;
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = createOpenAICompatibleProvider({
    apiKey: 'secret',
    model: 'test',
    baseUrl: 'https://example.test/v1',
    fetch: async (u, options) => {
      url = u.toString();
      body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'hello' } }] }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  assert.equal(await createAiClient(provider).complete('hi'), 'hello');
  assert.equal(url, 'https://example.test/v1/chat/completions');
  assert.equal(body.messages[0].content, 'hi');
});
test('untrusted HTTP remote endpoint rejected', () =>
  assert.throws(() =>
    createOpenAICompatibleProvider({
      apiKey: 'x',
      model: 'x',
      baseUrl: 'http://example.test',
    })
  ));
test('invalid response shape rejected', async () => {
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = createOpenAICompatibleProvider({
    apiKey: 'x',
    model: 'x',
    baseUrl: 'https://api.example',
    fetch: async () => new Response('{}'),
  });
  await assert.rejects(
    provider.chat([{ role: 'user', content: 'hello' }]),
    AiProviderError
  );
});
test('retry and fallback', async () => {
  let n = 0;
  /** Explicit retry wrapper over injected failures, with finite attempts and no live dispatch. */
  const retry = withRetry(
    {
      async chat() {
        if (n++ < 1) {
          throw new AiProviderError('fail', 503, true);
        }
        return 'ok';
      },
    },
    { delayMs: 0 }
  );
  assert.equal(await retry.chat([{ role: 'user', content: 'x' }]), 'ok');
  assert.equal(
    await withFallback(
      {
        chat: async () => {
          throw Error('fail');
        },
      },
      { chat: async () => 'fallback' }
    ).chat([]),
    'fallback'
  );
});
test('stream fallback handles a non-streaming provider failure before yielding', async () => {
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = withFallback(
    {
      async chat() {
        throw Error('primary outage');
      },
    },
    {
      async chat() {
        return 'secondary answer';
      },
      async *stream() {
        yield 'secondary ';
        yield 'answer';
      },
    }
  );
  let result = '';
  // Collect fallback deltas without interpreting generated text.
  for await (const part of provider.stream([])) {
    result += part;
  }
  assert.equal(result, 'secondary answer');
  /** Caller-owned abort controller used to verify cancellation independently of native settlement. */
  const controller = new AbortController();
  controller.abort();
  /** Fallback fixture must not contact the secondary after initiating cancellation. */
  const aborted = withFallback(
    {
      async chat() {
        throw Error('failed');
      },
    },
    {
      async chat() {
        return 'unsafe retry';
      },
    }
  );
  await assert.rejects(async () => {
    // Drive the aborted iterator to prove a secondary provider is never selected.
    for await (const _ of aborted.stream([], { signal: controller.signal })) {
      /* Consume the stream so parser failures reach the assertion. */
    }
  }, /failed/);
});
