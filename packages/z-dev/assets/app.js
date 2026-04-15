const { config = {}, bootstrap: initialBootstrap = null } = window.zerux || {};
const themeStorageKey = "zerux:devtools:theme";
const themeModes = ["system", "dark", "light"];
let forcedThemeMode = null;
const moduleMounts = new Map();
const loadedScripts = new Map();
const loadedStyles = new Map();

const loadModuleAssets = async (moduleData) => {
  if (!moduleData.assets) return null;

  const { styleUrl, scriptUrl } = moduleData.assets;
  const results = {};

  if (styleUrl) {
    if (!loadedStyles.has(styleUrl)) {
      loadedStyles.set(styleUrl, (async () => {
        const response = await fetch(styleUrl, { cache: "default" });
        if (!response.ok) throw new Error("Failed to load style");
        return response.text();
      })());
    }
    results.style = await loadedStyles.get(styleUrl);
  }

  if (scriptUrl) {
    if (!loadedScripts.has(scriptUrl)) {
      loadedScripts.set(scriptUrl, import(new URL(scriptUrl, window.location.origin).toString()));
    }
    results.script = await loadedScripts.get(scriptUrl);
  }

  return results;
};

const preloadModules = (modules, skipId) => {
  modules.forEach((module) => {
    if (module.id === skipId || (module.sections && module.sections.some(s => s.id === skipId))) return;
    if (module.assets) {
      void loadModuleAssets(module);
    }
  });
};

let applicationState = {
  app: config.app?.routeName || null,
  identifier: config.identifier || null,
  sectionId: config.sectionId || null,
  bootstrap: initialBootstrap,
  socket: null,
  devtoolsSocket: null
};

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const getSystemTheme = () =>
  window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const applyTheme = (mode) => {
  const effective = forcedThemeMode === "dark" || forcedThemeMode === "light"
    ? forcedThemeMode
    : mode === "system" ? getSystemTheme() : mode;
  document.documentElement.setAttribute("data-theme", effective);
  const label = document.querySelector("[data-theme-label]");
  if (label) {
    label.textContent = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
  }
};

const getSavedTheme = () => localStorage.getItem(themeStorageKey) || "system";

const broadcastThemeToParent = (mode) => {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: "zerux:theme-sync",
    mode,
    effectiveTheme: mode === "system" ? getSystemTheme() : mode
  }, "*");
};

const setupThemeToggle = () => {
  let mode = getSavedTheme();
  applyTheme(mode);
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const currentIndex = themeModes.indexOf(mode);
    mode = themeModes[(currentIndex + 1) % themeModes.length];
    localStorage.setItem(themeStorageKey, mode);
    forcedThemeMode = null;
    applyTheme(mode);
    broadcastThemeToParent(mode);
  });
  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (mode === "system") {
      applyTheme(mode);
      broadcastThemeToParent(mode);
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === themeStorageKey) {
      mode = getSavedTheme();
      forcedThemeMode = null;
      applyTheme(mode);
      broadcastThemeToParent(mode);
    }
  });
  window.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "zerux:theme-sync") return;
    const nextMode = event.data.mode;
    const nextEffectiveTheme = event.data.effectiveTheme;
    if (nextMode === "system" || nextMode === "dark" || nextMode === "light") {
      mode = nextMode;
      localStorage.setItem(themeStorageKey, nextMode);
    }
    forcedThemeMode = nextEffectiveTheme === "dark" || nextEffectiveTheme === "light"
      ? nextEffectiveTheme
      : null;
    applyTheme(mode);
  });
  broadcastThemeToParent(mode);
};

