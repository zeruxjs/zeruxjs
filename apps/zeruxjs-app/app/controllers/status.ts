const summarizeRuntime = (runtime: any) => ({
  mode: runtime.mode,
  routes: runtime.routes.length,
  middleware: [...runtime.middleware.keys()].sort(),
  controllers: [...runtime.controllers.keys()].sort(),
  composables: [...runtime.composables.keys()].sort(),
  publicFiles: [...runtime.publicFiles.keys()].sort()
});

export default {
  health(context: any) {
    return {
      ok: true,
      app: "zeruxjs-app",
      requestId: context.state.requestId,
      params: context.params,
      query: Object.fromEntries(context.query.entries()),
      runtime: summarizeRuntime(context.runtime)
    };
  }
};
