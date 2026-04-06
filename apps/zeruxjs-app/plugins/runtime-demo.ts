export default (api: any) => {
  api.addMiddleware("plugin-tag", async (context: any, next: () => Promise<void>) => {
    context.state.middleware = [...(context.state.middleware ?? []), "plugin-tag"];
    await next();
  });

  api.setComposable("pluginSummary", (runtime: any) => ({
    routes: runtime.routes.length,
    publicFiles: runtime.publicFiles.size
  }));

  api.addRoute({
    pattern: "/plugin/runtime",
    method: "GET",
    middleware: ["request-context", "plugin-tag"],
    handler(context: any) {
      const summary = context.services.composables.pluginSummary
        ? context.services.composables.pluginSummary(context.runtime)
        : {};

      return `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Plugin Runtime Route</title>
          <style>
            body { margin: 0; font-family: "Segoe UI", sans-serif; background: #10171f; color: #e7eefc; padding: 28px; }
            .panel { max-width: 840px; margin: 0 auto; border: 1px solid rgba(120,183,255,.16); border-radius: 18px; padding: 24px; background: rgba(12,20,34,.88); }
            h1 { margin: 0 0 14px; }
            p { color: #9fb2d1; line-height: 1.7; }
            pre { overflow: auto; padding: 16px; border-radius: 12px; background: rgba(2,6,23,.72); }
          </style>
        </head>
        <body>
          <section class="panel">
            <h1>Plugin-Added Route</h1>
            <p>This page was registered from <code>plugins/runtime-demo.ts</code>.</p>
            <pre>${JSON.stringify({
              requestId: context.state.requestId,
              middleware: context.state.middleware,
              summary
            }, null, 2)}</pre>
          </section>
        </body>
      </html>`;
    }
  });
};
