import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchServices,
  registerSearchService,
  createLocalSearchFactory,
} from '@zeruxjs/search/adapters';
/** Build bounded memory-only service configuration for isolated synthetic tenants.
 * @returns {object} Fresh isolated local-service configuration.
 */
const local = () => ({
  factories: {
    local: createLocalSearchFactory({
      maxTenants: 2,
      maxDocumentsPerTenant: 10,
    }),
  },
  connections: [{ name: 'catalog', backend: 'local' }],
  authorize: (context) =>
    context?.verified ? { tenant: context.tenant } : null,
});
/** Create a synthetic already-verified tenant context; production verification belongs to the host.
 * @param {string} tenant - Synthetic verified tenant identity.
 * @returns {object} Fixture context consumed only by the test authorizer.
 */
const identity = (tenant) => ({ verified: true, tenant });
/** Explicit synthetic remote capabilities; no live engine is contacted. */
const caps = {
  tenantIsolation: true,
  durability: 'persistent',
  consistency: 'eventual',
  filters: ['eq'],
  sort: [],
  mutations: ['index'],
  pagination: 'offset',
};
/** Build an injected adapter with controlled synthetic outcomes and cleanup behavior.
 * @param {object} overrides - Explicit synthetic method replacements.
 * @returns {object} Injected adapter; no real network client is acquired.
 */
const fixture = (overrides) => ({
  capabilities: caps,
  search: async () => ({ hits: [], coverage: 'exact' }),
  index: async () => ({ state: 'accepted', taskId: 'opaque' }),
  health: async () => 'ready',
  close() {},
  ...overrides,
});
/** Build a fixed allowlisted synthetic connection; example credentials are fixture-only.
 * @param {Function} factory - Explicit synthetic adapter factory.
 * @returns {object} Private connection fixture with a fixed HTTPS allowlist.
 */
const remote = (factory) => ({
  factories: { remote: factory },
  connections: [
    {
      name: 'catalog',
      backend: 'remote',
      endpoint: 'https://search.example/index',
      allowedEndpoints: ['https://search.example/index'],
      credentials: { password: 'private' },
    },
  ],
  authorize: () => ({ tenant: 'verified' }),
});

test('local compatibility, physical tenant isolation, staged writes, unsupported operations, close', async () => {
  /** Owned synthetic service; close must drain it before the fixture completes. */
  const service = await createSearchServices(local());
  try {
    await service.mutate('catalog', identity('a'), 'index', [
      { id: '1', text: 'hello', tenant: 'b' },
    ]);
    assert.equal(
      (await service.search('catalog', identity('a'), { text: 'hello' })).hits
        .length,
      1
    );
    assert.equal(
      (await service.search('catalog', identity('b'), { text: 'hello' })).hits
        .length,
      0
    );
    await assert.rejects(
      service.search('catalog', { tenant: 'a' }, { text: 'hello' }),
      { code: 'DENIED' }
    );
    assert.throws(
      () =>
        service.search('catalog', identity('a'), {
          text: 'hello',
          tenant: 'a',
        }),
      { code: 'INVALID' }
    );
    assert.throws(
      () =>
        service.search('catalog', identity('a'), {
          text: 'hello',
          sort: { field: 'id', direction: 'asc' },
        }),
      { code: 'UNSUPPORTED' }
    );
    assert.throws(() =>
      service.mutate('catalog', identity('a'), 'index', [
        { id: '2', text: 'safe' },
        { id: '3', text: 'bad', n: Infinity },
      ])
    );
    assert.equal(
      (await service.search('catalog', identity('a'), { text: 'safe' })).hits
        .length,
      0
    );
    await service.mutate('catalog', identity('a'), 'delete', ['1']);
    assert.equal(
      (await service.search('catalog', identity('a'), { text: 'hello' })).hits
        .length,
      0
    );
  } finally {
    await service.close();
  }
  assert.throws(() => service.health('catalog'), { code: 'CLOSED' });
});

test('capabilities and endpoint policy reject before dispatch; persistent requirements deny local selection', async () => {
  /** Explicit fixture configuration; changes exercise validation without touching application state. */
  const options = local();
  options.connections[0].requirePersistent = true;
  await assert.rejects(createSearchServices(options), { code: 'UNSUPPORTED' });
  let calls = 0;
  /** Synthetic connection configuration deliberately redirected outside its allowlist. */
  const denied = remote(async () => {
    calls++;
    return fixture();
  });
  denied.connections[0].endpoint = 'https://attacker.example/';
  await assert.rejects(createSearchServices(denied), { code: 'DENIED' });
  assert.equal(calls, 0);
  /** Owned synthetic service; close must drain it before the fixture completes. */
  const service = await createSearchServices(
    remote(async () =>
      fixture({
        search() {
          calls++;
          throw Error('must not dispatch');
        },
      })
    )
  );
  try {
    assert.throws(
      () =>
        service.search(
          'catalog',
          {},
          {
            text: 'x',
            filters: [{ field: 'id', operator: 'prefix', value: 'a' }],
          }
        ),
      { code: 'UNSUPPORTED' }
    );
  } finally {
    await service.close();
  }
  assert.equal(calls, 0);
});

