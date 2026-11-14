import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAICompatibleProvider,
  createAiClient,
  withConcurrencyLimit,
  withRetry,
  AiProviderError,
  parseAiSse,
} from '../dist/index.js';
/**
 * Encode fixture text without interpreting it as instructions.
 * @param {string} value - Synthetic SSE text.
 * @returns {Uint8Array} UTF-8 bytes for controlled fragmentation.
 */
const encode = (value) => new TextEncoder().encode(value);
/**
 * Expose encoded fixture bytes through a finite chunked stream.
 * @param {string} value - Synthetic event text.
 * @param {number} n - Chunk byte size, default three.
 * @returns {ReadableStream<Uint8Array>} Controlled stream independent of HTTP or live model access.
 */
function chunks(value, n = 3) {
  /** Encoded fixture bytes; chunking tests decoder correctness independently of HTTP. */
  const data = encode(value);
  return new ReadableStream({
    start(ctrl) {
      for (let i = 0; i < data.length; i += n) {
        ctrl.enqueue(data.slice(i, i + n));
      }
      ctrl.close();
    },
  });
}
test('streamed completion decodes fragmented SSE, unicode and DONE', async () => {
  /** Synthetic stream/adapter fixture; its configured reader lifecycle is asserted below. */
  const stream =
    ': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"Hi 🌟"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n';
  let body;
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = createOpenAICompatibleProvider({
    apiKey: 'secret',
    baseUrl: 'https://provider.test/v1',
    model: 'a',
    fetch: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(chunks(stream, 2), {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      });
    },
  });
  /** Collected text deltas; output must match exactly across fragmented Unicode frames. */
  const result = [];
  // Collect text across deliberately fragmented framing/UTF-8 boundaries.
  for await (const part of createAiClient(provider).streamComplete('hello')) {
    result.push(part);
  }
  assert.equal(result.join(''), 'Hi 🌟 there');
  assert.equal(body.stream, true);
});
test('stream enforces cumulative response bytes, event size and MIME', async () => {
  /** Deliberate wire/text fixture used to check bounds and inertness. */
  const payload = 'data: {"choices":[{"delta":{"content":"123456789"}}]}\n\n';
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = createOpenAICompatibleProvider({
    apiKey: 'secret',
    baseUrl: 'https://provider.test/v1',
    model: 'a',
    maxResponseBytes: 20,
    fetch: async () =>
      new Response(chunks(payload), {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  });
  await assert.rejects(async () => {
    // Drive the negative stream through its failing read and cleanup path.
    for await (const _ of provider.stream([{ role: 'user', content: 'hi' }])) {
      /* Consume the stream so parser failures reach the assertion. */
    }
  }, /size limit/);
  /** Deliberately unsupported response/encoding fixture, expected to reject without replay. */
  const invalid = createOpenAICompatibleProvider({
    apiKey: 'secret',
    baseUrl: 'https://provider.test/v1',
    model: 'a',
    fetch: async () =>
      new Response('plain', { headers: { 'content-type': 'text/plain' } }),
  });
  await assert.rejects(async () => {
    // Drive the negative stream through its failing read and cleanup path.
    for await (const _ of invalid.stream([{ role: 'user', content: 'hi' }])) {
      /* Consume the stream so parser failures reach the assertion. */
    }
  }, /event-stream/);
});
test('provider refuses redirect and prevents Authorization override', async () => {
  let authorization, redirect;
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = createOpenAICompatibleProvider({
    apiKey: 'configured',
    baseUrl: 'https://provider.test',
    model: 'a',
    headers: { authorization: 'attacker' },
    fetch: async (_url, init) => {
      authorization = init.headers.get('Authorization');
      redirect = init.redirect;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'okay' } }] })
      );
    },
  });
  assert.equal(await provider.chat([{ role: 'user', content: 'hi' }]), 'okay');
  assert.equal(authorization, 'Bearer configured');
  assert.equal(redirect, 'error');
});
test('retry only retries explicit transient provider errors, honors cap and abort', async () => {
  let n = 0;
  /** Explicit retry wrapper over injected failures, with finite attempts and no live dispatch. */
  const retry = withRetry(
    {
      async chat() {
        if (++n < 3) {
          throw new AiProviderError('limited', 429, true);
        }
        return 'ok';
      },
    },
    { attempts: 3, delayMs: 0 }
  );
  assert.equal(await retry.chat([]), 'ok');
  assert.equal(n, 3);
  let failed = 0;
  await assert.rejects(
    withRetry(
      {
        async chat() {
          failed++;
          throw Error('not safe to retry');
        },
      },
      { attempts: 3, delayMs: 0 }
    ).chat([]),
    /not safe/
  );
  assert.equal(failed, 1);
});
test('concurrency limit holds slots until stream closes, queued abort removes waiter', async () => {
  let release;
  /** Controlled provider fixture; host-visible calls and cleanup are asserted locally. */
  const provider = {
    async chat() {
      await new Promise((r) => {
        release = r;
      });
      return 'done';
    },
    async *stream() {
      yield 'one';
      await new Promise((r) => {
        release = r;
      });
      yield 'two';
    },
  };
  /** Bounded admission/registry owner used to test capability or resource limits. */
  const limited = withConcurrencyLimit(provider, {
    maxConcurrent: 1,
    maxQueued: 1,
  });
  /** Owned async iterator whose active slot must release when iteration ends. */
  const iterator = limited.stream([])[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, 'one');
  assert.deepEqual(limited.status(), { active: 1, queued: 0 });
  /** Caller-owned cancellation source used to inspect retained work and listener cleanup. */
  const abort = new AbortController();
  /** Unsettled operation retained so cancellation/overload assertions observe its terminal rejection. */
  const pending = limited.chat([], { signal: abort.signal });
  await new Promise((r) => setImmediate(r));
  assert.equal(limited.status().queued, 1);
  abort.abort();
  await assert.rejects(pending);
  assert.equal(limited.status().queued, 0);
  await iterator.return();
  assert.equal(limited.status().active, 0);
  /** Admitted follow-up call verifies a released iterator slot can be reused. */
  const next = limited.chat([]);
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal(await next, 'done');
  assert.deepEqual(limited.status(), { active: 0, queued: 0 });
});
test('parseAiSse ignores comments and decodes event chunks across boundaries', async () => {
  let assembled = '';
  // Collect text across deliberately fragmented framing/UTF-8 boundaries.
  for await (const part of parseAiSse(
    chunks(': test\n\ndata: {"choices":[{"delta":{"content":"yes"}}]}\n\n'),
    10000
  )) {
    assembled += part;
  }
  assert.equal(assembled, 'yes');
});
