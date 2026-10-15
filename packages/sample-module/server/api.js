import { defineDevtoolsModuleApiHandlers } from "z-dev";

export default defineDevtoolsModuleApiHandlers({
  inspect({ app, snapshot, identifier, body, module }) {
    return {
      module: module.id,
      packageName: module.packageName,
      routeName: app.routeName,
      identifier: identifier ?? null,
      requestedAt: body && typeof body === "object" ? body.requestedAt ?? null : null,
      snapshot: {
        mode: snapshot.mode,
        appPort: snapshot.appPort,
        routes: snapshot.routes.length,
        updatedAt: snapshot.updatedAt
      }
    };
  }
});