test('backend errors are redacted and accepted task receipts do not imply completion', async () => {
  /** Owned synthetic service; close must drain it before the fixture completes. */
  const service = await createSearchServices(
    remote(async () =>
      fixture({
        search: async () => {
          throw Error('password=private');
        },
      })
    )
  );
  try {
    await assert.rejects(
      service.search('catalog', {}, { text: 'x' }),
      (e) =>
        e.code === 'UNAVAILABLE' &&
        !e.message.includes('private') &&
        e.cause.message.includes('private')
    );
    assert.deepEqual(
      await service.mutate('catalog', {}, 'index', [{ id: '1', text: 'x' }]),
      { state: 'accepted', taskId: 'opaque' }
    );
  } finally {
    await service.close();
  }
});

test('cancelled writes retain slot, signal and cleanup until native settlement; no replay', async (t) => {
  let settle,
    nativeSignal,
    writes = 0,
    closes = 0;
  /** Explicit fixture configuration; changes exercise validation without touching application state. */
  const options = remote(async () =>
    fixture({
      index: async (_, call) => {
        writes++;
        nativeSignal = call.signal;
        return new Promise((r) => {
          settle = r;
        });
      },
      close() {
        closes++;
      },
    })
  );
  options.maxPending = 1;
  /** Owned synthetic service; close must drain it before the fixture completes. */
  const service = await createSearchServices(options);
  /** Owned cancellation controller for this one synthetic operation. */
  const abort = new AbortController();
  // Release a held synthetic native operation even when an earlier assertion fails.
  t.after(async () => {
    settle?.({ state: 'completed' });
    await service.close();
  });
  /** Observed synthetic mutation promise; cancellation must not automatically replay it. */
  const write = service.mutate(
    'catalog',
    {},
    'index',
    [{ id: '1', text: 'x' }],
    { signal: abort.signal }
  );
  await new Promise((r) => setImmediate(r));
  abort.abort();
  await assert.rejects(write, { code: 'CANCELLED', outcome: 'unknown' });
  assert.equal(nativeSignal.aborted, true);
  await assert.rejects(service.health('catalog'), { code: 'LIMIT' });
  /** Owned close promise; settle retained native work before awaiting its drain. */
  const closing = service.close();
  await new Promise((r) => setImmediate(r));
  assert.equal(closes, 0);
  settle({ state: 'completed' });
  await closing;
  assert.equal(closes, 1);
  assert.equal(writes, 1);
});

test('startup rollback owns late factory settlement after deadline and closes prior resources', async () => {
  /** Synthetic close-order ledger, containing fixed fixture names only. */
  const closed = [];
  /** Explicit fixture configuration; changes exercise validation without touching application state. */
  const options = remote(async () =>
    fixture({
      close() {
        closed.push('first');
      },
    })
  );
  options.factories.slow = async () => {
    await new Promise((r) => setTimeout(r, 25));
    return fixture({
      close() {
        closed.push('late');
      },
    });
  };
  options.connections.push({ name: 'late', backend: 'slow' });
  options.timeoutMs = 10;
  await assert.rejects(createSearchServices(options), { code: 'DEADLINE' });
  assert.deepEqual(closed, ['late', 'first']);
});

test('registration snapshots selection and limits tenant cardinality', async () => {
  /** Explicit fixture configuration; changes exercise validation without touching application state. */
  const options = local();
  /** Inert captured service registration; start acquires an owned generation. */
  const registration = registerSearchService(options);
  options.connections[0].backend = 'attacker';
  /** Owned synthetic service; close must drain it before the fixture completes. */
  const service = await registration.start();
  try {
    for (const tenant of ['a', 'b']) {
      await service.mutate('catalog', identity(tenant), 'index', [
        { id: '1', text: 'x' },
      ]);
    }
    await assert.rejects(
      service.mutate('catalog', identity('c'), 'index', [
        { id: '1', text: 'x' },
      ]),
      { code: 'LIMIT' }
    );
  } finally {
    await service.close();
  }
});

test('startup rollback failures stay explicit and preserve both private causes', async () => {
  /** Explicit fixture configuration; changes exercise validation without touching application state. */
  const options = remote(async () =>
    fixture({
      close() {
        throw Error('private close detail');
      },
    })
  );
  options.factories.failed = async () => {
    throw Error('private startup detail');
  };
  options.connections.push({ name: 'failed', backend: 'failed' });
  await assert.rejects(
    createSearchServices(options),
    (error) =>
      error.code === 'UNAVAILABLE' &&
      error.outcome === 'unknown' &&
      !error.message.includes('private') &&
      error.cause instanceof AggregateError &&
      error.cause.errors.length === 2
  );
});
