import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchServices, registerSearchService, createLocalSearchFactory } from '@zeruxjs/search/adapters';
const local = () => ({ factories: { local: createLocalSearchFactory({ maxTenants: 2, maxDocumentsPerTenant: 10 }) }, connections: [{ name: 'catalog', backend: 'local' }], authorize: (context) => context?.verified ? { tenant: context.tenant } : null });
const identity = tenant => ({ verified: true, tenant });
const caps = { tenantIsolation: true, durability: 'persistent', consistency: 'eventual', filters: ['eq'], sort: [], mutations: ['index'], pagination: 'offset' };
const fixture = overrides => ({ capabilities: caps, search: async () => ({ hits: [], coverage: 'exact' }), index: async () => ({ state: 'accepted', taskId: 'opaque' }), health: async () => 'ready', close() {}, ...overrides });
const remote = factory => ({ factories: { remote: factory }, connections: [{ name: 'catalog', backend: 'remote', endpoint: 'https://search.example/index', allowedEndpoints: ['https://search.example/index'], credentials: { password: 'private' } }], authorize: () => ({ tenant: 'verified' }) });

test('local compatibility, physical tenant isolation, staged writes, unsupported operations, close', async () => {
  const service = await createSearchServices(local());
  try {
    await service.mutate('catalog', identity('a'), 'index', [{ id: '1', text: 'hello', tenant: 'b' }]);
    assert.equal((await service.search('catalog', identity('a'), { text: 'hello' })).hits.length, 1);
    assert.equal((await service.search('catalog', identity('b'), { text: 'hello' })).hits.length, 0);
    await assert.rejects(service.search('catalog', { tenant: 'a' }, { text: 'hello' }), { code: 'DENIED' });
    assert.throws(() => service.search('catalog', identity('a'), { text: 'hello', tenant: 'a' }), { code: 'INVALID' });
    assert.throws(() => service.search('catalog', identity('a'), { text: 'hello', sort: { field: 'id', direction: 'asc' } }), { code: 'UNSUPPORTED' });
    assert.throws(() => service.mutate('catalog', identity('a'), 'index', [{ id: '2', text: 'safe' }, { id: '3', text: 'bad', n: Infinity }]));
    assert.equal((await service.search('catalog', identity('a'), { text: 'safe' })).hits.length, 0);
    await service.mutate('catalog', identity('a'), 'delete', ['1']);
    assert.equal((await service.search('catalog', identity('a'), { text: 'hello' })).hits.length, 0);
  } finally { await service.close(); }
  assert.throws(() => service.health('catalog'), { code: 'CLOSED' });
});

test('capabilities and endpoint policy reject before dispatch; persistent requirements deny local selection', async () => {
  const options = local(); options.connections[0].requirePersistent = true;
  await assert.rejects(createSearchServices(options), { code: 'UNSUPPORTED' });
  let calls = 0;
  const denied = remote(async () => { calls++; return fixture(); });
  denied.connections[0].endpoint = 'https://attacker.example/';
  await assert.rejects(createSearchServices(denied), { code: 'DENIED' });
  assert.equal(calls, 0);
  const service = await createSearchServices(remote(async () => fixture({ search() { calls++; throw Error('must not dispatch'); } })));
  try { assert.throws(() => service.search('catalog', {}, { text: 'x', filters: [{ field: 'id', operator: 'prefix', value: 'a' }] }), { code: 'UNSUPPORTED' }); } finally { await service.close(); }
  assert.equal(calls, 0);
});

test('backend errors are redacted and accepted task receipts do not imply completion', async () => {
  const service = await createSearchServices(remote(async () => fixture({ search: async () => { throw Error('password=private'); } })));
  try {
    await assert.rejects(service.search('catalog', {}, { text: 'x' }), e => e.code === 'UNAVAILABLE' && !e.message.includes('private') && e.cause.message.includes('private'));
    assert.deepEqual(await service.mutate('catalog', {}, 'index', [{ id: '1', text: 'x' }]), { state: 'accepted', taskId: 'opaque' });
  } finally { await service.close(); }
});

test('cancelled writes retain slot, signal and cleanup until native settlement; no replay', async () => {
  let settle, nativeSignal, writes = 0, closes = 0;
  const options = remote(async () => fixture({ index: async (_, call) => { writes++; nativeSignal = call.signal; return new Promise(r => { settle = r; }); }, close() { closes++; } })); options.maxPending = 1;
  const service = await createSearchServices(options), abort = new AbortController();
  const write = service.mutate('catalog', {}, 'index', [{ id: '1', text: 'x' }], { signal: abort.signal });
  await new Promise(r => setImmediate(r)); abort.abort();
  await assert.rejects(write, { code: 'CANCELLED', outcome: 'unknown' });
  assert.equal(nativeSignal.aborted, true);
  await assert.rejects(service.health('catalog'), { code: 'LIMIT' });
  const closing = service.close(); await new Promise(r => setImmediate(r)); assert.equal(closes, 0);
  settle({ state: 'completed' }); await closing;
  assert.equal(closes, 1); assert.equal(writes, 1);
});

test('startup rollback owns late factory settlement after deadline and closes prior resources', async () => {
  const closed = [];
  const options = remote(async () => fixture({ close() { closed.push('first'); } }));
  options.factories.slow = async () => { await new Promise(r => setTimeout(r, 25)); return fixture({ close() { closed.push('late'); } }); };
  options.connections.push({ name: 'late', backend: 'slow' }); options.timeoutMs = 10;
  await assert.rejects(createSearchServices(options), { code: 'DEADLINE' });
  assert.deepEqual(closed, ['late', 'first']);
});

test('registration snapshots selection and limits tenant cardinality', async () => {
  const options = local(), registration = registerSearchService(options);
  options.connections[0].backend = 'attacker';
  const service = await registration.start();
  try {
    for (const tenant of ['a', 'b']) await service.mutate('catalog', identity(tenant), 'index', [{ id: '1', text: 'x' }]);
    await assert.rejects(service.mutate('catalog', identity('c'), 'index', [{ id: '1', text: 'x' }]), { code: 'LIMIT' });
  } finally { await service.close(); }
});

test('startup rollback failures stay explicit and preserve both private causes', async () => {
  const options = remote(async () => fixture({ close() { throw Error('private close detail'); } }));
  options.factories.failed = async () => { throw Error('private startup detail'); };
  options.connections.push({ name: 'failed', backend: 'failed' });
  await assert.rejects(createSearchServices(options), error => error.code === 'UNAVAILABLE' && error.outcome === 'unknown' && !error.message.includes('private') && error.cause instanceof AggregateError && error.cause.errors.length === 2);
});
