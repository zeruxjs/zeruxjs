import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createServiceScope,
  initializeRuntimeServices,
} from '../dist/bootstrap/services.js';

/** Create isolated injected service factories and their ordered disposal log.
 * @returns {object} Fixture providers and log; no external resources are opened.
 */
const suite = () => {
  /** Ordered synthetic service teardown receipts used to verify reverse dependency order. */
  const log = [];
  /** Build one inert named provider factory.
   * @param {string} name - Service label recorded during cleanup.
   * @returns {Function} Async provider returning a named fixture owner.
   */
  const create = (name) => async () => ({
    name,
    close: async () => {
      log.push('close ' + name);
    },
  });
  /** Injected service factories whose values and cleanup belong to the test generation. */
  const providers = {
    database: create('database'),
    cache: create('cache'),
    files: create('files'),
    analytics: async () => ({
      track: async () => undefined,
      status: () => ({}),
      close: () => log.push('close analytics'),
    }),
    email: create('email'),
  };
  return { log, providers };
};

test('multiple services initialize in dependency order, access through scoped names and clean up in reverse order', async () => {
  /** Isolated provider fixture and its ordered cleanup receipts. */
  const { log, providers } = suite();
  providers.analytics = async (config, db) => {
    assert.equal(db?.name, 'database');
    return { close: () => log.push('close analytics') };
  };
  providers.email = async (config, files, analytics) => {
    assert.equal(files?.name, 'files');
    assert.ok(analytics);
    return { name: 'email', close: () => log.push('close email') };
  };
  /** Private service configuration consumed by initialization without public credential exposure. */
  const config = {
    files: { stores: [{ name: 'media', type: 'local' }] },
    email: { accounts: [{}] },
    analytics: { analytics: 'reporting' },
  };
  /** Owned service generation closed after dependency and rollback assertions. */
  const scope = await initializeRuntimeServices(
    config,
    process.cwd(),
    providers
  );
  assert.equal(scope.get('files').name, 'files');
  assert.deepEqual(
    scope.status().map((s) => s.state),
    Array(5).fill('ready')
  );
  assert.equal(config.email, undefined);
  assert.equal(config.files, undefined);
  assert.equal(config.analytics, undefined);
  await Promise.all([scope.close(), scope.close()]);
  assert.deepEqual(log, [
    'close email',
    'close analytics',
    'close files',
    'close cache',
    'close database',
  ]);
});

test('partially initialized resources rollback if required service fails', async () => {
  /** Isolated provider fixture and its ordered cleanup receipts. */
  const { log, providers } = suite();
  providers.email = async () => {
    throw Error('SMTP config invalid');
  };
  await assert.rejects(
    initializeRuntimeServices(
      { email: { accounts: [{}] }, files: { stores: [] } },
      process.cwd(),
      providers
    ),
    /SMTP config invalid/
  );
  assert.deepEqual(log, ['close files', 'close cache', 'close database']);
});

test('missing analytics cannot interrupt startup and email remains usable', async () => {
  /** Isolated provider fixture and its ordered cleanup receipts. */
  const { log, providers } = suite();
  providers.analytics = async () => {
    throw new Error('database down');
  };
  providers.email = async (config, files, analytics) => {
    assert.equal(analytics, undefined);
    return { close: () => log.push('close email') };
  };
  /** Original warning sink restored after the optional analytics failure check. */
  const originalWarn = console.warn;
  /** Captured diagnostics proving an optional analytics outage remains bounded. */
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };
  try {
    /** Owned service generation closed after dependency and rollback assertions. */
    const scope = await initializeRuntimeServices(
      { analytics: { analytics: 'reporting' }, email: { accounts: [{}] } },
      process.cwd(),
      providers
    );
    assert.equal(scope.get('analytics'), undefined);
    assert.equal(
      scope.status().find((s) => s.name === 'analytics').state,
      'degraded'
    );
    assert.ok(scope.get('email'));
    assert.equal(warnings.length, 1);
    await scope.close();
  } finally {
    console.warn = originalWarn;
  }
});

test('scope closes all services even if first cleanup rejects', async () => {
  /** Owned service generation closed after dependency and rollback assertions. */
  const scope = createServiceScope();
  let cleaned = false;
  scope.add('files', {}, () => {
    cleaned = true;
  });
  scope.add('email', {}, () => {
    throw Error('failed transport close');
  });
  await assert.rejects(scope.close(), AggregateError);
  assert.equal(cleaned, true);
  await assert.rejects(scope.close(), AggregateError);
});

test('disabled services and duplicate registrations are reported clearly', async () => {
  /** Owned service generation closed after dependency and rollback assertions. */
  const scope = createServiceScope();
  scope.add('files', null);
  scope.add('email', {});
  assert.equal(
    scope.status().find((s) => s.name === 'files').state,
    'disabled'
  );
  assert.throws(() => scope.add('email', {}), /Duplicate/);
  await scope.close();
  assert.throws(() => scope.add('cache', {}), /closed/);
});
