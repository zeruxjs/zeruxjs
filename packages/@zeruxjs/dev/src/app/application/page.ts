import { renderDocument, escapeHtml } from "../../components/document.js";
import { renderSectionNav, renderSectionPanels, renderThemeButton } from "../../components/chrome.js";
import type { DevtoolsModuleDefinition, DevtoolsSectionDefinition } from "../../module-registry.js";
import type { SharedDevRegistration, SharedDevSnapshot } from "../../types.js";

interface ApplicationPageContext {
  app: SharedDevRegistration;
  snapshot: SharedDevSnapshot;
  identifier?: string | null;
  sections: Array<DevtoolsSectionDefinition & { content: string }>;
  modules: DevtoolsModuleDefinition[];
  nonce?: string;
}

export default ({ app, snapshot, identifier, sections, modules, nonce }: ApplicationPageContext) => {
  const activeId = sections[0]?.id ?? "overview";

  return renderDocument({
    title: `${app.routeName} | Zerux Devtools`,
    bodyClass: "zx-application",
    nonce,
    payload: {
      page: "application",
      app,
      snapshot,
      identifier,
      sections: sections.map(({ id, title, icon }) => ({ id, title, icon })),
      modules
    },
    content: `
      <div class="zx-app-shell" data-app="${escapeHtml(app.routeName)}">
        <header class="zx-app-topbar">
          <div>
            <p class="zx-eyebrow">Nuxt-style Workspace</p>
            <h1>${escapeHtml(app.appName)}</h1>
            <p class="zx-subtle">
              Shared workspace for <code>${escapeHtml(app.routeName)}</code>
              ${identifier ? `<span class="zx-session-chip">paired: ${escapeHtml(identifier)}</span>` : ""}
            </p>
          </div>
          <div class="zx-home-actions">
            <button type="button" class="zx-sidebar-toggle" data-sidebar-toggle aria-label="Toggle sections">☰</button>
            ${renderThemeButton()}
          </div>
        </header>
        <div class="zx-app-layout">
          <aside class="zx-sidebar" data-sidebar>
            <div class="zx-sidebar-mobile-head">
              <strong>Sections</strong>
              <button type="button" class="zx-sidebar-close" data-sidebar-close aria-label="Close sections">×</button>
            </div>
            <section class="zx-sidebar-panel">
              <h2>Sections</h2>
              ${renderSectionNav(sections, activeId)}
            </section>
            <section class="zx-sidebar-panel">
              <h2>Modules</h2>
              <div class="zx-module-list" data-module-summary>
                ${modules.length
                  ? modules.map((module) => `
                    <article class="zx-module-item">
                      <strong>${escapeHtml(module.title)}</strong>
                      <span>${escapeHtml(module.badge ?? "registered")}</span>
                    </article>
                  `).join("")
                  : `<p class="zx-empty">No extra modules registered.</p>`}
              </div>
            </section>
          </aside>
          <main class="zx-main">
            ${renderSectionPanels(sections, activeId)}
          </main>
        </div>
      </div>
    `
  });
};