const renderOverview = (snapshot, modules) => {
  const root = document.querySelector("[data-overview-root]");
  if (root) root.textContent = snapshot.rootDir || "unknown";
  const manifest = document.querySelector("[data-overview-manifest]");
  if (manifest) manifest.textContent = snapshot.manifestPath || "missing";
  const log = document.querySelector("[data-overview-log]");
  if (log) log.textContent = snapshot.logFilePath || "missing";
  const updated = document.querySelector("[data-overview-updated]");
  if (updated) updated.textContent = snapshot.updatedAt || "unknown";
  const port = document.querySelector("[data-overview-port]");
  if (port) port.textContent = String(snapshot.appPort ?? "unknown");
  const mode = document.querySelector("[data-overview-mode]");
  if (mode) mode.textContent = snapshot.mode || "unknown";
  const routes = document.querySelector("[data-overview-routes]");
  if (routes) routes.textContent = String((snapshot.routes || []).length);
  const moduleCount = document.querySelector("[data-overview-modules]");
  if (moduleCount) moduleCount.textContent = String(modules.length);
  const moduleCountDetail = document.querySelector("[data-overview-module-count]");
  if (moduleCountDetail) moduleCountDetail.textContent = `${modules.length} active`;
};

const renderPages = (snapshot) => {
  const list = document.querySelector("[data-pages-list]");
  if (!list) return;
  list.innerHTML = (snapshot.routes || []).length
    ? snapshot.routes.map((route) => `
      <div class="zx-route-item">
        <strong>${escapeHtml(route.path)}</strong>
        <span>${escapeHtml((route.methods || []).join(", "))}</span>
      </div>
    `).join("")
    : `<p class="zx-empty">No routes found.</p>`;
};

const renderModules = (modules) => {
  const root = document.querySelector("[data-modules-list]");
  if (!root) return;
  root.innerHTML = modules.length
    ? modules.map((module) => `
      <article class="zx-module-card">
        <strong>${escapeHtml(module.title)}</strong>
        <span>${escapeHtml(module.description || "No description provided.")}</span>
        <small>${escapeHtml(module.packageName || module.badge || "custom module")}</small>
      </article>
    `).join("")
    : `<p class="zx-empty">No registered devtools modules.</p>`;
};

const renderDiagnostics = (snapshot) => {
  const events = document.getElementById("events");
  if (events) {
    events.innerHTML = (snapshot.clientEvents || []).length
      ? snapshot.clientEvents.slice().reverse().map((event) => {
          const css = event.type === "error" ? "event-error" : event.type === "warn" ? "event-warn" : "event-info";
          return `<code class="${css}">[${escapeHtml(event.type || "info")}] ${escapeHtml(event.message || JSON.stringify(event))}</code>`;
        }).join("")
      : `<div class="zx-empty">No client events yet.</div>`;
  }
  const logs = document.getElementById("logs");
  if (logs) {
    logs.textContent = (snapshot.logs || []).join("\n") || "No logs yet.";
  }
};

const createModuleApi = (moduleId) => async (name, options = {}) => {
  const url = new URL(`/${applicationState.app}/__zerux/modules/${moduleId}/api/${name}`, window.location.origin);
  if (applicationState.identifier) {
    url.searchParams.set("identifier", applicationState.identifier);
  }
  url.searchParams.set("requester", moduleId);
  const method = options.method || "POST";
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(options.body ?? {})
  });
  return response.json();
};

const createDevtoolsSocket = () => {
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL(`${wsProtocol}//${location.host}/__zerux/ws`);
  wsUrl.searchParams.set("app", applicationState.app);
  wsUrl.searchParams.set("client", "devtools");
  if (applicationState.identifier) {
    wsUrl.searchParams.set("identifier", applicationState.identifier);
  }
  return new WebSocket(wsUrl.toString());
};

