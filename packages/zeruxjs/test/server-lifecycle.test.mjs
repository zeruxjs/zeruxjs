import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationLifecycle, defineService } from 'zeruxjs';
import {
  createServerLifecycleHooks,
  createContext,
  setContext,
  useContext,
  runHooks,
  useEffect,
} from '@zeruxjs/hooks';
/** Inert built-in providers ensuring lifecycle fixtures contact no external services. */
const providers = { database: async () => null, cache: async () => null };
/** Fixed request lifecycle phases asserted for ordering and at-most-once emission. */
const phaseNames = [
  'request:before',
  'route:resolved',
  'response:before',
  'request:error',
  'response:after',
  'request:after',
];
/** Create a loopback runtime with a host-owned lifecycle bus and cleanup receipts.
 * @param {object} config - Private fixture configuration merged with the explicit host bus.
 * @returns {Promise<object>} Fixture owner whose close disposes generation, listener, hooks and files.
 */
async function fixture(config = {}) {
  /** Temporary lifecycle project removed after generation and host hook disposal. */
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'lifecycle-'));
  /** Host-owned lifecycle bus reused across fixture generations and disposed by close. */
  const hooks = createServerLifecycleHooks();
  /** Request phase receipts containing correlation and public terminal metadata. */
  const phases = [];
  /** Generation phase receipts used to distinguish failed candidates from serving generations. */
  const generations = [];
  /** Request effect and explicit-disposer receipts checked for exact terminal cleanup. */
  const cleanups = [];
  /** Request-scoped hook context whose retained reads must fail after disposal. */
  const context = createContext('none');
  let retainedMutation;
  for (const phase of phaseNames) {
    hooks.register(phase, (event) => {
      assert.ok(Object.isFrozen(event));
      phases.push({ phase, ...event });
    });
  }
  for (const phase of [
    'prepare',
    'ready',
    'activate',
    'error',
    'close',
    'closed',
  ]) {
    hooks.register(`generation:${phase}`, (event) =>
      generations.push({ phase, ...event })
    );
  }
  hooks.register('request:before', (event) => {
    setContext(context, event.requestId);
    runHooks(() =>
      useEffect(() => () => cleanups.push(`effect:${event.requestId}`), [])
    );
    event.onDispose(() => cleanups.push(`owned:${event.requestId}`));
  });
  hooks.register('response:before', (event) => {
    retainedMutation = event.response;
    event.response.setHeader('x-lifecycle', 'active');
  });
  /** Generation owner borrowing the host lifecycle bus for replacement and shutdown. */
  const app = await createApplicationLifecycle({
    rootDir,
    mode: 'dev',
    config: { ...config, lifecycleHooks: hooks },
    providers,
    drainTimeoutMs: 100,
  });
  /** Owned ephemeral loopback server closed after application drain. */
  const server = createServer((req, res) => {
    void app.handle(req, res).catch(() => {
      if (!res.destroyed) {
        res.destroy();
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  /** Collect one native response from the isolated lifecycle runtime.
   * @param {string} url - Relative fixture route.
   * @param {object} options - Authored method, headers and body.
   * @returns {Promise<object>} Status, headers and text after response completion.
   */
  function call(url, options = {}) {
    return new Promise((resolve, reject) => {
      /** Native loopback request whose response is collected before assertion. */
      const req = request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path: url,
          headers: { accept: 'application/json', ...options.headers },
          method: options.method ?? 'GET',
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body })
          );
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end(options.body);
    });
  }
  return {
    rootDir,
    hooks,
    app,
    server,
    call,
    phases,
    generations,
    cleanups,
    context,
    mutation: () => retainedMutation,
    /** Drain the application, close native connections and dispose the borrowed host bus.
     * @returns {Promise<void>} Resolves after the temporary lifecycle project is removed.
     */
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      hooks.dispose();
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}
/** Project recorded request events to their ordered phase names.
 * @param {object} f - Lifecycle fixture retaining request phase receipts.
 * @returns {string[]} Fresh ordered phase-name projection.
 */
function requestPhases(f) {
  return f.phases.map((item) => item.phase);
}

test('successful/404/validation/error responses emit each phase once and dispose state/context', async () => {
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture();
  try {
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/ok',
        /** Exercise the test-specific request context or streaming completion boundary.
         * @returns {unknown} Authored response, pending stream completion or deliberate private failure.
         */
        handler() {
          return { context: useContext(f.context) };
        },
      });
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/fail',
        /** Exercise the test-specific request context or streaming completion boundary.
         * @returns {unknown} Authored response, pending stream completion or deliberate private failure.
         */
        handler() {
          throw Error('PRIVATE route payload');
        },
      });
    /** Successful response carrying request context correlation and precommit header mutation. */
    const first = await f.call('/ok');
    assert.equal(first.status, 200);
    assert.equal(first.headers['x-lifecycle'], 'active');
    assert.equal(JSON.parse(first.body).context, first.headers['x-request-id']);
    assert.deepEqual(requestPhases(f), [
      'request:before',
      'route:resolved',
      'response:before',
      'response:after',
      'request:after',
    ]);
    assert.equal(f.cleanups.length, 2);
    assert.throws(() => f.mutation().setStatus(202), /phase ended/);
    for (const [url, options, status] of [
      ['/missing', {}, 404],
      [
        '/ok',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        },
        400,
      ],
      ['/fail', {}, 500],
    ]) {
      f.phases.length = 0;
      /** Response receipt checked for safe status/body and terminal lifecycle behavior. */
      const result = await f.call(url, options);
      assert.equal(result.status, status);
      assert.equal(result.body.includes('PRIVATE'), false);
      for (const phase of phaseNames) {
        assert.ok(
          requestPhases(f).filter((value) => value === phase).length <= 1
        );
      }
      assert.equal(requestPhases(f).at(-1), 'request:after');
      assert.equal(
        f.phases.find((item) => item.phase === 'request:error')?.kind,
        status === 404 ? undefined : 'handler'
      );
    }
    assert.equal(f.cleanups.length, 8);
    assert.equal(f.app.runtime().toManifest().config.lifecycleHooks, undefined);
  } finally {
    await f.close();
  }
});
test('stream stays scoped until disconnect; finish/close/error cannot duplicate terminal cleanup', async () => {
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture();
  let release, escaped, handlerFinished;
  /** Handler completion promise retained until the disconnect assertion has finished. */
  const done = new Promise((resolve) => (handlerFinished = resolve));
  try {
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/stream',
        /** Exercise the test-specific request context or streaming completion boundary.
         * @param {object} ctx - Request-bound response and lifecycle context when required.
         * @returns {unknown} Authored response, pending stream completion or deliberate private failure.
         */
        async handler(ctx) {
          assert.ok(ctx.requestLifecycle);
          escaped = () => useContext(f.context);
          ctx.res.writeHead(200, { 'content-type': 'text/plain' });
          ctx.res.write('chunk');
          await new Promise((resolve) => (release = resolve));
          try {
            assert.throws(escaped, /disposed/);
            assert.equal(ctx.requestLifecycle.signal.aborted, true);
          } finally {
            handlerFinished();
          }
        },
      });
    /** Owned streaming client explicitly destroyed to exercise disconnect cleanup. */
    const client = request({
      hostname: '127.0.0.1',
      port: f.server.address().port,
      path: '/stream',
    });
    client.on('error', () => {});
    /** Pending native response event attached before sending the streaming request. */
    const incoming = once(client, 'response');
    client.end();
    /** Native streaming response destroyed after its first data event. */
    const [response] = await incoming;
    await once(response, 'data');
    assert.equal(f.cleanups.length, 0);
    /** One-shot terminal hook promise proving disconnect lifecycle cleanup has completed. */
    const ended = new Promise((resolve) =>
      f.hooks.register('request:after', resolve, { once: true })
    );
    response.destroy();
    client.destroy();
    await ended;
    assert.equal(f.cleanups.length, 2);
    assert.equal(
      f.phases.find((item) => item.phase === 'request:after').outcome,
      'disconnected'
    );
    release();
    await done;
    await new Promise((resolve) => setImmediate(resolve));
    for (const phase of phaseNames) {
      assert.equal(
        requestPhases(f).filter((value) => value === phase).length,
        1
      );
    }
  } finally {
    release?.();
    await f.close();
  }
});
test('completed stream has one commit and cleanup after last byte, with bounded header mutation', async () => {
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture();
  let end;
  try {
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/stream',
        /** Exercise the test-specific request context or streaming completion boundary.
         * @param {object} ctx - Request-bound response and lifecycle context when required.
         * @returns {unknown} Authored response, pending stream completion or deliberate private failure.
         */
        handler(ctx) {
          ctx.res.write('first');
          end = () => ctx.res.end('last');
          return;
        },
      });
    // A route that writes directly must keep its handler pending, otherwise the existing runtime ends it.
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/stream',
        /** Exercise the test-specific request context or streaming completion boundary.
         * @param {object} ctx - Request-bound response and lifecycle context when required.
         * @returns {unknown} Authored response, pending stream completion or deliberate private failure.
         */
        async handler(ctx) {
          ctx.res.write('first');
          await new Promise(
            (resolve) =>
              (end = () => {
                ctx.res.end('last');
                resolve();
              })
          );
        },
      });
    /** Pending stream response held until the fixture releases its final byte. */
    const response = f.call('/stream');
    while (!end) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(f.cleanups.length, 0);
    end();
    /** Response receipt checked for safe status/body and terminal lifecycle behavior. */
    const result = await response;
    assert.equal(result.body, 'firstlast');
    assert.equal(f.cleanups.length, 2);
    assert.equal(
      requestPhases(f).filter((value) => value === 'response:before').length,
      1
    );
    assert.equal(
      f.phases.find((item) => item.phase === 'request:after').outcome,
      'completed'
    );
  } finally {
    end?.();
    await f.close();
  }
});
test('failed reload rolls back only candidate; replacement and shutdown generations close once', async () => {
  /** Minimal explicit Standard Schema fixture preserving validated service settings. */
  const schema = {
    '~standard': { version: 1, validate: (value) => ({ value }) },
  };
  /** Service setting disposal receipts distinguishing failed and replaced generations. */
  const closed = [];
  /** Reloadable service with explicit generation cleanup and a deliberate failing setting. */
  const definition = defineService({
    name: 'custom:demo',
    namespace: 'demo',
    schema,
    reloadable: ['label'],
    /** Register candidate cleanup before validating the synthetic reload setting.
     * @param {{settings: {label: string}, onDispose: Function}} context - Validated settings and generation disposer registration.
     * @returns {object} Fixture service value; the fail setting throws before activation.
     */
    start({ settings, onDispose }) {
      onDispose(() => closed.push(settings.label));
      if (settings.label === 'fail') {
        throw Error('provider unavailable');
      }
      return { value: settings };
    },
  });
  /** Create private reload settings for the declared fixture service.
   * @param {string} label - Candidate generation setting.
   * @returns {object} Configuration retaining the explicit service definition.
   */
  const config = (label) => ({
    serviceDefinitions: [definition],
    services: { demo: { settings: { label } } },
  });
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture(config('one'));
  try {
    await assert.rejects(
      f.app.reload({ ...config('fail'), lifecycleHooks: f.hooks }),
      /provider unavailable/
    );
    assert.equal(f.app.runtime().serviceScope.get('custom:demo').label, 'one');
    assert.equal(f.app.status().generation, 1);
    await f.app.reload({ ...config('two'), lifecycleHooks: f.hooks });
    assert.equal(f.app.runtime().serviceScope.get('custom:demo').label, 'two');
    await f.app.close();
    await f.app.close();
    /** Phase receipts grouped by generation identity for exact lifecycle ordering assertions. */
    const byGeneration = Map.groupBy(
      f.generations,
      (event) => event.generationId
    );
    assert.equal(byGeneration.size, 3);
    assert.deepEqual(
      [...byGeneration.values()].map((events) =>
        events.map((event) => event.phase)
      ),
      [
        ['prepare', 'ready', 'activate', 'close', 'closed'],
        ['prepare', 'error', 'close', 'closed'],
        ['prepare', 'ready', 'activate', 'close', 'closed'],
      ]
    );
    assert.deepEqual(closed, ['fail', 'one', 'two']);
  } finally {
    await f.close();
  }
});
test('hook failure yields one error phase and cleanup; terminal/cleanup failures cannot skip disposal', async () => {
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture();
  try {
    f.hooks.register('request:before', (context) => {
      context.onDispose(() => {
        throw Error('cleanup failure');
      });
      throw Error('PRIVATE hook payload');
    });
    f.hooks.register('request:after', () => {
      throw Error('observation failure');
    });
    /** Response receipt checked for safe status/body and terminal lifecycle behavior. */
    const result = await f.call('/unused');
    assert.equal(result.status, 500);
    assert.equal(result.body.includes('PRIVATE'), false);
    assert.equal(
      f.phases.filter((item) => item.phase === 'request:error').length,
      1
    );
    assert.equal(f.cleanups.length, 2);
    assert.equal(
      f.phases.find((item) => item.phase === 'request:error').kind,
      'hook'
    );
  } finally {
    await f.close();
  }
});
test('replacement retains old stream until finish and both generations dispose request scopes', async () => {
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture();
  let release;
  try {
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({
        pattern: '/held',
        /** Exercise the test-specific request context or streaming completion boundary.
         * @param {object} ctx - Request-bound response and lifecycle context when required.
         * @returns {unknown} Authored response, pending stream completion or deliberate private failure.
         */
        async handler(ctx) {
          ctx.res.write('old');
          await new Promise(
            (resolve) =>
              (release = () => {
                ctx.res.end('done');
                resolve();
              })
          );
        },
      });
    /** Pending response from the old generation that replacement must continue to drain. */
    const old = f.call('/held');
    while (!release) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    /** Original generation identity checked before its held request is released. */
    const firstGeneration = f.generations[0].generationId;
    /** Reload promise retaining the old generation until its active stream settles. */
    const replacing = f.app.reload({ lifecycleHooks: f.hooks });
    while (f.app.status().generation < 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(
      f.generations.some(
        (event) =>
          event.generationId === firstGeneration && event.phase === 'closed'
      ),
      false
    );
    assert.equal(f.cleanups.length, 0);
    release();
    await old;
    await replacing;
    assert.equal(f.cleanups.length, 2);
    /** Request served by the replacement generation after the prior stream drains. */
    const newRequest = await f.call('/not-found');
    assert.equal(newRequest.status, 404);
    assert.equal(f.cleanups.length, 4);
    assert.equal(
      new Set(
        f.phases
          .filter((event) => event.phase === 'request:after')
          .map((event) => event.generationId)
      ).size,
      2
    );
  } finally {
    release?.();
    await f.close();
  }
});
test('commit-time status/header mutation rejects injection and disposed config fails before providers', async () => {
  /** Lifecycle fixture owning hooks, application, listener and temporary project. */
  const f = await fixture();
  try {
    f.app
      .runtime()
      .asPluginApi()
      .addRoute({ pattern: '/ok', handler: () => 'ok' });
    /** Owned precommit hook handle removed after its deliberate status mutation assertion. */
    const status = f.hooks.register('response:before', (event) =>
      event.response.setStatus(202)
    );
    assert.equal((await f.call('/ok')).status, 202);
    status.remove();
    /** Owned precommit hook handle injecting an invalid header for rejection testing. */
    const invalid = f.hooks.register('response:before', (event) =>
      event.response.setHeader('x-check', 'bad\r\nInjected: yes')
    );
    /** Response receipt checked for safe status/body and terminal lifecycle behavior. */
    const result = await f.call('/ok');
    assert.equal(result.status, 500);
    assert.equal(result.headers.injected, undefined);
    invalid.remove();
    let calls = 0;
    /** Already disposed host hook bus rejected before any provider acquisition. */
    const disposed = createServerLifecycleHooks();
    disposed.dispose();
    await assert.rejects(
      createApplicationLifecycle({
        rootDir: f.rootDir,
        config: { lifecycleHooks: disposed },
        providers: {
          database: async () => {
            calls++;
          },
        },
      })
    );
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});
