import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "pages",
  title: "Pages",
  icon: "□",
  order: 30,
  render({ snapshot }) {
    return `
      <article class="zdev-card">
        <header class="zdev-card-head">
          <div>
            <span class="zdev-card-label">Routes</span>
            <h3>Discovered Pages</h3>
          </div>
        </header>
        <div class="zdev-route-list" data-pages-list>
          ${snapshot.routes.length
            ? snapshot.routes.map((route) => `
              <div class="zdev-route-item">
                <strong>${route.path}</strong>
                <span>${route.methods.join(", ")}</span>
              </div>
            `).join("")
            : `<p class="zdev-empty">No routes found.</p>`}
        </div>
      </article>
    `;
  }
};

export default section;
