import type { DevtoolsSectionDefinition } from "../../module-registry.js";

const section: DevtoolsSectionDefinition = {
  id: "plugins",
  title: "Plugins",
  icon: "✦",
  order: 60,
  render() {
    return `
      <section class="zdev-panel-stack">
        <article class="zdev-card">
          <header class="zdev-card-head">
            <div>
              <span class="zdev-card-label">Plugin Wiring</span>
              <h3>Plugin and Module Surface</h3>
            </div>
          </header>
          <ul class="zdev-list">
            <li>Register UI or data modules with <code>registerDevtoolsModule()</code>.</li>
            <li>Expose custom endpoints with <code>registerDevtoolsApiHandler()</code>.</li>
            <li>Attach websocket behavior with <code>registerDevtoolsServerChannel()</code>.</li>
            <li>Keep package-specific UI inside your own module package and let the dev server consume it.</li>
          </ul>
        </article>
      </section>
    `;
  }
};

export default section;