const createModuleSocket = (moduleId) => {
  const socket = applicationState.devtoolsSocket;

  return {
    raw: socket,
    requestServer(channel, payload) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        type: "channel",
        channelType: "server",
        app: applicationState.app,
        moduleId,
        requesterModuleId: moduleId,
        channel,
        identifier: applicationState.identifier || undefined,
        payload: payload || {}
      }));
    },
    sendPeer(channel, payload, targetModuleId) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        type: "channel",
        channelType: "peer",
        app: applicationState.app,
        moduleId,
        targetModuleId,
        requesterModuleId: moduleId,
        channel,
        identifier: applicationState.identifier || undefined,
        payload: payload || {}
      }));
    },
    onMessage(handler) {
      socket?.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.moduleId && message.moduleId !== moduleId) return;
          handler(message);
        } catch {
          return;
        }
      });
    },
    close() {
      return;
    }
  };
};

const mountModulePanel = async (panel, moduleData) => {
  if (!moduleData || moduleMounts.has(panel)) {
    return;
  }

  const host = panel.querySelector("[data-module-root]");
  const template = host?.querySelector("template");
  if (!host || !template) {
    return;
  }

  const shadowRoot = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("div");
  wrapper.className = "zx-module-surface";

  const baseStyle = document.createElement("style");
  baseStyle.textContent = `
    :host { color: inherit; }
    *, *::before, *::after { box-sizing: border-box; }
    .zx-module-surface { color: inherit; font: inherit; }
  `;
  shadowRoot.append(baseStyle, wrapper);
  wrapper.append(template.content.cloneNode(true));

  let lifecycle = null;
  const assets = await loadModuleAssets(moduleData);

  if (assets?.style) {
    const style = document.createElement("style");
    style.textContent = assets.style;
    shadowRoot.prepend(style);
  }

  const mod = assets?.script;
  if (mod) {
    const mount = mod.mount || mod.default?.mount;
    if (typeof mount === "function") {
      lifecycle = await mount({
        app: config.app,
        identifier: config.identifier || null,
        snapshot: applicationState.bootstrap?.snapshot || {},
        module: moduleData,
        root: wrapper,
        shadowRoot,
        api: createModuleApi(moduleData.id),
        socket: createModuleSocket(moduleData.id)
      });
    }
  }

  moduleMounts.set(panel, {
    refresh(nextState) {
      lifecycle?.refresh?.(nextState);
    },
    destroy() {
      lifecycle?.destroy?.();
      lifecycle?.socket?.close?.();
    }
  });
};

const setActiveSection = async (id, skipHistory = false) => {
  if (!skipHistory) {
    const url = new URL(window.location.href);
    url.pathname = `/${applicationState.app}/${id === "overview" ? "" : id}`;
    if (applicationState.identifier) {
      url.searchParams.set("identifier", applicationState.identifier);
    }
    window.history.pushState({ sectionId: id }, "", url.toString());
  }

  applicationState.sectionId = id;
  document.querySelectorAll("[data-section-link]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-section-link") === id);
  });

  const modules = applicationState.bootstrap?.modules || config.modules || [];
  const moduleMap = new Map(modules.map((module) => [module.id, module]));

  for (const panel of document.querySelectorAll("[data-section-panel]")) {
    const isActive = panel.getAttribute("data-section-panel") === id;
    panel.classList.toggle("is-active", isActive);
    if (!isActive) continue;

    const moduleId = panel.getAttribute("data-module-panel");
    if (moduleId) {
      await mountModulePanel(panel, moduleMap.get(moduleId));
    }
  }
};

const setupSectionNavigation = (sections) => {
  const shell = document.querySelector(".zx-app-shell");
  const closeSidebar = () => shell?.classList.remove("is-sidebar-open");
  document.querySelectorAll("[data-section-link]").forEach((link) => {
    link.addEventListener("click", async () => {
      const id = link.getAttribute("data-section-link");
      if (!id) return;
      if (window.innerWidth <= 750) {
        closeSidebar();
      }
      await setActiveSection(id);
    });
  });
  const initialId = config.sectionId || (sections[0]?.id);
  if (initialId) {
    void setActiveSection(initialId, true);
  }

  window.addEventListener("popstate", (event) => {
    const id = event.state?.sectionId || config.sectionId || (sections[0]?.id);
    if (id) {
      void setActiveSection(id, true);
    }
  });
  document.querySelector("[data-sidebar-close]")?.addEventListener("click", closeSidebar);
  document.addEventListener("click", (event) => {
    if (window.innerWidth > 750) return;
    if (!shell?.classList.contains("is-sidebar-open")) return;
    const sidebar = document.querySelector("[data-sidebar]");
    const toggle = document.querySelector("[data-sidebar-toggle]");
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (sidebar?.contains(target) || toggle?.contains(target)) return;
    closeSidebar();
  });
};

