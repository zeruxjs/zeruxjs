import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "components",
  title: "Components",
  icon: "◫",
  order: 40,
  render() {
    return `
      <section class="zdev-panel-stack">
        <article class="zdev-card">
          <header class="zdev-card-head">
            <div>
              <span class="zdev-card-label">Component Inspector</span>
              <h3>Reserved for Future Trees</h3>
            </div>
          </header>
          <p class="zdev-empty">
            Attach component metadata here from a Zdev module. This section already appears in the
            sidebar automatically because it is just another file in <code>src/app/application/</code>.
          </p>
        </article>
      </section>
    `;
  }
};

export default section;
