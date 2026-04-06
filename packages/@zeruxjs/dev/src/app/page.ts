import { renderDocument, escapeHtml } from "../components/document.js";
import { renderThemeButton } from "../components/chrome.js";
import type { SharedDevRegistration } from "../types.js";

interface HomePageContext {
  apps: SharedDevRegistration[];
  nonce?: string;
}

export default ({ apps, nonce }: HomePageContext) => renderDocument({
  title: "Zerux Dev",
  bodyClass: "zx-home",
  nonce,
  payload: {
    page: "home",
    apps
  },
  content: `
    <div class="zx-home-shell">
      <header class="zx-home-hero">
        <div>
          <p class="zx-eyebrow">Shared Development Surface</p>
          <h1>Zerux Devtools Hub</h1>
          <p class="zx-home-copy">
            One shared dev server for every active Zerux app. Open an application workspace,
            inspect live runtime state, and extend the sidebar with new sections by dropping a file
            into <code>src/app/application/</code>.
          </p>
        </div>
        <div class="zx-home-actions">
          ${renderThemeButton()}
        </div>
      </header>
      <main class="zx-home-grid">
        ${apps.map((app) => `
          <a class="zx-app-card" href="/${escapeHtml(app.routeName)}">
            <div class="zx-app-card-head">
              <span class="zx-app-badge">${escapeHtml(app.routeName)}</span>
              <span class="zx-app-port">:${escapeHtml(app.appPort)}</span>
            </div>
            <h2>${escapeHtml(app.appName)}</h2>
            <p>${escapeHtml(app.rootDir)}</p>
            <div class="zx-app-meta">
              <span>Open workspace</span>
              <span>Live diagnostics</span>
            </div>
          </a>
        `).join("")}
      </main>
    </div>
  `
});
