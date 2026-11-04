import {
  registerSearchService,
  createLocalSearchFactory,
} from "@zeruxjs/search/adapters";

async function main() {
  // An authenticated host creates these contexts after session/tenant authorization.
  const verified = new WeakMap<object, string>();
  const requestContext = {};
  verified.set(requestContext, "shop-1");
  const registration = registerSearchService({
    factories: {
      local: createLocalSearchFactory({
        maxTenants: 4,
        maxDocumentsPerTenant: 1000,
      }),
    },
    connections: [{ name: "products", backend: "local" }],
    authorize(context) {
      const tenant =
        typeof context === "object" && context !== null
          ? verified.get(context)
          : undefined;
      return tenant ? { tenant } : null;
    },
  });
  // Framework: config.search = { enabled: true, registration }.
  const search = await registration.start();
  try {
    await search.mutate("products", requestContext, "index", [
      { id: "shoe", text: "Blue shoes" },
    ]);
    console.log(
      await search.search("products", requestContext, { text: "shoes" }),
    );
  } finally {
    await search.close();
  }
}
void main();
