import type { IncomingMessage } from "node:http";

interface DevClientScriptOptions {
  routeName: string;
  devServerUrl: string;
  allowedDevDomain?: string | null;
  devPortLessAlias: { value: string | null | false };
}

const buildInjectedClient = ({ routeName, devServerUrl, allowedDevDomain, devPortLessAlias }: DevClientScriptOptions) => `<script>
(() => {
  if (window.__ZERUX_DEV_CLIENT__) return;
  window.__ZERUX_DEV_CLIENT__ = true;
  const app = '${routeName}';
  const devMainServerUrl = '${devServerUrl}';
  const allowedDevDomain = '${allowedDevDomain}';
  const devPortLessAlias = '${devPortLessAlias.value}';
  const resolveDevServerUrl = () => {
    const currentProtocol = window.location.protocol;
    const currentHostname = window.location.hostname;
    const currentPort = window.location.port ? ':' + window.location.port : '';
    const isLocalHostOrPrivate = /^(localhost|127\.0\.0\.1|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|f[cd][0-9a-f]{0,2}:|fe80:)/.test(currentHostname);
    console.log({app, devMainServerUrl, allowedDevDomain, devPortLessAlias, currentHostname, currentPort, isLocalHostOrPrivate});
    if (isLocalHostOrPrivate) {
      return Object.assign(new URL(devMainServerUrl), { hostname: currentHostname }).toString();
    } else if (currentHostname.endsWith(".localhost")) {
      return devPortLessAlias;
    } else {
      if (allowedDevDomain) {
        return currentProtocol + '//' + allowedDevDomain;
      } else {
        return devPortLessAlias;
      }
    }
  };
  const devServerUrl = resolveDevServerUrl();
  const devServer = new URL(devServerUrl);
  const base = devServer.origin + '/' + app + '/__zerux';
  const tabIdentifierStorageKey = 'zerux:devtools:tabid:' + app;
  const themeStorageKey = 'zerux:devtools:theme';
  const getTabIdentifier = () => {
    let current = sessionStorage.getItem(tabIdentifierStorageKey);
    if (current) return current;
    current = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    sessionStorage.setItem(tabIdentifierStorageKey, current);
    return current;
  };
  const tabIdentifier = getTabIdentifier();
  const getSystemTheme = () =>
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const getStoredThemeMode = () => localStorage.getItem(themeStorageKey) || 'system';
  const getEffectiveTheme = () =>
    getStoredThemeMode() === 'system' ? getSystemTheme() : getStoredThemeMode();
  const wsProtocol = devServer.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsProtocol + '//' + devServer.host + '/__zerux/ws?app=' + encodeURIComponent(app) + '&client=page&identifier=' + encodeURIComponent(tabIdentifier);
  const devtoolsUrl = devServer.origin + '/' + app;
  const pairedDevtoolsUrl = devtoolsUrl + '?identifier=' + encodeURIComponent(tabIdentifier);
  const drawerStorageKey = 'zerux:devtools:drawer:' + app;
  const state = {
    warnings: [],
    errors: [],
    drawerOpen: false
  };
  const send = (payload) => {
    fetch(base + '/client-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, href: location.href, identifier: tabIdentifier, timestamp: new Date().toISOString() })
    }).catch(() => undefined);
  };

  const styles = document.createElement('style');
  styles.textContent = \`
    #zerux-dev-button,
    #zerux-dev-drawer,
    #zerux-dev-error-screen {
      --zx-bg: rgba(9,10,13,0.96);
      --zx-bg-soft: rgba(17,18,23,0.94);
      --zx-panel: rgba(7,8,11,0.985);
      --zx-text: #edf0f5;
      --zx-muted: #9ca5b3;
      --zx-border: rgba(205,213,225,0.16);
      --zx-accent: #bcc5d0;
      --zx-warm: #c99d4d;
    }
    #zerux-dev-button[data-theme="light"],
    #zerux-dev-drawer[data-theme="light"],
    #zerux-dev-error-screen[data-theme="light"] {
      --zx-bg: rgba(255,255,255,0.96);
      --zx-bg-soft: rgba(250,246,239,0.98);
      --zx-panel: rgba(251,252,255,0.995);
      --zx-text: #17202d;
      --zx-muted: #5f6c7e;
      --zx-border: rgba(26,58,94,0.14);
      --zx-accent: #356d9d;
      --zx-warm: #b88a3b;
    }
    #zerux-dev-button {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 46px;
      height: 46px;
      border-radius: 999px;
      border: 1px solid var(--zx-border);
      background: var(--zx-bg);
      color: var(--zx-accent);
      font: 700 16px/1 sans-serif;
      cursor: pointer;
      z-index: 2147483647;
      box-shadow: 0 16px 30px rgba(0,0,0,0.28);
    }
    #zerux-dev-badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--zx-warm);
      color: #2d1600;
      font: 700 11px/20px sans-serif;
      display: none;
    }
    #zerux-dev-drawer {
      position: fixed;
      top: 76px;
      right: 24px;
      width: min(1060px, calc(100vw - 40px));
      height: min(640px, calc(100vh - 108px));
      background: var(--zx-panel);
      border: 1px solid var(--zx-border);
      border-radius: 12px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.38);
      z-index: 2147483646;
      overflow: hidden;
      display: none;
      grid-template-rows: auto 1fr;
    }
    #zerux-dev-drawer.zerux-open { display: grid; }
    #zerux-dev-drawer.zerux-dragging {
      user-select: none;
      cursor: grabbing;
    }
    #zerux-dev-drawer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--zx-border);
      background: var(--zx-bg);
      cursor: grab;
    }
    #zerux-dev-drawer-title {
      min-width: 0;
    }
    #zerux-dev-drawer-title strong {
      display: block;
      color: var(--zx-text);
      font: 700 13px/1.3 sans-serif;
    }
    #zerux-dev-drawer-title span {
      display: block;
      margin-top: 2px;
      color: var(--zx-muted);
      font: 500 11px/1.3 sans-serif;
    }
    #zerux-dev-drawer-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .zerux-dev-action {
      border: 1px solid var(--zx-border);
      border-radius: 999px;
      background: var(--zx-bg-soft);
      color: var(--zx-text);
      padding: 6px 10px;
      font: 600 11px/1 sans-serif;
      cursor: pointer;
    }
    #zerux-dev-drawer-close {
      width: 28px;
      height: 28px;
      padding: 0;
      font: 700 16px/1 sans-serif;
    }
    #zerux-dev-drawer-main {
      display: block;
      height: 100%;
    }
    #zerux-dev-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--zx-panel);
    }
    #zerux-dev-error-screen {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      background:
        radial-gradient(circle at top left, rgba(166, 35, 35, 0.35), transparent 30%),
        linear-gradient(180deg, rgba(13,17,23,0.98), rgba(20,10,12,0.98));
      color: var(--zx-text);
      display: none;
      overflow: auto;
      padding: 32px;
    }
    #zerux-dev-error-screen.zerux-open { display: block; }
    #zerux-dev-error-inner {
      max-width: 1100px;
      margin: 0 auto;
      border: 1px solid rgba(201,157,77,0.2);
      border-radius: 12px;
      background: rgba(18, 16, 14, 0.88);
      box-shadow: 0 24px 90px rgba(0,0,0,0.36);
      overflow: hidden;
    }
    #zerux-dev-error-head {
      padding: 20px 24px;
      border-bottom: 1px solid rgba(201,157,77,0.16);
    }
    #zerux-dev-error-head h2 {
      margin: 0;
      font: 800 30px/1.1 sans-serif;
    }
    #zerux-dev-error-head p {
      margin: 8px 0 0;
      color: var(--zx-muted);
      font: 500 14px/1.5 sans-serif;
    }
    #zerux-dev-error-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    #zerux-dev-error-actions button {
      border: 1px solid rgba(201,157,77,0.22);
      border-radius: 999px;
      background: rgba(31, 25, 18, 0.96);
      color: #f4e6ca;
      padding: 9px 14px;
      cursor: pointer;
      font: 600 13px/1 sans-serif;
    }
    #zerux-dev-error-body {
      padding: 20px 24px 24px;
      display: grid;
      gap: 12px;
    }
    #zerux-dev-error-stack {
      margin: 0;
      padding: 16px;
      border-radius: 14px;
      background: rgba(9, 5, 6, 0.82);
      border: 1px solid rgba(201,157,77,0.12);
      font: 500 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @media (max-width: 980px) {
      #zerux-dev-drawer {
        inset: 0;
        width: 100vw;
        height: 100vh;
        border-radius: 0;
        grid-template-rows: auto 1fr;
        right: auto;
        top: 0;
      }
    }
  \`;
  document.head.appendChild(styles);

  const button = document.createElement('button');
  button.id = 'zerux-dev-button';
  button.type = 'button';
  button.textContent = 'Z';
  const badge = document.createElement('span');
  badge.id = 'zerux-dev-badge';
  button.appendChild(badge);

  const drawer = document.createElement('section');
  drawer.id = 'zerux-dev-drawer';
  drawer.innerHTML = \`
    <div id="zerux-dev-drawer-bar">
      <div id="zerux-dev-drawer-title">
        <strong>Zerux Devtools</strong>
        <span>\${location.pathname}</span>
      </div>
      <div id="zerux-dev-drawer-actions">
        <button type="button" class="zerux-dev-action" id="zerux-dev-open-tab">Open devtools</button>
        <button type="button" class="zerux-dev-action" id="zerux-dev-open-current-tab">Open this page</button>
        <button type="button" class="zerux-dev-action" id="zerux-dev-drawer-close" aria-label="Close">×</button>
      </div>
    </div>
    <div id="zerux-dev-drawer-main">
      <iframe id="zerux-dev-frame" src="\${pairedDevtoolsUrl}" title="Zerux Devtools"></iframe>
    </div>
  \`;

  const errorScreen = document.createElement('section');
  errorScreen.id = 'zerux-dev-error-screen';
  errorScreen.innerHTML = \`
    <div id="zerux-dev-error-inner">
      <div id="zerux-dev-error-head">
        <h2>Application Error</h2>
        <p id="zerux-dev-error-message">A runtime error occurred while rendering this page.</p>
        <div id="zerux-dev-error-actions">
          <button type="button" id="zerux-dev-open-drawer">Open diagnostics</button>
          <button type="button" id="zerux-dev-dismiss-error">Dismiss overlay</button>
        </div>
      </div>
      <div id="zerux-dev-error-body">
        <pre id="zerux-dev-error-stack">No stack trace available.</pre>
      </div>
    </div>
  \`;

  const drawerBar = drawer.querySelector('#zerux-dev-drawer-bar');
  const errorMessage = errorScreen.querySelector('#zerux-dev-error-message');
  const errorStack = errorScreen.querySelector('#zerux-dev-error-stack');
  const frame = drawer.querySelector('#zerux-dev-frame');
  const format = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const postThemeToFrame = () => {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'zerux:theme-sync',
      mode: getStoredThemeMode(),
      effectiveTheme: getEffectiveTheme()
    }, devServer.origin);
  };
  const applyOverlayTheme = () => {
    const theme = getEffectiveTheme();
    button.setAttribute('data-theme', theme);
    drawer.setAttribute('data-theme', theme);
    errorScreen.setAttribute('data-theme', theme);
    postThemeToFrame();
  };
  const updateBadge = () => {
    if (!state.warnings.length) {
      badge.style.display = 'none';
      badge.textContent = '';
      return;
    }
    badge.style.display = 'block';
    badge.textContent = state.warnings.length > 99 ? '99+' : String(state.warnings.length);
  };
  const openDrawer = () => {
    state.drawerOpen = true;
    if (frame && frame.getAttribute('src') !== pairedDevtoolsUrl) {
      frame.setAttribute('src', pairedDevtoolsUrl);
    }
    drawer.classList.add('zerux-open');
    postThemeToFrame();
  };
  const closeDrawer = () => {
    state.drawerOpen = false;
    drawer.classList.remove('zerux-open');
  };
  let dragState = null;
  const saveDrawerPosition = () => {
    if (window.innerWidth <= 980) return;
    localStorage.setItem(drawerStorageKey, JSON.stringify({
      left: drawer.style.left,
      top: drawer.style.top
    }));
  };
  const getDefaultDrawerPosition = () => {
    const width = drawer.offsetWidth || Math.min(980, window.innerWidth - 40);
    const height = drawer.offsetHeight || Math.min(640, window.innerHeight - 108);
    return {
      left: Math.max(Math.round((window.innerWidth - width) / 2), 12),
      top: Math.max(window.innerHeight - height - 10, 12)
    };
  };
  const applyDrawerPosition = (left, top) => {
    const nextLeft = Math.min(Math.max(left, 12), window.innerWidth - drawer.offsetWidth - 12);
    const nextTop = Math.min(Math.max(top, 12), window.innerHeight - drawer.offsetHeight - 10);
    drawer.style.left = nextLeft + 'px';
    drawer.style.top = nextTop + 'px';
    drawer.style.right = 'auto';
  };
  const syncDrawerBounds = () => {
    if (window.innerWidth <= 980) return;
    const raw = localStorage.getItem(drawerStorageKey);
    if (!raw) {
      const defaults = getDefaultDrawerPosition();
      applyDrawerPosition(defaults.left, defaults.top);
      return;
    }
    try {
      const saved = JSON.parse(raw);
      const left = Number.parseInt(saved.left, 10);
      const top = Number.parseInt(saved.top, 10);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        applyDrawerPosition(left, top);
        return;
      }
    } catch {}
    const defaults = getDefaultDrawerPosition();
    applyDrawerPosition(defaults.left, defaults.top);
  };
  const showErrorOverlay = (entry) => {
    errorMessage.textContent = entry.message || 'Application Error';
    errorStack.textContent = [entry.message, entry.source, entry.stack].filter(Boolean).join('\\n\\n');
    errorScreen.classList.add('zerux-open');
  };
  const recordWarning = (entry) => {
    state.warnings.push(entry);
    updateBadge();
  };
  const recordError = (entry) => {
    state.errors.push(entry);
    showErrorOverlay(entry);
  };

  button.addEventListener('click', () => {
    if (state.warnings.length || state.errors.length) {
      openDrawer();
      return;
    }
    if (state.drawerOpen) {
      closeDrawer();
      return;
    }
    openDrawer();
  });

  drawer.querySelector('#zerux-dev-drawer-close')?.addEventListener('click', () => {
    closeDrawer();
  });
  drawer.querySelector('#zerux-dev-drawer-close')?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  drawer.querySelector('#zerux-dev-open-tab')?.addEventListener('click', () => {
    window.open(devtoolsUrl, '_blank', 'noopener,noreferrer');
  });
  drawer.querySelector('#zerux-dev-open-current-tab')?.addEventListener('click', () => {
    window.open(pairedDevtoolsUrl, '_blank', 'noopener,noreferrer');
  });
  frame?.addEventListener('load', () => {
    postThemeToFrame();
  });
  drawer.querySelector('#zerux-dev-open-tab')?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  drawer.querySelector('#zerux-dev-open-current-tab')?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  drawerBar?.addEventListener('pointerdown', (event) => {
    if (window.innerWidth <= 980) return;
    if (event.target && event.target.closest('button')) return;
    const rect = drawer.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    drawer.classList.add('zerux-dragging');
    drawerBar.setPointerCapture(event.pointerId);
  });

  drawerBar?.addEventListener('pointermove', (event) => {
    if (!dragState || window.innerWidth <= 980) return;
    const maxLeft = window.innerWidth - drawer.offsetWidth - 12;
    const maxTop = window.innerHeight - drawer.offsetHeight - 12;
    const nextLeft = Math.min(Math.max(event.clientX - dragState.offsetX, 12), maxLeft);
    const nextTop = Math.min(Math.max(event.clientY - dragState.offsetY, 12), maxTop);
    drawer.style.left = nextLeft + 'px';
    drawer.style.top = nextTop + 'px';
    drawer.style.right = 'auto';
  });

  drawerBar?.addEventListener('pointerup', (event) => {
    dragState = null;
    drawer.classList.remove('zerux-dragging');
    if (drawerBar.hasPointerCapture(event.pointerId)) {
      drawerBar.releasePointerCapture(event.pointerId);
    }
    saveDrawerPosition();
  });

  drawerBar?.addEventListener('pointercancel', () => {
    dragState = null;
    drawer.classList.remove('zerux-dragging');
  });

  errorScreen.querySelector('#zerux-dev-open-drawer')?.addEventListener('click', () => {
    openDrawer();
  });
  errorScreen.querySelector('#zerux-dev-dismiss-error')?.addEventListener('click', () => {
    errorScreen.classList.remove('zerux-open');
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (!document.body) return;
    document.body.appendChild(button);
    document.body.appendChild(drawer);
    document.body.appendChild(errorScreen);
    applyOverlayTheme();
    syncDrawerBounds();
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== devServer.origin) return;
    if (!event.data || event.data.type !== 'zerux:theme-sync') return;

    const nextMode = event.data.mode;
    if (nextMode === 'system' || nextMode === 'dark' || nextMode === 'light') {
      localStorage.setItem(themeStorageKey, nextMode);
      applyOverlayTheme();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === themeStorageKey) {
      applyOverlayTheme();
    }
  });
  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', applyOverlayTheme);
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 980) {
      drawer.style.left = '';
      drawer.style.top = '';
      drawer.style.right = '';
      return;
    }
    syncDrawerBounds();
  });

  window.addEventListener('error', (event) => {
    const entry = {
      type: 'error',
      message: event.message,
      source: [event.filename, event.lineno, event.colno].filter(Boolean).join(':'),
      stack: event.error && event.error.stack ? event.error.stack : ''
    };
    recordError(entry);
    send(entry);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const entry = {
      type: 'error',
      message: event.reason instanceof Error ? event.reason.message : String(event.reason),
      source: 'unhandledrejection',
      stack: event.reason instanceof Error ? event.reason.stack || '' : String(event.reason)
    };
    recordError(entry);
    send(entry);
  });
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);
  console.warn = (...args) => {
    const entry = {
      type: 'warn',
      message: args.map(format).join(' '),
      source: 'console.warn',
      stack: ''
    };
    recordWarning(entry);
    send(entry);
    warn(...args);
  };
  console.error = (...args) => {
    const entry = {
      type: 'error',
      message: args.map(format).join(' '),
      source: 'console.error',
      stack: ''
    };
    recordError(entry);
    send(entry);
    error(...args);
  };
  const socket = new WebSocket(wsUrl);
  socket.addEventListener('message', (message) => {
    try {
      const data = JSON.parse(message.data);
      if (data.type === 'reload') {
        window.location.reload();
      }
    } catch {}
  });
})();
</script>
<script type="module">
  import {
    onCLS,
    onINP,
    onLCP,
  } from 'https://unpkg.com/web-vitals@5/dist/web-vitals.attribution.js?module';

  onCLS((m)=>console.log("CLS: ", m));
  onINP((m)=>console.log("INP: ", m));
  onLCP((m)=>console.log("LCP: ", m));
</script>`;

export const isPrimaryHtmlRequest = (req: IncomingMessage) => {
  if ((req.method || "GET").toUpperCase() !== "GET") return false;

  const accept = String(req.headers.accept || "");
  if (!accept.includes("text/html")) return false;

  const requestedWith = String(req.headers["x-requested-with"] || "").toLowerCase();
  if (requestedWith === "xmlhttprequest") return false;

  const secFetchDest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
  if (secFetchDest && secFetchDest !== "document" && secFetchDest !== "iframe") return false;

  const secFetchMode = String(req.headers["sec-fetch-mode"] || "").toLowerCase();
  if (secFetchMode && secFetchMode !== "navigate") return false;

  return true;
};

export const injectDevClient = (html: string, options: DevClientScriptOptions) => {
  const snippet = buildInjectedClient(options);
  if (html.includes("</body>")) {
    return html.replace("</body>", `${snippet}</body>`);
  }
  return `${html}${snippet}`;
};
