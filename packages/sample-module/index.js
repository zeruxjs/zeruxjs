import { defineDevtoolsModule } from "z-dev";

export default defineDevtoolsModule({
  id: "sample-module",
  title: "Sample Module",
  description: "Reference module package for Zerux devtools.",
  badge: "example",
  sections: [
    {
      id: "sample-module",
      title: "Sample Module",
      icon: "⌘",
      order: 60,
      render({ app, snapshot }) {
        return `
          <section class="sample-module">
            <header class="sample-hero">
              <div>
                <span class="sample-eyebrow">External Package</span>
                <h2>Sample Module</h2>
                <p>
                  This section is coming from <code>packages/sample-module</code>. Its styles and
                  scripts are mounted only inside this panel.
                </p>
              </div>
              <div class="sample-chip">App: ${app.routeName}</div>
            </header>

            <div class="sample-grid">
              <article class="sample-card">
                <span class="sample-label">Mode</span>
                <strong>${snapshot.mode}</strong>
              </article>
              <article class="sample-card">
                <span class="sample-label">Routes</span>
                <strong>${snapshot.routes.length}</strong>
              </article>
              <article class="sample-card">
                <span class="sample-label">Port</span>
                <strong>${snapshot.appPort}</strong>
              </article>
            </div>

            <div class="sample-layout">
              <article class="sample-panel">
                <div class="sample-panel-head">
                  <div>
                    <span class="sample-label">Module API</span>
                    <h3>Live Snapshot</h3>
                  </div>
                  <button type="button" data-sample-refresh>Refresh</button>
                </div>
                <pre data-sample-api>Waiting for API call…</pre>
              </article>

              <article class="sample-panel">
                <div class="sample-panel-head">
                  <div>
                    <span class="sample-label">Module WebSocket</span>
                    <h3>Server Channel</h3>
                  </div>
                  <button type="button" data-sample-ping>Ping Server</button>
                </div>
                <p class="sample-status" data-sample-socket-state>Socket idle</p>
                <pre data-sample-socket>Waiting for websocket message…</pre>
              </article>
            </div>
          </section>
        `;
      }
    }
  ]
});
