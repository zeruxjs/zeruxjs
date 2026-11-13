import type { DevtoolsSectionDefinition } from '../../module-registry.js';

/** Legacy route summary over the host runtime snapshot; this is not route authorization. */
const section: DevtoolsSectionDefinition = {
  id: 'pages',
  title: 'Pages',
  icon: '□',
  order: 30,
  /** Render this authored development section from trusted host snapshot metadata.
   * @param {import('../../module-registry.js').DevtoolsSectionContext} context - Host-owned route snapshot; display does not grant endpoint access.
   * @returns {string} Authored section HTML; dynamic snapshot content must already be trusted at this legacy boundary.
   */
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
          ${
            snapshot.routes.length
              ? snapshot.routes
                  .map(
                    (route) => `
              <div class="zdev-route-item">
                <strong>${route.path}</strong>
                <span>${route.methods.join(', ')}</span>
              </div>
            `
                  )
                  .join('')
              : `<p class="zdev-empty">No routes found.</p>`
          }
        </div>
      </article>
    `;
  },
};

export default section;
