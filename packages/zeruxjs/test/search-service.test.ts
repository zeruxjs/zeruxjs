import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSearchService,
  createLocalSearchFactory,
} from '@zeruxjs/search/adapters';
import { initializeRuntimeServices } from '../dist/bootstrap/services.js';
import { prepareConfiguration } from '../dist/bootstrap/config-validation.js';
/**
 * Create an isolated explicitly registered local search service.
 * @returns {ReturnType<typeof registerSearchService>} Host-authorized registration with bounded tenant indexes.
 */
const registration = () =>
  registerSearchService({
    factories: {
      local: createLocalSearchFactory({
        maxTenants: 2,
        maxDocumentsPerTenant: 10,
      }),
    },
    connections: [{ name: 'catalog', backend: 'local' }],
    authorize: () => ({ tenant: 'host-verified' }),
  });
test('explicit builtin search starts, stays private, is available to custom dependencies and closes', async () => {
  let dependencySeen = false;
  /** Private search registration and custom consumer used to test dependency ordering. */
  const config = {
    search: { enabled: true, registration: registration() },
    services: { consumer: { settings: {} } },
    serviceDefinitions: [
      {
        name: 'custom:consumer',
        namespace: 'consumer',
        dependencies: ['search'],
        schema: {
          '~standard': {
            version: 1,
            vendor: 'fixture',
            validate: (value) => ({ value }),
          },
        },
        async start({ get }) {
          dependencySeen = (await get('search').health('catalog')) === 'ready';
          return { value: {} };
        },
      },
    ],
  };
  /** Validated public/private configuration split; search registration must remain private. */
  const prepared = await prepareConfiguration(config);
  assert.equal('search' in prepared.publicConfig, false);
  /** Generation service owner closed before checking that further search access rejects. */
  const scope = await initializeRuntimeServices(config, process.cwd(), {
    database: async () => null,
    cache: async () => null,
  });
  assert.equal(dependencySeen, true);
  /** Borrowed search service whose lifetime belongs to the enclosing service scope. */
  const search = scope.get('search');
  assert.equal(await search.health('catalog'), 'ready');
  assert.equal(scope.status().find((s) => s.name === 'search').state, 'ready');
  assert.equal(config.search, undefined);
  await scope.close();
  assert.throws(() => search.health('catalog'), { code: 'CLOSED' });
});
test('search preflight before resource acquisition; failed search startup rolls back dependencies', async () => {
  let opened = 0,
    closed = 0;
  /** Injected dependency owners recording rollback without opening external services. */
  const providers = {
    database: async () => {
      opened++;
      return {
        close() {
          closed++;
        },
      };
    },
    cache: async () => null,
  };
  await assert.rejects(
    initializeRuntimeServices(
      { search: { enabled: true, registration: { kind: 'unknown' } } },
      process.cwd(),
      providers
    )
  );
  assert.equal(opened, 0);
  await assert.rejects(
    initializeRuntimeServices(
      { search: { enabled: true, registration: registration() } },
      process.cwd(),
      {
        ...providers,
        search: async () => {
          throw Error('unavailable');
        },
      }
    )
  );
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});
