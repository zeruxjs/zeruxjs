import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceScope, initializeRuntimeServices } from '../dist/bootstrap/services.js';

const suite = () => {
  const log = [];
  const create = name => async () => ({ name, close: async () => { log.push('close ' + name); } });
  const providers = {
    database: create('database'), cache: create('cache'), files: create('files'),
    analytics: async () => ({ track: async () => undefined, status: () => ({}), close: () => log.push('close analytics') }),
    email: create('email')
  };
  return { log, providers };
};

test('multiple services initialize in dependency order, access through scoped names and clean up in reverse order', async () => {
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
  const config = { files: { stores: [{ name: 'media', type: 'local' }] }, email: { accounts: [{}] }, analytics: { analytics: 'reporting' } };
  const scope = await initializeRuntimeServices(config, process.cwd(), providers);
  assert.equal(scope.get('files').name, 'files');
  assert.deepEqual(scope.status().map(s => s.state), Array(5).fill('ready'));
  assert.equal(config.email, undefined);
  assert.equal(config.files, undefined);
  assert.equal(config.analytics, undefined);
  await Promise.all([scope.close(), scope.close()]);
  assert.deepEqual(log, ['close email', 'close analytics', 'close files', 'close cache', 'close database']);
});

test('partially initialized resources rollback if required service fails', async () => {
  const { log, providers } = suite();
  providers.email = async () => { throw Error('SMTP config invalid'); };
  await assert.rejects(initializeRuntimeServices({ email: { accounts: [{}] }, files: { stores: [] } }, process.cwd(), providers), /SMTP config invalid/);
  assert.deepEqual(log, ['close files', 'close cache', 'close database']);
});

test('missing analytics cannot interrupt startup and email remains usable', async () => {
  const { log, providers } = suite();
  providers.analytics = async () => { throw new Error('database down'); };
  providers.email = async (config, files, analytics) => { assert.equal(analytics, undefined); return { close: () => log.push('close email') }; };
  const originalWarn = console.warn; const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const scope = await initializeRuntimeServices({ analytics: { analytics: 'reporting' }, email: { accounts: [{}] } }, process.cwd(), providers);
    assert.equal(scope.get('analytics'), undefined);
    assert.equal(scope.status().find(s => s.name === 'analytics').state, 'degraded');
    assert.ok(scope.get('email'));
    assert.equal(warnings.length, 1);
    await scope.close();
  } finally { console.warn = originalWarn; }
});

test('scope closes all services even if first cleanup rejects', async () => {
  const scope = createServiceScope(); let cleaned = false;
  scope.add('files', {}, () => { cleaned = true; });
  scope.add('email', {}, () => { throw Error('failed transport close'); });
  await assert.rejects(scope.close(), AggregateError);
  assert.equal(cleaned, true);
  await assert.rejects(scope.close(), AggregateError);
});

test('disabled services and duplicate registrations are reported clearly', async () => {
  const scope = createServiceScope();
  scope.add('files', null);
  scope.add('email', {});
  assert.equal(scope.status().find(s => s.name === 'files').state, 'disabled');
  assert.throws(() => scope.add('email', {}), /Duplicate/);
  await scope.close();
  assert.throws(() => scope.add('cache', {}), /closed/);
});
