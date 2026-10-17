import { escapeHtml } from "./document.js";
import type { DevtoolsSectionDefinition } from "../module-registry.js";

export const renderThemeButton = () => `
  <button type="button" class="zdev-theme-toggle" data-theme-toggle>
    <span data-theme-label>Theme: System</span>
  </button>
`;

type RenderableSection = DevtoolsSectionDefinition & {
  content?: string;
};

export const renderSectionNav = (sections: RenderableSection[], activeId: string) => `
  <nav class="zdev-sidebar-nav">
    ${sections.map((section) => `
      <button
        type="button"
        class="zdev-sidebar-link${section.id === activeId ? " is-active" : ""}"
        data-section-link="${escapeHtml(section.id)}"
      >
        <span class="zdev-sidebar-icon">${escapeHtml(section.icon ?? "•")}</span>
        <span>${escapeHtml(section.title)}</span>
      </button>
    `).join("")}
  </nav>
`;

export const renderSectionPanels = (sections: Array<RenderableSection & { content: string }>, activeId: string) => `
  <div class="zdev-panels">
    ${sections.map((section) => `
      <section
        class="zdev-panel${section.id === activeId ? " is-active" : ""}"
        data-section-panel="${escapeHtml(section.id)}"
        ${section.moduleId ? `data-module-panel="${escapeHtml(section.moduleId)}"` : ""}
      >
        ${section.moduleId ? `
          <div class="zdev-module-shell" data-module-root="${escapeHtml(section.moduleId)}" data-module-section="${escapeHtml(section.id)}">
            <template>${section.content}</template>
          </div>
        ` : section.content}
      </section>
    `).join("")}
  </div>
`;
