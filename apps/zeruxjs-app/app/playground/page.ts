export default ({ state, services, runtime, env, pathname }: any) => {
  const requestInfo = {
    pathname,
    requestId: state.requestId,
    startedAt: state.startedAt,
    middleware: state.middleware,
    note: services.composables.runtimeSummary
      ? services.composables.runtimeSummary(runtime, env)
      : "missing composable"
  };

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Zerux Playground</title>
      <style>
        body { margin: 0; font-family: "Segoe UI", sans-serif; background: #0b1322; color: #ebf2ff; padding: 28px; }
        .shell { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
        .panel { border: 1px solid rgba(120,183,255,.16); border-radius: 18px; padding: 20px; background: rgba(15,23,42,.82); }
        h1, h2 { margin: 0 0 12px; }
        p { margin: 0; color: #9fb2d1; line-height: 1.7; }
        pre { margin: 0; overflow: auto; padding: 16px; border-radius: 12px; background: rgba(2,6,23,.72); color: #dbeafe; }
        a { color: #78b7ff; }
      </style>
    </head>
    <body>
      <main class="shell">
        <section class="panel">
          <h1>Playground Route</h1>
          <p>This page is rendered through app route discovery and shared middleware.</p>
        </section>
        <section class="panel">
          <h2>Runtime Request State</h2>
          <pre>${JSON.stringify(requestInfo, null, 2)}</pre>
        </section>
        <section class="panel">
          <h2>Next checks</h2>
          <p>Try <a href="/blog/devtools-sample">a dynamic route</a>, <a href="/plugin/runtime">a plugin route</a>, or <a href="/boom">the error route</a>.</p>
        </section>
      </main>
    </body>
  </html>`;
};
