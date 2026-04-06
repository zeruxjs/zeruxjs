import { escapeHtml } from "./document.js";
import type { DevtoolsSectionDefinition } from "../module-registry.js";

export const renderThemeButton = () => `
  <button type="button" class="zx-theme-toggle" data-theme-toggle>
    <span data-theme-label>Theme: System</span>
  </button>
`;

type RenderableSection = DevtoolsSectionDefinition & {
  content?: string;
};

export const renderSectionNav = (sections: RenderableSection[], activeId: string) => `
  <nav class="zx-sidebar-nav">
    ${sections.map((section) => `
      <button
        type="button"
        class="zx-sidebar-link${section.id === activeId ? " is-active" : ""}"
        data-section-link="${escapeHtml(section.id)}"
      >
        <span class="zx-sidebar-icon">${escapeHtml(section.icon ?? "•")}</span>
        <span>${escapeHtml(section.title)}</span>
      </button>
    `).join("")}
  </nav>
`;

export const renderSectionPanels = (sections: Array<RenderableSection & { content: string }>, activeId: string) => `
  <div class="zx-panels">
    ${sections.map((section) => `
      <section
        class="zx-panel${section.id === activeId ? " is-active" : ""}"
        data-section-panel="${escapeHtml(section.id)}"
        ${section.moduleId ? `data-module-panel="${escapeHtml(section.moduleId)}"` : ""}
      >
        ${section.moduleId ? `
          <div class="zx-module-shell" data-module-root="${escapeHtml(section.moduleId)}" data-module-section="${escapeHtml(section.id)}">
            <template>${section.content}</template>
          </div>
        ` : section.content}
      </section>
    `).join("")}
  </div>
`;
