import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "modules",
  title: "Modules",
  icon: "◇",
  order: 50,
  render({ modules }) {
    return `
      <article class="zx-card">
        <header class="zx-card-head">
          <div>
            <span class="zx-card-label">Registered Modules</span>
            <h3>Package Modules</h3>
          </div>
        </header>
        <p class="zx-subtle zx-card-copy">
          Add package names in <code>devtools.modules</code>. Each package should expose
          <code>zerux.module.config.js</code>, an entry file, and optional isolated style/script assets.
        </p>
        <div class="zx-module-grid" data-modules-list>
          ${modules.length
            ? modules.map((module) => `
              <article class="zx-module-card">
                <strong>${module.title}</strong>
                <span>${module.description ?? "No description provided."}</span>
                <small>${module.packageName ?? module.badge ?? "custom module"}</small>
              </article>
            `).join("")
            : `<p class="zx-empty">No registered devtools modules.</p>`}
        </div>
      </article>
    `;
  }
};

export default section;
