import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  defineService,
  resolveApplicationConfig,
  prepareConfiguration,
  createApplicationLifecycle,
  RestartRequiredError,
} from 'zeruxjs';
import { object, string } from '@zeruxjs/validator/schemas';
import { initializeRuntimeServices } from '../dist/bootstrap/services.js';
/** Shared strict label schema validating settings before service acquisition. */
const schema = object({ label: string() });
/** Inert built-in providers keeping configuration tests independent of databases and caches. */
const providers = { database: async () => null, cache: async () => null };
/** Synthetic private callback and credential that must never enter public config. */
const privateOptions = {
  password:
    'PRIVATE' /** Private inert host callback used to prove executable options are excluded.
   * @returns {void} No work is performed.
   */,
  callback() {},
};
/** Build the private configuration for one explicitly registered service.
 * @param {object} def - Validated service definition.
 * @param {string} [label] - Fixture setting; invalid cases deliberately pass other values.
 * @returns {object} Host configuration retaining private options.
 */
const config = (def, label = 'one') => ({
  serviceDefinitions: [def],
  services: { demo: { settings: { label }, privateOptions } },
});
test('precedence and validation before connections', async () => {
  /** Resolved configuration checked for layer precedence or public/private separation. */
  const result = await resolveApplicationConfig({
    defaults: { server: { port: 1, devPort: 2 } },
    file: { server: { port: 3 } },
    environment: { server: { port: 4 } },
    overrides: { server: { port: 5 } },
  });
  assert.equal(result.server.port, 5);
  assert.equal(result.server.devPort, 2);
  let calls = 0;
  /** Provider counters proving invalid configuration rejects before resource acquisition. */
  const mocks = {
    database: async () => {
      calls++;
    },
    cache: async () => {
      calls++;
    },
  };
  /** Explicit service definition exercising validation, rollback or generation replacement. */
  const def = defineService({
    name: 'custom:demo',
    namespace: 'demo',
    schema,
    start: () => ({ value: {} }),
  });
  for (const invalid of [
    { unknown: true },
    { server: { port: '3000' } },
    { services: { unknown: {} } },
    config(def, 123),
  ]) {
    await assert.rejects(
      initializeRuntimeServices(invalid, process.cwd(), mocks)
    );
  }
  assert.equal(calls, 0);
});
test('public projection omits credentials and executable options', async () => {
  /** Explicit service definition exercising validation, rollback or generation replacement. */
  const def = defineService({
    name: 'custom:demo',
    namespace: 'demo',
    schema,
    publicFields: ['label'],
    start: () => ({ value: {} }),
  });
  /** Validated settings projection checked without serializing executable private options. */
  const prepared = await prepareConfiguration(config(def));
  assert.equal(prepared.publicConfig.services.demo.label, 'one');
  assert.equal(
    JSON.stringify(prepared.publicConfig).includes('PRIVATE'),
    false
  );
  assert.ok(Object.isFrozen(prepared.publicConfig));
  await assert.rejects(
    prepareConfiguration({ publicSettings: { password: 'private' } })
  );
});
test('cycles precede startup; optional failure rolls back once', async () => {
  let calls = 0;
  /** Rollback receipts proving optional startup failure disposes registered work once. */
  const log = [];
  /** First half of an intentional service dependency cycle rejected before startup. */
  const a = defineService({
    name: 'custom:a',
    namespace: 'a',
    schema,
    dependencies: ['custom:b'],
    start: () => ({ value: {} }),
  });
  /** Second half of the intentional dependency cycle; neither factory may run. */
  const b = defineService({
    name: 'custom:b',
    namespace: 'b',
    schema,
    dependencies: ['custom:a'],
    start: () => ({ value: {} }),
  });
  await assert.rejects(
    initializeRuntimeServices({ serviceDefinitions: [a, b] }, process.cwd(), {
      database: async () => {
        calls++;
      },
    }),
    /cycle/
  );
  assert.equal(calls, 0);
  /** Explicit service definition exercising validation, rollback or generation replacement. */
  const def = defineService({
    name: 'custom:demo',
    namespace: 'demo',
    schema,
    required: false,
    /** Exercise the test-specific service startup and cleanup contract.
     * @param {{onDispose: Function, signal: AbortSignal}} context - Generation cancellation signal and disposer registration used during failed startup.
     * @returns {object | never} Fixture service value/disposer, or the intentional startup failure.
     */
    start({ onDispose, signal }) {
      onDispose(() => {
        assert.equal(signal.aborted, true);
        log.push('rollback');
      });
      throw Error('unavailable');
    },
  });
  /** Service scope owning startup resources and reverse dependency disposal. */
  const scope = await initializeRuntimeServices(
    config(def),
    process.cwd(),
    providers
  );
  assert.equal(
    scope.status().find((s) => s.name === 'custom:demo').state,
    'degraded'
  );
  await scope.close();
  await scope.close();
  assert.deepEqual(log, ['rollback']);
});
test('failed reload preserves previous generation and cleanup is owned', async () => {
  /** Isolated generation root removed after reload and cleanup assertions. */
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'zerux-config-'));
  /** Disposed setting labels distinguishing failed candidates from serving generations. */
  const closed = [];
  /** Explicit service definition exercising validation, rollback or generation replacement. */
  const def = defineService({
    name: 'custom:demo',
    namespace: 'demo',
    schema,
    reloadable: ['label'],
    /** Exercise the test-specific service startup and cleanup contract.
     * @param {{settings: {label: string}, onDispose: Function}} context - Validated settings and generation cleanup registration for reload candidates.
     * @returns {object | never} Fixture service value/disposer, or the intentional startup failure.
     */
    start({ settings, onDispose }) {
      onDispose(() => closed.push(settings.label));
      if (settings.label === 'fail') {
        throw Error('PRIVATE failure');
      }
      return { value: { label: settings.label } };
    },
  });
  let app;
  try {
    app = await createApplicationLifecycle({
      rootDir,
      config: config(def),
      providers,
    });
    await assert.rejects(app.reload(config(def, 'fail')), /PRIVATE failure/);
    assert.equal(app.runtime().serviceScope.get('custom:demo').label, 'one');
    assert.equal(app.status().generation, 1);
    assert.equal(app.status().lastError.includes('PRIVATE'), false);
    await assert.rejects(
      app.reload({ ...config(def), server: { port: 42 } }),
      RestartRequiredError
    );
    await app.reload(config(def, 'two'));
    assert.equal(app.runtime().serviceScope.get('custom:demo').label, 'two');
    await app.close();
    await app.close();
    assert.deepEqual(closed, ['fail', 'one', 'two']);
    await assert.rejects(app.reload(config(def)));
  } finally {
    await app?.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
test('custom dependencies acquire in order and dispose dependents first', async () => {
  /** Ordered dependent-service startup and disposal receipts. */
  const events = [];
  /** Declared base dependency returning a fixture value and owned disposer. */
  const base = defineService({
    name: 'custom:base',
    namespace: 'base',
    schema,
    /** Exercise the test-specific service startup and cleanup contract.
     * @returns {object | never} Fixture service value/disposer, or the intentional startup failure.
     */
    start() {
      events.push('base');
      return {
        value: { id: 1 },
        /** Record generation cleanup so reverse dependency order can be asserted.
         * @returns {void} Appends one fixture disposal receipt.
         */
        dispose() {
          events.push('close base');
        },
      };
    },
  });
  /** Consumer allowed to read only its declared dependency and disposed before that base. */
  const dependent = defineService({
    name: 'custom:demo',
    namespace: 'demo',
    schema,
    dependencies: ['custom:base'],
    /** Exercise the test-specific service startup and cleanup contract.
     * @param {{get: Function}} context - Dependency resolver restricted to this service definition.
     * @returns {object | never} Fixture service value/disposer, or the intentional startup failure.
     */
    start({ get }) {
      assert.equal(get('custom:base').id, 1);
      assert.throws(() => get('cache'), /Undeclared/);
      events.push('demo');
      return {
        value: {},
        /** Record generation cleanup so reverse dependency order can be asserted.
         * @returns {void} Appends one fixture disposal receipt.
         */
        dispose() {
          events.push('close demo');
        },
      };
    },
  });
  /** Service scope owning startup resources and reverse dependency disposal. */
  const scope = await initializeRuntimeServices(
    {
      serviceDefinitions: [dependent, base],
      services: {
        demo: { settings: { label: 'd' } },
        base: { settings: { label: 'b' } },
      },
    },
    process.cwd(),
    providers
  );
  await scope.close();
  assert.deepEqual(events, ['base', 'demo', 'close demo', 'close base']);
});
test('database execution policy validates before framework provider initialization', async () => {
  let calls = 0;
  await assert.rejects(
    initializeRuntimeServices(
      { db: { execution: { maxPending: 0 } } },
      process.cwd(),
      {
        database: async () => {
          calls++;
        },
      }
    )
  );
  assert.equal(calls, 0);
  /** Service scope owning startup resources and reverse dependency disposal. */
  const scope = await initializeRuntimeServices(
    {
      db: {
        execution: {
          maxPending: 2,
          maxBatch: 2 /** Inert metric callback that must remain private after policy validation.
           * @returns {void} No telemetry is emitted.
           */,
          onMetric() {},
        },
      },
    },
    process.cwd(),
    {
      ...providers,
      database: async (config) => {
        assert.equal(config.db.execution.maxPending, 2);
        return null;
      },
    }
  );
  assert.equal(
    JSON.stringify(scope.publicConfig()).includes('onMetric'),
    false
  );
  await scope.close();
});

test('cache policy validates before providers and preserves owner-scoped policy', async () => {
  let calls = 0;
  /** Provider counters proving invalid configuration rejects before resource acquisition. */
  const mocks = {
    database: async () => {
      calls++;
    },
    cache: async () => {
      calls++;
    },
  };
  for (const policy of [
    { maxBulk: 0 },
    { maxDepth: 100 },
    { requireCapabilities: ['invented'] },
    { ownHelper: 'false' },
    { unknown: true },
  ]) {
    await assert.rejects(
      initializeRuntimeServices(
        { cache: { connector: 'memory', policy } },
        process.cwd(),
        mocks
      )
    );
  }
  for (const cache of [
    { connector: 'memory', defaultTtlSeconds: 0 },
    { connector: 'memory', prefix: 123 },
  ]) {
    await assert.rejects(
      initializeRuntimeServices({ cache }, process.cwd(), mocks)
    );
  }
  assert.equal(calls, 0);
  /** Validated settings projection checked without serializing executable private options. */
  const prepared = await prepareConfiguration({
    cache: {
      connector: 'memory',
      policy: { maxBulk: 10, requireCapabilities: ['conditionalWrites'] },
    },
  });
  assert.equal(prepared.config.cache.policy.maxBulk, 10);
});
test('private development watch directories validate before startup and stay out of public config', async () => {
  /** Resolved configuration checked for layer precedence or public/private separation. */
  const result = await prepareConfiguration({
    server: { port: 3010, watchIgnoredPaths: ['.workspace', 'private/cache'] },
  });
  assert.deepEqual({ ...result.publicConfig.server }, { port: 3010 });
  for (const watchIgnoredPaths of [
    ['../secret'],
    ['/absolute'],
    ['foo//bar'],
    'all',
    Array.from({ length: 65 }, () => '.private'),
  ]) {
    await assert.rejects(
      prepareConfiguration({ server: { watchIgnoredPaths } })
    );
  }
});

test('direct HTTP is explicitly configured and does not enter the public config', async () => {
  /** Validated settings projection checked without serializing executable private options. */
  const prepared = await prepareConfiguration({
    server: { portless: false, port: 3010 },
  });
  assert.equal(prepared.config.server.portless, false);
  assert.equal(prepared.publicConfig.server.portless, undefined);
  await assert.rejects(
    prepareConfiguration({ server: { portless: 'false' } }),
    /INVALID_PORTLESS_OPTION/
  );
});
