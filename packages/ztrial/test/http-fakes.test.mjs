import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { getEventListeners } from 'node:events';
import {
  createHttpFake,
  withHttpFake,
  createTestClock,
  createSequenceRandom,
  createRunner,
  spyOn,
  waitFor,
} from 'ztrial';
/** Build one exact inert synthetic response-step route.
 * @param {string} path Fixed same-origin fixture path.
 * @param {object} reply Explicit bounded synthetic response data, never executable source.
 * @returns {object} One-step fixture definition without opening a server. */
const route = (path, reply) => ({ path, responses: [reply] });

test('injected exact routing scripts, metadata-only expectations and denied outbound requests', async () => {
  /** Original global Fetch or test-object method reference, checked for unchanged/restored ownership. */
  const original = globalThis.fetch;
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    routes: [
      {
        method: 'POST',
        path: '/v1/chat',
        responses: [{ body: 'first' }, { status: 503, body: 'retry' }],
      },
    ],
    random: createSequenceRandom([0.1, 0.2]),
    now: () => 42,
  });
  try {
    assert.equal(
      await (
        await fake.fetch('https://fake.test/v1/chat', {
          method: 'POST',
          body: 'private fixture input',
        })
      ).text(),
      'first'
    );
    assert.equal(
      (await fake.fetch('https://fake.test/v1/chat', { method: 'POST' }))
        .status,
      503
    );
    fake.assertDone();
    assert.deepEqual(fake.calls(), [
      { route: 0, method: 'POST', at: 42 },
      { route: 0, method: 'POST', at: 42 },
    ]);
    assert.ok(!JSON.stringify(fake.calls()).includes('private'));
    await assert.rejects(
      fake.fetch('https://outbound.invalid/private'),
      (error) =>
        error.code === 'UNHANDLED_REQUEST' && !error.message.includes('private')
    );
    assert.throws(
      () => fake.assertDone(),
      (error) => error.code === 'EXPECTATION_FAILED'
    );
    assert.equal(globalThis.fetch, original);
  } finally {
    await fake.close();
  }
});

test('two ephemeral servers are isolated and release ports, sockets and listeners', async () => {
  /** First independently owned synthetic HTTP fixture, using a private ephemeral listener. */
  const a = createHttpFake({ routes: [route('/same', { body: 'one' })] });
  /** Second independently owned synthetic HTTP fixture with no shared scripts/state. */
  const b = createHttpFake({ routes: [route('/same', { body: 'two' })] });
  /** Actual distinct ephemeral listener addresses from two independent fixtures. */
  const [first, second] = await Promise.all([a.listen(), b.listen()]);
  assert.notEqual(first, second);
  try {
    assert.deepEqual(
      await Promise.all([
        fetch(first + '/same').then((value) => value.text()),
        fetch(second + '/same').then((value) => value.text()),
      ]),
      ['one', 'two']
    );
    a.assertDone();
    b.assertDone();
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
  for (const fake of [a, b]) {
    assert.equal(fake.diagnostics().listening, false);
    assert.equal(fake.diagnostics().activeRequests, 0);
  }
  for (const origin of [first, second]) {
    await assert.rejects(
      new Promise((resolve, reject) => {
        /** Owned one-shot local native HTTP probe; errors are observed after fixture port shutdown. */
        const req = http.get(origin, resolve);
        req.once('error', reject);
      }),
      (error) => error.code === 'ECONNREFUSED'
    );
  }
});

test('deterministic stream chunks exercise SSE framing and partial-stream failure', async () => {
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    routes: [
      route('/sse', {
        headers: { 'content-type': 'text/event-stream' },
        chunks: [{ data: 'data: {"value":' }, { data: '1}\n' }, { data: '\n' }],
      }),
      route('/broken', {
        chunks: [{ data: 'partial' }, { data: 'never' }],
        failAfterChunks: 1,
      }),
    ],
  });
  try {
    /** Actual injected/native synthetic response; bodies must be consumed or cancelled. */
    const response = await fake.fetch('https://fake.test/sse');
    /** Owned response/body reader with explicit lock release after terminal outcome. */
    const reader = response.body.getReader();
    /** Observed deterministic producer chunks; not a claim about TCP packet boundaries. */
    const parts = [];
    while (true) {
      /** Actual synthetic stream read receipt checked before consuming its bytes. */
      const value = await reader.read();
      if (value.done) {
        break;
      }
      parts.push(new TextDecoder().decode(value.value));
    }
    reader.releaseLock();
    assert.deepEqual(parts, ['data: {"value":', '1}\n', '\n']);
    /** Owned intentionally failing scripted stream reader, released after observing its failure. */
    const broken = (
      await fake.fetch('https://fake.test/broken')
    ).body.getReader();
    assert.equal(
      new TextDecoder().decode((await broken.read()).value),
      'partial'
    );
    await assert.rejects(
      broken.read(),
      (error) => error.code === 'SCRIPTED_STREAM_FAILURE'
    );
    broken.releaseLock();
    fake.assertDone();
  } finally {
    await fake.close();
  }
  assert.equal(fake.diagnostics().activeStreams, 0);
});

