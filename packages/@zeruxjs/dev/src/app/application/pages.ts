import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "pages",
  title: "Pages",
  icon: "□",
  order: 30,
  render({ snapshot }) {
    return `
      <article class="zx-card">
        <header class="zx-card-head">
          <div>
            <span class="zx-card-label">Routes</span>
            <h3>Discovered Pages</h3>
          </div>
        </header>
        <div class="zx-route-list" data-pages-list>
          ${snapshot.routes.length
            ? snapshot.routes.map((route) => `
              <div class="zx-route-item">
                <strong>${route.path}</strong>
                <span>${route.methods.join(", ")}</span>
              </div>
            `).join("")
            : `<p class="zx-empty">No routes found.</p>`}
        </div>
      </article>
    `;
  }
};

export default section;
