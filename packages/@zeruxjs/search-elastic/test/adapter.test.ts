import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createElasticSearchAdapter,
  createElasticSearchFactory,
  ElasticBulkError,
  ElasticConflictError,
} from '@zeruxjs/search-elastic';
import { registerSearchService } from '@zeruxjs/search/adapters';
/** Reproduce the public tenant namespace encoding for synthetic response assertions.
 * @param {string} value - Literal fixture tenant.
 * @returns {string} Hexadecimal SHA-256 namespace.
 */
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** Create an explicit fixture tenant scope with cooperative signal and finite deadline.
 * @param {string} tenant - Verified fixture tenant; defaults to shop-a where declared.
 * @returns {object} Independent bounded call scope.
 */
const call = (tenant = 'shop-a') => ({
  tenant,
  signal: new AbortController().signal,
  deadline: Date.now() + 5000,
});
/** Build a controlled borrowed-client fixture without network access.
 * @param {object} extra - Explicit synthetic method overrides.
 * @returns {object} Client, request ledger and compatible wrapper configuration.
 */
function fixture(extra = {}) {
  /** Synthetic native-call ledger; fixed assertion data only, never a real engine log. */
  const requests = [];
  /** Injected synthetic client; its lifetime remains with the fixture, not the adapter. */
  const client = {
    info: async () => ({ version: { number: '9.5.1' } }),
    search: async (params, control) => {
      requests.push({ kind: 'search', params, control });
      return {
        hits: {
          hits: [
            {
              _source: {
                _zxTenant: hash('shop-a'),
                id: '1',
                text: 'safe',
                category: 'book',
                price: 4,
              },
              _score: 1,
            },
          ],
          total: { value: 1, relation: 'eq' },
        },
        timed_out: false,
        _shards: { failed: 0 },
      };
    },
    bulk: async (params, control) => {
      requests.push({ kind: 'bulk', params, control });
      return {
        errors: false,
        items: params.operations
          .filter((p) => p.index || p.delete)
          .map((p) =>
            p.delete ? { delete: { status: 200 } } : { index: { status: 201 } }
          ),
      };
    },
    index: async (params, control) => {
      requests.push({ kind: 'index', params, control });
      return {};
    },
    get: async () => ({
      _source: { _zxTenant: hash('shop-a'), id: '1', text: 'safe' },
      _seq_no: 1,
      _primary_term: 2,
    }),
    indices: {
      getMapping: async () => ({
        'shop-v1': {
          mappings: {
            dynamic: 'strict',
            properties: {
              _zxTenant: { type: 'keyword' },
              id: { type: 'keyword' },
              text: { type: 'text' },
              category: { type: 'keyword' },
              price: { type: 'double' },
            },
          },
        },
      }),
      create: async (params) => {
        requests.push({ kind: 'create', params });
      },
    },
    close: async () => requests.push({ kind: 'close' }),
    ...extra,
  };
  return {
    client,
    requests,
    options: {
      client,
      index: 'shop-v1',
      fields: { category: 'keyword', price: 'double' },
    },
  };
}
test('structured translation pins tenant independently; writes/deletes namespace IDs; borrowed ownership', async () => {
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture();
  /** Owned adapter wrapper; teardown drains it without closing its borrowed fixture client. */
  const adapter = await createElasticSearchAdapter(f.options);
  try {
    /** Validated independent result page used to verify scope and coverage. */
    const page = await adapter.search(
      {
        text: 'x OR *:*',
        limit: 2,
        offset: 4,
        sort: { field: 'price', direction: 'desc' },
        filters: [
          { field: 'category', operator: 'in', value: ['book'] },
          { field: 'price', operator: 'gte', value: 2 },
        ],
      },
      call()
    );
    assert.equal(page.coverage, 'exact');
    assert.equal(page.hits[0].document._zxTenant, undefined);
    /** Recorded synthetic native request used to assert literal translation and zero retries. */
    const request = f.requests[0];
    assert.equal(
      request.params.query.bool.filter[0].term._zxTenant,
      hash('shop-a')
    );
    assert.deepEqual(request.params.query.bool.filter[1], {
      terms: { category: ['book'] },
    });
    assert.equal(
      request.params.query.bool.must[0].match.text.query,
      'x OR *:*'
    );
    assert.deepEqual(request.params.sort, [{ price: 'desc' }, { id: 'asc' }]);
    assert.equal(request.control.maxRetries, 0);
    await adapter.index([{ id: '1', text: 'safe', price: 2 }], call());
    await adapter.delete(['1'], call('shop-b'));
    assert.notEqual(
      f.requests[1].params.operations[0].index._id,
      f.requests[2].params.operations[0].delete._id
    );
    assert.equal(f.requests[1].params.operations[1]._zxTenant, hash('shop-a'));
    await adapter.ensureIndex(call());
    /** Recorded explicit strict provisioning payload, never sent to a real engine. */
    const mappings = f.requests.at(-1).params.mappings;
    assert.equal(mappings.dynamic, 'strict');
    assert.equal(mappings.properties._zxTenant.type, 'keyword');
    assert.equal((await adapter.getVersion('1', call())).version.seqNo, 1);
    await adapter.replaceIfVersion(
      { id: '1', text: 'replacement' },
      { seqNo: 1, primaryTerm: 2 },
      call()
    );
    assert.equal(f.requests.at(-1).params.if_primary_term, 2);
  } finally {
    await adapter.close();
  }
  assert(!f.requests.some((r) => r.kind === 'close'));
  await assert.rejects(adapter.health(call()), { code: 'CLOSED' });
});
test('direct adapter rejects unsafe runtime shapes, reserved tenant fields, DSL, limits and unsupported filters', async () => {
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture();
  /** Owned adapter wrapper; teardown drains it without closing its borrowed fixture client. */
  const adapter = await createElasticSearchAdapter(f.options);
  try {
    for (const q of [
      { text: 'x', query: { match_all: {} } },
      {
        text: 'x',
        filters: [{ field: '_zxTenant', operator: 'eq', value: 'other' }],
      },
      {
        text: 'x',
        filters: [{ field: 'category', operator: 'contains', value: 'a' }],
      },
      {
        text: 'x',
        filters: [{ field: 'category', operator: 'eq', value: null }],
      },
      {
        text: 'x',
        filters: [
          {
            field: 'category',
            operator: 'eq',
            value: 'A',
            caseSensitive: false,
          },
        ],
      },
      { text: '', offset: 10000 },
    ]) {
      await assert.rejects(adapter.search(q, call()));
    }
    await assert.rejects(
      adapter.index([{ id: '1', text: 'x', _zxTenant: 'forged' }], call())
    );
    await assert.rejects(
      adapter.index(
        [{ id: '1', text: 'x', price: Number.MAX_SAFE_INTEGER + 1 }],
        call()
      )
    );
    await assert.rejects(
      adapter.index(Array(101).fill({ id: '1', text: 'x' }), call()),
      { code: 'LIMIT' }
    );
    let read = false;
    /** Accessor-bearing negative fixture that must reject without reading the getter. */
    const doc = {
      id: 'x',
      get text() {
        read = true;
        return 'x';
      },
    };
    await assert.rejects(adapter.index([doc], call()));
    assert.equal(read, false);
    assert.equal(f.requests.length, 0);
  } finally {
    await adapter.close();
  }
  for (const index of ['*', 'a,b', '../x', 'UPPER']) {
    await assert.rejects(createElasticSearchAdapter({ ...f.options, index }));
  }
  await assert.rejects(
    createElasticSearchAdapter({
      index: 'safe',
      endpoint: 'http://localhost:9200',
      allowedEndpoints: ['http://localhost:9200'],
      auth: { apiKey: 'x' },
    })
  );
});
test('partial bulk errors expose positions/counts without documents or native errors; never replay', async () => {
  let calls = 0;
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture({
    bulk: async () => {
      calls++;
      return {
        errors: true,
        items: [
          { index: { status: 201 } },
          {
            index: {
              status: 429,
              error: { reason: 'private document secret' },
            },
          },
        ],
      };
    },
  });
  /** Owned adapter wrapper; teardown drains it without closing its borrowed fixture client. */
  const adapter = await createElasticSearchAdapter(f.options);
  try {
    await assert.rejects(
      adapter.index(
        [
          { id: '1', text: 'x' },
          { id: '2', text: 'private' },
        ],
        call()
      ),
      (e) =>
        e instanceof ElasticBulkError &&
        e.succeeded === 1 &&
        e.failures[0].position === 1 &&
        !JSON.stringify(e).includes('private')
    );
    assert.equal(calls, 1);
  } finally {
    await adapter.close();
  }
});
test('tenant mismatch fails closed, unsupported versions reject, backend errors/conflicts redact', async () => {
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture();
  /** Owned adapter wrapper; teardown drains it without closing its borrowed fixture client. */
  const adapter = await createElasticSearchAdapter(f.options);
  try {
    await assert.rejects(adapter.search({ text: 'x' }, call('other')), {
      code: 'DENIED',
    });
  } finally {
    await adapter.close();
  }
  await assert.rejects(
    createElasticSearchAdapter(
      fixture({ info: async () => ({ version: { number: '8.19.0' } }) }).options
    ),
    { code: 'UNSUPPORTED' }
  );
  /** Owned wrapper around an injected failing client; teardown must close its observation scope. */
  const bad = await createElasticSearchAdapter(
    fixture({
      index: async () => {
        throw { meta: { statusCode: 409 } };
      },
      search: async () => {
        throw Error('API key secret');
      },
    }).options
  );
  try {
    await assert.rejects(
      bad.replaceIfVersion(
        { id: '1', text: 'x' },
        { seqNo: 1, primaryTerm: 1 },
        call()
      ),
      ElasticConflictError
    );
    await assert.rejects(
      bad.search({ text: 'x' }, call()),
      (e) => e.code === 'UNAVAILABLE' && !e.message.includes('secret')
    );
  } finally {
    await bad.close();
  }
});
test('cancellation retains native slot and close waits for actual borrowed settlement', async (t) => {
  let finish, signal;
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture({
    search: async (_, request) => {
      signal = request.signal;
      return new Promise((r) => {
        finish = r;
      });
    },
  });
  /** Owned adapter wrapper; teardown drains it without closing its borrowed fixture client. */
  const adapter = await createElasticSearchAdapter({
    ...f.options,
    maxPending: 1,
  });
  /** Owned cancellation controller for one held synthetic request. */
  const ctrl = new AbortController();
  /** Held actual operation promise; fixture cleanup must settle it before draining close. */
  const work = adapter.search(
    { text: 'x' },
    { ...call(), signal: ctrl.signal }
  );
  // Always settle the held native fixture before close, including assertion-failure paths.
  t.after(async () => {
    ctrl.abort();
    finish?.({
      hits: { hits: [], total: { value: 0, relation: 'eq' } },
      timed_out: false,
      _shards: { failed: 0 },
    });
    await Promise.allSettled([work, adapter.close()]);
  });
  await new Promise((r) => setImmediate(r));
  ctrl.abort();
  assert(signal.aborted);
  await assert.rejects(adapter.health(call()), { code: 'LIMIT' });
  let closed = false;
  /** Observed wrapper close promise; actual held work must settle before completion. */
  const closing = adapter.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  finish({
    hits: { hits: [], total: { value: 0, relation: 'eq' } },
    timed_out: false,
    _shards: { failed: 0 },
  });
  await assert.rejects(work, { code: 'CANCELLED' });
  await closing;
});
test('neutral registration consumes adapter without engine-specific config leaking', async () => {
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture();
  /** Inert explicit registration; start acquires a separately owned service generation. */
  const registration = registerSearchService({
    factories: { elastic: async () => createElasticSearchAdapter(f.options) },
    connections: [
      { name: 'catalog', backend: 'elastic', requirePersistent: true },
    ],
    authorize: (ctx) => (ctx === 'verified' ? { tenant: 'shop-a' } : null),
  });
  /** Owned shared-service generation; close in finally even on denied dispatch. */
  const services = await registration.start();
  try {
    assert.equal(
      (await services.search('catalog', 'verified', { text: 'x' })).hits.length,
      1
    );
    await assert.rejects(services.search('catalog', 'forged', { text: 'x' }), {
      code: 'DENIED',
    });
  } finally {
    await services.close();
  }
  assert.equal(
    typeof createElasticSearchFactory({ index: 'shop-v1' }),
    'function'
  );
});

test('incompatible mappings reject before bulk dispatch', async () => {
  let writes = 0;
  /** Independent injected-client fixture; no live engine is contacted. */
  const f = fixture({
    bulk: async () => {
      writes++;
    },
  });
  f.client.indices.getMapping = async () => ({
    'shop-v1': { mappings: { dynamic: true, properties: {} } },
  });
  /** Owned adapter wrapper; teardown drains it without closing its borrowed fixture client. */
  const adapter = await createElasticSearchAdapter(f.options);
  try {
    await assert.rejects(adapter.index([{ id: '1', text: 'x' }], call()), {
      code: 'UNSUPPORTED',
    });
    assert.equal(writes, 0);
  } finally {
    await adapter.close();
  }
});

test('factory schema snapshots reject accessors without executing them', () => {
  let read = false;
  /** Accessor-bearing mapping fixture; validation must not execute its getter. */
  const fields = {};
  Object.defineProperty(fields, 'category', {
    enumerable: true,
    get() {
      read = true;
      return 'keyword';
    },
  });
  assert.throws(
    () => createElasticSearchFactory({ index: 'shop-v1', fields }),
    { code: 'INVALID' }
  );
  assert.equal(read, false);
});
