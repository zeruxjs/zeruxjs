import { escapeHtml } from './document.js';
import type { DevtoolsSectionDefinition } from '../module-registry.js';

/** Render the fixed native theme toggle used by trusted development pages.
 * @returns {string} Authored button markup with its client binding attributes.
 */
export const renderThemeButton = () => `
  <button type="button" class="zdev-theme-toggle" data-theme-toggle>
    <span data-theme-label>Theme: System</span>
  </button>
`;

type RenderableSection = DevtoolsSectionDefinition & {
  /** Optional trusted rendered HTML; never treated as an untrusted string sanitizer. */
  content?: string;
};

/** Render navigation over explicitly authored section definitions.
 * @param {RenderableSection[]} sections - Trusted ordered section list.
 * @param {string} activeId - Current section identifier.
 * @returns {string} Escaped native navigation buttons; client bindings own activation.
 */
export const renderSectionNav = (
  sections: RenderableSection[],
  activeId: string
) => `
  <nav class="zdev-sidebar-nav">
    ${sections
      .map(
        (section) => `
      <button
        type="button"
        class="zdev-sidebar-link${section.id === activeId ? ' is-active' : ''}"
        data-section-link="${escapeHtml(section.id)}"
      >
        <span class="zdev-sidebar-icon">${escapeHtml(section.icon ?? '•')}</span>
        <span>${escapeHtml(section.title)}</span>
      </button>
    `
      )
      .join('')}
  </nav>
`;

/** Render trusted section content within the development panel shells.
 * @param {Array<RenderableSection & {content: string}>} sections - Authored rendered section list.
 * @param {string} activeId - Current section identifier.
 * @returns {string} Panel markup; embedded section HTML remains a trusted-code boundary.
 */
export const renderSectionPanels = (
  sections: Array<
    RenderableSection & {
      /** Optional trusted rendered HTML; never treated as an untrusted string sanitizer. */
      content: string;
    }
  >,
  activeId: string
) => `
  <div class="zdev-panels">
    ${sections
      .map(
        (section) => `
      <section
        class="zdev-panel${section.id === activeId ? ' is-active' : ''}"
        data-section-panel="${escapeHtml(section.id)}"
        ${section.moduleId ? `data-module-panel="${escapeHtml(section.moduleId)}"` : ''}
      >
        ${
          section.moduleId
            ? `
          <div class="zdev-module-shell" data-module-root="${escapeHtml(section.moduleId)}" data-module-section="${escapeHtml(section.id)}">
            <template>${section.content}</template>
          </div>
        `
            : section.content
        }
      </section>
    `
      )
      .join('')}
  </div>
`;
