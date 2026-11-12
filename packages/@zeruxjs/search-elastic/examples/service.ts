import { registerSearchService } from '@zeruxjs/search/adapters';
import { createElasticSearchFactory } from '@zeruxjs/search-elastic';

// Trusted server configuration only. Importing this module opens no connection.
/** Build an inert host-authorized server registration without opening a connection.
 * @param {string} endpoint - Exact approved verified-TLS engine endpoint.
 * @param {string} apiKey - Private least-privilege API key; never send it to a browser.
 * @param {(context: unknown) => string | null} tenantFor - Host session/tenant/permission verifier.
 * @returns {object} Inert framework registration; its started generation owns close.
 */
export function configureSearch(
  endpoint: string,
  apiKey: string,
  tenantFor: (context: unknown) => string | null
) {
  return registerSearchService({
    factories: {
      elastic: createElasticSearchFactory({
        index: 'catalog-v1',
        fields: { category: 'keyword', price: 'double' },
      }),
    },
    connections: [
      {
        name: 'catalog',
        backend: 'elastic',
        endpoint,
        allowedEndpoints: [endpoint],
        credentials: { apiKey },
        requirePersistent: true,
      },
    ],
    authorize(context) {
      // The host verifies the session and search permissions; never trust a tenant header.
      /** Host-verified tenant selected by the injected application authorizer. */
      const tenant = tenantFor(context);
      return tenant ? { tenant } : null;
    },
  });
}
// Framework config: { search: { enabled: true, registration: configureSearch(...) } }
// Standalone: const manager = await registration.start();
// try { await manager.search('catalog', authenticatedContext, {text:'boots',limit:10}); }
// finally { await manager.close(); }
// Provision/verify the index separately using an explicitly created adapter.ensureIndex(call).
