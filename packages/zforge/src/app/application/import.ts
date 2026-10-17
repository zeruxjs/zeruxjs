import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "imports",
  title: "Imports",
  icon: "↗",
  order: 20,
  render({ modules }) {
    return `
      <section class="zdev-panel-stack">
        <article class="zdev-card">
          <header class="zdev-card-head">
            <div>
              <span class="zdev-card-label">Import Graph</span>
              <h3>Future Import Inspection</h3>
            </div>
          </header>
          <p class="zdev-empty">
            This panel is ready for dependency graph data. Use a module package to register import
            analyzers and pipe their output into the bootstrap API or peer websocket channels.
          </p>
        </article>
        <article class="zdev-card">
          <header class="zdev-card-head">
            <div>
              <span class="zdev-card-label">Module Hooks</span>
              <h3>Available Inputs</h3>
            </div>
          </header>
          <ul class="zdev-list">
            <li>Bootstrap API helpers from <code>zdev/src/api/</code></li>
            <li>Server and peer websocket channels from <code>zdev/src/api/ws.ts</code></li>
            <li>UI module registration from <code>zdev/src/module-registry.ts</code></li>
            <li>${modules.length ? `${modules.length} module(s) currently registered.` : "No external modules registered yet."}</li>
          </ul>
        </article>
      </section>
    `;
  }
};

export default section;
