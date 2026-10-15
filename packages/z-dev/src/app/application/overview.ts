import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "overview",
  title: "Overview",
  icon: "◌",
  order: 10,
  render({ app, snapshot, modules }) {
    return `
      <section class="zdev-card-grid">
        <article class="zdev-card zdev-metric">
          <span class="zdev-card-label">App Port</span>
          <strong data-overview-port>${snapshot.appPort}</strong>
        </article>
        <article class="zdev-card zdev-metric">
          <span class="zdev-card-label">Mode</span>
          <strong data-overview-mode>${snapshot.mode}</strong>
        </article>
        <article class="zdev-card zdev-metric">
          <span class="zdev-card-label">Routes</span>
          <strong data-overview-routes>${snapshot.routes.length}</strong>
        </article>
        <article class="zdev-card zdev-metric">
          <span class="zdev-card-label">Modules</span>
          <strong data-overview-modules>${modules.length}</strong>
        </article>
      </section>
      <section class="zdev-panel-stack">
        <article class="zdev-card">
          <header class="zdev-card-head">
            <div>
              <span class="zdev-card-label">Runtime</span>
              <h3>${app.appName}</h3>
            </div>
          </header>
          <dl class="zdev-detail-grid">
            <div><dt>Root</dt><dd data-overview-root>${snapshot.rootDir}</dd></div>
            <div><dt>Manifest</dt><dd data-overview-manifest>${snapshot.manifestPath ?? "missing"}</dd></div>
            <div><dt>Log File</dt><dd data-overview-log>${snapshot.logFilePath ?? "missing"}</dd></div>
            <div><dt>Updated</dt><dd data-overview-updated>${snapshot.updatedAt}</dd></div>
          </dl>
        </article>
        <article class="zdev-card">
          <header class="zdev-card-head">
            <div>
              <span class="zdev-card-label">Module Loader</span>
              <h3>${app.serviceName}.config.js</h3>
            </div>
          </header>
          <p class="zdev-subtle zdev-card-copy">
            Link packages into <code>devtools.modules</code> and ${app.serviceName.charAt(0).toUpperCase() + app.serviceName.slice(1)} will load each package that exposes
            a <code>${app.serviceName}.module.config.js</code> file.
          </p>
          <div class="zdev-route-item">
            <strong>Config source</strong>
            <span data-overview-config>${app.rootDir}/${app.serviceName}.config.js</span>
          </div>
          <div class="zdev-route-item">
            <strong>Loaded packages</strong>
            <span data-overview-module-count>${modules.length} active</span>
          </div>
        </article>
      </section>
    `;
  }
};

export default section;
