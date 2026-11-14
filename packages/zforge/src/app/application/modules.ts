import type { DevtoolsSectionDefinition } from '../../module-registry.js';

/** Trusted configured module summary section; module execution remains explicit host integration. */
const section: DevtoolsSectionDefinition = {
  id: 'modules',
  title: 'Modules',
  icon: '◇',
  order: 50,
  /** Render this authored development section from trusted host snapshot metadata.
   * @param {import('../../module-registry.js').DevtoolsSectionContext} context - Explicit trusted module definitions selected by the host.
   * @returns {string} Authored section HTML; dynamic snapshot content must already be trusted at this legacy boundary.
   */
  render({ modules }) {
    return `
      <article class="zdev-card">
        <header class="zdev-card-head">
          <div>
            <span class="zdev-card-label">Registered Modules</span>
            <h3>Package Modules</h3>
          </div>
        </header>
        <p class="zdev-subtle zdev-card-copy">
          Add package names in <code>devtools.modules</code>. Each package should expose
          <code>zdev.module.config.js</code>, an entry file, and optional isolated style/script assets.
        </p>
        <div class="zdev-module-grid" data-modules-list>
          ${
            modules.length
              ? modules
                  .map(
                    (module) => `
              <article class="zdev-module-card">
                <strong>${module.title}</strong>
                <span>${module.description ?? 'No description provided.'}</span>
                <small>${module.packageName ?? module.badge ?? 'custom module'}</small>
              </article>
            `
                  )
                  .join('')
              : `<p class="zdev-empty">No registered devtools modules.</p>`
          }
        </div>
      </article>
    `;
  },
};

export default section;
