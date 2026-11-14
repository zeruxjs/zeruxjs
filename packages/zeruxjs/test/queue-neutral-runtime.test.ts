import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeRuntimeServices } from '../dist/bootstrap/services.js';
import { prepareConfiguration } from '../dist/bootstrap/config-validation.js';
import { selectQueueBackend } from '@zeruxjs/queue/neutral';
import { memcacheQBackend } from '@zeruxjs/queue/backends';
/** Create synthetic dependency owners for queue rollback checks.
 * @param {string[]} log - Ordered disposal receipts.
 * @returns {object} Database and cache provider fixtures.
 */
const providers = (log) => ({
  database: async () => ({
    /** Record the injected backend or dependency close without external broker work.
     * @returns {void} Appends one ordered fixture cleanup receipt.
     */
    close() {
      log.push('database');
    },
  }),
  cache: async () => ({
    /** Record the injected backend or dependency close without external broker work.
     * @returns {void} Appends one ordered fixture cleanup receipt.
     */
    close() {
      log.push('cache');
    },
  }),
});
test('explicit registered backend starts through real framework selection, stays private and closes before dependencies', async () => {
  /** Ordered backend/dependency cleanup receipts isolated to this test. */
  const log = [];
  let opened = 0;
  /** Explicit allowlisted backend factory; fixture methods never contact a broker. */
  const factory = memcacheQBackend(
    (options) => {
      assert.equal(options.host, 'private-host');
      opened++;
      return {
        /** Accept a synthetic job to exercise framework selection rather than broker delivery.
         * @returns {Promise<void>} No broker acceptance or persistence is implied.
         */
        async add() {
          return;
        },
        /** Return an empty synthetic queue without destructive network reads.
         * @returns {Promise<void>} No message is available in this fixture.
         */
        async take() {},
        /** Record the injected backend or dependency close without external broker work.
         * @returns {void} Appends one ordered fixture cleanup receipt.
         */
        close() {
          log.push('worker');
        },
      };
    },
    ['jobs']
  );
  /** Private factory selection preserving the requested provider options. */
  const selection = selectQueueBackend(factory, { host: 'private-host' });
  /** Validated configuration checked for secret-free public projection. */
  const prepared = await prepareConfiguration({
    queue: { enabled: true, selection },
  });
  assert.equal(prepared.config.queue.selection.factory, factory);
  assert.doesNotMatch(
    JSON.stringify(prepared.publicConfig),
    /private-host|factory|queue/
  );
  /** Generation owner responsible for queue drain before dependent services close. */
  const scope = await initializeRuntimeServices(
    { queue: { enabled: true, required: true, selection } },
    process.cwd(),
    providers(log)
  );
  /** Borrowed selected queue instance exposed only while its generation is active. */
  const service = scope.get('queue');
  await service.publish('jobs', 'task', {});
  assert.equal(service.name, 'memcacheq');
  assert.ok(service.extension(factory));
  assert.equal(opened, 1);
  await scope.close();
  await scope.close();
  assert.deepEqual(log, ['worker', 'cache', 'database']);
});
test('invalid unknown options are rejected before database/cache factories, even for optional service', async () => {
  let calls = 0;
  /** Explicit allowlisted backend factory; fixture methods never contact a broker. */
  const factory = memcacheQBackend(() => {
    calls++;
    throw Error('must not open');
  }, ['jobs']);
  /** Counters proving invalid selection/options reject before any resource factory starts. */
  const p = {
    database: async () => {
      calls++;
    },
    cache: async () => {
      calls++;
    },
  };
  for (const queue of [
    { enabled: true, selection: { factory, options: { unknown: 'SECRET' } } },
    {
      enabled: true,
      selection: { factory, options: {}, requireCapabilities: ['scheduler'] },
    },
    {
      enabled: true,
      selection: { factory, options: {} },
      redis: { password: 'SECRET' },
    },
  ]) {
    await assert.rejects(
      initializeRuntimeServices({ queue }, process.cwd(), p),
      (error) => !error.message.includes('SECRET')
    );
  }
  assert.equal(calls, 0);
});
test('required partial startup rolls back in reverse order; optional backend failures log no secret details', async () => {
  /** Ordered backend/dependency cleanup receipts isolated to this test. */
  const log = [];
  /** Validated backend capability definition reused by the intentional startup-failure factory. */
  const base = memcacheQBackend(() => {
    throw Error('unused');
  }, ['jobs']);
  /** Explicit allowlisted backend factory; fixture methods never contact a broker. */
  const factory = {
    ...base,
    /** Register partial backend cleanup and fail startup with a private cause.
     * @param {object} _options - Unused already validated provider options.
     * @param {object} scope - Backend startup scope retaining the channel cleanup.
     * @returns {never} Always throws the intentional private startup failure.
     */
    open(_options, scope) {
      scope.onCleanup(() => log.push('channel'));
      throw Error('SECRET url/password');
    },
  };
  await assert.rejects(
    initializeRuntimeServices(
      {
        queue: {
          enabled: true,
          required: true,
          selection: { factory, options: {} },
        },
      },
      process.cwd(),
      providers(log)
    ),
    (error) =>
      error.code === 'START_FAILED' && !error.message.includes('SECRET')
  );
  assert.deepEqual(log, ['channel', 'cache', 'database']);
  log.length = 0;
  /** Captured optional-startup diagnostics checked for secret redaction. */
  const warnings = [];
  /** Original warning sink restored even if a rollback assertion fails. */
  const saved = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    /** Generation owner responsible for queue drain before dependent services close. */
    const scope = await initializeRuntimeServices(
      { queue: { enabled: true, selection: { factory, options: {} } } },
      process.cwd(),
      providers(log)
    );
    assert.equal(
      scope.status().find((s) => s.name === 'queue').state,
      'degraded'
    );
    assert.ok(scope.errors().has('queue'));
    await scope.close();
    assert.doesNotMatch(warnings.join(' '), /SECRET|password/);
    assert.deepEqual(log, ['channel', 'cache', 'database']);
  } finally {
    console.warn = saved;
  }
});
