import { defineDevtoolsModuleSocketHandlers } from "z-dev";

export default defineDevtoolsModuleSocketHandlers({
  ping({ app, snapshot, identifier, clientType, payload, module }) {
    return {
      ok: true,
      module: module.id,
      app: app.routeName,
      clientType: clientType ?? null,
      identifier: identifier ?? null,
      receivedAt: new Date().toISOString(),
      receivedPayload: payload ?? null,
      routeCount: snapshot.routes.length
    };
  }
});
