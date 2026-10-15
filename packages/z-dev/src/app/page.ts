import { renderDocument, escapeHtml } from "../components/document.js";
import { renderThemeButton } from "../components/chrome.js";
import type { SharedDevRegistration } from "../types.js";

interface HomePageContext {
  apps: SharedDevRegistration[];
  nonce?: string;
}

export default ({ apps, nonce }: HomePageContext) => renderDocument({
  title: "Zdev Hub",
  bodyClass: "zdev-home",
  nonce,
  config: {
    page: "home",
    apps: apps.map(app => ({ routeName: app.routeName, appName: app.appName, appPort: app.appPort, rootDir: app.rootDir, serviceName: app.serviceName }))
  },
  content: `
    <div class="zdev-home-shell">
      <header class="zdev-home-hero">
        <div>
          <p class="zdev-eyebrow">Shared Development Surface</p>
          <h1>Zdev Hub</h1>
          <p class="zdev-home-copy">
            One shared dev server for every active app. Open an application workspace,
            inspect live runtime state, and extend the sidebar with new sections by dropping a file
            into <code>src/app/application/</code>.
          </p>
        </div>
        <div class="zdev-home-actions">
          ${renderThemeButton()}
        </div>
      </header>
      <main class="zdev-home-grid">
        ${apps.map((app) => `
          <a class="zdev-app-card" href="/${escapeHtml(app.routeName)}">
            <div class="zdev-app-card-head">
              <span class="zdev-app-badge">${escapeHtml(app.routeName)}</span>
              <span class="zdev-app-port">:${escapeHtml(app.appPort)}</span>
            </div>
            <h2>${escapeHtml(app.appName)}</h2>
            <p>${escapeHtml(app.rootDir)}</p>
            <div class="zdev-app-meta">
              <span>Open workspace</span>
              <span>Live diagnostics</span>
            </div>
          </a>
        `).join("")}
      </main>
    </div>
  `
});
