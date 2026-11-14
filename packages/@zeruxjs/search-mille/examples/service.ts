import { registerSearchService } from '@zeruxjs/search/adapters';
import { createMilleSearchFactory } from '@zeruxjs/search-mille';

// This is trusted, private server configuration. No connection opens on import.
/** Build an inert server registration with host-verified tenant authorization.
 * @param {string} endpoint - Exact approved HTTPS engine endpoint.
 * @param {string} apiKey - Private least-privilege server key.
 * @param {Uint8Array} taskKey - Stable private 32-byte random host key, never browser config.
 * @param {(context: unknown) => string | null} tenantFor - Host session/tenant/permission verifier.
 * @returns {object} Inert registration; an explicitly started generation owns close.
 */
export function configureSearch(
  endpoint: string,
  apiKey: string,
  taskKey: Uint8Array,
  tenantFor: (context: unknown) => string | null
) {
  return registerSearchService({
    factories: {
      mille: createMilleSearchFactory({
        index: 'catalog',
        fields: { category: 'string', price: 'number' },
        searchable: ['text'],
        filterable: ['category', 'price'],
        sortable: ['id', 'price'],
        taskScope: 'production-search',
        taskKey, // stable host key, distinct engine scope
      }),
    },
    connections: [
      {
        name: 'catalog',
        backend: 'mille',
        endpoint,
        allowedEndpoints: [endpoint],
        credentials: { apiKey },
        requirePersistent: true,
      },
    ],
    authorize(context) {
      /** Host-verified tenant from the application callback; caller role strings are not proof. */
      const tenant = tenantFor(context);
      return tenant ? { tenant } : null;
    },
  });
}
// Framework: {search:{enabled:true,registration:configureSearch(...)}}.
// Standalone: const manager = await registration.start();
// try { const receipt = await manager.mutate('catalog', verifiedContext, 'index',
//   [{id:'shoe',text:'Blue shoes'}]); /* receipt.state === 'accepted' */ }
// finally { await manager.close(); }
// For taskStatus/waitForTask and privileged setup, explicitly own a direct adapter.
// Supply verified tenant context; never expose raw SDK/admin keys or unfiltered task APIs.
