import { renderDocument, escapeHtml } from "../../components/document.js";
import { renderSectionNav, renderSectionPanels, renderThemeButton } from "../../components/chrome.js";
import type { DevtoolsModuleDefinition, DevtoolsSectionDefinition } from "../../module-registry.js";
import type { SharedDevRegistration, SharedDevSnapshot } from "../../types.js";

interface ApplicationPageContext {
  app: SharedDevRegistration;
  snapshot: SharedDevSnapshot;
  identifier?: string | null;
  sectionId?: string | null;
  sections: Array<DevtoolsSectionDefinition & { content: string }>;
  modules: DevtoolsModuleDefinition[];
  nonce?: string;
}

export default ({ app, snapshot, identifier, sectionId, sections, modules, nonce }: ApplicationPageContext) => {
  const activeId = sectionId || sections[0]?.id || "overview";

  return renderDocument({
    title: `${app.routeName} | ${app.serviceName.charAt(0).toUpperCase() + app.serviceName.slice(1)} Devtools`,
    bodyClass: "zdev-application",
    serviceName: app.serviceName,
    nonce,
    config: {
      page: "application",
      app: { routeName: app.routeName, appName: app.appName },
      identifier,
      sectionId: activeId,
      snapshot,
      sections: sections.map(({ id, title, icon }) => ({ id, title, icon })),
      modules: modules.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        badge: m.badge,
        packageName: m.packageName,
        assets: m.assets,
        sections: (m.sections ?? []).map((s) => ({ id: s.id, title: s.title, icon: s.icon, order: s.order, moduleId: s.moduleId })),
        meta: m.meta
      }))
    },
    content: `
      <div class="zdev-app-shell" data-app="${escapeHtml(app.routeName)}">
        <header class="zdev-app-topbar">
          <div>
            <p class="zdev-eyebrow">Dev Workspace</p>
            <h1>${escapeHtml(app.appName)}</h1>
            <p class="zdev-subtle">
              Shared workspace for <code>${escapeHtml(app.routeName)}</code>
              ${identifier ? `<span class="zdev-session-chip">paired: ${escapeHtml(identifier)}</span>` : ""}
            </p>
          </div>
          <div class="zdev-home-actions">
            <button type="button" class="zdev-sidebar-toggle" data-sidebar-toggle aria-label="Toggle sections">☰</button>
            ${renderThemeButton()}
          </div>
        </header>
        <div class="zdev-app-layout">
          <aside class="zdev-sidebar" data-sidebar>
            <div class="zdev-sidebar-mobile-head">
              <strong>Sections</strong>
              <button type="button" class="zdev-sidebar-close" data-sidebar-close aria-label="Close sections">×</button>
            </div>
            <section class="zdev-sidebar-panel">
              <h2>Sections</h2>
              ${renderSectionNav(sections, activeId)}
            </section>
            <section class="zdev-sidebar-panel">
              <h2>Modules</h2>
              <div class="zdev-module-list" data-module-summary>
                ${modules.length
        ? modules.map((module) => `
                    <article class="zdev-module-item">
                      <strong>${escapeHtml(module.title)}</strong>
                      <span>${escapeHtml(module.badge ?? "registered")}</span>
                    </article>
                  `).join("")
        : `<p class="zdev-empty">No extra modules registered.</p>`}
              </div>
            </section>
          </aside>
          <main class="zdev-main">
            ${renderSectionPanels(sections, activeId)}
          </main>
        </div>
      </div>
    `
  });
};
