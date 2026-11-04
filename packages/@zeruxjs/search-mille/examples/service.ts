import { registerSearchService } from "@zeruxjs/search/adapters";
import { createMilleSearchFactory } from "@zeruxjs/search-mille";

// This is trusted, private server configuration. No connection opens on import.
export function configureSearch(
  endpoint: string,
  apiKey: string,
  taskKey: Uint8Array,
  tenantFor: (context: unknown) => string | null,
) {
  return registerSearchService({
    factories: {
      mille: createMilleSearchFactory({
        index: "catalog",
        fields: { category: "string", price: "number" },
        searchable: ["text"],
        filterable: ["category", "price"],
        sortable: ["id", "price"],
        taskScope: "production-search",
        taskKey, // stable host key, distinct engine scope
      }),
    },
    connections: [
      {
        name: "catalog",
        backend: "mille",
        endpoint,
        allowedEndpoints: [endpoint],
        credentials: { apiKey },
        requirePersistent: true,
      },
    ],
    authorize(context) {
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
