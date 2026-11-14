import { escapeHtmlText } from '@zeruxjs/security/encoding';

/** Render the legacy runtime playground with escaped diagnostic JSON.
 * @param {object} root0 - Borrowed framework context projection.
 * @param {object} root0.state - Middleware-owned request state.
 * @param {object} root0.services - Host-registered composables, never caller imports.
 * @param {object} root0.runtime - Current generation runtime.
 * @param {object} root0.env - Private host environment; only the authored summary chooses a public field.
 * @param {string} root0.pathname - Matched request path, escaped before HTML insertion.
 * @returns {string} HTML with diagnostics encoded as text, not script data.
 */
export default ({ state, services, runtime, env, pathname }: any) => {
  /** Explicit public diagnostic projection; never serialize the entire environment/runtime object. */
  const requestInfo = {
    pathname,
    requestId: state.requestId,
    startedAt: state.startedAt,
    middleware: state.middleware,
    note: services.composables.runtimeSummary
      ? services.composables.runtimeSummary(runtime, env)
      : 'missing composable',
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
          <pre>${escapeHtmlText(JSON.stringify(requestInfo, null, 2))}</pre>
        </section>
        <section class="panel">
          <h2>Next checks</h2>
          <p>Try <a href="/blog/devtools-sample">a dynamic route</a>, <a href="/plugin/runtime">a plugin route</a>, or <a href="/boom">the error route</a>.</p>
        </section>
      </main>
    </body>
  </html>`;
};
