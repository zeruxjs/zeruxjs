import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "overview",
  title: "Overview",
  icon: "◌",
  order: 10,
  render({ app, snapshot, modules }) {
    return `
      <section class="zx-card-grid">
        <article class="zx-card zx-metric">
          <span class="zx-card-label">App Port</span>
          <strong data-overview-port>${snapshot.appPort}</strong>
        </article>
        <article class="zx-card zx-metric">
          <span class="zx-card-label">Mode</span>
          <strong data-overview-mode>${snapshot.mode}</strong>
        </article>
        <article class="zx-card zx-metric">
          <span class="zx-card-label">Routes</span>
          <strong data-overview-routes>${snapshot.routes.length}</strong>
        </article>
        <article class="zx-card zx-metric">
          <span class="zx-card-label">Modules</span>
          <strong data-overview-modules>${modules.length}</strong>
        </article>
      </section>
      <section class="zx-panel-stack">
        <article class="zx-card">
          <header class="zx-card-head">
            <div>
              <span class="zx-card-label">Runtime</span>
              <h3>${app.appName}</h3>
            </div>
          </header>
          <dl class="zx-detail-grid">
            <div><dt>Root</dt><dd data-overview-root>${snapshot.rootDir}</dd></div>
            <div><dt>Manifest</dt><dd data-overview-manifest>${snapshot.manifestPath ?? "missing"}</dd></div>
            <div><dt>Log File</dt><dd data-overview-log>${snapshot.logFilePath ?? "missing"}</dd></div>
            <div><dt>Updated</dt><dd data-overview-updated>${snapshot.updatedAt}</dd></div>
          </dl>
        </article>
        <article class="zx-card">
          <header class="zx-card-head">
            <div>
              <span class="zx-card-label">Module Loader</span>
              <h3>zerux.config.js</h3>
            </div>
          </header>
          <p class="zx-subtle zx-card-copy">
            Link packages into <code>devtools.modules</code> and Zerux will load each package that exposes
            a <code>zerux.module.config.js</code> file.
          </p>
          <div class="zx-route-item">
            <strong>Config source</strong>
            <span data-overview-config>${app.rootDir}/zerux.config.js</span>
          </div>
          <div class="zx-route-item">
            <strong>Loaded packages</strong>
            <span data-overview-module-count>${modules.length} active</span>
          </div>
        </article>
      </section>
    `;
  }
};

export default section;