test('timeout, request abort and reader cancellation clean timers/listeners and streams', async () => {
  /** Owned fixture abort controller; listener counts return to their pre-test state. */
  const controller = new AbortController();
  /** Pre-call owned-signal abort listener count. */
  const before = getEventListeners(controller.signal, 'abort').length;
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    requestTimeoutMs: 20,
    routes: [
      route('/timeout', { failure: 'timeout' }),
      route('/slow', { chunks: [{ data: 'late', delayMs: 1000 }] }),
      route('/cancel', {
        chunks: [{ data: 'first' }, { data: 'later', delayMs: 1000 }],
      }),
    ],
  });
  try {
    await assert.rejects(
      fake.fetch('https://fake.test/timeout'),
      (error) => error.code === 'REQUEST_TIMEOUT'
    );
    /** Actual injected/native synthetic response; bodies must be consumed or cancelled. */
    const response = await fake.fetch('https://fake.test/slow', {
      signal: controller.signal,
    });
    /** Owned response/body reader with explicit lock release after terminal outcome. */
    const reader = response.body.getReader();
    /** Actual in-flight injected request/read promise observed through timeout/cancellation. */
    const pending = reader.read();
    controller.abort();
    await assert.rejects(pending);
    reader.releaseLock();
    /** Owned reader whose explicit cancellation must release stream/request accounting. */
    const cancel = (
      await fake.fetch('https://fake.test/cancel')
    ).body.getReader();
    await cancel.read();
    await cancel.cancel();
    cancel.releaseLock();
    fake.assertDone();
  } finally {
    await fake.close();
  }
  assert.equal(fake.diagnostics().activeRequests, 0);
  assert.equal(fake.diagnostics().activeStreams, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, before);
});

test('manual clock and sequence random never modify global time or entropy', async () => {
  /** Owned manual fixture clock, closed after fake cleanup; global Date/timers remain untouched. */
  const clock = createTestClock(10);
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    now: clock.now,
    sleep: clock.sleep,
    random: createSequenceRandom([0.25]),
    routes: [route('/delayed', { delayMs: 50, body: 'done' })],
  });
  try {
    /** Actual in-flight injected request/read promise observed through timeout/cancellation. */
    const pending = fake.fetch('https://fake.test/delayed');
    void pending.catch(() => {});
    await waitFor(() => clock.pending() === 1, {
      timeoutMs: 100,
      intervalMs: 1,
    });
    assert.equal(clock.pending(), 1);
    clock.advance(49);
    assert.equal(clock.pending(), 1);
    clock.advance(1);
    assert.equal(await (await pending).text(), 'done');
    assert.equal(fake.calls()[0].at, 10);
    fake.assertDone();
    assert.equal(clock.now(), 60);
  } finally {
    await fake.close();
    clock.close();
  }
  assert.equal(clock.pending(), 0);
});

