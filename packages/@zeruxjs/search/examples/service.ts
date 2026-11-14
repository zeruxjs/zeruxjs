import {
  registerSearchService,
  createLocalSearchFactory,
} from '@zeruxjs/search/adapters';

/** Demonstrate host-verified local selection without a listener or external engine.
 * @returns {Promise<void>} Completes the sample mutation/query and always closes its service.
 */
async function main() {
  // An authenticated host creates these contexts after session/tenant authorization.
  /** Host-owned verification map for this example; raw request fields never establish tenant authority. */
  const verified = new WeakMap<object, string>();
  /** Opaque example context registered by the host after authentication. */
  const requestContext = {};
  verified.set(requestContext, 'shop-1');
  /** Inert captured service registration; start acquires an owned generation. */
  const registration = registerSearchService({
    factories: {
      local: createLocalSearchFactory({
        maxTenants: 4,
        maxDocumentsPerTenant: 1000,
      }),
    },
    connections: [{ name: 'products', backend: 'local' }],
    authorize(context) {
      /** Verified tenant retrieved only from the host-owned context map. */
      const tenant =
        typeof context === 'object' && context !== null
          ? verified.get(context)
          : undefined;
      return tenant ? { tenant } : null;
    },
  });
  // Framework: config.search = { enabled: true, registration }.
  /** Owned service generation; finally closes it even when dispatch fails. */
  const search = await registration.start();
  try {
    await search.mutate('products', requestContext, 'index', [
      { id: 'shoe', text: 'Blue shoes' },
    ]);
    console.log(
      await search.search('products', requestContext, { text: 'shoes' })
    );
  } finally {
    await search.close();
  }
}
void main();
