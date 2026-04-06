import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "components",
  title: "Components",
  icon: "◫",
  order: 40,
  render() {
    return `
      <section class="zx-panel-stack">
        <article class="zx-card">
          <header class="zx-card-head">
            <div>
              <span class="zx-card-label">Component Inspector</span>
              <h3>Reserved for Future Trees</h3>
            </div>
          </header>
          <p class="zx-empty">
            Attach component metadata here from a Zerux module. This section already appears in the
            sidebar automatically because it is just another file in <code>src/app/application/</code>.
          </p>
        </article>
      </section>
    `;
  }
};

export default section;