test('body, response and concurrency bounds reject invalid/denied inputs', async () => {
  for (const options of [
    { routes: [], maxBodyBytes: 0 },
    { routes: [route('/x', { body: 'too large' })], maxResponseBytes: 1 },
    { routes: [route('/x', { headers: { x: 'bad\r\nInjected: true' } })] },
  ]) {
    assert.throws(() => createHttpFake(options));
  }
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    maxBodyBytes: 2,
    maxConcurrent: 1,
    requestTimeoutMs: 50,
    routes: [
      { method: 'POST', path: '/body', responses: [{ body: 'ok' }] },
      route('/hold', { failure: 'timeout' }),
    ],
  });
  try {
    await assert.rejects(
      fake.fetch('https://fake.test/body', { method: 'POST', body: 'private' }),
      (error) => error.code === 'REQUEST_BODY_LIMIT'
    );
    /** Actual in-flight injected request/read promise observed through timeout/cancellation. */
    const pending = fake.fetch('https://fake.test/hold');
    await assert.rejects(
      fake.fetch('https://fake.test/other'),
      (error) => error.code === 'CONCURRENCY_LIMIT'
    );
    await assert.rejects(pending, (error) => error.code === 'REQUEST_TIMEOUT');
  } finally {
    await fake.close();
  }
});

test('assertion failure, expectation failure and runner timeout close acquired servers and restore scoped mocks', async () => {
  let assertionFake;
  await assert.rejects(
    withHttpFake({ routes: [] }, async (fake) => {
      assertionFake = fake;
      await fake.listen();
      throw Error('assertion failed');
    }),
    /assertion failed/
  );
  assert.equal(assertionFake.diagnostics().listening, false);
  let unmet;
  await assert.rejects(
    withHttpFake(
      { routes: [route('/unused', { body: 'unused' })] },
      async (fake) => {
        unmet = fake;
        await fake.listen();
      }
    ),
    (error) => error.code === 'EXPECTATION_FAILED'
  );
  assert.equal(unmet.diagnostics().listening, false);
  /** Independent inert runner whose callback owns this test’s fake/spies. */
  const runner = createRunner();
  /** Fixture-owned method object; no unrelated parallel runner’s mock is restored. */
  const object = { method: () => 1 };
  /** Original global Fetch or test-object method reference, checked for unchanged/restored ownership. */
  const original = object.method;
  let timed;
  runner.test('timeout owner', async (context) => {
    /** Owned local method replacement registered with this callback’s onCleanup. */
    const spy = spyOn(object, 'method');
    context.onCleanup(spy.mockRestore);
    timed = createHttpFake({ scope: context, routes: [] });
    await timed.listen();
    await new Promise(() => {});
  });
  /** Actual fixture runner outcome proving failed/undefined rejection cleanup stays visible. */
  const summary = await runner.runTests({ timeoutMs: 40 });
  assert.equal(summary.failed, 1);
  assert.equal(timed.diagnostics().listening, false);
  assert.equal(object.method, original);
});

test('explicit external allowance is per fixture and backend rejection preserves failure', async () => {
  /** Fixed injected transport/native acquisition cause, not a live dependency outage. */
  const failure = new Error('test transport unavailable');
  let calls = 0;
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    routes: [],
    network: {
      origins: ['https://allowed.test'],
      transport: async (_request, init) => {
        calls++;
        assert.equal(init.redirect, 'error');
        throw failure;
      },
    },
  });
  try {
    await assert.rejects(
      fake.fetch('https://allowed.test/check'),
      (error) => error === failure
    );
    assert.equal(calls, 1);
    await assert.rejects(
      fake.fetch('https://denied.test'),
      (error) => error.code === 'UNHANDLED_REQUEST'
    );
    assert.equal(calls, 1);
  } finally {
    await fake.close();
  }
  /** Independent fixture proving another fixture’s external allowance is never inherited. */
  const isolated = createHttpFake({ routes: [] });
  try {
    await assert.rejects(
      isolated.fetch('https://allowed.test'),
      (error) => error.code === 'UNHANDLED_REQUEST'
    );
  } finally {
    await isolated.close();
  }
});

test('allowed injected transports still obey request/response bounds and stream ownership', async () => {
  let calls = 0;
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({
    routes: [],
    maxBodyBytes: 2,
    maxResponseBytes: 4,
    network: {
      origins: ['https://allowed.test'],
      transport: async () => {
        calls++;
        return new Response('12345');
      },
    },
  });
  try {
    await assert.rejects(
      fake.fetch('https://allowed.test/', {
        method: 'POST',
        body: 'private payload',
      }),
      (error) => error.code === 'REQUEST_BODY_LIMIT'
    );
    assert.equal(calls, 0);
    /** Actual injected/native synthetic response; bodies must be consumed or cancelled. */
    const response = await fake.fetch('https://allowed.test/');
    await assert.rejects(
      response.text(),
      (error) => error.code === 'RESPONSE_BODY_LIMIT'
    );
    assert.equal(fake.diagnostics().activeRequests, 0);
  } finally {
    await fake.close();
  }
  for (const location of [
    'https://outbound.invalid/',
    '//outbound.invalid/',
    '/\\outbound.invalid/',
  ]) {
    assert.throws(
      () =>
        createHttpFake({
          routes: [route('/', { status: 302, headers: { location } })],
        }),
      /redirect/
    );
  }
});