const setupApplication = async () => {
  const app = config.app?.routeName;
  if (!app) return;

  applicationState.app = app;
  applicationState.identifier = config.identifier || null;

  const bootstrapUrl = new URL(`/${app}/__zerux/api/bootstrap`, window.location.origin);
  if (applicationState.identifier) bootstrapUrl.searchParams.set("identifier", applicationState.identifier);

  const refresh = async () => {
    const response = await fetch(bootstrapUrl, { cache: "no-store" });
    const data = await response.json();
    
    // Merge only updated info (snapshot, identifier) into the bootstrap state
    // to preserve static config like modules and sections metadata.
    applicationState.bootstrap = {
      ...(applicationState.bootstrap || {}),
      ...data,
      snapshot: {
        ...(applicationState.bootstrap?.snapshot || {}),
        ...(data.snapshot || {})
      }
    };
    
    // Sync with global window object
    window.zerux.bootstrap = applicationState.bootstrap;
    
    const { snapshot, modules = [] } = applicationState.bootstrap;
    renderOverview(snapshot, modules);
    renderPages(snapshot);
    renderModules(modules);
    renderDiagnostics(snapshot);
    
    for (const mount of moduleMounts.values()) {
      mount.refresh?.(applicationState.bootstrap);
    }
    if (modules.length) {
      preloadModules(modules, applicationState.sectionId);
    }
  };

  if (!applicationState.bootstrap) {
    applicationState.bootstrap = { ...config };
    window.zerux.bootstrap = applicationState.bootstrap;
  }

  setupSectionNavigation(config.sections || []);
  if (config.modules) {
    const initialId = config.sectionId || (config.sections && config.sections[0]?.id);
    preloadModules(config.modules, initialId);
  }
  document.querySelector("[data-sidebar-toggle]")?.addEventListener("click", () => {
    document.querySelector(".zx-app-shell")?.classList.toggle("is-sidebar-open");
  });
  
  if (applicationState.bootstrap.snapshot) {
    // Initial snapshot present (if we had it in inject, which we don't for now, but good for future)
    // or we just initialized it from config. 
    // If we only have config, we still need one refresh for the snapshot.
    const data = applicationState.bootstrap;
    if (data.snapshot && Object.keys(data.snapshot).length > 0) {
        renderOverview(data.snapshot, data.modules || []);
        renderPages(data.snapshot);
        renderModules(data.modules || []);
        renderDiagnostics(data.snapshot);
        if (data.modules) {
          preloadModules(data.modules, applicationState.sectionId);
        }
    } else {
        await refresh();
    }
  } else {
    await refresh();
  }

  const socket = createDevtoolsSocket();
  applicationState.devtoolsSocket = socket;
  applicationState.socket = socket;
  socket.addEventListener("open", () => {
    const badge = document.getElementById("ws-badge");
    if (badge) badge.textContent = "ws: connected";
  });
  socket.addEventListener("message", () => {
    refresh().catch(() => undefined);
  });
  socket.addEventListener("close", () => {
    const badge = document.getElementById("ws-badge");
    if (badge) badge.textContent = "ws: reconnecting";
    setTimeout(setupApplication, 1000);
  }, { once: true });
};

setupThemeToggle();
if (config.page === "application") {
  setupApplication().catch(() => undefined);
}
