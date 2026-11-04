import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElasticSearchAdapter, createElasticSearchFactory, ElasticBulkError, ElasticConflictError } from '@zeruxjs/search-elastic';
import { registerSearchService } from '@zeruxjs/search/adapters';
const hash = value => createHash('sha256').update(value).digest('hex');
const call = (tenant = 'shop-a') => ({ tenant, signal: new AbortController().signal, deadline: Date.now() + 5000 });
function fixture(extra = {}) {
  const requests = [], client = {
    info: async () => ({ version: { number: '9.5.1' } }),
    search: async (params, control) => { requests.push({ kind: 'search', params, control }); return { hits: { hits: [{ _source: { _zxTenant: hash('shop-a'), id: '1', text: 'safe', category: 'book', price: 4 }, _score: 1 }], total: { value: 1, relation: 'eq' } }, timed_out: false, _shards: { failed: 0 } }; },
    bulk: async (params, control) => { requests.push({ kind: 'bulk', params, control }); return { errors: false, items: params.operations.filter(p => p.index || p.delete).map(p => p.delete ? { delete: { status: 200 } } : { index: { status: 201 } }) }; },
    index: async (params, control) => { requests.push({ kind: 'index', params, control }); return {}; },
    get: async () => ({ _source: { _zxTenant: hash('shop-a'), id: '1', text: 'safe' }, _seq_no: 1, _primary_term: 2 }),
    indices: { getMapping: async () => ({ 'shop-v1': { mappings: { dynamic: 'strict', properties: { _zxTenant: { type: 'keyword' }, id: { type: 'keyword' }, text: { type: 'text' }, category: { type: 'keyword' }, price: { type: 'double' } } } } }), create: async (params) => { requests.push({ kind: 'create', params }); } },
    close: async () => requests.push({ kind: 'close' }), ...extra,
  };
  return { client, requests, options: { client, index: 'shop-v1', fields: { category: 'keyword', price: 'double' } } };
}
test('structured translation pins tenant independently; writes/deletes namespace IDs; borrowed ownership', async () => {
  const f = fixture(), adapter = await createElasticSearchAdapter(f.options);
  try {
    const page = await adapter.search({ text: 'x OR *:*', limit: 2, offset: 4, sort: { field: 'price', direction: 'desc' }, filters: [{ field: 'category', operator: 'in', value: ['book'] }, { field: 'price', operator: 'gte', value: 2 }] }, call());
    assert.equal(page.coverage, 'exact'); assert.equal(page.hits[0].document._zxTenant, undefined);
    const request = f.requests[0]; assert.equal(request.params.query.bool.filter[0].term._zxTenant, hash('shop-a'));
    assert.deepEqual(request.params.query.bool.filter[1], { terms: { category: ['book'] } });
    assert.equal(request.params.query.bool.must[0].match.text.query, 'x OR *:*');
    assert.deepEqual(request.params.sort, [{ price: 'desc' }, { id: 'asc' }]); assert.equal(request.control.maxRetries, 0);
    await adapter.index([{ id: '1', text: 'safe', price: 2 }], call());
    await adapter.delete(['1'], call('shop-b'));
    assert.notEqual(f.requests[1].params.operations[0].index._id, f.requests[2].params.operations[0].delete._id);
    assert.equal(f.requests[1].params.operations[1]._zxTenant, hash('shop-a'));
    await adapter.ensureIndex(call());
    const mappings = f.requests.at(-1).params.mappings; assert.equal(mappings.dynamic, 'strict'); assert.equal(mappings.properties._zxTenant.type, 'keyword');
    assert.equal((await adapter.getVersion('1', call())).version.seqNo, 1);
    await adapter.replaceIfVersion({ id: '1', text: 'replacement' }, { seqNo: 1, primaryTerm: 2 }, call());
    assert.equal(f.requests.at(-1).params.if_primary_term, 2);
  } finally { await adapter.close(); }
  assert(!f.requests.some(r => r.kind === 'close'));
  await assert.rejects(adapter.health(call()), { code: 'CLOSED' });
});
test('direct adapter rejects unsafe runtime shapes, reserved tenant fields, DSL, limits and unsupported filters', async () => {
  const f = fixture(), adapter = await createElasticSearchAdapter(f.options);
  try {
    for (const q of [ { text: 'x', query: { match_all: {} } }, { text: 'x', filters: [{ field: '_zxTenant', operator: 'eq', value: 'other' }] }, { text: 'x', filters: [{ field: 'category', operator: 'contains', value: 'a' }] }, { text: 'x', filters: [{ field: 'category', operator: 'eq', value: null }] }, { text: 'x', filters: [{ field: 'category', operator: 'eq', value: 'A', caseSensitive: false }] }, { text: '', offset: 10000 } ]) await assert.rejects(adapter.search(q, call()));
    await assert.rejects(adapter.index([{ id: '1', text: 'x', _zxTenant: 'forged' }], call()));
    await assert.rejects(adapter.index([{ id: '1', text: 'x', price: Number.MAX_SAFE_INTEGER + 1 }], call()));
    await assert.rejects(adapter.index(Array(101).fill({ id: '1', text: 'x' }), call()), { code: 'LIMIT' });
    let read = false; const doc = { id: 'x', get text() { read = true; return 'x'; } };
    await assert.rejects(adapter.index([doc], call())); assert.equal(read, false);
    assert.equal(f.requests.length, 0);
  } finally { await adapter.close(); }
  for (const index of ['*', 'a,b', '../x', 'UPPER']) await assert.rejects(createElasticSearchAdapter({ ...f.options, index }));
  await assert.rejects(createElasticSearchAdapter({ index: 'safe', endpoint: 'http://localhost:9200', allowedEndpoints: ['http://localhost:9200'], auth: { apiKey: 'x' } }));
});
test('partial bulk errors expose positions/counts without documents or native errors; never replay', async () => {
  let calls = 0;
  const f = fixture({ bulk: async () => { calls++; return { errors: true, items: [{ index: { status: 201 } }, { index: { status: 429, error: { reason: 'private document secret' } } }] }; } });
  const adapter = await createElasticSearchAdapter(f.options);
  try { await assert.rejects(adapter.index([{ id: '1', text: 'x' }, { id: '2', text: 'private' }], call()), e => e instanceof ElasticBulkError && e.succeeded === 1 && e.failures[0].position === 1 && !JSON.stringify(e).includes('private')); assert.equal(calls, 1); } finally { await adapter.close(); }
});
test('tenant mismatch fails closed, unsupported versions reject, backend errors/conflicts redact', async () => {
  const f = fixture(), adapter = await createElasticSearchAdapter(f.options);
  try { await assert.rejects(adapter.search({ text: 'x' }, call('other')), { code: 'DENIED' }); } finally { await adapter.close(); }
  await assert.rejects(createElasticSearchAdapter(fixture({ info: async () => ({ version: { number: '8.19.0' } }) }).options), { code: 'UNSUPPORTED' });
  const bad = await createElasticSearchAdapter(fixture({ index: async () => { throw { meta: { statusCode: 409 } }; }, search: async () => { throw Error('API key secret'); } }).options);
  try {
    await assert.rejects(bad.replaceIfVersion({ id: '1', text: 'x' }, { seqNo: 1, primaryTerm: 1 }, call()), ElasticConflictError);
    await assert.rejects(bad.search({ text: 'x' }, call()), e => e.code === 'UNAVAILABLE' && !e.message.includes('secret'));
  } finally { await bad.close(); }
});
test('cancellation retains native slot and close waits for actual borrowed settlement', async () => {
  let finish, signal;
  const f = fixture({ search: async (_, request) => { signal = request.signal; return new Promise(r => { finish = r; }); } });
  const adapter = await createElasticSearchAdapter({ ...f.options, maxPending: 1 });
  const ctrl = new AbortController(), work = adapter.search({ text: 'x' }, { ...call(), signal: ctrl.signal });
  await new Promise(r => setImmediate(r)); ctrl.abort(); assert(signal.aborted);
  await assert.rejects(adapter.health(call()), { code: 'LIMIT' });
  let closed = false; const closing = adapter.close().then(() => { closed = true; });
  await new Promise(r => setImmediate(r)); assert.equal(closed, false);
  finish({ hits: { hits: [], total: { value: 0, relation: 'eq' } }, timed_out: false, _shards: { failed: 0 } });
  await assert.rejects(work, { code: 'CANCELLED' }); await closing;
});
test('neutral registration consumes adapter without engine-specific config leaking', async () => {
  const f = fixture(); const registration = registerSearchService({ factories: { elastic: async () => createElasticSearchAdapter(f.options) }, connections: [{ name: 'catalog', backend: 'elastic', requirePersistent: true }], authorize: ctx => ctx === 'verified' ? { tenant: 'shop-a' } : null });
  const services = await registration.start();
  try { assert.equal((await services.search('catalog', 'verified', { text: 'x' })).hits.length, 1); await assert.rejects(services.search('catalog', 'forged', { text: 'x' }), { code: 'DENIED' }); } finally { await services.close(); }
  assert.equal(typeof createElasticSearchFactory({ index: 'shop-v1' }), 'function');
});

test('incompatible mappings reject before bulk dispatch', async () => {
  let writes = 0; const f = fixture({ bulk: async () => { writes++; } });
  f.client.indices.getMapping = async () => ({ 'shop-v1': { mappings: { dynamic: true, properties: {} } } });
  const adapter = await createElasticSearchAdapter(f.options);
  try { await assert.rejects(adapter.index([{ id: '1', text: 'x' }], call()), { code: 'UNSUPPORTED' }); assert.equal(writes, 0); } finally { await adapter.close(); }
});

test('factory schema snapshots reject accessors without executing them', () => {
  let read = false; const fields = {};
  Object.defineProperty(fields, 'category', { enumerable: true, get() { read = true; return 'keyword'; } });
  assert.throws(() => createElasticSearchFactory({ index: 'shop-v1', fields }), { code: 'INVALID' });
  assert.equal(read, false);
});
