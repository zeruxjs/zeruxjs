import type { IncomingMessage } from "node:http";

export interface DevClientScriptOptions {
  routeName: string;
  devServerUrl: string;
  allowedDevDomain?: string | null;
  devPortLessAlias: { value: string | null | false };
  serviceName: string;
}

/** Escape JS expression and HTML script boundaries, not only JavaScript quotes. */
const scriptValue = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => ({
  '<': '\\u003c', '>': '\\u003e', '&': '\\u0026',
  '\u2028': '\\u2028', '\u2029': '\\u2029'
} as Record<string, string>)[char]);

const buildInjectedClient = ({ routeName, devServerUrl, allowedDevDomain, devPortLessAlias, serviceName }: DevClientScriptOptions) => `<script data-zdev-client="true">
(() => {
  if (window.__ZDEV_CLIENT__) return;
  window.__ZDEV_CLIENT__ = true;
  const app = ${scriptValue(routeName)};
  const service = ${scriptValue(serviceName)};
  const devMainServerUrl = ${scriptValue(devServerUrl)};
  const allowedDevDomain = ${scriptValue(allowedDevDomain ?? null)};
  const devPortLessAlias = ${scriptValue(devPortLessAlias.value)};
  const resolveDevServerUrl = () => {
    const currentProtocol = window.location.protocol;
    const currentHostname = window.location.hostname;
    const currentPort = window.location.port ? ':' + window.location.port : '';
    const isLocalHostOrPrivate = /^(localhost|127\.0\.0\.1|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|f[cd][0-9a-f]{0,2}:|fe80:)/.test(currentHostname);
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
  const base = devServer.origin + '/' + app + '/__' + service;
  const tabIdentifierStorageKey = 'zdev:devtools:tabid:' + app;
  const themeStorageKey = 'zdev:devtools:theme';
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
  const wsUrl = wsProtocol + '//' + devServer.host + '/__' + service + '/ws?app=' + encodeURIComponent(app) + '&client=page&identifier=' + encodeURIComponent(tabIdentifier);
  const devtoolsUrl = devServer.origin + '/' + app;
  const pairedDevtoolsUrl = devtoolsUrl + '?identifier=' + encodeURIComponent(tabIdentifier);
  const drawerStorageKey = 'zdev:devtools:drawer:' + app;
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
  styles.id = 'zdev-style';
  styles.textContent = \`
    #zdev-button,
    #zdev-drawer,
    #zdev-error-screen {
      --zdev-bg: rgba(9,10,13,0.96);
      --zdev-bg-soft: rgba(17,18,23,0.94);
      --zdev-panel: rgba(7,8,11,0.985);
      --zdev-text: #edf0f5;
      --zdev-muted: #9ca5b3;
      --zdev-border: rgba(205,213,225,0.16);
      --zdev-accent: #bcc5d0;
      --zdev-warm: #c99d4d;
    }
    #zdev-button[data-theme="light"],
    #zdev-drawer[data-theme="light"],
    #zdev-error-screen[data-theme="light"] {
      --zx-bg: rgba(255,255,255,0.96);
      --zx-bg-soft: rgba(250,246,239,0.98);
      --zx-panel: rgba(251,252,255,0.995);
      --zx-text: #17202d;
      --zx-muted: #5f6c7e;
      --zx-border: rgba(26,58,94,0.14);
      --zx-accent: #356d9d;
      --zx-warm: #b88a3b;
    }
    #zdev-button {
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
    #zdev-badge {
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
    #zdev-drawer {
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
    #zdev-drawer.zdev-open { display: grid; }
    #zdev-drawer.zdev-dragging {
      user-select: none;
      cursor: grabbing;
    }
    #zdev-drawer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--zx-border);
      background: var(--zx-bg);
      cursor: grab;
    }
    #zdev-drawer-title {
      min-width: 0;
    }
    #zdev-drawer-title strong {
      display: block;
      color: var(--zx-text);
      font: 700 13px/1.3 sans-serif;
    }
    #zdev-drawer-title span {
      display: block;
      margin-top: 2px;
      color: var(--zx-muted);
      font: 500 11px/1.3 sans-serif;
    }
    #zdev-drawer-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .zdev-action {
      border: 1px solid var(--zx-border);
      border-radius: 999px;
      background: var(--zx-bg-soft);
      color: var(--zx-text);
      padding: 6px 10px;
      font: 600 11px/1 sans-serif;
      cursor: pointer;
    }
    #zdev-drawer-close {
      width: 28px;
      height: 28px;
      padding: 0;
      font: 700 16px/1 sans-serif;
    }
    #zdev-drawer-main {
      display: block;
      height: 100%;
    }
    #zdev-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--zx-panel);
    }
    #zdev-error-screen {
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
    #zdev-error-screen.zdev-open { display: block; }
    #zdev-error-inner {
      max-width: 1100px;
      margin: 0 auto;
      border: 1px solid rgba(201,157,77,0.2);
      border-radius: 12px;
      background: rgba(18, 16, 14, 0.88);
      box-shadow: 0 24px 90px rgba(0,0,0,0.36);
      overflow: hidden;
    }
    #zdev-error-head {
      padding: 20px 24px;
      border-bottom: 1px solid rgba(201,157,77,0.16);
    }
    #zdev-error-head h2 {
      margin: 0;
      font: 800 30px/1.1 sans-serif;
    }
    #zdev-error-head p {
      margin: 8px 0 0;
      color: var(--zx-muted);
      font: 500 14px/1.5 sans-serif;
    }
    #zdev-error-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    #zdev-error-actions button {
      border: 1px solid rgba(201,157,77,0.22);
      border-radius: 999px;
      background: rgba(31, 25, 18, 0.96);
      color: #f4e6ca;
      padding: 9px 14px;
      cursor: pointer;
      font: 600 13px/1 sans-serif;
    }
    #zdev-error-body {
      padding: 20px 24px 24px;
      display: grid;
      gap: 12px;
    }
    #zdev-error-stack {
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
      #zdev-drawer {
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
  button.id = 'zdev-button';
  button.type = 'button';
  button.textContent = 'Z';
  const badge = document.createElement('span');
  badge.id = 'zdev-badge';
  button.appendChild(badge);

  const drawer = document.createElement('section');
  drawer.id = 'zdev-drawer';
  drawer.innerHTML = \`
    <div id="zdev-drawer-bar">
      <div id="zdev-drawer-title">
        <strong>\${service ? service.charAt(0).toUpperCase() + service.slice(1) : 'Zdev'} Devtools</strong>
        <span>\${location.pathname}</span>
      </div>
      <div id="zdev-drawer-actions">
        <button type="button" class="zdev-action" id="zdev-open-tab">Open devtools</button>
        <button type="button" class="zdev-action" id="zdev-open-current-tab">Open this page</button>
        <button type="button" class="zdev-action" id="zdev-drawer-close" aria-label="Close">×</button>
      </div>
    </div>
    <div id="zdev-drawer-main">
      <iframe id="zdev-frame" src="\${pairedDevtoolsUrl}" title="Devtools"></iframe>
    </div>
  \`;

  const errorScreen = document.createElement('section');
  errorScreen.id = 'zdev-error-screen';
  errorScreen.innerHTML = \`
    <div id="zdev-error-inner">
      <div id="zdev-error-head">
        <h2>Application Error</h2>
        <p id="zdev-error-message">A runtime error occurred while rendering this page.</p>
        <div id="zdev-error-actions">
          <button type="button" id="zdev-open-drawer">Open diagnostics</button>
          <button type="button" id="zdev-dismiss-error">Dismiss overlay</button>
        </div>
      </div>
      <div id="zdev-error-body">
        <pre id="zdev-error-stack">No stack trace available.</pre>
      </div>
    </div>
  \`;

  const drawerBar = drawer.querySelector('#zdev-drawer-bar');
  const errorMessage = errorScreen.querySelector('#zdev-error-message');
  const errorStack = errorScreen.querySelector('#zdev-error-stack');
  const frame = drawer.querySelector('#zdev-frame');
  
  let isFrameLoaded = false;
  
  const format = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  
  const postThemeToFrame = () => {
    if (!frame || !frame.contentWindow) return;
    
    if (!isFrameLoaded) {
      console.log('[Zdev] Iframe not loaded yet, skipping postMessage');
      return;
    }
    
    frame.contentWindow.postMessage({
      type: 'zdev:theme-sync',
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
      isFrameLoaded = false; // Reset since we're changing src
      frame.setAttribute('src', pairedDevtoolsUrl);
    }
    drawer.classList.add('zdev-open');
    // Don't call postThemeToFrame here - wait for load event
  };
  const closeDrawer = () => {
    state.drawerOpen = false;
    drawer.classList.remove('zdev-open');
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
  const reconnectState = {
    socket: null,
    timer: null,
    attempt: 0,
    applyingUpdate: false,
    queuedPayload: null
  };
  const clearReconnectTimer = () => {
    if (!reconnectState.timer) return;
    clearTimeout(reconnectState.timer);
    reconnectState.timer = null;
  };
  const refreshStylesheets = (version) => {
    const stamp = encodeURIComponent(version || new Date().toISOString());
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));

    links.forEach((link) => {
      if (link.id === 'zdev-style') return;
      try {
        const href = link.getAttribute('href');
        if (!href) return;
        const nextUrl = new URL(href, window.location.href);
        nextUrl.searchParams.set('t', stamp);
        link.setAttribute('href', nextUrl.toString());
      } catch {}
    });
  };
  const stripInjectedDevNodes = (root) => {
    root.querySelectorAll('#zdev-button, #zdev-drawer, #zdev-error-screen, script[data-zdev-client="true"]').forEach((node) => node.remove());
  };
  const executeScripts = (root) => {
    root.querySelectorAll('script').forEach((script) => {
      if (script.hasAttribute('data-zdev-client')) {
        script.remove();
        return;
      }
      const nextScript = document.createElement('script');
      for (const attr of script.attributes) {
        nextScript.setAttribute(attr.name, attr.value);
      }
      nextScript.textContent = script.textContent || '';
      script.replaceWith(nextScript);
    });
  };
  const applyDocumentPatch = async (version) => {
    const response = await fetch(window.location.href, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'text/html',
        'Cache-Control': 'no-cache',
        'X-Zdev-Hot-Update': version || new Date().toISOString()
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch updated document');
    }

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    if (!parsed || !parsed.body) {
      throw new Error('Failed to parse updated document');
    }

    stripInjectedDevNodes(parsed);

    const preservedNodes = [
      document.getElementById('zdev-button'),
      document.getElementById('zdev-drawer'),
      document.getElementById('zdev-error-screen')
    ].filter(Boolean);

    document.title = parsed.title || document.title;

    Array.from(document.body.attributes).forEach((attr) => {
      document.body.removeAttribute(attr.name);
    });
    Array.from(parsed.body.attributes).forEach((attr) => {
      document.body.setAttribute(attr.name, attr.value);
    });

    const nextNodes = Array.from(parsed.body.childNodes).map((node) => document.importNode(node, true));
    document.body.replaceChildren(...nextNodes, ...preservedNodes);
    executeScripts(document.body);
    window.dispatchEvent(new CustomEvent('zdev:hot-update', {
      detail: {
        strategy: 'document',
        updatedAt: version || new Date().toISOString()
      }
    }));
  };
  const applyHotUpdate = async (payload) => {
    if (reconnectState.applyingUpdate) {
      reconnectState.queuedPayload = payload;
      return;
    }

    reconnectState.applyingUpdate = true;
    try {
      if (payload && payload.strategy === 'style') {
        refreshStylesheets(payload.updatedAt);
      } else {
        await applyDocumentPatch(payload && payload.updatedAt);
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      reconnectState.applyingUpdate = false;
    }

    if (reconnectState.queuedPayload) {
      const nextPayload = reconnectState.queuedPayload;
      reconnectState.queuedPayload = null;
      await applyHotUpdate(nextPayload);
    }
  };
  const scheduleReconnect = () => {
    if (reconnectState.timer) return;
    const delay = Math.min(500 * Math.pow(2, reconnectState.attempt), 5000);
    reconnectState.attempt += 1;
    reconnectState.timer = setTimeout(() => {
      reconnectState.timer = null;
      connectSocket();
    }, delay);
  };
  const connectSocket = () => {
    if (reconnectState.socket && (reconnectState.socket.readyState === WebSocket.OPEN || reconnectState.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimer();
    const socket = new WebSocket(wsUrl);
    reconnectState.socket = socket;

    socket.addEventListener('open', () => {
      reconnectState.attempt = 0;
      clearReconnectTimer();
      if (frame && state.drawerOpen && frame.getAttribute('src') !== pairedDevtoolsUrl) {
        isFrameLoaded = false;
        frame.setAttribute('src', pairedDevtoolsUrl);
      }
    });

    socket.addEventListener('message', async (message) => {
      try {
        const data = JSON.parse(message.data);
        if (data.type === 'reload') {
          window.location.reload();
          return;
        }
        if (data.type === 'hot-update') {
          await applyHotUpdate(data.payload || {});
        }
      } catch {}
    });

    socket.addEventListener('close', () => {
      if (reconnectState.socket === socket) {
        reconnectState.socket = null;
      }
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {}
    });
  };
  const showErrorOverlay = (entry) => {
    errorMessage.textContent = entry.message || 'Application Error';
    errorStack.textContent = [entry.message, entry.source, entry.stack].filter(Boolean).join('\\n\\n');
    errorScreen.classList.add('zdev-open');
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

  drawer.querySelector('#zdev-drawer-close')?.addEventListener('click', () => {
    closeDrawer();
  });
  drawer.querySelector('#zdev-drawer-close')?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  drawer.querySelector('#zdev-open-tab')?.addEventListener('click', () => {
    window.open(devtoolsUrl, '_blank', 'noopener,noreferrer');
  });
  drawer.querySelector('#zdev-open-current-tab')?.addEventListener('click', () => {
    window.open(pairedDevtoolsUrl, '_blank', 'noopener,noreferrer');
  });
  
  // Mark iframe as loaded and send initial theme
  frame?.addEventListener('load', () => {
    console.log('[Zdev] Iframe loaded from:', frame.src);
    isFrameLoaded = true;
    postThemeToFrame();
  });
  
  drawer.querySelector('#zdev-open-tab')?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  drawer.querySelector('#zdev-open-current-tab')?.addEventListener('pointerdown', (event) => {
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
    drawer.classList.add('zdev-dragging');
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
    drawer.classList.remove('zdev-dragging');
    if (drawerBar.hasPointerCapture(event.pointerId)) {
      drawerBar.releasePointerCapture(event.pointerId);
    }
    saveDrawerPosition();
  });

  drawerBar?.addEventListener('pointercancel', () => {
    dragState = null;
    drawer.classList.remove('zdev-dragging');
  });

  errorScreen.querySelector('#zdev-open-drawer')?.addEventListener('click', () => {
    openDrawer();
  });
  errorScreen.querySelector('#zdev-dismiss-error')?.addEventListener('click', () => {
    errorScreen.classList.remove('zdev-open');
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
    if (!event.data || event.data.type !== 'zdev:theme-sync') return;

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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      connectSocket();
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
  connectSocket();
})();
</script>
`;

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
  if (/data-zdev-client=["']true["']/.test(html)) return html;
  const snippet = buildInjectedClient(options);
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, match => `${snippet}${match}`)
    : `${html}${snippet}`;
};