test('fixture deadline and close during listen startup release ephemeral ports', async () => {
  let timed;
  await assert.rejects(
    withHttpFake({ routes: [], timeoutMs: 30 }, async (fake) => {
      timed = fake;
      await fake.listen();
      await new Promise(() => {});
    }),
    (error) => error.code === 'FIXTURE_CLOSED'
  );
  assert.equal(timed.diagnostics().listening, false);
  assert.equal(timed.diagnostics().sockets, 0);
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({ routes: [] });
  /** Actual explicit listener-start promise observed while concurrent close owns cleanup. */
  const starting = fake.listen();
  await fake.close();
  /** Actual private ephemeral listener origin, never an operator application URL. */
  const origin = await starting;
  assert.ok(origin.startsWith('http://127.0.0.1:'));
  assert.equal(fake.diagnostics().listening, false);
  await fake.close();
});

test('cleanup callbacks run LIFO after rejection and expose all cleanup failures', async () => {
  /** Independent inert runner whose callback owns this test’s fake/spies. */
  const runner = createRunner();
  /** Observed LIFO owned cleanup invocation order. */
  const order = [];
  runner.test('failed assertion', (context) => {
    context.onCleanup(() => {
      order.push(1);
    });
    context.onCleanup(() => {
      order.push(2);
      throw Error('cleanup failed');
    });
    throw Error('primary failure');
  });
  runner.test('undefined rejection', () => {
    throw undefined;
  });
  /** Actual fixture runner outcome proving failed/undefined rejection cleanup stays visible. */
  const summary = await runner.runTests();
  assert.equal(summary.failed, 2);
  assert.deepEqual(order, [2, 1]);
  assert.ok(summary.results[0].error instanceof AggregateError);
  assert.equal(summary.results[0].error.errors.length, 2);
});

test('native server acquisition failure preserves its cause and fixture cleanup', async () => {
  /** Fixed injected transport/native acquisition cause, not a live dependency outage. */
  const failure = new Error('test bind backend unavailable');
  /** Owned native createServer mock restored unconditionally after acquisition-failure assertion. */
  const replacement = mock.method(http, 'createServer', () => {
    throw failure;
  });
  let fixture;
  try {
    await assert.rejects(
      withHttpFake({ routes: [] }, (fake) => {
        fixture = fake;
        return fake.listen();
      }),
      (error) => error === failure
    );
    assert.equal(fixture.diagnostics().closed, true);
    assert.equal(fixture.diagnostics().listening, false);
  } finally {
    replacement.mock.restore();
  }
});

test('local adapter enforces body limits and exposes only sanitized unexpected-request responses', async () => {
  /** Owned explicit HTTP fixture; every direct-use test awaits close in finally. */
  const fake = createHttpFake({ routes: [], maxBodyBytes: 2 });
  /** Actual private ephemeral listener origin, never an operator application URL. */
  const origin = await fake.listen();
  try {
    /** Actual private local bridge rejection receipt for a known oversized synthetic body. */
    const oversized = await fetch(origin + '/private', {
      method: 'POST',
      body: 'private payload',
    });
    assert.equal(oversized.status, 413);
    assert.doesNotMatch(await oversized.text(), /payload/);
    /** Actual sanitized unexpected-request response, independently causing expectation failure. */
    const unknown = await fetch(origin + '/unknown');
    assert.equal(unknown.status, 500);
    assert.equal(await unknown.text(), 'HTTP fake request failed');
    assert.throws(
      () => fake.assertDone(),
      (error) => error.code === 'EXPECTATION_FAILED'
    );
  } finally {
    await fake.close();
  }
  assert.equal(fake.diagnostics().sockets, 0);
});
